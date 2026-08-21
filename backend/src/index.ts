import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';
import crypto from 'crypto';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';

import { authRouter, definirSocketAuth } from './routes/auth';
import { criarUsuariosRouter } from './routes/usuarios';
import { empresasRouter } from './routes/empresas';
import { criarDispositivosRouter } from './routes/dispositivos';
import { topologiaRouter } from './routes/topologia';
import { auditoriaRouter } from './routes/auditoria';
import { alertasRouter } from './routes/alertas';
import { linksRouter } from './routes/links';
import { integracaoRouter } from './routes/integracao';
import { adminRouter } from './routes/admin';
import { criarAntenasRouter } from './routes/antenas';
import { devicesPingHistoryRouter } from './routes/pingHistory';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { criarServidorMcp } from './mcp/uptimexMcp';
import { iniciarTodosDispositivos } from './services/monitorEngine';
import { iniciarTodasAntenas } from './services/antenaEngine';
import { carregarConfig } from './services/configService';
import { telegramConfigurado } from './services/telegramService';
import { iniciarAgendadorResumos } from './services/resumoService';
import { iniciarServicoSeriesTemporais, pararServicoSeriesTemporais } from './services/pingSeriesService';
import { carregarUsuarioAutenticado, usuarioPodeAcessarEmpresaAtual } from './middleware/auth';
import { csrfMiddleware } from './middleware/csrf';
import { parseCookies, SESSION_COOKIE } from './services/sessionService';
import { autenticarChaveMcp } from './services/mcpKeyService';
import { iniciarRetencaoAuditoria } from './services/auditService';
import { mapRouter } from './routes/map';

dotenv.config();

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);

// Acesso direto não confia em headers de proxy. No compose, o backend só recebe
// tráfego do Nginx e TRUST_PROXY_HOPS=1 permite recuperar o IP do visitante.
const trustProxyHops = Math.max(0, Math.min(2, Number(process.env.TRUST_PROXY_HOPS || 0) || 0));
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

// FRONTEND_URL aceita lista separada por vírgula. Além dela, libera o frontend
// servido por IP privado da rede local (acesso pelo celular no dev), sempre na
// porta 5173 — origens públicas continuam bloqueadas.
const origensPermitidas = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const REDE_LOCAL_5173 = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)[\d.]+:5173$/;

function validarOrigem(
  origin: string | undefined,
  cb: (err: Error | null, permitir?: boolean) => void
) {
  const liberarRedeDev = String(process.env.ALLOW_PRIVATE_DEV_ORIGINS || '').toLowerCase() === 'true';
  if (!origin || origensPermitidas.includes(origin) || (liberarRedeDev && REDE_LOCAL_5173.test(origin))) {
    return cb(null, true);
  }
  cb(new Error('Origem não permitida pelo CORS'));
}

const tentativasSocket = new Map<string, { inicio: number; total: number }>();
function permitirHandshakeSocket(req: http.IncomingMessage): boolean {
  const remoto = req.socket.remoteAddress || 'desconhecido';
  const encaminhado = trustProxyHops > 0
    ? String(req.headers['x-real-ip'] || '').slice(0, 64)
    : '';
  const chave = encaminhado || remoto;
  const agora = Date.now();
  const atual = tentativasSocket.get(chave);
  if (!atual || agora - atual.inicio >= 60_000) {
    if (tentativasSocket.size > 10_000) tentativasSocket.clear();
    tentativasSocket.set(chave, { inicio: agora, total: 1 });
    return true;
  }
  atual.total += 1;
  return atual.total <= 60;
}

const io = new SocketServer(server, {
  cors: { origin: validarOrigem, credentials: true },
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (req, callback) => callback(null, permitirHandshakeSocket(req)),
});
definirSocketAuth(io);

// A API é consumida por um frontend em outra origem (porta/domínio diferente).
// As fotos protegidas também passam por fetch autenticado nessa configuração.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
}));

// Endpoint experimental aposentado. O bloqueio vem antes de CORS, parsing e
// routers para que todos os métodos (inclusive OPTIONS) terminem aqui.
app.use('/api/teste-antigravity', (_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

app.use(cors({ origin: validarOrigem, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api', csrfMiddleware);

// Limitador global: rede de segurança contra flood/abuso. Teto alto de propósito
// pra não atrapalhar o polling do painel (vários operadores/TVs, às vezes atrás
// do mesmo IP). O login tem um limitador próprio bem mais estrito (10/15min).
const limitadorGlobal = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições em pouco tempo. Aguarde um instante.' },
});
app.use('/api', limitadorGlobal);

app.use('/api/auth', authRouter);
app.use('/api/usuarios', criarUsuariosRouter(io));
app.use('/api/empresas', empresasRouter);
app.use('/api/dispositivos', criarDispositivosRouter(io));
app.use('/api/topologia', topologiaRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/links', linksRouter);
app.use('/api/integracao', integracaoRouter);
app.use('/api/admin', adminRouter);
app.use('/api/antenas', criarAntenasRouter(io));
app.use('/api/devices', devicesPingHistoryRouter);
app.use('/api/map', mapRouter);

// -------- Servidor MCP (Streamable HTTP, stateless) --------
// A IA da empresa conecta aqui. Autenticação própria por chave MCP,
// independente da sessão dos usuários; as ferramentas são somente leitura.
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'Limite de requisicoes excedido.' }, id: null },
});

app.post('/api/mcp', mcpLimiter, async (req, res) => {
  const respJsonRpc = (status: number, message: string) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: req.body?.id ?? null });

  const auth = req.headers.authorization || '';
  const enviado = auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : String(req.headers['x-api-key'] || '').trim();
  const escopo = await autenticarChaveMcp(enviado);
  if (!escopo) return respJsonRpc(401, 'Chave de API invalida, expirada ou ausente.');

  const mcp = criarServidorMcp(escopo);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', (_req, res) => {
  res.status(404).json({ erro: 'Rota nao encontrada.' });
});

app.use((erro: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(erro);
  const isMulter = erro?.name === 'MulterError';
  const isCors = String(erro?.message || '').includes('CORS');
  const status = isMulter ? 400 : isCors ? 403 : 500;
  const identificador = crypto.randomUUID();
  const mensagemInterna = process.env.NODE_ENV === 'production'
    ? (erro?.name || 'Error')
    : (erro instanceof Error ? erro.message : 'erro desconhecido');
  console.error(`[request-error ${identificador}] ${req.method} ${req.path}: ${mensagemInterna}`);
  res.status(status).json({
    erro: status === 400
      ? 'Arquivo invalido ou acima do limite permitido.'
      : status === 403
        ? 'Origem nao permitida.'
        : 'Falha interna ao processar a requisicao.',
    id: identificador,
  });
});

// Handshake do socket exige a mesma sessão opaca usada na API — sem isso qualquer cliente
// conseguiria entrar na sala de status ao vivo de qualquer empresa.
io.use(async (socket, next) => {
  const cookieToken = parseCookies(socket.request.headers.cookie)[SESSION_COOKIE];
  const bearerToken = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token.trim()
    : '';
  const token = cookieToken || bearerToken;
  if (!token) return next(new Error('unauthorized'));
  try {
    socket.data.user = await carregarUsuarioAutenticado(token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

// Cliente entra na "sala" da empresa pra receber só os eventos relevantes
io.on('connection', async (socket) => {
  const usuario = socket.data.user;
  const expiraEmMs = usuario.tokenExpiresAt
    ? usuario.tokenExpiresAt * 1000 - Date.now()
    : 0;
  if (expiraEmMs <= 0) {
    socket.disconnect(true);
    return;
  }
  const timerExpiracao = setTimeout(() => socket.disconnect(true), expiraEmMs);
  socket.once('disconnect', () => clearTimeout(timerExpiracao));

  socket.join(`usuario_${usuario.id}`);
  if (usuario.sessionId) socket.join(`sessao_${usuario.sessionId}`);
  const conexoesUsuario = await io.in(`usuario_${usuario.id}`).fetchSockets();
  if (conexoesUsuario.length > 10) {
    socket.disconnect(true);
    return;
  }
  let janelaEventos = Date.now();
  let eventosRecebidos = 0;
  socket.use((_evento, next) => {
    const agora = Date.now();
    if (agora - janelaEventos >= 10_000) {
      janelaEventos = agora;
      eventosRecebidos = 0;
    }
    eventosRecebidos += 1;
    if (eventosRecebidos > 100) {
      socket.disconnect(true);
      return next(new Error('rate limit'));
    }
    next();
  });
  if (usuario.role === 'admin') {
    socket.join('antenas_noc');
    socket.join('empresas_admin');
  } else if (usuario.empresaIds.length > 0) {
    socket.join(usuario.empresaIds.map((empresaId: number) => `empresa_${empresaId}`));
  }
  socket.on('entrar_empresa', async (valor: unknown, responder?: (resultado: { ok: boolean }) => void) => {
    const empresaId = Number(valor);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      responder?.({ ok: false });
      return;
    }

    try {
      const autorizado = await usuarioPodeAcessarEmpresaAtual(usuario.id, empresaId);
      if (!autorizado) {
        socket.leave(`empresa_${empresaId}`);
        console.warn(`Socket negado: usuario=${usuario.id} empresa=${empresaId}`);
        responder?.({ ok: false });
        return;
      }
      await socket.join(`empresa_${empresaId}`);
      responder?.({ ok: true });
    } catch {
      responder?.({ ok: false });
    }
  });
  socket.on('sair_empresa', (valor: unknown) => {
    const empresaId = Number(valor);
    if (Number.isInteger(empresaId) && empresaId > 0) {
      socket.leave(`empresa_${empresaId}`);
    }
  });
});

const PORT = Number(process.env.PORT || 4000);
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
server.listen(PORT, BIND_HOST, async () => {
  console.log(`NetMonitor backend rodando em ${BIND_HOST}:${PORT}`);
  await carregarConfig();
  console.log(
    telegramConfigurado()
      ? 'Alertas Telegram: ATIVOS'
      : 'Alertas Telegram: desativados (configure na tela Usuários ou no .env)'
  );
  iniciarServicoSeriesTemporais();
  await iniciarTodosDispositivos(io);
  await iniciarTodasAntenas(io);
  iniciarAgendadorResumos();
  iniciarRetencaoAuditoria();
});

async function encerrarServidor(sinal: string) {
  console.log(`${sinal} recebido; persistindo a fila de ping antes de encerrar.`);
  server.close();
  try {
    await pararServicoSeriesTemporais();
  } finally {
    process.exit(0);
  }
}

process.once('SIGTERM', () => void encerrarServidor('SIGTERM'));
process.once('SIGINT', () => void encerrarServidor('SIGINT'));
