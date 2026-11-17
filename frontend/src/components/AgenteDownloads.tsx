import { useEffect, useRef, useState } from 'react';

type Artifact = { url: string; bytes: number; sha256: string };
type Manifest = { version: string; python: Artifact | null; windows: Artifact | null };
const fileSize = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

export function AgenteDownloads({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    ref.current?.showModal();
    const controller = new AbortController();
    fetch('/downloads/agent-manifest.json', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Pacotes indisponíveis');
        const value = await response.json();
        if (typeof value.version !== 'string') throw new Error('Manifesto inválido');
        const artifact = (item: unknown): Artifact | null => {
          if (!item || typeof item !== 'object') return null;
          const file = item as Artifact;
          return /^\/downloads\/[A-Za-z0-9._-]+\.(exe|zip)$/.test(file.url) && /^[a-f0-9]{64}$/.test(file.sha256) && Number.isFinite(file.bytes) && file.bytes > 0 ? file : null;
        };
        setManifest({ version: value.version, python: artifact(value.python), windows: artifact(value.windows) });
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  function download(title: string, detail: string, artifact?: Artifact | null) {
    return <section className="py-5 border-b border-white/10 last:border-0">
      <h3 className="text-lg font-display text-slate-100">{title}</h3>
      <p className="text-sm text-slate-300 mt-1 mb-3">{detail}</p>
      {artifact ? <>
        <a href={artifact.url} download className="inline-flex rounded-lg bg-signal-600 px-4 py-2 text-white font-medium hover:bg-signal-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">Baixar {title} · {fileSize(artifact.bytes)}</a>
        <details className="mt-3 text-xs text-muted"><summary className="cursor-pointer">Verificar SHA-256</summary><code className="block mt-2 break-all select-all">{artifact.sha256}</code></details>
      </> : <p className="text-sm text-muted">{loading ? 'Consultando pacotes…' : 'Pacote ainda não publicado nesta instalação.'}</p>}
    </section>;
  }

  return <dialog ref={ref} onCancel={onClose} aria-labelledby="agent-title" className="w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] overflow-auto rounded-2xl border border-white/15 bg-deep-900 text-slate-200 p-6 sm:p-8 backdrop:bg-black/70">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3"><img src="/favicon.svg" alt="" className="w-12 h-12" /><div><h2 id="agent-title" className="text-2xl font-display font-semibold">Agente uptimeX</h2><p className="text-sm text-muted">{manifest ? `Assistente ${manifest.version}` : 'Preparar um servidor para monitoramento'}</p></div></div>
      <button onClick={onClose} aria-label="Fechar downloads" className="p-2 rounded-lg hover:bg-white/10 focus-visible:outline">✕</button>
    </div>
    <p className="mt-6 text-sm text-slate-300">Execute no servidor que será monitorado. Informe o IP do coletor autorizado e escolha as métricas. O agente oferece acesso somente leitura por SNMPv3.</p>
    {download('Windows', 'Executável com assistente gráfico, sem instalar Python. Nesta versão, oferece prévia; a instalação de um agente Windows ainda não está disponível.', manifest?.windows)}
    {download('Linux / Python', 'Pacote com CLI e janela opcional. Instalação em Debian/Ubuntu e família RHEL com systemd; requer Python 3.9+ e privilégios administrativos.', manifest?.python)}
    <div className="mt-5"><h3 className="font-display text-slate-100">No terminal Linux</h3><p className="text-sm text-muted mt-1">Extraia o ZIP e, dentro da pasta uptimeX-agent, execute:</p><pre className="mt-3 rounded-lg bg-black/20 p-4 overflow-x-auto text-xs sm:text-sm"><code>{'python3 install.py          # visualizar\nsudo python3 install.py --apply'}</code></pre></div>
    <p className="mt-4 text-xs text-muted">Versão inicial: valide em ambiente de teste. Instalações SNMP existentes e firewalls UFW/firewalld ativos são preservados e bloqueiam a aplicação automática.</p>
  </dialog>;
}
