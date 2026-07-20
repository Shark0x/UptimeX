import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
});

export const criarUsuarioSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/, 'Use apenas letras, números, ponto, hífen ou underscore'),
  password: z.string().min(6).max(200),
  role: z.enum(['admin', 'visualizador']),
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
  ip: z.string().trim().min(1).max(45),
  fabricante: z.enum(['mikrotik', 'ubiquiti', 'cisco', 'generico']).optional(),
  metodo_monitoramento: z.enum(['snmp', 'ping', 'snmp+ping']).optional(),
  comunidade_snmp: z.string().trim().max(100).optional(),
  porta_snmp: z.coerce.number().int().min(1).max(65535).optional(),
  intervalo_polling_seg: z.coerce.number().int().min(5).max(3600).optional(),
});

export const editarDispositivoSchema = criarDispositivoSchema.omit({ empresa_id: true }).extend({
  ativo: z.coerce.boolean().optional(),
});
