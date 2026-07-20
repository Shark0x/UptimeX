# NetMonitor — Central de Operações de Rede

Substituto moderno do **Dude (MikroTik)**: monitoramento SNMP/ICMP multi-empresa, com histórico de quedas, mapa de topologia visual e log de auditoria.

Feito para rodar em **servidor Linux/VPS**, com backend **Node.js** e banco **MySQL**.

---

## O que ele faz

- **Monitoramento por ping ICMP** do IP público fixo de cada cliente: 4 echos por ciclo medindo **latência média** e **perda de pacotes**, com estados online / offline / degradado (alta latência ou perda). SNMP continua disponível como método alternativo ou segunda opinião.
- **Gráficos de telemetria** por dispositivo (drawer lateral): latência e perda de pacotes em janelas de 1h / 6h / 24h, atualizando ao vivo via socket. Amostras guardadas por 7 dias (janelas longas são agregadas em baldes de 5 min).
- **Detecção de mudança de estado** com registro de quando caiu e por quanto tempo (histórico completo por dispositivo + quedas nas últimas 24h).
- **Tempo real** via WebSocket: heartbeats atualizam status, latência e perda no painel sem refetch.
- **Multi-empresa**: cada empresa tem seus dispositivos e sua própria **aba de topologia** — mapa arrastável com ícones de roteador, switch, firewall, servidor, datacenter, POP, backbone, OLT, ONU, AP, internet e cliente corporativo; conexões mudam de cor conforme a saúde das pontas.
- **Auditoria**: toda criação/edição/remoção é registrada com usuário, ação, horário e detalhes.
- **Interface dark premium**: preto profundo + vermelho-sinal, glassmorphism sutil, microanimações e alertas visuais pulsantes em quedas.

---

## Estrutura

```
netmonitor/
├── backend/     Node.js + TypeScript + Express + Socket.io + MySQL
└── frontend/    React + Vite + Tailwind + React Flow
```

---

## Pré-requisitos

- Node.js 18+ e npm
- MySQL 5.7+ ou 8+
- O servidor precisa conseguir enviar SNMP (UDP 161) e ICMP (ping) para os IPs monitorados.
  Em muitos VPS o ICMP de saída é liberado; SNMP depende do equipamento remoto ter a comunidade configurada e liberar o IP do seu servidor.

> **Nota sobre ping ICMP:** em Linux, `ping` pode exigir privilégio. Se o fallback de ping não funcionar, rode o backend com um usuário que tenha permissão de socket ICMP, ou ajuste `net.ipv4.ping_group_range` no sistema.

---

## Instalação

### 1. Banco de dados

Configure as credenciais no backend:

```bash
cd backend
cp .env.example .env
# edite .env com host, usuário e senha do seu MySQL
```

Rode a migração (cria o banco e todas as tabelas):

```bash
npm install
npm run build
npm run migrate
```

### 2. Backend

```bash
# ainda em backend/
npm run dev        # desenvolvimento (hot reload)
# ou
npm start          # produção (após npm run build)
```

O backend sobe em `http://localhost:4000`. Ao iniciar, ele já religa o monitoramento de todos os dispositivos ativos no banco.

### 3. Frontend

```bash
cd ../frontend
cp .env.example .env   # ajuste as URLs se o backend não estiver em localhost
npm install
npm run dev            # abre em http://localhost:5173
```

Para produção: `npm run build` gera a pasta `dist/` (sirva com nginx, Caddy ou similar).

---

## Como usar

1. Ao abrir, informe seu nome/usuário (usado no log de auditoria).
2. Crie uma **empresa**.
3. Dentro da empresa, aba **Status** → **+ Novo dispositivo**: informe nome, IP público, fabricante, método (SNMP+Ping recomendado), comunidade SNMP e intervalo de verificação.
4. O monitoramento começa na hora. O cartão pulsa verde (online) ou pisca vermelho (offline).
5. Aba **Topologia**: adicione nós, vincule-os aos dispositivos e arraste para desenhar o mapa da rede daquela empresa. Nós vinculados mostram o status ao vivo.
6. Aba **Histórico**: veja cada queda, quando ocorreu e a duração, com total de tempo offline.
7. Aba **Auditoria**: log de todas as ações.

---

## Segurança e produção (recomendações)

Esta é a base funcional. Antes de expor em produção, considere:

- **Autenticação real**: hoje a identificação de usuário é só um nome livre (suficiente para auditoria interna, não para controle de acesso). Adicione login com senha/JWT se for multiusuário de verdade.
- **HTTPS**: coloque o frontend e o backend atrás de um proxy reverso com TLS (nginx/Caddy).
- **Firewall**: restrinja quem acessa a porta 4000 do backend.
- **Comunidade SNMP**: use SNMP v2c com comunidades não-triviais e, idealmente, migre para SNMPv3 (autenticação + criptografia) nos equipamentos que suportam — o código pode ser estendido para v3.

---

## Sobre a captura com Wireshark (Sharkp)

O motor envia pacotes SNMP GET reais (UDP 161) e echo requests ICMP. Se você quiser auditar/validar o tráfego com Wireshark no servidor:

```bash
# capturar SNMP saindo do servidor
sudo tcpdump -i any 'udp port 161' -w snmp.pcap

# capturar ICMP (ping)
sudo tcpdump -i any icmp -w icmp.pcap
```

Depois é só abrir os `.pcap` no Wireshark para conferir exatamente o que o NetMonitor está enviando e recebendo de cada IP.

---

## Próximos passos possíveis

- Alertas (e-mail / Telegram / webhook) quando um dispositivo cai.
- SNMPv3.
- Coleta de métricas extras via SNMP (tráfego de interface, CPU, temperatura) por fabricante.
- Exportação de relatórios de disponibilidade (SLA) por empresa.
