import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empresa, ResumoStatusEmpresa } from '../api';
import { EmpresaFoto } from '../components/EmpresaFoto';
import { Paginacao } from '../components/Paginacao';
import { combinaBusca } from '../lib/busca';
import { atualizarResumos, resumosEmCache } from '../lib/empresasSnapshot';

const INTERVALO_ATUALIZACAO_MS = 15000;
const TILES_POR_PAGINA = 30;

type StatusEmpresa = 'offline' | 'degradado' | 'desconhecido' | 'online' | 'vazio';
type FiltroStatus = 'todos' | 'offline' | 'degradado' | 'online' | 'sem-monitor' | '/30';
type EmpresaClassificada = { e: ResumoStatusEmpresa; status: StatusEmpresa };

const ORDEM: Record<StatusEmpresa, number> = {
  offline: 0,
  degradado: 1,
  desconhecido: 2,
  vazio: 3,
  online: 4,
};

const STATUS: Record<
  StatusEmpresa,
  {
    rotulo: string;
    curto: string;
    cor: string;
    texto: string;
    badge: string;
    card: string;
    trilho: string;
  }
> = {
  offline: {
    rotulo: 'Fora do ar',
    curto: 'Queda',
    cor: '#FF2B3A',
    texto: 'text-offline',
    badge: 'border-signal-500/45 bg-signal-600/15 text-[rgb(var(--badge-offline-fg))]',
    card: 'border-signal-500/45 bg-signal-600/[0.075] hover:border-signal-400/80',
    trilho: 'bg-offline',
  },
  degradado: {
    rotulo: 'Enlace degradado',
    curto: 'Atenção',
    cor: '#FFB224',
    texto: 'text-warn',
    badge: 'border-warn/35 bg-warn/10 text-[rgb(var(--badge-degradado-fg))]',
    card: 'border-warn/30 bg-warn/[0.045] hover:border-warn/65',
    trilho: 'bg-warn',
  },
  desconhecido: {
    rotulo: 'Sem resposta',
    curto: 'Sem sinal',
    cor: '#A0A0AA',
    texto: 'text-slate-300',
    badge: 'border-white/15 bg-white/[0.045] text-slate-300',
    card: 'border-white/10 bg-white/[0.025] hover:border-white/25',
    trilho: 'bg-slate-400',
  },
  vazio: {
    rotulo: 'Sem monitoramento',
    curto: 'Sem monitor',
    cor: '#5D5D68',
    texto: 'text-muted',
    badge: 'border-white/10 bg-white/[0.025] text-muted',
    card: 'border-white/[0.07] bg-white/[0.015] hover:border-white/20',
    trilho: 'bg-deep-600',
  },
  online: {
    rotulo: 'Operacional',
    curto: 'No ar',
    cor: '#2FD771',
    texto: 'text-online',
    badge: 'border-online/30 bg-online/[0.08] text-[rgb(var(--badge-online-fg))]',
    card: 'border-online/15 bg-online/[0.025] hover:border-online/40',
    trilho: 'bg-online',
  },
};

function classificar(r: ResumoStatusEmpresa): StatusEmpresa {
  if (Number(r.total) === 0) return 'vazio';
  if (Number(r.offline) > 0) return 'offline';
  if (Number(r.degradados) > 0) return 'degradado';
  if (Number(r.online) > 0) return 'online';
  return 'desconhecido';
}

function StatusGlyph({ status, className = 'w-4 h-4' }: { status: StatusEmpresa; className?: string }) {
  const cor = STATUS[status].cor;

  if (status === 'offline') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d="M4 5.5h16L12 19 4 5.5Z" fill={cor} />
      </svg>
    );
  }

  if (status === 'degradado') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d="m12 3 9 9-9 9-9-9 9-9Z" fill={cor} />
        <path d="M12 7.5v6" stroke="#0B0B0F" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.8" r="1.15" fill="#0B0B0F" />
      </svg>
    );
  }

  if (status === 'online') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path d="M12 4 21 20H3L12 4Z" fill={cor} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="none" stroke={cor} strokeWidth="2" strokeDasharray={status === 'vazio' ? '3 3' : undefined} />
      {status === 'desconhecido' && <path d="M12 8v5.5M12 17v.1" stroke={cor} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function IconeBusca() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

function IconeAtualizar({ girando }: { girando: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-4 h-4 ${girando ? 'animate-spin' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 7v5h-5" />
      <path d="M4.8 9A8 8 0 0 1 18.7 6L20 7" />
      <path d="M4 17v-5h5" />
      <path d="M19.2 15A8 8 0 0 1 5.3 18L4 17" />
    </svg>
  );
}

function IconeAbrir() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

function tempoRelativo(ms: number): string {
  const seg = Math.max(0, Math.floor(ms / 1000));
  if (seg < 5) return 'agora';
  if (seg < 60) return `há ${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min}min`;
  return `há ${Math.floor(min / 60)}h`;
}

function tempoDeQueda(inicio: string | null, agora: number): string | null {
  if (!inicio) return null;
  const timestamp = new Date(inicio).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const minutos = Math.max(0, Math.floor((agora - timestamp) / 60000));
  if (minutos < 1) return 'caiu agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto ? `há ${horas}h ${resto}min` : `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias}d ${horas % 24}h`;
}

function StatusBadge({ status }: { status: StatusEmpresa }) {
  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.13em] ${STATUS[status].badge}`}>
      <StatusGlyph status={status} className="w-3 h-3" />
      {STATUS[status].rotulo}
    </span>
  );
}

function AvatarEmpresa({ empresa, status }: { empresa: ResumoStatusEmpresa; status: StatusEmpresa }) {
  const fallback = (
    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-deep-700 to-deep-900 font-display text-sm font-semibold text-slate-100">
      {(empresa.nome.trim().slice(0, 2) || 'UX').toUpperCase()}
    </span>
  );

  return (
    <span className="relative shrink-0">
      {empresa.foto_url ? (
        <EmpresaFoto
          empresaId={empresa.id}
          alt=""
          className="h-11 w-11 rounded-xl border border-white/10 object-cover"
          fallback={fallback}
        />
      ) : fallback}
      <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-deep-950 shadow-lg">
        <StatusGlyph status={status} className="w-3 h-3" />
      </span>
    </span>
  );
}

// Resumo da frota por EMPRESA (quantas estão no ar / em queda / em atenção / sem
// monitoramento). A granularidade de dispositivo vai pro rodapé do deck — manter
// os dois totais separados foi o que tirou a confusão de "113 vs 146".
type ResumoFrota = { online: number; offline: number; degradado: number; semMonitor: number };

function FitaSaude({ resumo, total }: { resumo: ResumoFrota; total: number }) {
  const segmentos = [
    { k: 'online', cls: 'macro-fleet-bar--online', val: resumo.online, rot: 'no ar' },
    { k: 'offline', cls: 'macro-fleet-bar--offline', val: resumo.offline, rot: 'em queda' },
    { k: 'degradado', cls: 'macro-fleet-bar--degradado', val: resumo.degradado, rot: 'atenção' },
    { k: 'sem', cls: 'macro-fleet-bar--desconhecido', val: resumo.semMonitor, rot: 'sem monitor' },
  ];
  const presentes = segmentos.filter((s) => s.val > 0);
  const descricao = total > 0
    ? presentes.map((s) => `${s.val} ${s.rot}`).join(', ')
    : 'Nenhuma empresa monitorada.';

  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-md bg-white/[0.04]" role="img" aria-label={descricao}>
        {total > 0 && presentes.map((s) => (
          <span key={s.k} className={`block h-full ${s.cls}`} style={{ width: `${(s.val / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
        {segmentos.map((s) => (
          <li key={s.k} className="inline-flex items-center gap-2 font-mono text-[11px] tabular-nums text-slate-300">
            <span className={`h-2 w-2 shrink-0 rounded-sm ${s.cls}`} aria-hidden />
            <strong className="font-semibold text-slate-100">{s.val}</strong>&nbsp;{s.rot}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Cartão compacto de uma empresa que exige ação, no próprio deck. Clicar abre a
// empresa (mesmo fluxo do grid). A "queda vira ação": o operador vai do veredito
// direto ao diagnóstico, sem rolar.
function CartaoCritico({ item, agora, onSelecionar }: { item: EmpresaClassificada; agora: number; onSelecionar: (e: Empresa) => void }) {
  const { e, status } = item;
  const queda = status === 'offline' ? tempoDeQueda(e.offline_desde, agora) : null;

  return (
    <button
      type="button"
      onClick={() => onSelecionar({ id: e.id, nome: e.nome, foto_url: e.foto_url, endereco: e.endereco })}
      data-status={status}
      className="macro-company-card group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-white/[0.08] p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-deep-950"
      aria-label={`Abrir ${e.nome}. Status: ${STATUS[status].rotulo}.`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${STATUS[status].trilho}`} aria-hidden />
      <AvatarEmpresa empresa={e} status={status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-grotesk text-[13.5px] font-semibold text-slate-100">{e.nome}</span>
        <span className="mt-1 flex items-center gap-2">
          {status === 'offline' ? (
            <span className="rounded border border-signal-500/30 bg-signal-600/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tabular-nums text-[rgb(var(--badge-offline-fg))]">
              {Number(e.offline)} fora
            </span>
          ) : (
            <span className="rounded border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tabular-nums text-[rgb(var(--badge-degradado-fg))]">
              {Number(e.degradados)} {Number(e.degradados) === 1 ? 'lento' : 'lentos'}
            </span>
          )}
          {queda && <span className="font-mono text-[10.5px] tabular-nums text-muted">{queda}</span>}
        </span>
      </span>
      <span className="shrink-0 text-muted transition-colors duration-200 group-hover:text-slate-100" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h13M13 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

function BarraSaude({ empresa }: { empresa: ResumoStatusEmpresa }) {
  const total = Number(empresa.total);
  if (total <= 0) {
    return <div className="h-1.5 w-full rounded-full border border-dashed border-white/15" aria-label="Sem dispositivos monitorados" />;
  }

  const segmentos = [
    { nome: 'Online', valor: Number(empresa.online), cor: '#2FD771' },
    { nome: 'Degradados', valor: Number(empresa.degradados), cor: '#FFB224' },
    { nome: 'Offline', valor: Number(empresa.offline), cor: '#FF2B3A' },
    { nome: 'Sem resposta', valor: Number(empresa.desconhecidos), cor: '#5D5D68' },
  ].filter((item) => item.valor > 0);

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-deep-800"
      role="img"
      aria-label={segmentos.map((item) => `${item.valor} ${item.nome.toLowerCase()}`).join(', ')}
    >
      {segmentos.map((item) => (
        <span key={item.nome} style={{ width: `${(item.valor / total) * 100}%`, backgroundColor: item.cor }} />
      ))}
    </div>
  );
}

function CartaoEmpresa({ item, agora, onSelecionar }: { item: EmpresaClassificada; agora: number; onSelecionar: (e: Empresa) => void }) {
  const { e, status } = item;
  const total = Number(e.total);
  const respondendo = Number(e.online) + Number(e.degradados);
  const queda = status === 'offline' ? tempoDeQueda(e.offline_desde, agora) : null;

  return (
    <button
      type="button"
      onClick={() => onSelecionar({ id: e.id, nome: e.nome, foto_url: e.foto_url, endereco: e.endereco })}
      data-status={status}
      className={`macro-company-card group relative min-h-[172px] w-full overflow-hidden rounded-2xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-deep-950 ${STATUS[status].card}`}
      aria-label={`Abrir ${e.nome}. Status: ${STATUS[status].rotulo}.`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${STATUS[status].trilho}`} aria-hidden />
      <span className="absolute right-3 top-3 text-muted transition-colors duration-200 group-hover:text-slate-100" aria-hidden>
        <IconeAbrir />
      </span>

      <div className="flex items-start gap-3 pr-7">
        <AvatarEmpresa empresa={e} status={status} />
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-grotesk text-[15px] font-semibold leading-tight text-slate-100">{e.nome}</h3>
          <p className="mt-1 truncate font-mono text-[10px] text-muted">{e.endereco || 'Localização não informada'}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {e.link_30 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent-500/30 bg-accent-600/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.13em] text-accent-400">
              /30
            </span>
          )}
        </div>
        {queda && <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--badge-offline-fg))]">{queda}</span>}
      </div>

      <div className="mt-3">
        <BarraSaude empresa={e} />
        <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] tabular-nums">
          {total > 0 ? (
            <>
              <span className="text-muted">
                <strong className="font-medium text-slate-200">{respondendo}</strong>/{total} respondendo
              </span>
              <span className="flex items-center gap-2.5">
                {Number(e.degradados) > 0 && <span className="text-warn">{Number(e.degradados)} lentos</span>}
                {Number(e.offline) > 0 && <span className="text-offline">{Number(e.offline)} fora</span>}
              </span>
            </>
          ) : (
            <span className="text-muted">Nenhum dispositivo monitorado</span>
          )}
        </div>
      </div>
    </button>
  );
}

function EsqueletoMural() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Carregando empresas">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[172px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
      ))}
    </div>
  );
}

export function PainelMacro({ onSelecionar }: { onSelecionar: (e: Empresa) => void }) {
  const [empresas, setEmpresas] = useState<ResumoStatusEmpresa[]>(() => resumosEmCache() ?? []);
  const [carregado, setCarregado] = useState(() => resumosEmCache() !== null);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState(Date.now());
  const [agora, setAgora] = useState(Date.now());
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroStatus>('todos');
  const [pagina, setPagina] = useState(1);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    try {
      const dados = await atualizarResumos();
      setEmpresas(dados);
      setAtualizadoEm(Date.now());
      setErro(null);
    } catch {
      setErro('A leitura da frota falhou. O último retrato disponível foi mantido.');
    } finally {
      setCarregado(true);
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = window.setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
    return () => window.clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const ordenadas = useMemo<EmpresaClassificada[]>(
    () =>
      empresas
        .map((e) => ({ e, status: classificar(e) }))
        .sort((a, b) => {
          const severidade = ORDEM[a.status] - ORDEM[b.status];
          if (severidade !== 0) return severidade;
          if (a.status === 'offline') {
            const porQuedas = Number(b.e.offline) - Number(a.e.offline);
            if (porQuedas !== 0) return porQuedas;
          }
          if (a.status === 'degradado') {
            const porDegradacao = Number(b.e.degradados) - Number(a.e.degradados);
            if (porDegradacao !== 0) return porDegradacao;
          }
          const a_eh_30 = Boolean(a.e.link_30);
          const b_eh_30 = Boolean(b.e.link_30);
          if (a_eh_30 !== b_eh_30) return a_eh_30 ? 1 : -1;
          return a.e.nome.localeCompare(b.e.nome, 'pt-BR');
        }),
    [empresas]
  );

  const resumo = useMemo(() => {
    const base = {
      offline: 0,
      degradado: 0,
      online: 0,
      semMonitor: 0,
      enlacesTotal: 0,
      enlacesRespondendo: 0,
      dispositivosOffline: 0,
      dispositivosDegradados: 0,
      linhas30: 0,
    };

    ordenadas.forEach(({ e, status }) => {
      if (status === 'offline') base.offline++;
      else if (status === 'degradado') base.degradado++;
      else if (status === 'online') base.online++;
      else base.semMonitor++;

      if (e.link_30) base.linhas30++;
      base.enlacesTotal += Number(e.total);
      base.enlacesRespondendo += Number(e.online) + Number(e.degradados);
      base.dispositivosOffline += Number(e.offline);
      base.dispositivosDegradados += Number(e.degradados);
    });

    return base;
  }, [ordenadas]);

  const estado: StatusEmpresa =
    !carregado || ordenadas.length === 0
      ? 'vazio'
      : resumo.offline > 0
        ? 'offline'
        : resumo.degradado > 0
          ? 'degradado'
          : resumo.semMonitor > 0
            ? 'desconhecido'
            : 'online';

  const opcoesFiltro: { valor: FiltroStatus; rotulo: string; total: number }[] = [
    { valor: 'todos', rotulo: 'Todas', total: ordenadas.length },
    { valor: 'offline', rotulo: 'Queda', total: resumo.offline },
    { valor: 'degradado', rotulo: 'Atenção', total: resumo.degradado },
    { valor: 'online', rotulo: 'No ar', total: resumo.online },
    { valor: 'sem-monitor', rotulo: 'Sem sinal', total: resumo.semMonitor },
    { valor: '/30', rotulo: '/30', total: resumo.linhas30 },
  ];

  const filtradas = useMemo(
    () =>
      ordenadas.filter(({ e, status }) => {
        const correspondeBusca = combinaBusca(`${e.nome} ${e.endereco || ''}`, busca);
        // Cada filtro é um caso exclusivo: 'todos' passa tudo; '/30' casa por
        // link_30; 'sem-monitor' cobre desconhecido+vazio; o resto casa o status
        // direto. (Antes, `filtro==='todos' || filtro==='/30' ? e.link_30 : …`
        // agrupava o 'todos' na condição do ternário por precedência do `||`, e a
        // frota inteira sumia no filtro padrão — só /30 aparecia.)
        const correspondeFiltro =
          filtro === 'todos'
            ? true
            : filtro === '/30'
              ? Boolean(e.link_30)
              : filtro === 'sem-monitor'
                ? status === 'desconhecido' || status === 'vazio'
                : status === filtro;
        return correspondeBusca && correspondeFiltro;
      }),
    [ordenadas, busca, filtro]
  );

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / TILES_POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaSegura - 1) * TILES_POR_PAGINA, paginaSegura * TILES_POR_PAGINA);

  const secoes = [
    {
      id: 'acao',
      titulo: 'Exigem ação',
      descricao: 'Quedas e degradações que pedem diagnóstico do operador.',
      itens: visiveis.filter((item) => item.status === 'offline' || item.status === 'degradado'),
    },
    {
      id: 'telemetria',
      titulo: 'Telemetria incompleta',
      descricao: 'Empresas sem dispositivos ou sem resposta conclusiva.',
      itens: visiveis.filter((item) => item.status === 'desconhecido' || item.status === 'vazio'),
    },
    {
      id: 'estaveis',
      titulo: 'Operação estável',
      descricao: 'Empresas respondendo sem incidentes ativos.',
      itens: visiveis.filter((item) => item.status === 'online'),
    },
  ].filter((secao) => secao.itens.length > 0);

  // Veredito-herói: um número grande + palavra quando há incidente; só a palavra
  // quando não há. Substitui o antigo cartaz único por algo que diz "quão ruim" num
  // relance. O \n quebra a palavra em duas linhas no cartaz (Bebas Neue).
  const veredito: { num: number | null; palavra: string } = !carregado
    ? { num: null, palavra: 'aguardando\nleitura' }
    : estado === 'offline'
      ? { num: resumo.offline, palavra: resumo.offline === 1 ? 'empresa\nem queda' : 'empresas\nem queda' }
      : estado === 'degradado'
        ? { num: resumo.degradado, palavra: resumo.degradado === 1 ? 'empresa\nem atenção' : 'empresas\nem atenção' }
        : estado === 'desconhecido'
          ? { num: null, palavra: 'telemetria\nparcial' }
          : estado === 'vazio'
            ? { num: null, palavra: 'sem empresas\nmonitoradas' }
            : { num: null, palavra: 'frota\nestável' };

  // Empresas que exigem ação agora (quedas + degradações), pior primeiro — já vêm
  // ordenadas por severidade. O deck mostra as mais críticas como atalho; o grid
  // abaixo tem a lista completa e os filtros.
  const criticas = ordenadas
    .filter((i) => i.status === 'offline' || i.status === 'degradado')
    .slice(0, 6);

  const contextoEstado = !carregado
    ? 'Sincronizando o primeiro retrato da operação.'
    : estado === 'offline'
      ? `${resumo.dispositivosOffline} ${resumo.dispositivosOffline === 1 ? 'dispositivo está' : 'dispositivos estão'} sem responder.`
      : estado === 'degradado'
        ? `${resumo.dispositivosDegradados} ${resumo.dispositivosDegradados === 1 ? 'enlace apresenta' : 'enlaces apresentam'} perda ou latência elevada.`
        : estado === 'desconhecido'
          ? `${resumo.semMonitor} ${resumo.semMonitor === 1 ? 'empresa precisa' : 'empresas precisam'} de telemetria confiável.`
          : estado === 'vazio'
            ? 'Cadastre empresas e dispositivos para iniciar a leitura.'
            : 'Nenhuma queda ou degradação ativa neste retrato.';

  return (
    <main className="relative h-full overflow-y-auto pb-8" aria-busy={atualizando}>
      <section
        className={`macro-command-deck hud-corners mb-5 overflow-hidden rounded-2xl border ${estado === 'offline' ? 'border-signal-500/35' : 'border-white/[0.08]'}`}
        data-estado={estado}
      >
        <div className="relative z-10 p-4 sm:p-5 lg:p-6">
          {/* topo: marca + pulso "ao vivo" (vermelho quando há queda) */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal-400">uptimeX · centro de operação</p>
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted" aria-live="polite">
              <span className="relative flex h-2 w-2">
                {!erro && <span className={`absolute inline-flex h-full w-full rounded-full animate-sonar ${estado === 'offline' ? 'bg-offline/50' : 'bg-online/40'}`} />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${erro || estado === 'offline' ? 'bg-offline' : 'bg-online'}`} />
              </span>
              {erro ? 'último retrato preservado' : `ao vivo · atualizado ${tempoRelativo(agora - atualizadoEm)}`}
            </span>
          </div>

          <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
            {/* VEREDITO — um só foco à esquerda */}
            <div className="min-w-0 lg:col-span-5">
              <div className="mb-6 flex items-center gap-3 sm:mb-10">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${STATUS[estado].badge}`}>
                  <StatusGlyph status={estado} className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Veredito da operação</p>
                  <p className={`font-mono text-xs uppercase tracking-wider ${STATUS[estado].texto}`}>{STATUS[estado].rotulo}</p>
                </div>
              </div>

              <h1 className="flex items-start gap-3 leading-[0.82] sm:gap-4">
                {veredito.num != null && (
                  <span className={`font-titulo text-[84px] leading-[0.78] tabular-nums sm:text-[120px] ${estado === 'offline' ? 'text-white [text-shadow:0_0_34px_rgba(255,43,58,0.34)]' : 'text-slate-100'}`}>
                    {veredito.num}
                  </span>
                )}
                <span className="whitespace-pre-line pt-1.5 font-titulo text-[30px] leading-[0.86] tracking-[0.015em] text-slate-200 sm:text-[46px]">
                  {veredito.palavra}
                </span>
              </h1>

              <p className="mt-5 max-w-sm text-sm leading-relaxed text-slate-300">{contextoEstado}</p>

              {(resumo.offline > 0 || resumo.degradado > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setFiltro(resumo.offline > 0 ? 'offline' : 'degradado');
                    setPagina(1);
                  }}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-4 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-200 transition-colors duration-200 hover:border-signal-500/55 hover:bg-signal-600/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
                >
                  {resumo.offline > 0 ? 'Ver todas as quedas' : 'Ver atenções'} <span aria-hidden>→</span>
                </button>
              )}
            </div>

            {/* FROTA: uma fita de saúde + as empresas que exigem ação */}
            <div className="flex min-w-0 flex-col gap-7 lg:col-span-7">
              <div>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-muted">Saúde da frota</p>
                  <p className="font-mono text-xs tabular-nums text-slate-300">
                    <strong className="font-semibold text-slate-100">{resumo.online}</strong>/{ordenadas.length} empresas no ar
                  </p>
                </div>
                <FitaSaude resumo={resumo} total={ordenadas.length} />
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-muted">Precisam de você agora</p>
                  {criticas.length > 0 && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal-400">
                      {criticas.length} {criticas.length === 1 ? 'ativo' : 'ativos'} · pior primeiro
                    </span>
                  )}
                </div>
                {criticas.length === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-online/25 bg-online/[0.03] px-4 py-4">
                    <StatusGlyph status="online" className="h-5 w-5 shrink-0" />
                    <p className="text-[13px] text-slate-300">
                      <strong className="font-semibold text-slate-100">Nada pendente.</strong> Nenhuma empresa precisa de ação — a lista aparece aqui no instante em que algo cair.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {criticas.map((item) => (
                      <CartaoCritico key={item.e.id} item={item} agora={agora} onSelecionar={onSelecionar} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* rodapé: os dois totais honestos (empresa × dispositivo) + atualizar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] bg-deep-950/20 px-4 py-3 sm:px-5 lg:px-6">
          <p className="font-mono text-[11px] tabular-nums text-muted">
            <strong className="font-semibold text-slate-100">{ordenadas.length}</strong> empresas na frota
            <span className="px-2 text-slate-100">·</span>
            <strong className="font-semibold text-slate-100">{resumo.enlacesTotal}</strong> dispositivos monitorados
            {resumo.enlacesTotal > 0 && (
              <span>
                {' '}({resumo.enlacesRespondendo} no ar
                {resumo.dispositivosOffline > 0 ? ` · ${resumo.dispositivosOffline} fora` : ''}
                {resumo.dispositivosDegradados > 0 ? ` · ${resumo.dispositivosDegradados} lentos` : ''})
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={carregar}
            disabled={atualizando}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 font-mono text-[10px] uppercase tracking-[0.13em] text-slate-300 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 disabled:cursor-wait disabled:opacity-50"
          >
            <IconeAtualizar girando={atualizando} />
            {atualizando ? 'Atualizando' : 'Atualizar agora'}
          </button>
        </div>
      </section>

      {erro && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-signal-500/35 bg-signal-600/[0.08] px-4 py-3" role="alert">
          <div className="flex items-start gap-2.5">
            <StatusGlyph status="offline" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-display text-sm font-semibold text-[rgb(var(--badge-offline-fg))]">Dados possivelmente desatualizados</p>
              <p className="mt-0.5 text-xs text-slate-300">{erro}</p>
            </div>
          </div>
          <button type="button" onClick={carregar} className="min-h-11 shrink-0 px-2 font-mono text-[10px] uppercase tracking-wider text-signal-400 hover:text-[rgb(var(--badge-offline-fg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400">
            Tentar novamente
          </button>
        </div>
      )}

      {carregado && empresas.length > 0 && (
        <section className="mb-5 rounded-2xl border border-white/[0.07] bg-deep-900/45 p-3.5 sm:p-4" aria-label="Controles da frota">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <label className="block w-full xl:max-w-sm">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">Buscar empresa</span>
              <span className="relative block">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted"><IconeBusca /></span>
                <input
                  value={busca}
                  onChange={(event) => {
                    setBusca(event.target.value);
                    setPagina(1);
                  }}
                  placeholder="Nome ou endereço"
                  className="input min-h-11 pl-10"
                />
              </span>
            </label>

            <div className="min-w-0">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">Filtrar por estado</span>
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar empresas por estado">
                {opcoesFiltro.map((opcao) => {
                  const ativo = filtro === opcao.valor;
                  return (
                    <button
                      key={opcao.valor}
                      type="button"
                      onClick={() => {
                        setFiltro(opcao.valor);
                        setPagina(1);
                      }}
                      aria-pressed={ativo}
                      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 font-mono text-[10px] uppercase tracking-wider transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 ${
                        ativo
                          ? 'border-signal-500/50 bg-signal-600/15 text-slate-100'
                          : 'border-white/10 text-muted hover:border-white/25 hover:text-slate-200'
                      }`}
                    >
                      {opcao.rotulo}
                      <span className={`rounded px-1.5 py-0.5 tabular-nums ${ativo ? 'bg-signal-500/20 text-[rgb(var(--badge-offline-fg))]' : 'bg-white/[0.05] text-slate-400'}`}>{opcao.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3 font-mono text-[10px] text-muted">
            <span>{filtradas.length} {filtradas.length === 1 ? 'empresa visível' : 'empresas visíveis'}</span>
            <span>ordenadas por severidade</span>
          </div>
        </section>
      )}

      {!carregado ? (
        <EsqueletoMural />
      ) : empresas.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-white/15 bg-deep-900/30 px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.025]">
            <StatusGlyph status="vazio" className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold text-slate-100">A frota ainda está vazia</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">Cadastre empresas e dispositivos no Painel para começar a acompanhar a operação aqui.</p>
        </section>
      ) : filtradas.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-white/15 bg-deep-900/30 px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.025] text-muted"><IconeBusca /></span>
          <h2 className="mt-4 font-display text-lg font-semibold text-slate-100">Nenhuma empresa neste recorte</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">Ajuste a busca ou selecione outro estado para ampliar o resultado.</p>
          <button
            type="button"
            onClick={() => {
              setBusca('');
              setFiltro('todos');
              setPagina(1);
            }}
            className="mt-4 min-h-11 rounded-lg border border-white/15 px-4 font-mono text-[10px] uppercase tracking-wider text-slate-200 hover:border-signal-500/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
          >
            Limpar filtros
          </button>
        </section>
      ) : (
        <div className="space-y-7">
          {secoes.map((secao, indice) => (
            <section key={secao.id} aria-labelledby={`macro-secao-${secao.id}`}>
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-400">Prioridade {String(indice + 1).padStart(2, '0')}</p>
                  <h2 id={`macro-secao-${secao.id}`} className="mt-1 font-display text-lg font-semibold text-slate-100">{secao.titulo}</h2>
                  <p className="mt-0.5 text-xs text-muted">{secao.descricao}</p>
                </div>
                <span className="shrink-0 font-titulo text-3xl leading-none text-slate-400 tabular-nums">{secao.itens.length}</span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {secao.itens.map((item) => (
                  <CartaoEmpresa key={item.e.id} item={item} agora={agora} onSelecionar={onSelecionar} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="macro-pagination">
        <Paginacao pagina={paginaSegura} totalPaginas={totalPaginas} aoMudar={setPagina} />
      </div>
    </main>
  );
}
