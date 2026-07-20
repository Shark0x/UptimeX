import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api, Empresa, ResumoStatusEmpresa } from '../api';
import { Paginacao } from '../components/Paginacao';
import { HudTargeting } from '../components/ui/hud-targeting';
import { combinaBusca } from '../lib/busca';

const INTERVALO_ATUALIZACAO_MS = 15000;
const TILES_POR_PAGINA = 30;

type StatusEmpresa = 'offline' | 'degradado' | 'desconhecido' | 'online' | 'vazio';

// Problemas primeiro: quem está pior aparece no topo do mural
const ORDEM: Record<StatusEmpresa, number> = {
  offline: 0,
  degradado: 1,
  desconhecido: 2,
  online: 3,
  vazio: 4,
};

function classificar(r: ResumoStatusEmpresa): StatusEmpresa {
  if (Number(r.total) === 0) return 'vazio';
  if (Number(r.offline) > 0) return 'offline';
  if (Number(r.degradados) > 0) return 'degradado';
  if (Number(r.online) > 0) return 'online';
  return 'desconhecido';
}

const COR: Record<StatusEmpresa, string> = {
  online: '#2FD771',
  degradado: '#FFB224',
  offline: '#FF2B3A',
  desconhecido: '#82828E',
  vazio: '#55555F',
};

/**
 * Marcador de status = barbatana da uptimeX. A DIREÇÃO carrega o significado:
 * ▲ sobe = no ar (vivo), ▼ desce = caiu. Cor reforça, não é o único sinal.
 */
function Fin({ status, tamanho = 13 }: { status: StatusEmpresa; tamanho?: number }) {
  const cor = COR[status];
  const desce = status === 'offline';
  const oco = status === 'desconhecido' || status === 'vazio';
  const anim = status === 'offline' ? 'animate-alert-blink' : status === 'degradado' ? 'animate-warn-pulse' : '';
  const d = desce ? 'M1.6 2.6 L12.4 2.6 L7 12.4 Z' : 'M7 1.6 L12.4 12.4 L1.6 12.4 Z';
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 14 14"
      className={anim}
      style={{ filter: status === 'vazio' ? 'none' : `drop-shadow(0 0 5px ${cor}66)` }}
      aria-hidden
    >
      <path
        d={d}
        fill={oco ? 'none' : cor}
        stroke={cor}
        strokeWidth={oco ? 1.4 : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function tempoRelativo(ms: number): string {
  const seg = Math.floor(ms / 1000);
  if (seg < 5) return 'agora';
  if (seg < 60) return `${seg}s`;
  return `${Math.floor(seg / 60)}min`;
}

export function PainelMacro({ onSelecionar }: { onSelecionar: (e: Empresa) => void }) {
  const [empresas, setEmpresas] = useState<ResumoStatusEmpresa[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<number>(Date.now());
  const [, tick] = useState(0);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);

  const carregar = useCallback(async () => {
    try {
      const dados = await api.resumoStatusEmpresas();
      setEmpresas(dados);
      setAtualizadoEm(Date.now());
      setCarregado(true);
    } catch {
      /* mantém o último snapshot se uma atualização falhar */
    }
  }, []);

  useEffect(() => {
    carregar();
    const id = setInterval(carregar, INTERVALO_ATUALIZACAO_MS);
    return () => clearInterval(id);
  }, [carregar]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const ordenadas = useMemo(
    () =>
      [...empresas]
        .map((e) => ({ e, status: classificar(e) }))
        .sort((a, b) => ORDEM[a.status] - ORDEM[b.status] || a.e.nome.localeCompare(b.e.nome)),
    [empresas]
  );

  // Busca filtra os tiles; o veredito lá em cima continua olhando TODAS as empresas
  const filtradas = useMemo(
    () => ordenadas.filter(({ e }) => combinaBusca(e.nome, busca)),
    [ordenadas, busca]
  );
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / TILES_POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const tilesVisiveis = filtradas.slice((paginaSegura - 1) * TILES_POR_PAGINA, paginaSegura * TILES_POR_PAGINA);

  const resumo = useMemo(() => {
    let comQueda = 0, comAtencao = 0, ok = 0, enlOnline = 0, enlTotal = 0;
    ordenadas.forEach(({ e, status }) => {
      if (status === 'offline') comQueda++;
      else if (status === 'degradado') comAtencao++;
      else if (status === 'online') ok++;
      enlOnline += Number(e.online) + Number(e.degradados);
      enlTotal += Number(e.total);
    });
    return { comQueda, comAtencao, ok, enlOnline, enlTotal };
  }, [ordenadas]);

  // Código de estado da operação (reflete o pior estado ativo)
  const estado: StatusEmpresa =
    empresas.length === 0 ? 'vazio' : resumo.comQueda > 0 ? 'offline' : resumo.comAtencao > 0 ? 'degradado' : 'online';

  const legenda =
    estado === 'offline'
      ? `${resumo.comQueda} ${resumo.comQueda === 1 ? 'empresa fora do ar' : 'empresas fora do ar'}`
      : estado === 'degradado'
        ? `${resumo.comAtencao} com degradação no enlace`
        : estado === 'vazio'
          ? 'nenhuma empresa monitorada'
          : 'todos os enlaces no ar';
  return (
    <div className="h-full overflow-y-auto pb-6 relative">
      {/* -------- abertura HUD: mira trava na visão macro e sai de cena -------- */}
      <div
        aria-hidden
        className="hud-overlay absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center gap-4"
      >
        <HudTargeting tamanho={280} />
        <p
          className="font-mono text-[10px] uppercase tracking-[0.4em] text-signal-400/90 hud-pop pl-[0.4em]"
          style={{ '--delay': '1.6s' } as CSSProperties}
        >
          alvo adquirido · visão macro
        </p>
      </div>

      <div className="entrada" style={{ animationDelay: '1.7s' }}>
      {/* -------- painel-cartaz: título + estado da rede numa faixa só -------- */}
      <section
        className={`relative overflow-hidden mb-5 rounded-2xl border border-white/[0.07] bg-deep-900/30 backdrop-blur-md hud-corners ${estado === 'offline' ? 'animate-alert-pulse' : ''}`}
      >
        <div className="px-5 sm:px-6 py-5 sm:py-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="eyebrow">Consulta rápida</p>
            <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted shrink-0">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-online/40 animate-sonar" />
                <span className="relative inline-flex rounded-full w-2 h-2 bg-online" />
              </span>
              sinal vivo · {tempoRelativo(Date.now() - atualizadoEm)}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <span className="macro-fin">
                <Fin status={estado} tamanho={28} />
              </span>
              <h1
                className="macro-word font-titulo leading-[0.9] text-6xl sm:text-7xl text-slate-100"
                style={{ letterSpacing: '0.045em', textShadow: '0 2px 24px rgba(0,0,0,0.5)' }}
              >
                VISÃO{' '}
                <span style={{ WebkitTextStroke: '1.5px rgba(245,244,242,0.9)', color: 'transparent', textShadow: 'none' }}>
                  MACRO
                </span>
              </h1>
            </div>
            <p className="font-mono text-xs sm:text-sm text-muted mt-3 pl-0.5">{legenda}</p>
          </div>

          {/* leitura de fins — números pequenos, cor só nos acentos */}
          <div className="macro-metrics flex items-center gap-4 sm:gap-5 font-mono text-xs shrink-0">
            <span className="flex items-center gap-1.5 tabular-nums">
              <Fin status="online" tamanho={11} />
              <span className="text-slate-100">{resumo.ok}</span>
              <span className="text-muted hidden sm:inline">no ar</span>
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Fin status="degradado" tamanho={11} />
              <span className={resumo.comAtencao > 0 ? 'text-warn' : 'text-slate-500'}>{resumo.comAtencao}</span>
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <Fin status="offline" tamanho={11} />
              <span className={resumo.comQueda > 0 ? 'text-offline' : 'text-slate-500'}>{resumo.comQueda}</span>
            </span>
            <span className="flex items-baseline gap-1.5 tabular-nums border-l border-white/10 pl-4 sm:pl-5">
              <span className="text-slate-100 text-sm">{resumo.enlOnline}</span>
              <span className="text-muted">/{resumo.enlTotal}</span>
              <span className="text-muted hidden sm:inline">enlaces</span>
            </span>
          </div>
          </div>
        </div>
      </section>

      {/* -------- busca -------- */}
      {empresas.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <input
            value={busca}
            onChange={(ev) => {
              setBusca(ev.target.value);
              setPagina(1);
            }}
            placeholder="Buscar empresa…"
            aria-label="Buscar empresa pelo nome"
            className="input max-w-xs"
          />
          {busca.trim() !== '' && (
            <span className="text-[11px] font-mono text-muted whitespace-nowrap">
              {filtradas.length} de {empresas.length}
            </span>
          )}
        </div>
      )}

      {/* -------- mural de tiles -------- */}
      {!carregado ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-panel h-24 animate-pulse opacity-40" />
          ))}
        </div>
      ) : ordenadas.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-slate-300 font-display">Nenhuma empresa cadastrada ainda.</p>
          <p className="text-muted text-sm mt-1">Cadastre empresas no painel principal pra vê-las aqui.</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-slate-300 font-display">Nenhuma empresa encontrada.</p>
          <p className="text-muted text-sm mt-1">Nada com "{busca.trim()}" no nome — confira a grafia.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 animate-fade-up">
          {tilesVisiveis.map(({ e, status }) => {
            const total = Number(e.total);
            const noAr = Number(e.online) + Number(e.degradados);
            const tint =
              status === 'offline'
                ? 'border-signal-500/50 bg-signal-600/[0.09] hover:border-signal-500/80'
                : status === 'degradado'
                  ? 'border-warn/40 bg-warn/[0.06] hover:border-warn/70'
                  : status === 'online'
                    ? 'border-online/25 bg-online/[0.045] hover:border-online/50'
                    : 'border-white/[0.08] opacity-75 hover:opacity-100';
            const corFracao =
              status === 'offline' ? 'text-offline' : status === 'degradado' ? 'text-warn' : status === 'online' ? 'text-online' : 'text-muted';
            return (
              <button
                key={e.id}
                onClick={() => onSelecionar({ id: e.id, nome: e.nome, foto_url: e.foto_url, endereco: e.endereco })}
                className={`group text-left rounded-2xl border p-3.5 min-h-[92px] flex flex-col transition-all duration-200 hover:-translate-y-0.5 glass-panel ${tint}`}
              >
                <div className="mb-2">
                  <Fin status={status} tamanho={14} />
                </div>
                <p className="font-grotesk font-semibold text-slate-100 text-sm leading-tight line-clamp-2">
                  {e.nome}
                </p>
                <p className="font-mono text-[11px] mt-auto pt-2 tabular-nums">
                  {total > 0 ? (
                    <>
                      <span className={corFracao}>{noAr}</span>
                      <span className="text-muted">/{total} no ar</span>
                    </>
                  ) : (
                    <span className="text-muted/60">sem monitor</span>
                  )}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <Paginacao pagina={paginaSegura} totalPaginas={totalPaginas} aoMudar={setPagina} />
      </div>
    </div>
  );
}
