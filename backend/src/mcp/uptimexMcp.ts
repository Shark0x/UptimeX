import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { pool } from '../db/pool';

/**
 * Servidor MCP da uptimeX — expõe os dados de monitoramento como ferramentas
 * read-only pra uma IA/LLM (Claude ou compatível) consultar a operação:
 * "quais clientes estão em queda?", "qual a latência da empresa X?", etc.
 *
 * Tudo é somente leitura; nenhuma ferramenta altera dados.
 */

const LIMIAR_LATENCIA = 150; // ms — acima disso, degradado
const LIMIAR_PERDA = 2; // % — acima disso, degradado

type StatusEmpresa = 'online' | 'degradado' | 'offline' | 'sem_monitor';

interface ResumoEmpresa {
  id: number;
  nome: string;
  endereco: string | null;
  total: number;
  online: number;
  offline: number;
  degradados: number;
  status: StatusEmpresa;
}

/** Status agregado de cada empresa (mesma regra da interface). */
async function resumoEmpresas(): Promise<ResumoEmpresa[]> {
  const [rows]: any = await pool.query(`
    SELECT e.id, e.nome, e.endereco,
      COUNT(d.id) AS total,
      SUM(CASE WHEN d.status_atual = 'offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN d.status_atual = 'online'
               AND (d.latencia_ms >= ? OR d.perda_pct >= ?) THEN 1 ELSE 0 END) AS degradados,
      SUM(CASE WHEN d.status_atual = 'online'
               AND NOT (COALESCE(d.latencia_ms, 0) >= ? OR COALESCE(d.perda_pct, 0) >= ?) THEN 1 ELSE 0 END) AS online
    FROM empresas e
    LEFT JOIN dispositivos d ON d.empresa_id = e.id AND d.ativo = TRUE
    GROUP BY e.id, e.nome, e.endereco
    ORDER BY e.nome
  `, [LIMIAR_LATENCIA, LIMIAR_PERDA, LIMIAR_LATENCIA, LIMIAR_PERDA]);

  return rows.map((r: any): ResumoEmpresa => {
    const total = Number(r.total);
    const offline = Number(r.offline);
    const degradados = Number(r.degradados);
    const online = Number(r.online);
    const status: StatusEmpresa =
      total === 0 ? 'sem_monitor' : offline > 0 ? 'offline' : degradados > 0 ? 'degradado' : 'online';
    return { id: Number(r.id), nome: r.nome, endereco: r.endereco ?? null, total, online, offline, degradados, status };
  });
}

/** Empacota um objeto como resposta MCP (texto JSON + dados estruturados). */
function resposta(obj: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

export function criarServidorMcp(): McpServer {
  const server = new McpServer({ name: 'uptimex-mcp-server', version: '1.0.0' });

  // ---- panorama da operação ----
  server.registerTool(
    'uptimex_status_geral',
    {
      title: 'Status geral da rede',
      description:
        'Retorna o panorama atual de toda a operação monitorada pela uptimeX: ' +
        'total de empresas e quantas estão 100% no ar / em atenção / em queda, ' +
        'total de dispositivos e quantos respondem, e a lista de nomes das empresas em queda. ' +
        'Use como ponto de partida pra saber "como está a rede agora". Sem parâmetros.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const emps = await resumoEmpresas();
      let ok = 0, atencao = 0, queda = 0, dispNoAr = 0, dispFora = 0, dispTotal = 0;
      for (const e of emps) {
        if (e.status === 'offline') queda++;
        else if (e.status === 'degradado') atencao++;
        else if (e.status === 'online') ok++;
        dispNoAr += e.online + e.degradados;
        dispFora += e.offline;
        dispTotal += e.total;
      }
      return resposta({
        empresas_total: emps.length,
        empresas_ok: ok,
        empresas_em_atencao: atencao,
        empresas_em_queda: queda,
        dispositivos_total: dispTotal,
        dispositivos_no_ar: dispNoAr,
        dispositivos_fora: dispFora,
        empresas_em_queda_nomes: emps.filter((e) => e.status === 'offline').map((e) => e.nome),
      });
    }
  );

  // ---- lista de empresas com status ----
  server.registerTool(
    'uptimex_listar_empresas',
    {
      title: 'Listar empresas monitoradas',
      description:
        'Lista as empresas monitoradas com o status agregado de cada uma (online / degradado / offline / sem_monitor) ' +
        'e a contagem de dispositivos no ar e fora. Use `apenas_com_problema: true` pra trazer só quem está em queda ou degradação. ' +
        'Retorna: { total, empresas: [{ id, nome, endereco, status, dispositivos_total, no_ar, fora }] }.',
      inputSchema: {
        apenas_com_problema: z
          .boolean()
          .default(false)
          .describe('Se true, retorna só empresas com queda (offline) ou degradação'),
        limite: z.number().int().min(1).max(500).default(200).describe('Máximo de empresas a retornar'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ apenas_com_problema, limite }) => {
      let emps = await resumoEmpresas();
      if (apenas_com_problema) emps = emps.filter((e) => e.status === 'offline' || e.status === 'degradado');
      const recorte = emps.slice(0, limite);
      return resposta({
        total: emps.length,
        exibidas: recorte.length,
        empresas: recorte.map((e) => ({
          id: e.id,
          nome: e.nome,
          endereco: e.endereco,
          status: e.status,
          dispositivos_total: e.total,
          no_ar: e.online + e.degradados,
          fora: e.offline,
        })),
      });
    }
  );

  // ---- busca de empresa por nome ----
  server.registerTool(
    'uptimex_buscar_empresa',
    {
      title: 'Buscar empresa por nome',
      description:
        'Procura empresas cujo nome contém o termo informado (busca parcial, ignora acentos/maiúsculas no lado do banco). ' +
        'Útil pra descobrir o id/nome exato antes de detalhar os dispositivos. ' +
        'Retorna: { total, empresas: [{ id, nome, endereco, status }] }.',
      inputSchema: {
        termo: z.string().min(1).max(150).describe('Parte do nome da empresa, ex: "acme" ou "clube"'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ termo }) => {
      const emps = await resumoEmpresas();
      const t = termo.trim().toLowerCase();
      const achadas = emps.filter((e) => e.nome.toLowerCase().includes(t));
      return resposta({
        total: achadas.length,
        empresas: achadas.map((e) => ({ id: e.id, nome: e.nome, endereco: e.endereco, status: e.status })),
      });
    }
  );

  // ---- dispositivos de uma empresa ----
  server.registerTool(
    'uptimex_dispositivos_empresa',
    {
      title: 'Dispositivos de uma empresa',
      description:
        'Lista os dispositivos monitorados de uma empresa, com status atual, IP, latência (ms), perda (%) e última verificação. ' +
        'Aceite o id numérico OU parte do nome da empresa em `empresa`. Se o nome casar com mais de uma, retorna a lista de candidatas. ' +
        'Retorna: { empresa, dispositivos: [{ nome, ip, status, latencia_ms, perda_pct, ultima_verificacao }] }.',
      inputSchema: {
        empresa: z.string().min(1).max(150).describe('Id numérico da empresa OU parte do nome dela'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ empresa }) => {
      const termo = empresa.trim();
      let empresaId: number | null = null;
      let empresaNome = '';

      if (/^\d+$/.test(termo)) {
        const [rows]: any = await pool.query(`SELECT id, nome FROM empresas WHERE id = ?`, [Number(termo)]);
        if (rows.length === 0) return resposta({ erro: `Nenhuma empresa com id ${termo}.` });
        empresaId = rows[0].id;
        empresaNome = rows[0].nome;
      } else {
        const [rows]: any = await pool.query(
          `SELECT id, nome FROM empresas WHERE nome LIKE ? ORDER BY nome`,
          [`%${termo}%`]
        );
        if (rows.length === 0) return resposta({ erro: `Nenhuma empresa com "${termo}" no nome.` });
        if (rows.length > 1) {
          return resposta({
            aviso: `"${termo}" casou com ${rows.length} empresas — refine ou use o id.`,
            candidatas: rows.map((r: any) => ({ id: r.id, nome: r.nome })),
          });
        }
        empresaId = rows[0].id;
        empresaNome = rows[0].nome;
      }

      const [disp]: any = await pool.query(
        `SELECT nome, ip, status_atual, latencia_ms, perda_pct, ultima_verificacao
         FROM dispositivos WHERE empresa_id = ? AND ativo = TRUE ORDER BY nome`,
        [empresaId]
      );
      return resposta({
        empresa: { id: empresaId, nome: empresaNome },
        dispositivos: disp.map((d: any) => ({
          nome: d.nome,
          ip: d.ip,
          status: d.status_atual,
          latencia_ms: d.latencia_ms != null ? Number(d.latencia_ms) : null,
          perda_pct: d.perda_pct != null ? Number(d.perda_pct) : null,
          ultima_verificacao: d.ultima_verificacao,
        })),
      });
    }
  );

  // ---- quedas recentes ----
  server.registerTool(
    'uptimex_quedas_recentes',
    {
      title: 'Quedas recentes',
      description:
        'Lista os eventos de queda (dispositivos que ficaram offline) nas últimas N horas, do mais recente ao mais antigo, ' +
        'com empresa, dispositivo, início, fim e duração em minutos (fim/duração nulos = ainda fora do ar). ' +
        'Retorna: { desde_horas, total, quedas: [{ empresa, dispositivo, ip, inicio, fim, duracao_min, em_andamento }] }.',
      inputSchema: {
        horas: z.number().int().min(1).max(720).default(24).describe('Janela em horas pra trás (padrão 24, máx 720 = 30 dias)'),
        limite: z.number().int().min(1).max(200).default(50).describe('Máximo de eventos'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ horas, limite }) => {
      const [rows]: any = await pool.query(
        `SELECT e.nome AS empresa, d.nome AS dispositivo, d.ip,
                se.inicio, se.fim, se.duracao_segundos
         FROM status_eventos se
         JOIN dispositivos d ON d.id = se.dispositivo_id
         JOIN empresas e ON e.id = d.empresa_id
         WHERE se.status = 'offline' AND se.inicio >= NOW() - INTERVAL ? HOUR
         ORDER BY se.inicio DESC
         LIMIT ?`,
        [horas, limite]
      );
      return resposta({
        desde_horas: horas,
        total: rows.length,
        quedas: rows.map((r: any) => ({
          empresa: r.empresa,
          dispositivo: r.dispositivo,
          ip: r.ip,
          inicio: r.inicio,
          fim: r.fim,
          duracao_min: r.duracao_segundos != null ? Math.round(Number(r.duracao_segundos) / 60) : null,
          em_andamento: r.fim === null,
        })),
      });
    }
  );

  return server;
}
