// Changelog do uptimeX — FONTE ÚNICA da versão do app.
//
// A cada atualização/commit relevante: adicione uma entrada no TOPO (mais recente
// primeiro) com a data REAL (ISO yyyy-mm-dd) e bumpe o número por semver:
//   correção -> patch (x.x.+1) · novidade -> minor (x.+1.0) · quebra -> major (+1.0.0)
// O APP_VERSION, o rótulo e o aviso de "novidades" derivam automaticamente da
// primeira entrada daqui — não há versão hardcoded em outro lugar.

export type TipoMudanca = 'novo' | 'melhoria' | 'correcao' | 'seguranca';

export interface Mudanca {
  tipo: TipoMudanca;
  texto: string;
}

export interface Release {
  /** Número semver, ex.: '1.2.0' */
  versao: string;
  /** Data da release em ISO (yyyy-mm-dd) */
  data: string;
  /** Nome curto da versão, ex.: 'Central de Novidades' */
  titulo: string;
  /** Uma linha de resumo — destaque do pop-up */
  destaque?: string;
  mudancas: Mudanca[];
}

export const CHANGELOG: Release[] = [
  {
    versao: '1.4.1',
    data: '2026-11-17',
    titulo: 'Telemetria de conectividade restaurada',
    destaque:
      'Dispositivos monitorados por ping voltam a exibir o histórico de conectividade (latência, perda e disponibilidade) direto no painel de status.',
    mudancas: [
      {
        tipo: 'correcao',
        texto:
          'Ao abrir um dispositivo monitorado por ping no painel de status, o gráfico de telemetria (latência/perda/uptime) aparece novamente — inclusive em equipamentos que ainda tinham credenciais SNMP antigas gravadas.',
      },
    ],
  },
  {
    versao: '1.4.0',
    data: '2026-11-17',
    titulo: 'Assistente do agente uptimeX',
    destaque: 'Baixe o assistente SNMP pelo menu do perfil e prepare seus servidores para monitoramento.',
    mudancas: [
      { tipo: 'novo', texto: 'Downloads do agente uptimeX no menu do perfil, com pacote Python para Linux e assistente Windows.' },
      { tipo: 'novo', texto: 'Assistente com seleção de métricas, prévia da configuração e apresentação no terminal Linux.' },
      { tipo: 'melhoria', texto: 'Executável Windows com o ícone do uptimeX. Nesta versão, a aplicação automática está disponível apenas no Linux compatível.' },
    ],
  },
  {
    versao: '1.3.1',
    data: '2026-11-16',
    titulo: 'Métricas de Servidores (CPU & Memória) via SNMP',
    destaque:
      'Coleta automática de CPU, memória RAM e armazenamento de servidores e appliances via HOST-RESOURCES-MIB (RFC 2790) e fallbacks.',
    mudancas: [
      { tipo: 'novo', texto: 'Coleta de uso de CPU (%) em múltiplos núcleos e carga média por SNMP.' },
      { tipo: 'novo', texto: 'Coleta de memória RAM física (total, usada e percentual) e armazenamento de disco.' },
      { tipo: 'novo', texto: 'Série temporal e gráfico de histórico de CPU e Memória no painel do dispositivo.' },
      { tipo: 'melhoria', texto: 'Suporte universal a servidores Linux (net-snmp), Windows Server, VMware ESXi, MikroTik e Cisco.' },
    ],
  },
  {
    versao: '1.3.0',
    data: '2026-11-06',
    titulo: 'Engine SNMP nativa',
    destaque:
      'O uptimeX agora coleta SNMP direto dos equipamentos — interfaces, tráfego em tempo real e uptime — sem depender de Zabbix.',
    mudancas: [
      { tipo: 'novo', texto: 'Coleta SNMP nativa (v2c e v3) de interfaces, tráfego (bps/Mbps/Gbps) e uptime dos equipamentos.' },
      { tipo: 'novo', texto: 'Painel de interfaces e gráfico de tráfego por interface no detalhe do dispositivo, com botão "Coletar agora".' },
      { tipo: 'novo', texto: 'Aviso de "coleta atrasada" quando o equipamento não responde no tempo previsto.' },
      { tipo: 'melhoria', texto: 'Monitoramento híbrido: equipamentos sem SNMP seguem monitorados por ping normalmente.' },
      { tipo: 'melhoria', texto: 'Polling mais resiliente: um timeout nunca interrompe os ciclos e edições não geram coletas concorrentes.' },
      { tipo: 'seguranca', texto: 'Credenciais SNMP (comunidade v2c e senhas v3) guardadas cifradas por dispositivo.' },
    ],
  },
  {
    versao: '1.2.0',
    data: '2026-10-26',
    titulo: 'Central de Novidades',
    destaque:
      'Agora o uptimeX avisa você sobre cada atualização — com o histórico completo de versões no seu perfil.',
    mudancas: [
      { tipo: 'novo', texto: 'Central de Novidades no menu de perfil, com o histórico de todas as versões.' },
      { tipo: 'novo', texto: 'Aviso automático ao entrar quando há uma versão nova que você ainda não viu.' },
    ],
  },
  {
    versao: '1.1.0',
    data: '2026-10-18',
    titulo: 'Mapa, alertas e empresas',
    destaque:
      'Foco de empresa no mapa, alarme sonoro de quedas e um menu de ações por empresa.',
    mudancas: [
      { tipo: 'novo', texto: 'Balão de foco ao abrir uma empresa no mapa (deep link), com atalho para o Street View.' },
      { tipo: 'novo', texto: 'Alarme sonoro configurável para quedas no Mapa.' },
      { tipo: 'novo', texto: 'Verificação de ping sob demanda ("Testar agora") na aba Status.' },
      { tipo: 'melhoria', texto: 'Menu de ações por empresa: editar, ver no mapa e abrir no Street View, com rolagem.' },
      { tipo: 'novo', texto: 'Links dedicados /30 agora podem ser marcados como "sem monitoramento".' },
      { tipo: 'correcao', texto: 'Monitoramento de ping restaurado mesmo com comunidade SNMP legada indecriptável.' },
      { tipo: 'correcao', texto: 'No celular, o popup do mapa agora aparece acima do radar.' },
    ],
  },
  {
    versao: '1.0.0',
    data: '2026-08-21',
    titulo: 'PostgreSQL, Antenas e Segurança',
    destaque:
      'Base reforçada: banco PostgreSQL com isolamento por papel e o board de topologia de antenas.',
    mudancas: [
      { tipo: 'novo', texto: 'Board de topologia de Antenas (enlaces wireless) com versões salvas (presets).' },
      { tipo: 'novo', texto: 'Histórico de ping por dispositivo: latência e perda de pacotes ao longo do tempo.' },
      { tipo: 'melhoria', texto: 'Basemap do mapa migrado do CARTO para o OpenFreeMap (proxiado pelo backend).' },
      { tipo: 'seguranca', texto: 'Migração para PostgreSQL 17 com RLS e papéis (visualizador, operador, admin).' },
    ],
  },
  {
    versao: '0.9.0',
    data: '2026-07-26',
    titulo: 'Mapa TV',
    destaque: 'O primeiro mural: um Mapa TV em tela cheia com as quedas em tempo real.',
    mudancas: [
      { tipo: 'novo', texto: 'Mural Mapa TV em tela cheia com alerta de queda e sedes clicáveis.' },
      { tipo: 'novo', texto: 'Monitoramento de dispositivos por ICMP e SNMP.' },
      { tipo: 'novo', texto: 'Painel por empresa com gráficos de disponibilidade.' },
    ],
  },
];

/** Release mais recente (topo da lista). */
export const ULTIMA_RELEASE = CHANGELOG[0];

/** Versão atual do app — derivada da release mais recente. */
export const APP_VERSION = ULTIMA_RELEASE.versao;
