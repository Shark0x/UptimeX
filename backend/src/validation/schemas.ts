import { z } from 'zod';
import { portaSnmpPermitida, validarDestinoMonitoramento } from '../security/monitorTarget';

const enderecoMonitorado = z.string().trim().max(45).superRefine((valor, contexto) => {
  const resultado = validarDestinoMonitoramento(valor);
  if (!resultado.ok) contexto.addIssue({ code: 'custom', message: resultado.motivo });
});

const portaSnmp = z.coerce.number().int().min(1).max(65535)
  .refine(portaSnmpPermitida, 'Porta SNMP fora de SNMP_ALLOWED_PORTS.');

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});

const senhaForte = z.string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres')
  .max(200)
  .regex(/[a-z]/, 'A senha deve conter letra minuscula')
  .regex(/[A-Z]/, 'A senha deve conter letra maiuscula')
  .regex(/[0-9]/, 'A senha deve conter numero');

export const alterarMinhaSenhaSchema = z.object({
  senha_atual: z.string().min(1).max(200),
  nova_senha: senhaForte,
}).refine((valor) => valor.senha_atual !== valor.nova_senha, {
  path: ['nova_senha'],
  message: 'A nova senha deve ser diferente da atual.',
});

export const redefinirSenhaUsuarioSchema = z.object({ nova_senha: senhaForte });

export const atualizarUsuarioSchema = z.object({
  username: z.string().trim().min(3).max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Use apenas letras, numeros, ponto, hifen ou underscore'),
  nova_senha: senhaForte.optional(),
});

export const criarUsuarioSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/, 'Use apenas letras, números, ponto, hífen ou underscore'),
  // Mínimo 10 com pelo menos uma letra e um número — dificulta brute-force e
  // senhas triviais. (O login não valida formato, só existência: senhas antigas
  // continuam funcionando; a regra vale para novas contas.)
  password: z
    .string()
    .min(10, 'A senha deve ter pelo menos 10 caracteres')
    .max(200)
    .regex(/[A-Za-z]/, 'A senha deve conter ao menos uma letra')
    .regex(/[0-9]/, 'A senha deve conter ao menos um número'),
  role: z.enum(['admin', 'operador', 'visualizador']),
  empresa_ids: z.array(z.coerce.number().int().positive()).max(1000).optional().default([]),
}).superRefine((valor, contexto) => {
  if (valor.password.length < 12 || !/[a-z]/.test(valor.password) || !/[A-Z]/.test(valor.password)) {
    contexto.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'Use ao menos 12 caracteres, com maiuscula, minuscula e numero.',
    });
  }
});

export const atualizarVinculosUsuarioSchema = z.object({
  empresa_ids: z.array(z.coerce.number().int().positive()).max(1000),
});

export const gerarChaveMcpSchema = z.object({
  empresa_id: z.coerce.number().int().positive().optional().nullable(),
  global: z.boolean().optional().default(false),
  expires_days: z.coerce.number().int().min(1).max(365).optional().default(90),
}).superRefine((valor, contexto) => {
  if (!valor.global && !valor.empresa_id) {
    contexto.addIssue({ code: 'custom', path: ['empresa_id'], message: 'Selecione a empresa ou marque escopo global.' });
  }
  if (valor.global && valor.empresa_id) {
    contexto.addIssue({ code: 'custom', path: ['empresa_id'], message: 'Chave global nao deve ter empresa.' });
  }
});

// Vem de multipart/form-data, então números chegam como string e campo vazio como ''.
const coordenada = (limite: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
    z.number().min(-limite).max(limite).optional()
  );

export const criarEmpresaSchema = z.object({
  nome: z.string().trim().min(1).max(150),
  descricao: z.string().trim().max(255).optional().or(z.literal('')),
  endereco: z.string().trim().max(255).optional().or(z.literal('')),
  latitude: coordenada(90),
  longitude: coordenada(180),
});

// Bloco IPv4 em notação CIDR (ex: 45.174.147.128/30)
const REGEX_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
export const criarLinkSchema = z.object({
  empresa_id: z.coerce.number().int().positive(),
  bloco: z
    .string()
    .trim()
    .regex(REGEX_CIDR, 'Use o formato IP/prefixo, ex: 45.174.147.128/30')
    .refine((b) => {
      const m = b.match(REGEX_CIDR)!;
      return m.slice(1, 5).every((o) => Number(o) <= 255) && Number(m[5]) <= 32;
    }, 'Octetos vão até 255 e o prefixo até /32'),
  descricao: z.string().trim().max(255).optional().or(z.literal('')),
});

export const criarDispositivoSchema = z.object({
  empresa_id: z.coerce.number().int().positive(),
  nome: z.string().trim().min(1).max(150),
  ip: enderecoMonitorado,
  fabricante: z.enum(['mikrotik', 'ubiquiti', 'cisco', 'generico']).optional(),
  metodo_monitoramento: z.enum(['snmp', 'ping', 'snmp+ping']).optional(),
  comunidade_snmp: z.string().trim().max(100).optional(),
  porta_snmp: portaSnmp.optional(),
  intervalo_polling_seg: z.coerce.number().int().min(5).max(3600).optional(),
});

export const editarDispositivoSchema = criarDispositivoSchema.omit({ empresa_id: true }).extend({
  ativo: z.coerce.boolean().optional(),
});

const FABRICANTES_ANTENA = ['ubiquiti', 'mikrotik', 'mimosa', 'intelbras', 'cambium', 'cisco', 'outro'] as const;
const TIPOS_WIRELESS = [
  'ptp_master', 'ptp_slave', 'ptmp_ap', 'ptmp_station', 'torre', 'switch_torre', 'repetidora', 'outro',
] as const;

export const criarAntenaSchema = z.object({
  nome: z.string().trim().min(1).max(150),
  ip: enderecoMonitorado,
  fabricante: z.enum(FABRICANTES_ANTENA).optional(),
  modelo: z.string().trim().max(100).optional().or(z.literal('')),
  tipo_wireless: z.enum(TIPOS_WIRELESS).optional(),
  frequencia_mhz: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  largura_canal_mhz: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  ssid: z.string().trim().max(100).optional().or(z.literal('')),
  sinal_esperado_dbm: z.coerce.number().int().min(-150).max(0).optional().nullable(),
  intervalo_polling_seg: z.coerce.number().int().min(2).max(3600).optional(),
  criar_no_topologia: z.coerce.boolean().optional(),
  pos_x: z.coerce.number().optional(),
  pos_y: z.coerce.number().optional(),
  tipo_visual: z.string().trim().max(50).optional(),
});

export const editarAntenaSchema = criarAntenaSchema
  .omit({ criar_no_topologia: true, pos_x: true, pos_y: true })
  .extend({
    ativo: z.coerce.boolean().optional(),
  });

const coordenadaTopologia = z.coerce.number().finite().min(-100000).max(100000);
const tipoVisualAntena = z.string().trim().min(1).max(50).regex(/^[a-z0-9_-]+$/i);
const idPositivo = z.coerce.number().int().positive();
const corHex = z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Use cor hexadecimal #RRGGBB.').nullable();

export const criarNodeAntenaSchema = z.object({
  antena_id: idPositivo.optional().nullable(),
  label: z.string().trim().min(1).max(150),
  tipo_visual: tipoVisualAntena.optional().default('antena_ptp'),
  pos_x: coordenadaTopologia.optional().default(0),
  pos_y: coordenadaTopologia.optional().default(0),
});

export const editarNodeAntenaSchema = z.object({
  label: z.string().trim().min(1).max(150).optional(),
  tipo_visual: tipoVisualAntena.optional(),
}).refine((valor) => valor.label !== undefined || valor.tipo_visual !== undefined, 'Informe algo para alterar.');

export const moverNodeAntenaSchema = z.object({
  pos_x: coordenadaTopologia,
  pos_y: coordenadaTopologia,
});

const camposEnlaceAntena = {
  tipo_enlace: z.enum(['ptp_wireless', 'ptmp_wireless', 'cabo_poe', 'fibra_torre', 'backup_radio']).optional(),
  label: z.string().trim().max(100).optional(),
  frequencia: z.string().trim().max(50).optional(),
  distancia_km: z.coerce.number().finite().min(0).max(100000).optional().nullable(),
  capacidade_mbps: z.coerce.number().int().min(0).max(100000000).optional().nullable(),
  cor: corHex.optional(),
  curvo: z.boolean().optional(),
  espessura: z.coerce.number().finite().min(0.5).max(20).optional().nullable(),
  estilo: z.enum(['solida', 'tracejada', 'pontilhada']).optional().nullable(),
  animado: z.boolean().optional().nullable(),
};

export const criarEnlaceAntenaSchema = z.object({
  origem_node_id: idPositivo,
  destino_node_id: idPositivo,
  ...camposEnlaceAntena,
}).refine((valor) => valor.origem_node_id !== valor.destino_node_id, {
  message: 'Origem e destino devem ser diferentes.',
  path: ['destino_node_id'],
});

export const editarEnlaceAntenaSchema = z.object(camposEnlaceAntena)
  .refine((valor) => Object.keys(valor).length > 0, 'Informe algo para alterar.');

export const viewportAntenaSchema = z.object({
  pos_x: coordenadaTopologia,
  pos_y: coordenadaTopologia,
  zoom: z.coerce.number().finite().min(0.05).max(8),
});

export const configResumoSchema = z.object({
  diarioAtivo: z.boolean(),
  diarioHora: z.coerce.number().int().min(0).max(23),
  semanalAtivo: z.boolean(),
  semanalDia: z.coerce.number().int().min(0).max(6),
  semanalHora: z.coerce.number().int().min(0).max(23),
});

export const enviarResumoSchema = z.object({ periodo: z.enum(['diario', 'semanal']) });

export const configAlertaSchema = z.object({
  bot_token: z.string().trim().max(200).refine(
    (valor) => valor === '' || /^\d+:[A-Za-z0-9_-]{30,}$/.test(valor),
    'Token do Telegram em formato invalido.'
  ).optional(),
  chat_id: z.string().trim().max(20).refine((valor) => valor === '' || /^-?\d{5,20}$/.test(valor), 'Chat ID invalido.'),
  alerta_atraso_seg: z.coerce.number().int().min(10).max(3600),
});

export const corpoVazioSchema = z.preprocess((valor) => valor ?? {}, z.object({}).strict());

export const viewportTopologiaSchema = z.object({
  pos_x: coordenadaTopologia,
  pos_y: coordenadaTopologia,
  zoom: z.coerce.number().finite().min(0.05).max(8),
});

export const criarNodeTopologiaSchema = z.object({
  empresa_id: idPositivo,
  dispositivo_id: idPositivo.optional().nullable(),
  label: z.string().trim().min(1).max(150),
  tipo: z.string().trim().min(1).max(30).regex(/^[a-z0-9_-]+$/i),
  pos_x: coordenadaTopologia.optional().default(0),
  pos_y: coordenadaTopologia.optional().default(0),
});

export const moverNodeTopologiaSchema = z.object({
  pos_x: coordenadaTopologia,
  pos_y: coordenadaTopologia,
});

export const criarEdgeTopologiaSchema = z.object({
  empresa_id: idPositivo,
  node_origem: idPositivo,
  node_destino: idPositivo,
  label: z.string().trim().max(100).optional().nullable(),
}).refine((valor) => valor.node_origem !== valor.node_destino, {
  path: ['node_destino'],
  message: 'Origem e destino devem ser diferentes.',
});
