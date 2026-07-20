import { useEffect, useMemo, useState } from 'react';
import { api, LinkDedicado } from '../api';
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
  const [carregado, setCarregado] = useState(false);
  const [bloco, setBloco] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState<number | null>(null);

  async function carregar() {
    setLinks(await api.listarLinks(empresaId));
    setCarregado(true);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

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
                <p className="font-mono font-semibold text-lg text-slate-100">
                  {l.bloco.split('/')[0]}
                  <span className="text-signal-400">/{l.bloco.split('/')[1]}</span>
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
          </div>
        ))
      )}
    </div>
  );
}
