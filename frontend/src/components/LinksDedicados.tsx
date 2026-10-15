import { useEffect, useMemo, useState } from 'react';
import { api, Dispositivo, LinkDedicado } from '../api';
import { calcularCidr } from '../lib/ipcalc';
import { useToast } from './Toast';

/**
 * Aba "Link Dedicado": registro dos blocos de IP entregues ao cliente.
 * Digitou o CIDR (ex: /30), a calculadora resolve rede, broadcast, máscara
 * e a faixa utilizável — no preview do formulário e em cada card salvo.
 */

function Fato({ rotulo, valor, destaque = false }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest text-muted font-mono">{rotulo}</p>
      <p className={`font-mono text-sm tabular-nums truncate ${destaque ? 'text-online' : 'text-slate-100'}`}>{valor}</p>
    </div>
  );
}

function GradeCalculo({ bloco }: { bloco: string }) {
  const calc = calcularCidr(bloco);
  if (!calc.valido) {
    return <p className="text-warn text-xs font-mono mt-2">{calc.erro}</p>;
  }
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mt-3">
        <Fato rotulo="Máscara" valor={calc.mascara} />
        <Fato rotulo="Rede" valor={calc.rede} />
        <Fato rotulo="Broadcast" valor={calc.broadcast} />
        <Fato rotulo="Primeiro IP útil" valor={calc.primeiroHost} />
        <Fato rotulo="Último IP útil" valor={calc.ultimoHost} />
        <Fato
          rotulo="IPs entregues"
          valor={`${calc.hostsUtilizaveis} ${calc.hostsUtilizaveis === 1 ? 'utilizável' : 'utilizáveis'} de ${calc.totalEnderecos}`}
          destaque
        />
      </div>
      {calc.observacao && <p className="text-warn text-[11px] font-mono mt-2.5">{calc.observacao}</p>}
    </div>
  );
}

export function LinksDedicados({ empresaId, podeEditar }: { empresaId: number; podeEditar: boolean }) {
  const toast = useToast();
  const [links, setLinks] = useState<LinkDedicado[]>([]);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [bloco, setBloco] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState<number | null>(null);
  // Rascunho por link do painel "Sem monitoramento" (device escolhido + flag),
  // só aplicado ao clicar em "Aplicar".
  const [rascunho, setRascunho] = useState<Record<number, { dispositivoId: number | null; sem: boolean }>>({});
  const [salvandoMon, setSalvandoMon] = useState<number | null>(null);

  async function carregar() {
    const [ls, ds] = await Promise.all([api.listarLinks(empresaId), api.listarDispositivos(empresaId)]);
    setLinks(ls);
    setDispositivos(ds);
    setRascunho(
      Object.fromEntries(
        ls.map((l) => [l.id, { dispositivoId: l.dispositivo_id ?? null, sem: l.sem_monitoramento }])
      )
    );
    setCarregado(true);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const nomeDispositivo = (id: number | null) =>
    id == null ? null : dispositivos.find((d) => Number(d.id) === Number(id))?.nome ?? `#${id}`;

  async function aplicarMonitoramento(l: LinkDedicado) {
    const draft = rascunho[l.id] ?? { dispositivoId: l.dispositivo_id ?? null, sem: l.sem_monitoramento };
    if (draft.sem && draft.dispositivoId == null) {
      toast.erro('Escolha o dispositivo que este link representa para pausar o monitoramento.');
      return;
    }
    setSalvandoMon(l.id);
    try {
      await api.atualizarMonitoramentoLink(l.id, draft.sem, draft.dispositivoId);
      const nome = nomeDispositivo(draft.dispositivoId);
      toast.sucesso(
        draft.sem
          ? `Monitoramento pausado${nome ? ` — ${nome} não será mais pingado` : ''}`
          : `Monitoramento retomado${nome ? ` — ${nome} voltou a ser pingado` : ''}`
      );
      carregar();
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível atualizar o monitoramento.');
    } finally {
      setSalvandoMon(null);
    }
  }

  const preview = useMemo(() => (bloco.trim() ? calcularCidr(bloco) : null), [bloco]);

  async function registrar() {
    if (!preview?.valido) return;
    setSalvando(true);
    try {
      await api.criarLink(empresaId, bloco.trim(), descricao.trim());
      toast.sucesso(`Bloco ${bloco.trim()} registrado`);
      setBloco('');
      setDescricao('');
      carregar();
    } catch (e: any) {
      toast.erro(e.message || 'Não foi possível registrar o bloco.');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(l: LinkDedicado) {
    try {
      await api.removerLink(l.id);
      toast.sucesso(`Bloco ${l.bloco} removido`);
      setRemovendoId(null);
      carregar();
    } catch {
      toast.erro('Não foi possível remover o bloco.');
    }
  }

  return (
    <div className="space-y-4 animate-fade-up">
      {podeEditar && (
        <div className="glass-panel hud-corners p-5">
          <p className="eyebrow mb-1">Novo bloco</p>
          <h3 className="font-display font-semibold text-slate-100 mb-4">Registrar link dedicado</h3>
          <div className="flex flex-wrap gap-3">
            <div className="w-56">
              <label className="label-field">Bloco (CIDR)</label>
              <input
                value={bloco}
                onChange={(e) => setBloco(e.target.value)}
                placeholder="ex: 45.174.147.128/30"
                className="input font-mono"
                maxLength={45}
                onKeyDown={(e) => e.key === 'Enter' && registrar()}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label-field">Descrição (opcional)</label>
              <input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="ex: bloco do firewall / contrato 45123"
                className="input"
                maxLength={255}
              />
            </div>
            <div className="self-end">
              <button onClick={registrar} disabled={salvando || !preview?.valido} className="btn-primary">
                {salvando ? 'Salvando…' : 'Registrar'}
              </button>
            </div>
          </div>

          {/* preview ao digitar: a calculadora responde na hora */}
          {preview && (
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="text-[10px] uppercase tracking-widest text-muted font-mono">Prévia do cálculo</p>
              <GradeCalculo bloco={bloco} />
            </div>
          )}
        </div>
      )}

      {!carregado ? (
        <div className="glass-panel h-28 animate-pulse opacity-40" />
      ) : links.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <p className="text-slate-300 font-display">Nenhum bloco registrado ainda.</p>
          <p className="text-muted text-sm mt-1">
            {podeEditar
              ? 'Registre o bloco entregue ao cliente (ex: um /30) e o cálculo fica salvo aqui.'
              : 'Nenhum link dedicado registrado pra esta empresa.'}
          </p>
        </div>
      ) : (
        links.map((l) => (
          <div key={l.id} className="glass-panel hud-corners p-5 relative group">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono font-semibold text-lg text-slate-100 flex items-center gap-2 flex-wrap">
                  <span>
                    {l.bloco.split('/')[0]}
                    <span className="text-signal-400">/{l.bloco.split('/')[1]}</span>
                  </span>
                  {l.sem_monitoramento && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-warn/15 border border-warn/40 text-warn">
                      {/* ícone de "sino cortado" + texto: cor não é o único indicador */}
                      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                        <path d="M4 4l16 16" />
                        <path d="M18 8a6 6 0 0 0-9.3-5" />
                        <path d="M6 9v4l-2 3h11" />
                      </svg>
                      sem monitoramento
                    </span>
                  )}
                </p>
                {l.descricao && <p className="text-muted text-sm mt-0.5">{l.descricao}</p>}
              </div>
              {podeEditar &&
                (removendoId === l.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-warn font-mono">remover este bloco?</span>
                    <button onClick={() => remover(l)} className="text-xs text-offline hover:underline font-mono">sim</button>
                    <button onClick={() => setRemovendoId(null)} className="text-xs text-muted hover:underline font-mono">não</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemovendoId(l.id)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-offline
                      w-6 h-6 flex items-center justify-center rounded-md hover:bg-signal-600/15 transition-all text-sm"
                    aria-label={`Remover bloco ${l.bloco}`}
                  >
                    ✕
                  </button>
                ))}
            </div>
            <GradeCalculo bloco={l.bloco} />

            {/* -------- Monitoramento do link -------- */}
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="text-[10px] uppercase tracking-widest text-muted font-mono mb-2">Monitoramento</p>
              {podeEditar ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px]">
                    <label className="label-field" htmlFor={`dev-${l.id}`}>
                      Dispositivo que este link representa
                    </label>
                    <select
                      id={`dev-${l.id}`}
                      value={rascunho[l.id]?.dispositivoId ?? ''}
                      onChange={(e) =>
                        setRascunho((r) => ({
                          ...r,
                          [l.id]: {
                            dispositivoId: e.target.value ? Number(e.target.value) : null,
                            sem: r[l.id]?.sem ?? l.sem_monitoramento,
                          },
                        }))
                      }
                      className="input"
                    >
                      <option value="">— nenhum —</option>
                      {dispositivos.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nome} ({d.ip})
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none self-center pb-2">
                    <input
                      type="checkbox"
                      checked={rascunho[l.id]?.sem ?? l.sem_monitoramento}
                      onChange={(e) =>
                        setRascunho((r) => ({
                          ...r,
                          [l.id]: {
                            dispositivoId: r[l.id]?.dispositivoId ?? l.dispositivo_id ?? null,
                            sem: e.target.checked,
                          },
                        }))
                      }
                      className="w-4 h-4 accent-warn"
                    />
                    <span className="text-sm font-mono text-slate-200">Sem monitoramento</span>
                  </label>

                  <button
                    onClick={() => aplicarMonitoramento(l)}
                    disabled={salvandoMon === l.id}
                    className="self-center mb-0.5 text-sm font-mono px-3.5 py-2 rounded-lg border border-white/10 text-slate-200 hover:text-signal-400 hover:border-signal-500/40 transition-all disabled:opacity-50"
                  >
                    {salvandoMon === l.id ? 'Aplicando…' : 'Aplicar'}
                  </button>
                </div>
              ) : (
                <p className="text-sm font-mono text-muted">
                  {l.sem_monitoramento
                    ? `Sem monitoramento${nomeDispositivo(l.dispositivo_id) ? ` — ${nomeDispositivo(l.dispositivo_id)} pausado` : ''}.`
                    : 'Monitoramento ativo.'}
                </p>
              )}

              {/* orientação quando marcado sem dispositivo associado (flag só informativa) */}
              {podeEditar && (rascunho[l.id]?.sem ?? l.sem_monitoramento) && (rascunho[l.id]?.dispositivoId ?? l.dispositivo_id) == null && (
                <p className="text-[11px] font-mono text-warn mt-2">
                  Escolha um dispositivo para que "sem monitoramento" realmente pause o ping. Sem
                  isso, a marcação é apenas informativa.
                </p>
              )}
              {podeEditar && (rascunho[l.id]?.sem ?? l.sem_monitoramento) && (rascunho[l.id]?.dispositivoId ?? l.dispositivo_id) != null && (
                <p className="text-[11px] font-mono text-muted mt-2">
                  Ao aplicar, o dispositivo associado deixa de ser pingado. O histórico de ping,
                  status e incidentes é preservado.
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
