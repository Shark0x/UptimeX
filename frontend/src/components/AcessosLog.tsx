import { useEffect, useState } from 'react';
import { api, AcessoItem } from '../api';

function localizacao(item: AcessoItem): string {
  if (!item.ip_origem) return '—';
  const partes = [item.cidade, item.regiao, item.pais].filter(Boolean);
  return partes.length ? partes.join(', ') : 'localização desconhecida';
}

export function AcessosLog() {
  const [itens, setItens] = useState<AcessoItem[]>([]);

  useEffect(() => {
    api.acessos().then(setItens);
  }, []);

  return (
    <div className="glass-panel overflow-hidden animate-fade-up">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted font-mono border-b border-white/10">
            <th className="px-4 py-3 font-normal">Data/hora</th>
            <th className="px-4 py-3 font-normal">Usuário</th>
            <th className="px-4 py-3 font-normal">Resultado</th>
            <th className="px-4 py-3 font-normal">IP</th>
            <th className="px-4 py-3 font-normal">Localização</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.id} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-3 text-muted font-mono text-xs whitespace-nowrap">
                {new Date(item.timestamp).toLocaleString('pt-BR')}
              </td>
              <td className="px-4 py-3 text-slate-200">{item.usuario}</td>
              <td className="px-4 py-3">
                <span className={`text-xs font-mono uppercase ${item.acao === 'login' ? 'text-online' : 'text-offline'}`}>
                  {item.acao === 'login' ? 'sucesso' : 'falhou'}
                </span>
              </td>
              <td className="px-4 py-3 text-muted font-mono text-xs">{item.ip_origem || '—'}</td>
              <td className="px-4 py-3 text-muted text-xs">{localizacao(item)}</td>
            </tr>
          ))}
          {itens.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted text-sm">Nenhum acesso registrado ainda.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
