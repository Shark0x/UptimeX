import { useState } from 'react';
import { AuditLog } from './AuditLog';
import { AcessosLog } from './AcessosLog';

type Categoria = 'administrativa' | 'operacional' | 'acessos';

// Auditoria centralizada (padrão profissional: fonte única + separação por
// responsabilidade). Administrativa = ações no sistema/usuários; Operacional =
// mudanças nas empresas/monitoramento; Acessos = logins e tentativas.
const CATEGORIAS: { id: Categoria; label: string; hint: string }[] = [
  { id: 'administrativa', label: 'Administrativa', hint: 'Usuários, sistema, chaves MCP e board de antenas' },
  { id: 'operacional', label: 'Operacional', hint: 'Empresas, dispositivos, topologia e links' },
  { id: 'acessos', label: 'Acessos', hint: 'Logins e tentativas de acesso' },
];

export function AuditoriaCentral() {
  const [cat, setCat] = useState<Categoria>('administrativa');

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="glass-panel p-1.5 inline-flex gap-1 self-start">
        {CATEGORIAS.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            title={c.hint}
            className={`px-4 py-2 rounded-lg text-sm font-display transition-all whitespace-nowrap ${
              cat === c.id ? 'bg-signal-600/20 text-signal-400 font-bold' : 'text-muted hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-xs font-mono text-muted -mt-1">{CATEGORIAS.find((c) => c.id === cat)?.hint}</p>
      <div className="flex-1 min-h-0">
        {cat === 'acessos' ? <AcessosLog /> : <AuditLog categoria={cat} />}
      </div>
    </div>
  );
}
