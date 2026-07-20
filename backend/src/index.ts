import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import path from 'path';
import { Server as SocketServer } from 'socket.io';
import dotenv from 'dotenv';

import { authRouter } from './routes/auth';
import { usuariosRouter } from './routes/usuarios';
import { empresasRouter } from './routes/empresas';
import { criarDispositivosRouter } from './routes/dispositivos';
import { topologiaRouter } from './routes/topologia';
import { auditoriaRouter } from './routes/auditoria';
import { alertasRouter } from './routes/alertas';
import { linksRouter } from './routes/links';
import { iniciarTodosDispositivos } from './services/monitorEngine';
import { telegramConfigurado } from './services/telegramService';
import { verifyToken } from './services/authService';

dotenv.config();

const app = express();
const server = http.createServer(app);

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
  if (!origin || origensPermitidas.includes(origin) || REDE_LOCAL_5173.test(origin)) {
    return cb(null, true);
  }
  cb(new Error('Origem não permitida pelo CORS'));
}

const io = new SocketServer(server, {
  cors: { origin: validarOrigem },
});

// crossOriginResourcePolicy 'cross-origin': a API (incluindo /uploads) é consumida
// por um frontend em outra origem (porta/domínio diferente), então o padrão
// "same-origin" do helmet bloquearia inclusive o carregamento das fotos de empresa.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: validarOrigem }));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/empresas', empresasRouter);
app.use('/api/dispositivos', criarDispositivosRouter(io));
app.use('/api/topologia', topologiaRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/links', linksRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Handshake do socket exige o mesmo JWT usado na API — sem isso qualquer cliente
// conseguiria entrar na sala de status ao vivo de qualquer empresa.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('unauthorized'));
  try {
    verifyToken(token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

// Cliente entra na "sala" da empresa pra receber só os eventos relevantes
io.on('connection', (socket) => {
  socket.on('entrar_empresa', (empresaId: number) => {
    socket.join(`empresa_${empresaId}`);
  });
  socket.on('sair_empresa', (empresaId: number) => {
    socket.leave(`empresa_${empresaId}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`NetMonitor backend rodando na porta ${PORT}`);
  console.log(
    telegramConfigurado()
      ? 'Alertas Telegram: ATIVOS'
      : 'Alertas Telegram: desativados (defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env)'
  );
  await iniciarTodosDispositivos(io);
});
