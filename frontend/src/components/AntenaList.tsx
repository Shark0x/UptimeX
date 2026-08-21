import { useState, useMemo } from 'react';
import { AntenaWireless } from '../apiAntenas';
import { iconeAntenaPorTipo, corFabricante } from './AntenaIcons';

export function AntenaList({
  antenas,
  onAbrirAntena,
  onEditarAntena,
  onRemoverAntena,
  onPingInstantaneo,
}: {
  antenas: AntenaWireless[];
  onAbrirAntena: (a: AntenaWireless) => void;
  onEditarAntena: (a: AntenaWireless) => void;
  onRemoverAntena: (id: number) => void;
  onPingInstantaneo: (id: number) => void;
}) {
  const [busca, setBusca] = useState('');
  const [filtroFab, setFiltroFab] = useState<string>('todos');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [pingandoId, setPingandoId] = useState<number | null>(null);

  const listaFiltrada = useMemo(() => {
    return antenas.filter((a) => {
      const matchBusca =
        !busca ||
        a.nome.toLowerCase().includes(busca.toLowerCase()) ||
        a.ip.includes(busca) ||
        (a.modelo && a.modelo.toLowerCase().includes(busca.toLowerCase())) ||
        (a.ssid && a.ssid.toLowerCase().includes(busca.toLowerCase()));

      const matchFab = filtroFab === 'todos' || a.fabricante === filtroFab;
      const matchStatus = filtroStatus === 'todos' || a.status_atual === filtroStatus;

      return matchBusca && matchFab && matchStatus;
    });
  }, [antenas, busca, filtroFab, filtroStatus]);

  async function handlePing(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    setPingandoId(id);
    try {
      await onPingInstantaneo(id);
    } finally {
      setPingandoId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filtros e Busca */}
      <div className="glass-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, IP, modelo ou SSID..."
            className="input text-xs"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filtroFab}
            onChange={(e) => setFiltroFab(e.target.value)}
            className="input text-xs !w-auto"
          >
            <option value="todos">Todos Fabricantes</option>
            <option value="ubiquiti">Ubiquiti</option>
            <option value="mikrotik">MikroTik</option>
            <option value="mimosa">Mimosa</option>
            <option value="intelbras">Intelbras</option>
            <option value="cambium">Cambium</option>
          </select>

          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="input text-xs !w-auto"
          >
            <option value="todos">Todos os Estados</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="desconhecido">Aguardando</option>
          </select>
        </div>
      </div>

      {/* Tabela de Antenas */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-deep-900/90 text-muted uppercase text-[10px] tracking-wider border-b border-white/[0.08]">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Equipamento / Nome</th>
                <th className="px-4 py-3">Endereço IP</th>
                <th className="px-4 py-3">Fabricante & Modelo</th>
                <th className="px-4 py-3">Frequência / SSID</th>
                <th className="px-4 py-3">Latência</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {listaFiltrada.map((a) => {
                const Icone = iconeAntenaPorTipo(a.tipo_wireless || 'antena_ptp');
                const corFab = corFabricante(a.fabricante);
                const isOnline = a.status_atual === 'online';
                const isOffline = a.status_atual === 'offline';

                return (
                  <tr
                    key={a.id}
                    onClick={() => onAbrirAntena(a)}
                    className="hover:bg-white/[0.03] transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="relative flex items-center justify-center w-2.5 h-2.5">
                          {isOnline && (
                            <span className="absolute inline-flex h-full w-full rounded-full bg-online/30 animate-sonar" />
                          )}
                          <span
                            className={`relative inline-flex rounded-full w-2 h-2 ${
                              isOffline
                                ? 'status-dot-offline animate-alert-blink'
                                : isOnline
                                ? 'status-dot-online'
                                : 'bg-muted'
                            }`}
                          />
                        </span>
                        <span
                          className={`text-[10px] uppercase font-bold tracking-wider ${
                            isOffline ? 'text-offline' : isOnline ? 'text-online' : 'text-muted'
                          }`}
                        >
                          {a.status_atual}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-1.5 rounded-lg border ${corFab.bg} ${corFab.borda} ${corFab.texto}`}>
                          <Icone width={16} height={16} />
                        </span>
                        <div>
                          <p className="font-display text-sm font-semibold text-slate-100 group-hover:text-signal-400 transition-colors">
                            {a.nome}
                          </p>
                          <p className="text-[10px] text-muted uppercase tracking-wider">{a.tipo_wireless}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-200">{a.ip}</td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase border ${corFab.badge}`}>
                          {a.fabricante}
                        </span>
                        <span className="text-slate-300 text-[11px]">{a.modelo || '—'}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.frequencia_mhz ? (
                        <span className="text-cyan-400 font-semibold">
                          {(a.frequencia_mhz / 1000).toFixed(1)} GHz
                          {a.largura_canal_mhz ? ` (${a.largura_canal_mhz}M)` : ''}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {a.ssid && <p className="text-[10px] text-slate-400 truncate max-w-[120px]">SSID: {a.ssid}</p>}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {isOnline ? (
                        <div className="font-semibold text-slate-200">
                          {a.latencia_ms !== null && a.latencia_ms !== undefined ? `${Math.round(a.latencia_ms)} ms` : '—'}
                          {a.perda_pct !== null && a.perda_pct !== undefined && a.perda_pct > 0 && (
                            <span className="text-offline text-[10px] ml-1">({a.perda_pct.toFixed(0)}% perda)</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-offline font-semibold">100% perda</span>
                      )}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={(e) => handlePing(a.id, e)}
                          disabled={pingandoId === a.id}
                          className="btn-ghost text-[10px] !py-1 !px-2 text-cyan-400 hover:text-cyan-300"
                          title="Ping ICMP imediato"
                        >
                          {pingandoId === a.id ? 'Pingando...' : 'Ping'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditarAntena(a);
                          }}
                          className="p-1 hover:bg-white/10 text-slate-300 rounded transition-colors"
                          title="Editar"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Remover a antena "${a.nome}"?`)) {
                              onRemoverAntena(a.id);
                            }
                          }}
                          className="p-1 hover:bg-signal-500/20 text-signal-400 rounded transition-colors"
                          title="Remover"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Nenhuma antena encontrada com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
