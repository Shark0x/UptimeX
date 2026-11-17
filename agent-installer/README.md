# Agente uptimeX — instalador Python (primeira versao)

Configura um agente **SNMPv3 authPriv, SHA/AES, somente leitura** no servidor que
sera monitorado. Nao instala o sistema uptimeX, nao toca em Docker ou bancos e
nao instala agentes em switches/impressoras.

## Comecar

Requer Git e Python 3.9+. Na maquina que sera monitorada:

```sh
git clone --branch redesign-ui/20261014-212102 --single-branch https://github.com/Shark0x/UptimeX.git
cd UptimeX
python3 agent-installer/install.py
```

Para a primeira avaliação, siga [o roteiro de teste](TESTE.md).

O assistente pede o IPv4 do coletor, usuario e metricas. Sem `--apply`, mostra
somente a previa. Para instalar, com confirmacao antes das alteracoes:

```sh
sudo python3 agent-installer/install.py --apply
```

Automacao, sem perguntas:

```sh
sudo python3 agent-installer/install.py --nms 192.0.2.10 --metrics sistema,interfaces,cpu,memoria,discos --apply --yes
```

Substitua o IP de exemplo pelo IP real do coletor, considerando NAT/VPN.
Nao informe o IP do proprio alvo nesse campo.

Em um desktop com Tkinter instalado:

```sh
python3 agent-installer/install.py --gui
```

A janela permite escolher metricas, visualizar a previa e aplicar. A aplicacao
no Linux precisa ser executada com root; a janela nao solicita nem armazena
senha administrativa. A CLI funciona sem ambiente grafico. No Windows, use
`py agent-installer/install.py --gui` para visualizar o assistente.

## Escopo e limites desta versao

| Ambiente | Estado |
|---|---|
| Debian/Ubuntu, systemd, iptables | Backend implementado; validar em VM antes de producao |
| RHEL/Rocky/Alma/Fedora, systemd, iptables | Backend implementado; ainda sem validacao em VM |
| Windows/macOS | Previa/assistente; aplicacao bloqueada |
| UFW ou firewalld ativos | Aplicacao bloqueada; adaptadores futuros |
| Agente Net-SNMP existente | Aplicacao bloqueada para preservar configuracao e credenciais |
| Containers/WSL sem systemd | Aplicacao bloqueada |

O menu de perfil do uptimeX inclui **Agente uptimeX**, com os pacotes publicados
nesta instalacao. O executavel Windows inclui Python e usa o icone oficial do
projeto; no Linux, o pacote fonte requer Python. O executavel Windows oferece
a interface e previa, mas ainda nao instala um agente SNMPv3 no Windows.
SNMPv2c/comunidade nao faz parte desta primeira versao. O Windows precisa de um
agente SNMPv3 validado antes de podermos oferecer instalacao automatica.

## Como funciona

- Detecta o sistema e instala os pacotes oficiais de Net-SNMP.
- Usa configuracao e estado exclusivos em `/etc/uptimex-agent` e
  `/var/lib/uptimex-agent`, sem substituir `/etc/snmp/snmpd.conf`.
- Cria senhas aleatorias independentes de 24 caracteres. Guarda os dados em
  `/etc/uptimex-agent/credentials.json`, acessivel somente por root.
- Cria os servicos `uptimex-agent` e `uptimex-agent-firewall` com systemd.
- Aplica uma chain `UPTIMEX_SNMP` apenas ao UDP 161: aceita localhost e o coletor,
  bloqueia as demais origens, mesmo com policy INPUT ACCEPT. Nao muda policies,
  portas SSH ou chains Docker. Escuta somente IPv4.
- Reaplica suas regras ao iniciar pelo systemd. Se outro gerenciador limpar
  regras posteriormente, e necessario reiniciar `uptimex-agent-firewall`.
- Testa sysDescr localmente. A conectividade do coletor remoto deve ser validada
  separadamente; outros firewalls/borda podem bloquear UDP 161.

Reexecucoes recusam sobrescrever a instalacao. Em falha, o agente proprio e
parado; pacotes, arquivos de diagnostico e bloqueios restritivos podem permanecer.
O instalador ainda nao oferece atualizacao, rotacao de senhas ou desinstalacao automatica.

CPU/memoria/discos dependem do suporte a MIBs do agente. Memoria e armazenamento
compartilham a HOST-RESOURCES-MIB: a selecao nao separa perfeitamente esses dados.
Informacoes basicas do sistema ficam disponiveis para validar a conexao.
O intervalo de coleta e configurado no uptimeX, nao neste agente.

## Operacao e testes

```sh
sudo systemctl status uptimex-agent uptimex-agent-firewall
sudo journalctl -u uptimex-agent -n 50
sudo cat /etc/uptimex-agent/credentials.json
sudo systemctl disable --now uptimex-agent
python3 -m unittest discover -s agent-installer/tests -v
```

Parar o agente encerra o atendimento SNMP; o firewall restritivo permanece.
Nao execute o script Debian antigo junto com este instalador.

Referencias: [Net-SNMP snmpd.conf](https://net-snmp.sourceforge.io/docs/man/snmpd.conf.html),
[pacotes Net-SNMP Red Hat](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/system_administrators_guide/ch-system_monitoring_tools).

## Construir e integrar os downloads

No Windows, use um ambiente virtual para as ferramentas de build:

```powershell
py -m venv agent-installer/.venv
agent-installer/.venv/Scripts/python.exe -m pip install -r agent-installer/requirements-build.txt
agent-installer/.venv/Scripts/python.exe agent-installer/build.py --windows --publish
```

O build converte `frontend/public/favicon.svg` em PNG e ICO multirresolucao,
embute o icone no executavel e na janela, e gera os arquivos em
`agent-installer/dist`. `--publish` copia para `frontend/public/downloads` e
gera um manifesto com tamanho, versao e SHA-256. O frontend oferece somente
downloads presentes no manifesto. Sem pacotes, mostra indisponibilidade.

Para publicar somente o ZIP Python, sem dependencias de build:

```sh
python3 agent-installer/build.py --publish
```

Execute o build dos pacotes **antes** de `npm run build` no frontend ou de
construir sua imagem Docker. Os binarios gerados nao sao versionados no Git.
No checkout de Linux, e possivel copiar os artefatos Windows previamente
construidos para `agent-installer/dist` antes de executar `--publish`.
O executavel desta versao nao possui assinatura digital.

A apresentacao ASCII aparece na CLI; use `--no-banner` para ocultar ou
`NO_COLOR=1` para desativar cores. O ZIP nao inclui ambientes virtuais ou segredos.
