#!/usr/bin/env bash
# ============================================================================
#  Configura SNMPv3 (authPriv: SHA + AES-128) num servidor Debian/Ubuntu para
#  ser monitorado pelo uptimeX — de forma SEGURA: tráfego criptografado e porta
#  UDP 161 liberada SOMENTE para o IP do servidor de monitoramento (NMS).
#
#  Uso (como root):
#    sudo NMS_IP=216.28.198.177 bash configurar-snmpv3-debian.sh
#
#  Opcional — definir usuário/senhas (senão são geradas aleatórias e mostradas):
#    sudo NMS_IP=... SNMP_USER=uptimex \
#         SNMP_AUTH_PASS=suaSenhaAuth SNMP_PRIV_PASS=suaSenhaPriv \
#         bash configurar-snmpv3-debian.sh
#
#  Ao final imprime usuário/senhas para cadastrar no uptimeX (Versão SNMP = v3).
# ============================================================================
set -euo pipefail

# ---- parâmetros (via variáveis de ambiente) --------------------------------
SNMP_USER="${SNMP_USER:-uptimex}"
NMS_IP="${NMS_IP:-}"            # IP público/alcançável do servidor uptimeX
AUTH_PROTO="SHA"               # autenticação (combina com o padrão do uptimeX)
PRIV_PROTO="AES"               # criptografia AES-128 (idem)

gerar() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16; }
SNMP_AUTH_PASS="${SNMP_AUTH_PASS:-$(gerar)}"
SNMP_PRIV_PASS="${SNMP_PRIV_PASS:-$(gerar)}"

# ---- pré-checagens ---------------------------------------------------------
[ "$(id -u)" -eq 0 ] || { echo "ERRO: rode como root (use sudo)."; exit 1; }
if [ "${#SNMP_AUTH_PASS}" -lt 8 ] || [ "${#SNMP_PRIV_PASS}" -lt 8 ]; then
  echo "ERRO: as senhas auth/priv precisam de 8+ caracteres."; exit 1
fi

echo ">> Instalando snmpd + ferramentas..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq snmpd snmp >/dev/null

echo ">> Parando o snmpd para criar o usuário SNMPv3..."
systemctl stop snmpd 2>/dev/null || true

# O createUser é processado no próximo start: o snmpd deriva a chave, grava o
# segredo e REMOVE a senha em texto puro deste arquivo de estado.
STATE=/var/lib/snmp/snmpd.conf
touch "$STATE"
if grep -qiE "(createUser|usmUser).*(\"?$SNMP_USER\"?)" "$STATE"; then
  echo "   (usuário '$SNMP_USER' já existe no estado do snmpd; mantendo o atual)"
else
  echo "createUser $SNMP_USER $AUTH_PROTO \"$SNMP_AUTH_PASS\" $PRIV_PROTO \"$SNMP_PRIV_PASS\"" >> "$STATE"
fi

# ---- snmpd.conf: escutar em TODAS as interfaces + acesso r/o ao usuário v3 --
CONF=/etc/snmp/snmpd.conf
# padrão do Debian escuta só em 127.0.0.1 — troca para todas as interfaces
sed -i -E 's/^[[:space:]]*[Aa]gent[Aa]ddress[[:space:]].*/agentaddress udp:161/' "$CONF"
grep -qiE "^agentaddress " "$CONF" || echo "agentaddress udp:161" >> "$CONF"
# read-only para o usuário v3 exigindo authPriv (nível 'priv'); árvore completa
grep -qE "^rouser[[:space:]]+$SNMP_USER([[:space:]]|$)" "$CONF" || echo "rouser $SNMP_USER priv" >> "$CONF"

echo ">> Iniciando o snmpd..."
systemctl enable snmpd >/dev/null 2>&1 || true
systemctl start snmpd
sleep 2

# ---- firewall: UDP 161 liberado SOMENTE para o IP do NMS -------------------
if [ -n "$NMS_IP" ]; then
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
    ufw allow from "$NMS_IP" to any port 161 proto udp >/dev/null
    echo ">> ufw: UDP 161 liberado SOMENTE de $NMS_IP"
  elif command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p udp --dport 161 -s "$NMS_IP" -j ACCEPT 2>/dev/null \
      || iptables -I INPUT -p udp --dport 161 -s "$NMS_IP" -j ACCEPT
    echo ">> iptables: UDP 161 liberado SOMENTE de $NMS_IP"
    echo "   (regra NÃO persistente; use 'apt install iptables-persistent' para salvar)"
  else
    echo ">> Sem ufw/iptables detectado — libere UDP 161 só de $NMS_IP no seu firewall."
  fi
else
  echo ">> AVISO: NMS_IP não informado — NÃO mexi no firewall."
  echo "   Libere UDP 161 APENAS do IP do servidor uptimeX (não deixe aberto para todos)."
fi

# ---- validação local -------------------------------------------------------
echo ">> Validando SNMPv3 localmente (sysDescr)..."
OK=0
if snmpget -v3 -l authPriv -u "$SNMP_USER" -a "$AUTH_PROTO" -A "$SNMP_AUTH_PASS" \
     -x "$PRIV_PROTO" -X "$SNMP_PRIV_PASS" 127.0.0.1 1.3.6.1.2.1.1.1.0 2>/dev/null; then
  OK=1
fi
echo ">> Porta em escuta (deve aparecer 0.0.0.0:161):"
ss -lunp 2>/dev/null | grep ':161' || echo "   (161 não apareceu — veja 'systemctl status snmpd')"

echo
echo "============================================================"
if [ "$OK" = 1 ]; then
  echo " SNMPv3 respondendo localmente  ✅"
else
  echo " SNMPv3 NAO respondeu local  ⚠  (veja: journalctl -u snmpd -n 30)"
fi
echo " Cadastre no uptimeX (editar dispositivo -> Versao SNMP = v3):"
echo "   Usuario:      $SNMP_USER"
echo "   Nivel:        authPriv"
echo "   Auth:         SHA     |  Senha auth:  $SNMP_AUTH_PASS"
echo "   Priv:         AES     |  Senha priv:  $SNMP_PRIV_PASS"
echo "   Porta:        161"
echo
echo " GUARDE estas senhas: elas nao aparecem mais depois deste comando."
echo "============================================================"
