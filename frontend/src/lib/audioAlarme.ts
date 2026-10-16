// Alarme sonoro do mural/TV. A configuração é LOCAL do navegador (localStorage):
// cada tela/mural tem o seu som e volume — faz sentido pra um painel de parede.
// Presets são sintetizados via Web Audio (sem baixar arquivo); também dá pra
// subir um áudio personalizado (guardado como DataURL).

export type TipoAlarme = 'bipe-duplo' | 'sirene' | 'chime' | 'sonar' | 'digital' | 'custom';

export interface ConfigAlarme {
  tipo: TipoAlarme;
  /** 0..1 */
  volume: number;
}

export const PRESETS_ALARME: { id: TipoAlarme; nome: string }[] = [
  { id: 'bipe-duplo', nome: 'Bipe duplo (clássico)' },
  { id: 'sirene', nome: 'Sirene de queda' },
  { id: 'chime', nome: 'Notificação suave' },
  { id: 'sonar', nome: 'Sonar / radar' },
  { id: 'digital', nome: 'Alarme digital' },
  { id: 'custom', nome: 'Áudio personalizado' },
];

const CHAVE_CONFIG = 'uptimex_alarme_config';
const CHAVE_AUDIO = 'uptimex_alarme_audio_dataurl';
const CHAVE_AUDIO_NOME = 'uptimex_alarme_audio_nome';
const PADRAO: ConfigAlarme = { tipo: 'bipe-duplo', volume: 0.6 };
/** Limite do áudio custom: localStorage não é grande; 2 MB é seguro. */
export const TAMANHO_MAX_AUDIO = 2 * 1024 * 1024;

export function lerConfigAlarme(): ConfigAlarme {
  try {
    const bruto = localStorage.getItem(CHAVE_CONFIG);
    if (!bruto) return { ...PADRAO };
    const c = JSON.parse(bruto) as Partial<ConfigAlarme>;
    const tipo = PRESETS_ALARME.some((p) => p.id === c.tipo) ? (c.tipo as TipoAlarme) : PADRAO.tipo;
    const volume = typeof c.volume === 'number' ? Math.min(1, Math.max(0, c.volume)) : PADRAO.volume;
    return { tipo, volume };
  } catch {
    return { ...PADRAO };
  }
}

export function salvarConfigAlarme(cfg: ConfigAlarme): void {
  localStorage.setItem(CHAVE_CONFIG, JSON.stringify(cfg));
}

export function lerAudioCustom(): string | null {
  return localStorage.getItem(CHAVE_AUDIO);
}
export function lerNomeAudioCustom(): string | null {
  return localStorage.getItem(CHAVE_AUDIO_NOME);
}
export function salvarAudioCustom(dataUrl: string, nome: string): void {
  localStorage.setItem(CHAVE_AUDIO, dataUrl);
  localStorage.setItem(CHAVE_AUDIO_NOME, nome);
  bufferCustomCache = null; // invalida o buffer decodificado
}
export function removerAudioCustom(): void {
  localStorage.removeItem(CHAVE_AUDIO);
  localStorage.removeItem(CHAVE_AUDIO_NOME);
  bufferCustomCache = null;
}

// ---------- reprodução ----------

let bufferCustomCache: AudioBuffer | null = null;

async function obterBufferCustom(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (bufferCustomCache) return bufferCustomCache;
  const dataUrl = lerAudioCustom();
  if (!dataUrl) return null;
  try {
    const arr = await (await fetch(dataUrl)).arrayBuffer();
    bufferCustomCache = await ctx.decodeAudioData(arr);
    return bufferCustomCache;
  } catch {
    return null;
  }
}

/** Um tom com envelope (ataque rápido, decaimento exponencial) ligado ao master. */
function tom(
  ctx: AudioContext,
  master: GainNode,
  freq: number,
  inicio: number,
  dur: number,
  tipo: OscillatorType = 'square',
  pico = 0.5,
): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, inicio);
  env.gain.setValueAtTime(0.0001, inicio);
  env.gain.exponentialRampToValueAtTime(pico, inicio + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(inicio);
  osc.stop(inicio + dur + 0.03);
}

function tocarPreset(ctx: AudioContext, tipo: TipoAlarme, volume: number): void {
  const master = ctx.createGain();
  master.gain.value = volume; // volume geral (0..1)
  master.connect(ctx.destination);
  const t = ctx.currentTime;

  switch (tipo) {
    case 'bipe-duplo':
      tom(ctx, master, 880, t, 0.2);
      tom(ctx, master, 880, t + 0.28, 0.2);
      break;
    case 'sirene': {
      // Varredura 600↔1000 Hz, 3 passadas (um osc só, sem clipping).
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sawtooth';
      let tt = t;
      for (let i = 0; i < 3; i++) {
        osc.frequency.setValueAtTime(600, tt);
        osc.frequency.linearRampToValueAtTime(1000, tt + 0.35);
        osc.frequency.linearRampToValueAtTime(600, tt + 0.7);
        tt += 0.7;
      }
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.6, t + 0.05);
      env.gain.setValueAtTime(0.6, tt - 0.1);
      env.gain.exponentialRampToValueAtTime(0.0001, tt);
      osc.connect(env);
      env.connect(master);
      osc.start(t);
      osc.stop(tt + 0.03);
      break;
    }
    case 'chime':
      // Acorde ascendente suave (notas se sobrepõem → picos baixos p/ não clipar).
      tom(ctx, master, 587.33, t, 0.5, 'sine', 0.3); // D5
      tom(ctx, master, 783.99, t + 0.16, 0.6, 'sine', 0.3); // G5
      tom(ctx, master, 1046.5, t + 0.32, 0.7, 'sine', 0.3); // C6
      break;
    case 'sonar':
      tom(ctx, master, 1200, t, 0.6, 'sine', 0.5);
      tom(ctx, master, 1200, t + 0.75, 0.6, 'sine', 0.3);
      break;
    case 'digital':
      for (let i = 0; i < 4; i++) tom(ctx, master, 1320, t + i * 0.12, 0.08, 'square', 0.45);
      break;
  }
}

async function tocarCustom(ctx: AudioContext, volume: number): Promise<boolean> {
  const buf = await obterBufferCustom(ctx);
  if (!buf) return false;
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = volume;
  src.buffer = buf;
  src.connect(g);
  g.connect(ctx.destination);
  src.start();
  return true;
}

/**
 * Toca o alarme configurado. O `ctx` precisa já ter sido criado/resumido a partir
 * de um gesto do usuário (política de autoplay do navegador). Se o tipo for
 * 'custom' mas não houver áudio válido, cai no bipe padrão.
 */
export async function tocarAlarmeConfigurado(ctx: AudioContext, cfg?: ConfigAlarme): Promise<void> {
  const c = cfg ?? lerConfigAlarme();
  if (c.tipo === 'custom') {
    const ok = await tocarCustom(ctx, c.volume);
    if (!ok) tocarPreset(ctx, 'bipe-duplo', c.volume);
    return;
  }
  tocarPreset(ctx, c.tipo, c.volume);
}
