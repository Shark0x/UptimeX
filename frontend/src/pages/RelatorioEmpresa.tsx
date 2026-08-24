import { useEffect, useMemo, useState } from 'react';
import { api, Empresa, PingHistoryRange, RelatorioEmpresaData } from '../api';
import { MarcaUptimeX } from '../components/LogoUptimeX';

const RANGES: { id: PingHistoryRange; label: string }[] = [
  { id: '24h', label: '24 horas' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: '1y', label: '1 ano' },
];

function fmtDur(seg: number | null): string {
  if (seg === null) return '—';
  if (seg <= 0) return '0s';
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)}min ${seg % 60}s`;
  const dias = Math.floor(seg / 86400);
  const h = Math.floor((seg % 86400) / 3600);
  const min = Math.floor((seg % 3600) / 60);
  if (dias > 0) return `${dias}d ${h}h ${min}min`;
  return `${h}h ${min}min`;
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
const fmtMs = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')} ms`);
const fmtPct = (v: number | null, casas = 2) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })}%`);

function csvCell(valor: string | number | null): string {
  const s = valor === null ? '' : String(valor);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
  const conteudo = linhas.map((l) => l.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
function slug(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'empresa';
}

/** Área de latência média por intervalo — SVG inline, imprime nítido em PDF. */
function GraficoLatencia({ serie, limiar }: { serie: RelatorioEmpresaData['serie']; limiar: number }) {
  const pontos = serie.filter((p) => p.avg_latency !== null) as (RelatorioEmpresaData['serie'][number] & { avg_latency: number })[];
  if (serie.length === 0 || pontos.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
        Sem dados de ping suficientes no período.
      </div>
    );
  }
  const W = 760, H = 210, padL = 46, padR = 14, padT = 14, padB = 26;
  const maxLat = Math.max(limiar, ...pontos.map((p) => p.avg_latency)) * 1.15;
  const xFor = (i: number) => padL + (i / (serie.length - 1)) * (W - padL - padR);
  const yFor = (v: number) => padT + (1 - v / maxLat) * (H - padT - padB);

  const seg: string[] = [];
  serie.forEach((p, i) => {
    if (p.avg_latency === null) return;
    seg.push(`${seg.length === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.avg_latency).toFixed(1)}`);
  });
  const linha = seg.join(' ');
  const idxIni = serie.findIndex((p) => p.avg_latency !== null);
  const idxFim = serie.length - 1 - [...serie].reverse().findIndex((p) => p.avg_latency !== null);
  const area = `${linha} L${xFor(idxFim).toFixed(1)},${yFor(0).toFixed(1)} L${xFor(idxIni).toFixed(1)},${yFor(0).toFixed(1)} Z`;
  const yLimiar = yFor(limiar);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Latência média por intervalo">
      <defs>
        <linearGradient id="rel-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e02832" stopOpacity="0.22" />
          <stop offset="1" stopColor="#e02832" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* grades horizontais */}
      {[0, 0.5, 1].map((f) => {
        const y = padT + f * (H - padT - padB);
        const v = Math.round(maxLat * (1 - f));
        return (
          <g key={f}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{v}</text>
          </g>
        );
      })}
      {/* limiar de degradação */}
      {yLimiar > padT && yLimiar < H - padB && (
        <g>
          <line x1={padL} y1={yLimiar} x2={W - padR} y2={yLimiar} stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="5 4" />
          <text x={W - padR} y={yLimiar - 4} textAnchor="end" fontSize={10} fill="#d97706">limiar {limiar}ms</text>
        </g>
      )}
      <path d={area} fill="url(#rel-area)" />
      <path d={linha} fill="none" stroke="#e02832" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {/* rótulos de tempo */}
      <text x={padL} y={H - 8} textAnchor="start" fontSize={10} fill="#94a3b8">{fmtDataCurta(serie[0].timestamp)}</text>
      <text x={(padL + W - padR) / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">{fmtDataCurta(serie[Math.floor(serie.length / 2)].timestamp)}</text>
      <text x={W - padR} y={H - 8} textAnchor="end" fontSize={10} fill="#94a3b8">{fmtDataCurta(serie[serie.length - 1].timestamp)}</text>
    </svg>
  );
}

function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: string; sub?: string; tom?: 'bom' | 'alerta' | 'ruim' }) {
  const cor = tom === 'ruim' ? '#dc2626' : tom === 'alerta' ? '#d97706' : tom === 'bom' ? '#059669' : '#0f172a';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{rotulo}</p>
      <p className="mt-1 text-2xl font-bold leading-none tabular-nums" style={{ color: cor }}>{valor}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function RelatorioEmpresa({
  empresa,
  rangeInicial = '30d',
  onClose,
}: {
  empresa: Empresa;
  rangeInicial?: PingHistoryRange;
  onClose: () => void;
}) {
  const [range, setRange] = useState<PingHistoryRange>(rangeInicial);
  const [dados, setDados] = useState<RelatorioEmpresaData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    api.relatorioEmpresa(empresa.id, range)
      .then((d) => { if (ativo) setDados(d); })
      .catch(() => { if (ativo) setErro('Não foi possível gerar o relatório.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [empresa.id, range]);

  const disponibilidadeTom = useMemo(() => {
    const d = dados?.kpis.disponibilidade_pct;
    if (d == null) return undefined;
    return d >= 99.5 ? 'bom' : d >= 98 ? 'alerta' : 'ruim';
  }, [dados]);

  const resumo = useMemo(() => {
    if (!dados) return '';
    const k = dados.kpis;
    const disp = k.disponibilidade_pct != null ? `${k.disponibilidade_pct.toLocaleString('pt-BR')}% de disponibilidade` : 'disponibilidade indisponível';
    const quedas = `${k.total_quedas} queda${k.total_quedas === 1 ? '' : 's'} somando ${fmtDur(k.tempo_total_offline_seg)}`;
    const mttr = k.mttr_seg != null ? ` (MTTR ${fmtDur(k.mttr_seg)})` : '';
    const lat = `latência média de ${fmtMs(k.latencia_media)}${k.latencia_p95 != null ? `, p95 ${fmtMs(k.latencia_p95)}` : ''}${k.latencia_max != null ? `, pico ${fmtMs(k.latencia_max)}` : ''}`;
    return `No período (${dados.periodo.label.toLowerCase()}), ${dados.empresa.nome} registrou ${disp}, com ${quedas}${mttr}. ${lat[0].toUpperCase()}${lat.slice(1)}. Perda média de ${fmtPct(k.perda_media)} e ${fmtPct(k.degradado_pct)} do tempo em estado degradado (latência ≥ ${dados.limiares.latencia_ms}ms ou perda ≥ ${dados.limiares.perda_pct}%).`;
  }, [dados]);

  function exportarLatencia() {
    if (!dados) return;
    const linhas: (string | number | null)[][] = [
      ['timestamp', 'latencia_media_ms', 'latencia_min_ms', 'latencia_max_ms', 'perda_pct', 'uptime_pct', 'degradado_pct'],
      ...dados.serie.map((p) => [p.timestamp, p.avg_latency, p.min_latency, p.max_latency, p.packet_loss_pct, p.uptime_pct, p.degraded_pct]),
    ];
    baixarCsv(`uptimex_${slug(dados.empresa.nome)}_${range}_latencia.csv`, linhas);
  }
  function exportarQuedas() {
    if (!dados) return;
    const linhas: (string | number | null)[][] = [
      ['dispositivo', 'inicio', 'fim', 'duracao_segundos', 'em_andamento'],
      ...dados.quedas.map((q) => [q.dispositivo, q.inicio, q.fim, q.duracao_segundos, q.em_andamento ? 'sim' : 'nao']),
    ];
    baixarCsv(`uptimex_${slug(dados.empresa.nome)}_${range}_quedas.csv`, linhas);
  }

  return (
    <div className="relatorio-overlay fixed inset-0 z-[70] overflow-auto bg-slate-900/70 backdrop-blur-sm p-3 sm:p-6">
      {/* Barra de ações — não sai na impressão */}
      <div className="no-print mx-auto mb-4 flex max-w-[860px] flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r.id ? 'bg-signal-600 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportarLatencia} disabled={!dados} className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/20 disabled:opacity-40">
            CSV latência
          </button>
          <button onClick={exportarQuedas} disabled={!dados} className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/20 disabled:opacity-40">
            CSV quedas
          </button>
          <button onClick={() => window.print()} disabled={!dados} className="rounded-md bg-signal-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-signal-500 disabled:opacity-40">
            Imprimir / Salvar PDF
          </button>
          <button onClick={onClose} className="rounded-md border border-white/20 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-white/10">
            Fechar
          </button>
        </div>
      </div>

      {/* Documento */}
      <div className="relatorio-paper mx-auto max-w-[860px] overflow-hidden rounded-xl bg-white text-slate-800 shadow-2xl">
        {/* Cabeçalho escuro com a marca */}
        <div className="flex items-center justify-between gap-4 bg-[#0b0d12] px-8 py-6">
          <div className="flex items-center gap-3">
            <MarcaUptimeX largura={64} />
            <div className="flex items-baseline font-sora text-2xl font-extrabold leading-none tracking-[-0.03em]">
              <span className="text-[#f5f4f2]">uptime</span>
              <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(160deg,#ff6a52,#e02832)' }}>X</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#e02832]">Relatório de Disponibilidade</p>
            <p className="mt-1 text-sm text-slate-300">{dados ? dados.periodo.label : '—'}</p>
          </div>
        </div>

        {carregando && <div className="px-8 py-20 text-center text-slate-400">Gerando relatório…</div>}
        {erro && <div className="px-8 py-20 text-center text-red-500">{erro}</div>}

        {dados && !carregando && (
          <div className="px-8 py-7">
            {/* Identificação */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
              <div>
                <h1 className="font-sora text-2xl font-bold text-slate-900">{dados.empresa.nome}</h1>
                {dados.empresa.endereco && <p className="mt-0.5 text-sm text-slate-500">{dados.empresa.endereco}</p>}
              </div>
              <div className="text-right text-xs text-slate-400">
                <p>Período: {fmtData(dados.periodo.inicio)} → {fmtData(dados.periodo.fim)}</p>
                <p>Emitido em {fmtData(dados.periodo.gerado_em)}</p>
                <p>{dados.kpis.dispositivos_monitorados} dispositivo(s) monitorado(s)</p>
              </div>
            </div>

            {/* Resumo executivo */}
            <div className="mt-5 rounded-lg border-l-4 border-[#e02832] bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Resumo executivo</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{resumo}</p>
            </div>

            {/* KPIs */}
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Kpi rotulo="Disponibilidade" valor={fmtPct(dados.kpis.disponibilidade_pct, 3)} tom={disponibilidadeTom} />
              <Kpi rotulo="Quedas" valor={String(dados.kpis.total_quedas)} sub={`tempo fora: ${fmtDur(dados.kpis.tempo_total_offline_seg)}`} tom={dados.kpis.total_quedas === 0 ? 'bom' : 'ruim'} />
              <Kpi rotulo="MTTR" valor={fmtDur(dados.kpis.mttr_seg)} sub="tempo médio de reparo" />
              <Kpi rotulo="Maior queda" valor={fmtDur(dados.kpis.maior_queda_seg)} />
              <Kpi rotulo="Latência média" valor={fmtMs(dados.kpis.latencia_media)} />
              <Kpi rotulo="Latência p95" valor={fmtMs(dados.kpis.latencia_p95)} sub="por intervalo" />
              <Kpi rotulo="Latência pico" valor={fmtMs(dados.kpis.latencia_max)} />
              <Kpi rotulo="Tempo degradado" valor={fmtPct(dados.kpis.degradado_pct)} sub={`perda média ${fmtPct(dados.kpis.perda_media)}`} tom={(dados.kpis.degradado_pct ?? 0) >= 5 ? 'alerta' : undefined} />
            </div>

            {/* Gráfico de latência */}
            <div className="mt-7">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Latência média por intervalo</p>
              <div className="mt-2 rounded-lg border border-slate-200 p-3">
                <GraficoLatencia serie={dados.serie} limiar={dados.limiares.latencia_ms} />
              </div>
            </div>

            {/* Top dispositivos */}
            {dados.por_dispositivo.length > 0 && (
              <div className="mt-7">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Dispositivos com mais impacto</p>
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-2 font-semibold">Dispositivo</th>
                      <th className="py-1.5 px-2 text-right font-semibold">Quedas</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Tempo fora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.por_dispositivo.slice(0, 8).map((d) => (
                      <tr key={d.dispositivo} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 text-slate-700">{d.dispositivo}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{d.quedas}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums text-slate-700">{fmtDur(d.tempo_offline_seg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Extrato de quedas */}
            <div className="mt-7">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Extrato de quedas {dados.quedas.length >= 1000 && '(1000 mais recentes)'}
              </p>
              {dados.quedas.length === 0 ? (
                <p className="mt-2 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                  Nenhuma queda registrada no período. 🎉
                </p>
              ) : (
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-2 font-semibold">Dispositivo</th>
                      <th className="py-1.5 px-2 font-semibold">Início</th>
                      <th className="py-1.5 px-2 font-semibold">Fim</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Duração</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.quedas.map((q, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 text-slate-700">{q.dispositivo}</td>
                        <td className="py-1.5 px-2 tabular-nums text-slate-600">{fmtData(q.inicio)}</td>
                        <td className="py-1.5 px-2 tabular-nums text-slate-600">
                          {q.em_andamento ? <span className="font-semibold text-[#dc2626]">em andamento</span> : q.fim ? fmtData(q.fim) : '—'}
                        </td>
                        <td className="py-1.5 pl-2 text-right tabular-nums text-slate-700">{fmtDur(q.duracao_segundos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Rodapé */}
            <div className="mt-8 border-t border-slate-200 pt-4 text-[10px] leading-relaxed text-slate-400">
              <p>
                Gerado por <span className="font-semibold text-slate-500">uptimeX by SHARKP</span> — monitoramento contínuo de disponibilidade.
                Disponibilidade e latência derivam da série de ping consolidada da empresa; p95 é calculado sobre a latência média por intervalo.
                MTTR considera apenas quedas já encerradas.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
