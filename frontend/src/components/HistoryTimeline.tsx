import { useEffect, useState } from 'react';
import { api, Dispositivo, StatusEvento } from '../api';

function formatarDuracao(seg: number | null): string {
  if (seg === null) return 'em andamento';
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.floor(seg / 60)}min ${seg % 60}s`;
  const h = Math.floor(seg / 3600);
  const min = Math.floor((seg % 3600) / 60);
  return `${h}h ${min}min`;
}

export function HistoryTimeline({ dispositivos }: { dispositivos: Dispositivo[] }) {
  const [selecionado, setSelecionado] = useState<number | null>(dispositivos[0]?.id ?? null);
  const [eventos, setEventos] = useState<StatusEvento[]>([]);

  useEffect(() => {
    if (selecionado) {
      api.historicoDispositivo(selecionado).then(setEventos);
    }
  }, [selecionado]);

  const quedas = eventos.filter((e) => e.status === 'offline');
  const tempoTotalOffline = quedas.reduce((acc, e) => acc + (e.duracao_segundos || 0), 0);

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 h-full">
      <div className="glass-panel p-2 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-widest text-muted font-mono px-2 py-1.5">Dispositivos</p>
        {dispositivos.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelecionado(d.id)}
            className={`w-full text-left px-3 py-2 rounded text-sm font-display transition-colors ${
              selecionado === d.id ? 'bg-signal-600/20 text-signal-400 border border-signal-600/40' : 'text-slate-300 hover:bg-deep-800'
            }`}
          >
            {d.nome}
          </button>
        ))}
      </div>

      <div className="glass-panel p-4 overflow-y-auto">
        {selecionado ? (
          <>
            <div className="flex gap-6 mb-4 font-mono text-sm">
              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest">Quedas registradas</p>
                <p className="text-slate-100 text-lg">{quedas.length}</p>
              </div>
              <div>
                <p className="text-muted text-[10px] uppercase tracking-widest">Tempo total offline</p>
                <p className="text-offline text-lg">{formatarDuracao(tempoTotalOffline)}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              {eventos.length === 0 && <p className="text-muted text-sm">Nenhum evento registrado ainda.</p>}
              {eventos.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-center justify-between px-3 py-2 rounded border-l-2 ${
                    e.status === 'online' ? 'border-online bg-online/5' : 'border-offline bg-offline/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${e.status === 'online' ? 'text-online' : 'text-offline'}`}>
                      {e.status}
                    </span>
                    <span className="text-xs font-mono text-muted">{new Date(e.inicio).toLocaleString('pt-BR')}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-300">{formatarDuracao(e.duracao_segundos)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted text-sm">Selecione um dispositivo.</p>
        )}
      </div>
    </div>
  );
}
