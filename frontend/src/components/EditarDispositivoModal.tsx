import { useState } from 'react';
import { api, Dispositivo } from '../api';
import { useToast } from './Toast';

export function EditarDispositivoModal({
  dispositivo, onClose, onSalvo,
}: {
  dispositivo: Dispositivo; onClose: () => void; onSalvo: () => void;
}) {
  const [nome, setNome] = useState(dispositivo.nome);
  const [ip, setIp] = useState(dispositivo.ip);
  const [fabricante, setFabricante] = useState(dispositivo.fabricante);
  const [metodo, setMetodo] = useState(dispositivo.metodo_monitoramento);
  const [comunidade, setComunidade] = useState('');
  const [snmpVersao, setSnmpVersao] = useState<'v2c' | 'v3'>(dispositivo.snmp_versao || 'v2c');
  const [snmpUsuario, setSnmpUsuario] = useState(dispositivo.snmp_usuario || '');
  const [snmpNivel, setSnmpNivel] = useState<'noAuthNoPriv' | 'authNoPriv' | 'authPriv'>('authPriv');
  const [snmpAuthProto, setSnmpAuthProto] = useState('sha');
  const [snmpAuthSenha, setSnmpAuthSenha] = useState('');
  const [snmpPrivProto, setSnmpPrivProto] = useState('aes');
  const [snmpPrivSenha, setSnmpPrivSenha] = useState('');
  const [porta, setPorta] = useState(dispositivo.porta_snmp);
  const [intervalo, setIntervalo] = useState(dispositivo.intervalo_polling_seg);
  const [ativo, setAtivo] = useState(dispositivo.ativo);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  const toast = useToast();

  async function remover() {
    setRemovendo(true);
    try {
      await api.removerDispositivo(dispositivo.id);
      toast.sucesso(`Dispositivo "${dispositivo.nome}" removido`);
      onSalvo();
    } catch {
      toast.erro('Não foi possível remover o dispositivo.');
    } finally {
      setRemovendo(false);
    }
  }

  async function salvar() {
    if (!nome.trim() || !ip.trim()) return;
    setSalvando(true);
    try {
      const payload: Partial<Dispositivo> & {
        comunidade_snmp?: string; snmp_usuario?: string; snmp_nivel?: string;
        snmp_auth_protocolo?: string; snmp_auth_senha?: string;
        snmp_priv_protocolo?: string; snmp_priv_senha?: string;
      } = {
        nome, ip, fabricante,
        metodo_monitoramento: metodo,
        porta_snmp: porta, intervalo_polling_seg: intervalo, ativo,
        snmp_versao: snmpVersao,
      };
      if (comunidade.trim()) payload.comunidade_snmp = comunidade.trim();
      if (snmpVersao === 'v3') {
        payload.snmp_usuario = snmpUsuario.trim();
        payload.snmp_nivel = snmpNivel;
        payload.snmp_auth_protocolo = snmpAuthProto;
        payload.snmp_priv_protocolo = snmpPrivProto;
        if (snmpAuthSenha.trim()) payload.snmp_auth_senha = snmpAuthSenha.trim();
        if (snmpPrivSenha.trim()) payload.snmp_priv_senha = snmpPrivSenha.trim();
      }
      await api.editarDispositivo(dispositivo.id, payload);
      toast.sucesso('Alterações salvas');
      onSalvo();
    } catch {
      toast.erro('Não foi possível salvar as alterações.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-deep-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="glass-panel p-6 w-full max-w-md">
        <h2 className="font-display font-semibold text-lg text-slate-100 mb-4">Editar dispositivo</h2>
        <div className="space-y-3">
          <Campo label="Nome"><input value={nome} onChange={(e) => setNome(e.target.value)} className="input" maxLength={150} /></Campo>
          <Campo label="IP público"><input value={ip} onChange={(e) => setIp(e.target.value)} className="input" maxLength={45} /></Campo>
          <Campo label="Fabricante">
            <select value={fabricante} onChange={(e) => setFabricante(e.target.value)} className="input">
              <option value="mikrotik">MikroTik</option>
              <option value="ubiquiti">Ubiquiti</option>
              <option value="cisco">Cisco</option>
              <option value="generico">Genérico / Outro</option>
            </select>
          </Campo>
          <Campo label="Método de monitoramento">
            <select value={metodo} onChange={(e) => setMetodo(e.target.value as any)} className="input">
              <option value="snmp+ping">SNMP + Ping (recomendado)</option>
              <option value="snmp">Somente SNMP</option>
              <option value="ping">Somente Ping</option>
            </select>
          </Campo>
          {metodo !== 'ping' && (
            <>
              <Campo label="Versão SNMP">
                <select value={snmpVersao} onChange={(e) => setSnmpVersao(e.target.value as 'v2c' | 'v3')} className="input">
                  <option value="v2c">v2c (comunidade)</option>
                  <option value="v3">v3 (usuário/senha)</option>
                </select>
              </Campo>
              {snmpVersao === 'v2c' ? (
                <Campo label="Comunidade SNMP">
                  <input
                    type="password"
                    value={comunidade}
                    onChange={(e) => setComunidade(e.target.value)}
                    className="input"
                    placeholder={dispositivo.comunidade_snmp_configurada ? 'Deixe vazio para manter a atual' : 'Informe a comunidade'}
                    maxLength={100}
                    autoComplete="new-password"
                  />
                </Campo>
              ) : (
                <>
                  <Campo label="Usuário SNMPv3">
                    <input value={snmpUsuario} onChange={(e) => setSnmpUsuario(e.target.value)} className="input" maxLength={100} autoComplete="off" />
                  </Campo>
                  <Campo label="Nível de segurança">
                    <select value={snmpNivel} onChange={(e) => setSnmpNivel(e.target.value as any)} className="input">
                      <option value="authPriv">authPriv (autenticação + criptografia)</option>
                      <option value="authNoPriv">authNoPriv (só autenticação)</option>
                      <option value="noAuthNoPriv">noAuthNoPriv</option>
                    </select>
                  </Campo>
                  {snmpNivel !== 'noAuthNoPriv' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="Protocolo auth">
                        <select value={snmpAuthProto} onChange={(e) => setSnmpAuthProto(e.target.value)} className="input">
                          <option value="sha">SHA</option>
                          <option value="sha256">SHA-256</option>
                          <option value="sha512">SHA-512</option>
                          <option value="md5">MD5</option>
                        </select>
                      </Campo>
                      <Campo label="Senha auth">
                        <input type="password" value={snmpAuthSenha} onChange={(e) => setSnmpAuthSenha(e.target.value)} className="input"
                          placeholder={dispositivo.snmp_v3_configurado ? 'manter atual' : '••••••'} maxLength={200} autoComplete="new-password" />
                      </Campo>
                    </div>
                  )}
                  {snmpNivel === 'authPriv' && (
                    <div className="grid grid-cols-2 gap-2">
                      <Campo label="Protocolo priv">
                        <select value={snmpPrivProto} onChange={(e) => setSnmpPrivProto(e.target.value)} className="input">
                          <option value="aes">AES-128</option>
                          <option value="aes256b">AES-256</option>
                          <option value="des">DES</option>
                        </select>
                      </Campo>
                      <Campo label="Senha priv">
                        <input type="password" value={snmpPrivSenha} onChange={(e) => setSnmpPrivSenha(e.target.value)} className="input"
                          placeholder={dispositivo.snmp_v3_configurado ? 'manter atual' : '••••••'} maxLength={200} autoComplete="new-password" />
                      </Campo>
                    </div>
                  )}
                </>
              )}
              <Campo label="Porta SNMP"><input type="number" value={porta} onChange={(e) => setPorta(Number(e.target.value))} className="input" min={1} max={65535} /></Campo>
            </>
          )}
          <Campo label="Intervalo de verificação (segundos)">
            <input type="number" value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} className="input" min={5} />
          </Campo>
          <label className="flex items-center gap-2 text-sm text-slate-200 pt-1">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="accent-signal-500" />
            Monitoramento ativo
          </label>
        </div>
        {confirmandoRemocao ? (
          <div className="mt-6 border border-signal-500/40 bg-signal-600/10 rounded-xl p-3">
            <p className="text-sm text-slate-100">
              Remover <span className="font-semibold">{dispositivo.nome}</span>?
            </p>
            <p className="text-xs text-muted mt-1">
              O histórico de quedas e as métricas deste dispositivo também serão apagados. Essa ação não tem volta.
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setConfirmandoRemocao(false)} className="btn-ghost">Manter</button>
              <button
                onClick={remover}
                disabled={removendo}
                className="bg-signal-600 hover:bg-signal-500 text-[#fff] font-display font-semibold text-sm px-4 py-2 rounded-xl transition-all duration-150 disabled:opacity-50"
              >
                {removendo ? 'Removendo…' : 'Remover de vez'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 mt-6">
            <button
              onClick={() => setConfirmandoRemocao(true)}
              className="px-3 py-1.5 text-sm text-offline/80 hover:text-offline hover:bg-signal-600/10 rounded-lg transition-all"
            >
              Remover
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="btn-primary">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-field">{label}</label>
      {children}
    </div>
  );
}
