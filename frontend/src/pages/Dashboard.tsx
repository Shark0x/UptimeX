import { useEffect, useMemo, useRef, useState } from 'react';
import { api, Empresa, geocodificarEndereco, STATIC_BASE } from '../api';
import { useAuth } from '../auth/AuthContext';
import { MapaEmpresas, StatusMarcador } from '../components/MapaEmpresas';
import { Paginacao } from '../components/Paginacao';
import { useToast } from '../components/Toast';
import { combinaBusca } from '../lib/busca';

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];
const TAMANHO_MAX = 4 * 1024 * 1024;
const EMPRESAS_POR_PAGINA = 24;

interface ResumoEmpresa {
  total: number;
  online: number;
  offline: number;
  degradados: number;
  links: number;
}

function AvatarEmpresa({ empresa }: { empresa: Empresa }) {
  if (empresa.foto_url) {
    return (
      <img
        src={`${STATIC_BASE}${empresa.foto_url}`}
        alt={empresa.nome}
        className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
      />
    );
  }
  const iniciais = empresa.nome.slice(0, 2).toUpperCase();
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-signal-600 to-accent-600 flex items-center justify-center font-display font-semibold text-white shrink-0">
      {iniciais}
    </div>
  );
}

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: string | number; tom?: 'offline' | 'online' | 'warn' }) {
  const cor =
    tom === 'offline' ? 'text-offline' : tom === 'online' ? 'text-online' : tom === 'warn' ? 'text-warn' : 'text-slate-100';
  return (
    <div className="glass-panel px-4 py-3 flex-1 min-w-[130px]">
      <p className={`stat-number text-2xl leading-none ${cor}`}>{valor}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted font-mono mt-1.5">{rotulo}</p>
    </div>
  );
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={`w-3 h-3 ${className}`} fill="currentColor" aria-hidden>
      <path d="M6 0a4 4 0 0 0-4 4c0 2.9 4 8 4 8s4-5.1 4-8a4 4 0 0 0-4-4Zm0 5.5A1.5 1.5 0 1 1 6 2.5a1.5 1.5 0 0 1 0 3Z" />
    </svg>
  );
}

export function Dashboard({ onSelecionar }: { onSelecionar: (e: Empresa) => void }) {
  const { isAdmin } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [resumos, setResumos] = useState<Record<number, ResumoEmpresa>>({});
  const [formAberto, setFormAberto] = useState(false);
  const [foco, setFoco] = useState<{ latitude: number; longitude: number } | null>(null);
  const [empresaRemovendo, setEmpresaRemovendo] = useState<Empresa | null>(null);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [soLinkDedicado, setSoLinkDedicado] = useState(false);

  async function carregar() {
    // Duas chamadas fixas, não importa se são 5 ou 200 empresas:
    // a lista completa + o resumo agregado (uma query no backend).
    const [lista, resumoLista] = await Promise.all([api.listarEmpresas(), api.resumoStatusEmpresas()]);
    setEmpresas(lista);
    setResumos(
      Object.fromEntries(
        resumoLista.map((r) => [
          r.id,
          {
            total: Number(r.total),
            online: Number(r.online),
            offline: Number(r.offline),
            degradados: Number(r.degradados),
            links: Number(r.links_dedicados),
          },
        ])
      )
    );
  }

  useEffect(() => {
    carregar();
    // Status dos pins/KPIs ao vivo — mesmo ritmo da Visão Macro
    const id = setInterval(carregar, 15000);
    return () => clearInterval(id);
  }, []);

  // Cor de cada pin do mapa: pior estado da empresa manda
  const statusPorEmpresa = useMemo(() => {
    const mapa: Record<number, StatusMarcador> = {};
    Object.entries(resumos).forEach(([id, r]) => {
      mapa[Number(id)] =
        r.offline > 0 ? 'offline' : r.degradados > 0 ? 'degradado' : r.online > 0 ? 'online' : 'sem';
    });
    return mapa;
  }, [resumos]);

  const totais = useMemo(() => {
    let dispositivos = 0, online = 0, offline = 0;
    Object.values(resumos).forEach((r) => {
      dispositivos += r.total;
      online += r.online + r.degradados;
      offline += r.offline;
    });
    return { dispositivos, online, offline };
  }, [resumos]);

  const localizadas = useMemo(
    () => empresas.filter((e) => e.latitude != null && e.longitude != null),
    [empresas]
  );

  const filtradas = useMemo(
    () =>
      empresas.filter(
        (e) => combinaBusca(e.nome, busca) && (!soLinkDedicado || (resumos[e.id]?.links ?? 0) > 0)
      ),
    [empresas, busca, soLinkDedicado, resumos]
  );
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / EMPRESAS_POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaSegura - 1) * EMPRESAS_POR_PAGINA, paginaSegura * EMPRESAS_POR_PAGINA);

  function focarEmpresa(e: Empresa | null) {
    if (e && e.latitude != null && e.longitude != null) {
      setFoco({ latitude: Number(e.latitude), longitude: Number(e.longitude) });
    } else {
      setFoco(null);
    }
  }

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="eyebrow mb-1">Infraestrutura sob vigilância</p>
          <h1 className="font-display text-2xl font-semibold text-slate-100 tracking-tight">Central de Operações</h1>
          <p className="text-muted text-sm font-mono mt-1">monitoramento ICMP/SNMP · topologia · auditoria</p>
        </div>
        {isAdmin && (
          <button onClick={() => setFormAberto(true)} className="btn-primary">
            + Nova empresa
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-3 mb-5 animate-fade-up">
        <Kpi rotulo="empresas" valor={empresas.length} />
        <Kpi rotulo="dispositivos" valor={totais.dispositivos} />
        <Kpi rotulo="online" valor={totais.online} tom="online" />
        <Kpi rotulo="offline" valor={totais.offline} tom={totais.offline > 0 ? 'offline' : undefined} />
      </div>

      <div className="grid lg:grid-cols-12 gap-4 animate-fade-up">
        {/* -------- Mapa: área de atuação -------- */}
        <section className="lg:col-span-5 glass-panel hud-corners p-5 flex flex-col gap-3 overflow-hidden relative min-h-[520px]">
          <div className="flex items-center justify-between relative z-10">
            <div>
              <p className="eyebrow">Cobertura</p>
              <h2 className="font-display font-semibold text-slate-100">Área de atuação</h2>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted">
              {localizadas.length} {localizadas.length === 1 ? 'sede localizada' : 'sedes localizadas'}
            </span>
          </div>

          <div className="flex-1 min-h-0">
            <MapaEmpresas empresas={empresas} foco={foco} statusPorEmpresa={statusPorEmpresa} />
          </div>

          {localizadas.length === 0 && (
            <p className="text-muted text-xs font-mono text-center relative z-10">
              cadastre o endereço com a cidade onde você atua pra fixar o mapa nela
            </p>
          )}
        </section>

        {/* -------- Empresas -------- */}
        <section className="lg:col-span-7">
          <div className="flex flex-wrap items-center gap-3 mb-3">
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
            <button
              onClick={() => {
                setSoLinkDedicado((v) => !v);
                setPagina(1);
              }}
              aria-pressed={soLinkDedicado}
              className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg border transition-all duration-150
                ${soLinkDedicado
                  ? 'border-signal-500/60 text-signal-400 bg-signal-600/10 shadow-glow-signal'
                  : 'border-white/10 text-muted hover:text-slate-100 hover:border-white/25'}`}
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M6.5 9.5 L9.5 6.5 M5 11 l-1.8 1.8 a2.4 2.4 0 0 1 -3.4 -3.4 z" transform="translate(1.6 -1.2)" />
                <path d="M9.3 3.2 l1.8 -1.8 a2.4 2.4 0 0 1 3.4 3.4 l-1.8 1.8" />
                <path d="M6.7 12.8 l-1.8 1.8 a2.4 2.4 0 0 1 -3.4 -3.4 l1.8 -1.8" />
              </svg>
              Link dedicado
            </button>
            {(busca.trim() !== '' || soLinkDedicado) && (
              <span className="text-[11px] font-mono text-muted whitespace-nowrap">
                {filtradas.length} de {empresas.length}
              </span>
            )}
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 content-start">
            {visiveis.map((e) => {
              const r = resumos[e.id];
              return (
                <button
                  key={e.id}
                  onClick={() => onSelecionar(e)}
                  onMouseEnter={() => focarEmpresa(e)}
                  onMouseLeave={() => setFoco(null)}
                  className="group glass-panel-interactive hud-corners p-4 text-left flex flex-col gap-3 relative"
                >
                  {isAdmin && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remover ${e.nome}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setEmpresaRemovendo(e);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.stopPropagation();
                          setEmpresaRemovendo(e);
                        }
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100
                        w-6 h-6 flex items-center justify-center rounded-md text-muted hover:text-offline
                        hover:bg-signal-600/15 transition-all text-sm leading-none"
                    >
                      ✕
                    </span>
                  )}
                  <div className="flex items-start gap-3 min-w-0">
                    <AvatarEmpresa empresa={e} />
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-slate-100 truncate pr-5">{e.nome}</p>
                      {e.descricao && <p className="text-muted text-sm mt-0.5 line-clamp-2">{e.descricao}</p>}
                    </div>
                  </div>

                  <div className="mt-auto pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-muted truncate flex items-center gap-1 min-w-0">
                      {e.endereco ? (
                        <>
                          <PinIcon className="text-signal-500 shrink-0" />
                          <span className="truncate">{e.endereco}</span>
                        </>
                      ) : (
                        'sem localização'
                      )}
                    </span>
                    {r && r.total > 0 && (
                      <span className="text-[11px] font-mono tabular-nums shrink-0">
                        <span className="text-online">{r.online + r.degradados}</span>
                        <span className="text-muted">/{r.total}</span>
                        {r.offline > 0 && <span className="text-offline"> · {r.offline} off</span>}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {empresas.length === 0 && (
              <div className="col-span-full glass-panel p-8 text-center">
                <p className="text-slate-300 font-display">Nenhuma empresa cadastrada ainda.</p>
                <p className="text-muted text-sm mt-1">Crie a primeira empresa pra começar a mapear a rede.</p>
              </div>
            )}
            {empresas.length > 0 && filtradas.length === 0 && (
              <div className="col-span-full glass-panel p-8 text-center">
                <p className="text-slate-300 font-display">Nenhuma empresa encontrada.</p>
                <p className="text-muted text-sm mt-1">
                  {soLinkDedicado && busca.trim() === ''
                    ? 'Nenhuma empresa tem bloco registrado na aba Link Dedicado ainda.'
                    : `Nada com "${busca.trim()}" no nome${soLinkDedicado ? ' entre as empresas com link dedicado' : ''} — confira a grafia.`}
                </p>
              </div>
            )}
          </div>

          <Paginacao pagina={paginaSegura} totalPaginas={totalPaginas} aoMudar={setPagina} />
        </section>
      </div>

      {formAberto && (
        <NovaEmpresaModal
          onClose={() => setFormAberto(false)}
          onCriada={() => {
            setFormAberto(false);
            carregar();
          }}
        />
      )}

      {empresaRemovendo && (
        <RemoverEmpresaModal
          empresa={empresaRemovendo}
          totalDispositivos={resumos[empresaRemovendo.id]?.total ?? 0}
          onClose={() => setEmpresaRemovendo(null)}
          onRemovida={() => {
            setEmpresaRemovendo(null);
            setFoco(null);
            carregar();
          }}
        />
      )}
    </div>
  );
}

function RemoverEmpresaModal({
  empresa,
  totalDispositivos,
  onClose,
  onRemovida,
}: {
  empresa: Empresa;
  totalDispositivos: number;
  onClose: () => void;
  onRemovida: () => void;
}) {
  const toast = useToast();
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState('');

  async function remover() {
    setRemovendo(true);
    setErro('');
    try {
      await api.removerEmpresa(empresa.id);
      toast.sucesso(`Empresa "${empresa.nome}" removida`);
      onRemovida();
    } catch {
      setErro('Não foi possível remover a empresa.');
      setRemovendo(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel hud-corners p-6 w-full max-w-sm animate-fade-up border-signal-500/30">
        <p className="eyebrow mb-1">Remoção definitiva</p>
        <h2 className="font-display font-semibold text-lg text-slate-100">
          Remover {empresa.nome}?
        </h2>
        <p className="text-sm text-muted mt-3">
          {totalDispositivos > 0 ? (
            <>
              Os <span className="text-slate-200 font-semibold">{totalDispositivos} {totalDispositivos === 1 ? 'dispositivo monitorado' : 'dispositivos monitorados'}</span>,
              todo o histórico de quedas, as métricas e a topologia desta empresa serão apagados junto.
            </>
          ) : (
            'A topologia e os dados desta empresa serão apagados junto.'
          )}{' '}
          Essa ação não tem volta.
        </p>

        {erro && <p className="text-offline text-xs mt-3">{erro}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button
            onClick={remover}
            disabled={removendo}
            className="bg-signal-600 hover:bg-signal-500 text-white font-display font-semibold text-sm px-4 py-2 rounded-xl transition-all duration-150 disabled:opacity-50"
          >
            {removendo ? 'Removendo…' : 'Remover de vez'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NovaEmpresaModal({ onClose, onCriada }: { onClose: () => void; onCriada: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [endereco, setEndereco] = useState('');
  const [geo, setGeo] = useState<{ latitude: number; longitude: number; rotulo: string } | null>(null);
  const [buscandoGeo, setBuscandoGeo] = useState(false);
  const [geoErro, setGeoErro] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function selecionarArquivo(arquivo: File | null) {
    setErro('');
    if (!arquivo) {
      setFoto(null);
      setPreviewUrl(null);
      return;
    }
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      setErro('Formato inválido. Use JPEG, PNG ou WebP.');
      return;
    }
    if (arquivo.size > TAMANHO_MAX) {
      setErro('Arquivo muito grande. Máximo 4MB.');
      return;
    }
    setFoto(arquivo);
    setPreviewUrl(URL.createObjectURL(arquivo));
  }

  async function localizar() {
    if (!endereco.trim()) return;
    setBuscandoGeo(true);
    setGeoErro('');
    setGeo(null);
    try {
      const resultado = await geocodificarEndereco(endereco.trim());
      if (resultado) setGeo(resultado);
      else setGeoErro('Endereço não encontrado. Tente cidade e estado, ex: "Sorocaba, SP".');
    } catch {
      setGeoErro('Falha ao consultar o serviço de mapas.');
    } finally {
      setBuscandoGeo(false);
    }
  }

  async function criar() {
    if (!nome.trim()) return;
    setSalvando(true);
    setErro('');
    try {
      await api.criarEmpresa({
        nome,
        descricao,
        foto,
        endereco: endereco.trim() || undefined,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
      });
      toast.sucesso(`Empresa "${nome}" criada`);
      onCriada();
    } catch {
      setErro('Não foi possível criar a empresa.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel hud-corners p-6 w-full max-w-sm animate-fade-up max-h-[90vh] overflow-y-auto">
        <p className="eyebrow mb-1">Cadastro</p>
        <h2 className="font-display font-semibold text-lg text-slate-100 mb-4">Nova empresa</h2>
        <div className="space-y-3">
          <div>
            <label className="label-field">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da empresa" className="input" maxLength={150} />
          </div>
          <div>
            <label className="label-field">Descrição (opcional)</label>
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição" className="input" maxLength={255} />
          </div>
          <div>
            <label className="label-field">Endereço da sede (opcional)</label>
            <div className="flex gap-2">
              <input
                value={endereco}
                onChange={(e) => {
                  setEndereco(e.target.value);
                  setGeo(null);
                  setGeoErro('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && localizar()}
                placeholder="Rua, cidade, estado"
                className="input"
                maxLength={255}
              />
              <button
                type="button"
                onClick={localizar}
                disabled={buscandoGeo || !endereco.trim()}
                className="btn-ghost border border-white/10 shrink-0 disabled:opacity-40"
              >
                {buscandoGeo ? '…' : 'Localizar'}
              </button>
            </div>
            {geo && (
              <p className="text-[11px] font-mono text-online/90 mt-1.5 flex items-start gap-1.5">
                <PinIcon className="text-signal-400 mt-0.5 shrink-0" />
                <span className="line-clamp-2">{geo.rotulo}</span>
              </p>
            )}
            {geoErro && <p className="text-warn text-[11px] font-mono mt-1.5">{geoErro}</p>}
          </div>
          <div>
            <label className="label-field">Foto do local (opcional)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => selecionarArquivo(e.target.files?.[0] || null)}
              className="input file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-signal-600/30 file:text-signal-400 file:text-xs"
            />
            {previewUrl && (
              <img src={previewUrl} alt="Pré-visualização" className="mt-2 w-full h-32 object-cover rounded-lg border border-white/10" />
            )}
          </div>
        </div>

        {erro && <p className="text-offline text-xs mt-3">{erro}</p>}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={criar} disabled={salvando} className="btn-primary">
            {salvando ? 'Salvando...' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
