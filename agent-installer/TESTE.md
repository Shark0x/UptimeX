# Teste do agente SNMP uptimeX 0.1.0

Pacote experimental separado da central. Execute no servidor que deseja
monitorar. Comece em uma VM Debian/Ubuntu com systemd, sem SNMP existente e
sem UFW/firewalld ativo. Não desative o firewall de uma máquina em produção
para contornar as verificações: use uma VM compatível.

## 1. Obter o instalador

Extraia `uptimeX-Agent-Python.zip` e entre na pasta `uptimeX-agent`.
Alternativamente, obtenha o código pelo GitHub:

```bash
git clone --branch redesign-ui/20261014-212102 --single-branch https://github.com/Shark0x/UptimeX.git
cd UptimeX/agent-installer
```

Requer Python 3.9+. A CLI não exige bibliotecas Python adicionais.

## 2. Visualizar e instalar

Use o IP de origem com que o coletor chega ao servidor monitorado.
O coletor atual é `38.156.3.77`; ajuste em caso de VPN/NAT.

```bash
python3 install.py --nms 38.156.3.77
sudo python3 install.py --nms 38.156.3.77 --apply
```

O primeiro comando mostra apenas a prévia. O segundo solicita confirmação,
instala Net-SNMP, gera credenciais SNMPv3 SHA/AES e restringe UDP 161 ao coletor.
Guarde um snapshot da VM antes de aplicar para facilitar a restauração.

## 3. Cadastrar no uptimeX

Consulte as credenciais localmente, sem enviá-las a issues ou logs públicos:

```bash
sudo cat /etc/uptimex-agent/credentials.json
sudo systemctl status uptimex-agent uptimex-agent-firewall
```

Cadastre o IP alcançável da VM, porta 161, versão v3 e nível authPriv.
Copie usuário e senhas do arquivo gerado, usando autenticação SHA e criptografia
AES. Use o método SNMP + ping e marque Monitoramento ativo. Salve e use
Coletar agora. O cadastro não é automático.

## 4. Critérios de aceitação

- Os dois serviços estão ativos e a validação local do instalador passou.
- A coleta remota termina sem timeout/erro de autenticação.
- Sistema, interfaces e recursos suportados pelo alvo aparecem no uptimeX.
- Após ao menos dois ciclos, há taxas de tráfego para interfaces com atividade.
- Após reiniciar a VM, agente e firewall voltam a funcionar.
- Uma origem diferente do coletor não consegue consultar UDP 161.

Se houver timeout remoto, confira rota, NAT e firewall de borda. Se houver erro
de autenticação, confira usuário, SHA/AES e as duas senhas.

## Windows e limites

No Windows, `py install.py --gui` abre o assistente, mas aplicar a instalação
ainda não é suportado. A família RHEL também requer validação em VM.
Não há instalação remota em lote, atualização, rotação ou desinstalação automática.
Não execute o script Debian antigo junto com este instalador.

Para encerrar o teste, restaure o snapshot. Para apenas parar o agente:

```bash
sudo systemctl disable --now uptimex-agent
```

Isso mantém os arquivos e as regras restritivas de firewall.
