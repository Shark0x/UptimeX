import { useState, useEffect } from 'react';
import {
  AntenaWireless,
  FabricanteAntena,
  NovaAntenaPayload,
  TipoWireless,
} from '../apiAntenas';
import { IconePickerAntena } from './IconePickerAntena';
import { useToast } from './Toast';

// Mesma regra usada no backend pra inferir o ícone quando o usuário ainda não escolheu um manualmente.
function inferirTipoVisual(tipoWireless: TipoWireless): string {
  if (tipoWireless.includes('setorial') || tipoWireless.includes('ap')) return 'antena_setorial';
  if (tipoWireless.includes('torre')) return 'torre';
  if (tipoWireless.includes('station') || tipoWireless.includes('cliente')) return 'antena_cpe';
  if (tipoWireless.includes('switch')) return 'switch_poe';
  return 'antena_ptp';
}

const FABRICANTES: { id: FabricanteAntena; label: string; modelos: string[] }[] = [
  {
    id: 'ubiquiti',
    label: 'Ubiquiti (AirMAX / UISP)',
    modelos: [
      'Rocket Prism 5AC Gen2',
      'PowerBeam 5AC Gen2',
      'LiteBeam 5AC Gen2',
      'AirFiber 5XHD',
      'AirFiber 24HD',
      'NanoStation 5AC',
      'GigaBeam 60GHz',
    ],
  },
  {
    id: 'mikrotik',
    label: 'MikroTik (RouterBOARD)',
    modelos: [
      'NetMetal 5 ac',
      'LHG 5 ac Dual Chain',
      'SXT 5 ac',
      'BaseBox 5',
      'DynaDish 5',
      'CCR1036-8G-2S+',
      'RB4011iGS+RM',
    ],
  },
  {
    id: 'mimosa',
    label: 'Mimosa Networks',
    modelos: ['Mimosa B5c (Backbone)', 'Mimosa B11 (11GHz)', 'Mimosa C5c (CPE/PTP)', 'Mimosa C5x'],
  },
  {
    id: 'cambium',
    label: 'Cambium Networks',
    modelos: ['ePMP 3000 (MU-MIMO)', 'ePMP Force 300-25', 'PTP 550', 'PTP 670'],
  },
  {
    id: 'intelbras',
    label: 'Intelbras',
    modelos: ['APC 5A-90 (Setorial)', 'APC 5A-15D', 'Woman 5A-23', 'MIMO 5G'],
  },
  {
    id: 'outro',
    label: 'Outro / Genérico',
    modelos: ['Rádio Wireless PTP', 'Roteador de Torre', 'Switch PoE', 'Câmera IP de Torre'],
  },
];

const PAPEIS: { id: TipoWireless; label: string; desc: string }[] = [
  { id: 'ptp_master', label: 'PTP Master (Transmissor)', desc: 'Ponto a ponto transmissor principal' },
  { id: 'ptp_slave', label: 'PTP Slave (Receptor)', desc: 'Ponto a ponto receptor do enlace' },
  { id: 'ptmp_ap', label: 'PTMP AP (Painel / Setorial)', desc: 'Ponto multiponto para vários clientes' },
  { id: 'ptmp_station', label: 'PTMP Station (CPE Cliente)', desc: 'Antena de cliente apontada para a setorial' },
  { id: 'torre', label: 'Torre Telecom / POP Master', desc: 'Estrutura de site / torre com múltiplos rádios' },
  { id: 'switch_torre', label: 'Switch PoE de Torre', desc: 'Switch base alimentando os rádios' },
  { id: 'repetidora', label: 'Repetidora Solar / Site Remoto', desc: 'Ponto intermediário de retransmissão' },
];

export function AntenaModal({
  aberto,
  onClose,
  onSalvar,
  antenaEditando,
  iconeAtual,
}: {
  aberto: boolean;
  onClose: () => void;
  onSalvar: (payload: NovaAntenaPayload) => Promise<void>;
  antenaEditando?: AntenaWireless | null;
  iconeAtual?: string;
}) {
  const [nome, setNome] = useState('');
  const [ip, setIp] = useState('');
  const [fabricante, setFabricante] = useState<FabricanteAntena>('ubiquiti');
  const [modelo, setModelo] = useState('');
  const [tipoWireless, setTipoWireless] = useState<TipoWireless>('ptp_master');
  const [frequenciaMhz, setFrequenciaMhz] = useState<string>('5800');
  const [larguraCanalMhz, setLarguraCanalMhz] = useState<string>('80');
  const [ssid, setSsid] = useState('');
  const [sinalEsperado, setSinalEsperado] = useState<string>('-55');
  const [pollingSeg, setPollingSeg] = useState<number>(5);
  const [tipoVisual, setTipoVisual] = useState('antena_ptp');
  const [iconeManual, setIconeManual] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (antenaEditando) {
      setNome(antenaEditando.nome);
      setIp(antenaEditando.ip);
      setFabricante(antenaEditando.fabricante);
      setModelo(antenaEditando.modelo || '');
      setTipoWireless(antenaEditando.tipo_wireless);
      setFrequenciaMhz(antenaEditando.frequencia_mhz ? String(antenaEditando.frequencia_mhz) : '');
      setLarguraCanalMhz(antenaEditando.largura_canal_mhz ? String(antenaEditando.largura_canal_mhz) : '40');
      setSsid(antenaEditando.ssid || '');
      setSinalEsperado(antenaEditando.sinal_esperado_dbm ? String(antenaEditando.sinal_esperado_dbm) : '');
      setPollingSeg(antenaEditando.intervalo_polling_seg || 10);
      setTipoVisual(iconeAtual || inferirTipoVisual(antenaEditando.tipo_wireless));
      setIconeManual(true);
    } else {
      setNome('');
      setIp('');
      setFabricante('ubiquiti');
      setModelo('Rocket Prism 5AC Gen2');
      setTipoWireless('ptp_master');
      setFrequenciaMhz('5800');
      setLarguraCanalMhz('80');
      setSsid('');
      setSinalEsperado('-55');
      setPollingSeg(5);
      setTipoVisual(inferirTipoVisual('ptp_master'));
      setIconeManual(false);
    }
  }, [antenaEditando, iconeAtual, aberto]);

  // Enquanto o usuário não escolher um ícone manualmente, ele acompanha o papel wireless.
  useEffect(() => {
    if (!iconeManual) setTipoVisual(inferirTipoVisual(tipoWireless));
  }, [tipoWireless, iconeManual]);

  if (!aberto) return null;

  const fabricanteAtual = FABRICANTES.find((f) => f.id === fabricante);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !ip.trim()) {
      toast.erro('Preencha o nome e o IP do equipamento');
      return;
    }
    setSalvando(true);
    try {
      await onSalvar({
        nome: nome.trim(),
        ip: ip.trim(),
        fabricante,
        modelo: modelo.trim() || undefined,
        tipo_wireless: tipoWireless,
        frequencia_mhz: frequenciaMhz ? Number(frequenciaMhz) : undefined,
        largura_canal_mhz: larguraCanalMhz ? Number(larguraCanalMhz) : undefined,
        ssid: ssid.trim() || undefined,
        sinal_esperado_dbm: sinalEsperado ? Number(sinalEsperado) : undefined,
        intervalo_polling_seg: Number(pollingSeg) || 10,
        criar_no_topologia: !antenaEditando,
        tipo_visual: tipoVisual,
      });
      toast.sucesso(antenaEditando ? 'Antena atualizada!' : 'Antena adicionada com sucesso!');
      onClose();
    } catch (err: any) {
      toast.erro(err.message || 'Erro ao salvar antena');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="glass-panel w-full max-w-xl max-h-[90vh] flex flex-col hud-corners border-signal-500/30 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-deep-900/60">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-signal-500 animate-pulse" />
            <div>
              <h2 className="font-display text-lg font-bold text-slate-100">
                {antenaEditando ? 'Editar Antena Wireless' : 'Nova Antena / Equipamento'}
              </h2>
              <p className="text-xs font-mono text-muted">
                Módulo Antenas // Telemetria ICMP de Rádio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-slate-100 hover:bg-white/10 rounded-lg transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Nome e IP */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Nome do Equipamento *
              </label>
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex: Torre Morro - Rocket PTP 01"
                className="input"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Endereço IP (ICMP Ping) *
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="Ex: 192.168.1.20 ou IP público"
                className="input font-mono"
                required
              />
            </div>
          </div>

          {/* Fabricante e Papel */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Fabricante / Marca
              </label>
              <select
                value={fabricante}
                onChange={(e) => {
                  const novoFab = e.target.value as FabricanteAntena;
                  setFabricante(novoFab);
                  const fabObj = FABRICANTES.find((f) => f.id === novoFab);
                  if (fabObj?.modelos.length) setModelo(fabObj.modelos[0]);
                }}
                className="input"
              >
                {FABRICANTES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Função / Papel Wireless
              </label>
              <select
                value={tipoWireless}
                onChange={(e) => setTipoWireless(e.target.value as TipoWireless)}
                className="input"
              >
                {PAPEIS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Ícone exibido na topologia */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-2">
              Ícone no Mapa
            </label>
            <IconePickerAntena valor={tipoVisual} onSelecionar={(v) => { setTipoVisual(v); setIconeManual(true); }} />
          </div>

          {/* Modelo com sugestão rápida */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
              Modelo do Hardware
            </label>
            <input
              type="text"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              placeholder="Ex: Rocket Prism 5AC Gen2"
              className="input mb-2"
            />
            {fabricanteAtual?.modelos && (
              <div className="flex flex-wrap gap-1.5">
                {fabricanteAtual.modelos.slice(0, 4).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setModelo(m)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/10 text-slate-400 hover:text-slate-200 border border-white/5 transition-colors"
                  >
                    + {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Frequência, Canal e SSID */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Frequência (MHz)
              </label>
              <input
                type="number"
                value={frequenciaMhz}
                onChange={(e) => setFrequenciaMhz(e.target.value)}
                placeholder="Ex: 5800"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Largura Canal
              </label>
              <select
                value={larguraCanalMhz}
                onChange={(e) => setLarguraCanalMhz(e.target.value)}
                className="input font-mono"
              >
                <option value="20">20 MHz</option>
                <option value="40">40 MHz</option>
                <option value="80">80 MHz</option>
                <option value="160">160 MHz</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Sinal Alvo (dBm)
              </label>
              <input
                type="number"
                value={sinalEsperado}
                onChange={(e) => setSinalEsperado(e.target.value)}
                placeholder="Ex: -55"
                className="input font-mono"
              />
            </div>
          </div>

          {/* SSID e Polling */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                SSID / Identificador do Enlace
              </label>
              <input
                type="text"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder="Ex: PTP-TORRE-CLIENTE-01"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-muted mb-1">
                Intervalo de Ping ICMP (Segundos)
              </label>
              <select
                value={pollingSeg}
                onChange={(e) => setPollingSeg(Number(e.target.value))}
                className="input font-mono"
              >
                <option value="2">2 segundos (Ultra rápido / Teste)</option>
                <option value="5">5 segundos (Recomendado PTP)</option>
                <option value="10">10 segundos (Padrão)</option>
                <option value="30">30 segundos (Econômico)</option>
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-sm"
              disabled={salvando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary text-sm flex items-center gap-2"
              disabled={salvando}
            >
              {salvando ? (
                <span>Salvando...</span>
              ) : (
                <span>{antenaEditando ? 'Salvar Alterações' : '+ Adicionar Antena'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
