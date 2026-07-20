import { useEffect, useState } from 'react';
import { api, AuditoriaItem } from '../api';

const CORES_ACAO: Record<string, string> = {
  criar: 'text-online',
  editar: 'text-warn',
  remover: 'text-offline',
};

export function AuditLog() {
  const [itens, setItens] = useState<AuditoriaItem[]>([]);

  useEffect(() => {
    api.auditoria().then(setItens);
  }, []);

  return (
    <div className="glass-panel p-4 h-full overflow-y-auto">
      <p className="text-[10px] uppercase tracking-widest text-muted font-mono mb-3">Log de auditoria</p>
      <div className="space-y-1">
        {itens.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 font-mono text-xs">
            <span className="text-muted w-36 shrink-0">{new Date(item.timestamp).toLocaleString('pt-BR')}</span>
            <span className="text-signal-400 w-24 shrink-0">{item.usuario}</span>
            <span className={`${CORES_ACAO[item.acao] || 'text-slate-300'} w-16 shrink-0 uppercase`}>{item.acao}</span>
            <span className="text-muted w-24 shrink-0">{item.entidade}</span>
            <span className="text-slate-300 truncate">{item.detalhes}</span>
          </div>
        ))}
        {itens.length === 0 && <p className="text-muted text-sm px-3">Nenhuma ação registrada ainda.</p>}
      </div>
    </div>
  );
}
