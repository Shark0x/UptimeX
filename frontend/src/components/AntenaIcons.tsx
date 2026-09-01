import { SVGProps } from 'react';
import { FabricanteAntena } from '../apiAntenas';

type P = SVGProps<SVGSVGElement>;

const base: P = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

// Torre de Transmissão / Telecom Tower
export function IconTorreTelecom(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2v20M8 22l4-18 4 18" />
      <path d="M9.5 15h5M10.5 10h3M7 22h10" />
      <path d="M12 3a3 3 0 0 1 3-3M12 3a3 3 0 0 0-3-3" opacity="0.6" />
      <circle cx="12" cy="2" r="1" fill="currentColor" />
    </svg>
  );
}

// Antena Parabólica / Dish PTP
export function IconAntenaPtp(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M4 14a8 8 0 0 1 12-12" strokeWidth={1.8} />
      <path d="M10 8l7-3" strokeWidth={1.5} />
      <circle cx="17.5" cy="4.5" r="1.5" fill="currentColor" />
      <path d="M7 17l-3 4h6l-3-4z" />
      <path d="M7 17v-4" />
      <path d="M15 3a7 7 0 0 1 5 5" opacity="0.6" strokeDasharray="2 2" />
      <path d="M17 1a10 10 0 0 1 6 6" opacity="0.4" strokeDasharray="2 2" />
    </svg>
  );
}

// Antena Setorial / Painel PTMP AP
export function IconAntenaSetorial(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="3" width="10" height="14" rx="2" strokeWidth={1.6} />
      <line x1="12" y1="6" x2="12" y2="14" opacity="0.5" />
      <path d="M9 8.5h6M9 11.5h6" opacity="0.6" />
      <path d="M10 17v4M14 17v4M8 21h8" />
      <path d="M19 6a6 6 0 0 1 0 8" opacity="0.8" />
      <path d="M21 4a10 10 0 0 1 0 12" opacity="0.4" />
    </svg>
  );
}

// Antena CPE / Cliente Station
export function IconAntenaCpe(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="11" r="7" strokeWidth={1.5} />
      <circle cx="12" cy="11" r="3" opacity="0.6" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
      <path d="M12 18v4M9 22h6" />
      <path d="M18.5 4.5L20 3" opacity="0.8" />
    </svg>
  );
}

// Switch PoE de Torre
export function IconSwitchPoe(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="8" width="19" height="8" rx="1.5" strokeWidth={1.5} />
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="9.5" cy="12" r="1" fill="currentColor" />
      <circle cx="13" cy="12" r="1" fill="currentColor" />
      <path d="M17 10.5l-2 3.5h3l-2 3" strokeWidth={1.2} />
    </svg>
  );
}

// Repetidora / POP Wireless
export function IconRepetidora(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M5 21l7-18 7 18" />
      <path d="M8 15h8M9.5 11h5" />
      <circle cx="12" cy="3" r="1.5" fill="currentColor" />
      <path d="M2 10a12 12 0 0 1 20 0" opacity="0.4" />
      <path d="M4 12a9 9 0 0 1 16 0" opacity="0.7" />
    </svg>
  );
}

// Antena Omnidirecional (setor 360°)
export function IconAntenaOmni(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v12" strokeWidth={1.8} />
      <circle cx="12" cy="3" r="1.4" fill="currentColor" />
      <path d="M9 20l3-4 3 4M8 22h8" />
      <path d="M7.5 8.5a6 6 0 0 1 9 0" opacity="0.75" />
      <path d="M5 6a10 10 0 0 1 14 0" opacity="0.4" strokeDasharray="2 2" />
    </svg>
  );
}

// Roteador (borda / gateway)
export function IconRoteador(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="10" width="18" height="8" rx="2" strokeWidth={1.6} />
      <circle cx="6.5" cy="14" r="1" fill="currentColor" />
      <path d="M11 14h4M13.5 12l2 2-2 2" strokeWidth={1.3} />
      <path d="M12 10V6M12 6l-2.5 2.5M12 6l2.5 2.5" opacity="0.8" />
    </svg>
  );
}

// Switch gerenciável (portas)
export function IconSwitch(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="7" width="19" height="8" rx="1.6" strokeWidth={1.6} />
      <path d="M6 15v3M10 15v3M14 15v3M18 15v3" />
      <path d="M6 11h9M17 11h1" opacity="0.55" />
      <path d="M15 9l1.5 2-1.5 2" strokeWidth={1.2} opacity="0.8" />
    </svg>
  );
}

// Firewall (muro de tijolos)
export function IconFirewall(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="1" strokeWidth={1.6} />
      <path d="M3 9.7h18M3 14.3h18" />
      <path d="M9 5v4.7M15 5v4.7M6.5 9.7v4.6M12 9.7v4.6M17.5 9.7v4.6M9 14.3V19M15 14.3V19" opacity="0.85" />
    </svg>
  );
}

// Servidor / NVR (unidades de rack)
export function IconServidor(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="16" height="8" rx="1.5" strokeWidth={1.6} />
      <rect x="4" y="13" width="16" height="8" rx="1.5" strokeWidth={1.6} />
      <circle cx="7.5" cy="7" r="1" fill="currentColor" />
      <circle cx="7.5" cy="17" r="1" fill="currentColor" />
      <path d="M11 7h6M11 17h6" opacity="0.6" />
    </svg>
  );
}

// OLT (terminal de fibra / GPON)
export function IconOlt(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="7" rx="1.5" strokeWidth={1.6} />
      <circle cx="6.5" cy="7.5" r="1" fill="currentColor" />
      <path d="M10 7.5h8" opacity="0.5" />
      <path d="M8 11c-1 4-3 5-5 6M12 11v6M16 11c1 4 3 5 5 6" opacity="0.85" />
    </svg>
  );
}

// ONU / ONT (terminal do cliente fibra)
export function IconOnu(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="9" width="14" height="8" rx="2" strokeWidth={1.6} />
      <circle cx="8.5" cy="13" r="1" fill="currentColor" />
      <path d="M12 13h4" opacity="0.5" />
      <path d="M12 9V6M9.6 7a4 4 0 0 1 4.8 0" opacity="0.8" />
      <path d="M8 17v3M16 17v3" />
    </svg>
  );
}

// Internet / Nuvem (upstream)
export function IconNuvem(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M7 18h9.5a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2-1A3.8 3.8 0 0 0 7 18z" strokeWidth={1.6} />
    </svg>
  );
}

// CTO / Splitter óptico (distribuição)
export function IconCto(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="9.5" width="6" height="5" rx="1" strokeWidth={1.6} />
      <path d="M9 12h4M13 12l5-4M13 12h5M13 12l5 4" opacity="0.85" />
      <circle cx="19" cy="8" r="1.1" fill="currentColor" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" />
      <circle cx="19" cy="16" r="1.1" fill="currentColor" />
    </svg>
  );
}

// Nobreak / UPS (energia)
export function IconNobreak(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="3" width="12" height="18" rx="2" strokeWidth={1.6} />
      <path d="M13 7l-3 5h3l-3 5" strokeWidth={1.4} />
      <path d="M9.5 3V1.6M14.5 3V1.6" opacity="0.8" />
    </svg>
  );
}

// Cliente (residência / premissa)
export function IconClienteCasa(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 11.5L12 5l8.5 6.5" strokeWidth={1.7} />
      <path d="M6 10v9h12v-9" />
      <path d="M10.5 19v-4.5h3V19" />
    </svg>
  );
}

// Access Point interno (Wi-Fi)
export function IconAccessPoint(props: P) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="12" cy="17" rx="7" ry="2.6" strokeWidth={1.6} />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
      <path d="M8.5 12a5 5 0 0 1 7 0" opacity="0.8" />
      <path d="M6 9a9 9 0 0 1 12 0" opacity="0.4" strokeDasharray="2 2" />
    </svg>
  );
}

// POP / Datacenter (prédio)
export function IconDatacenter(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1" strokeWidth={1.6} />
      <path d="M8 7h2.5M13.5 7H16M8 11h2.5M13.5 11H16M8 15h2.5M13.5 15H16" opacity="0.7" />
      <path d="M10 21v-3h4v3" />
    </svg>
  );
}

// Ícones de Fabricantes (Logotipos estilizados HUD)
export function IconUbiquiti(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c0 .83-.67 1.5-1.5 1.5S10 17.33 10 16.5V11c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5.5zm0-8c0 .83-.67 1.5-1.5 1.5S10 9.33 10 8.5 10.67 7 11.5 7s1.5.67 1.5 1.5z" />
    </svg>
  );
}

export function IconMikrotik(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M3 6h3v12H3zm5 0h3v12H8zm5 0h3v5.5l3-5.5h3.5l-4 7 4.5 5h-3.8L16 13.5V18h-3z" />
    </svg>
  );
}

export function IconMimosa(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 15V9l4 4 4-4v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCambium(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

export function IconIntelbras(props: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M8 12h8" />
    </svg>
  );
}

// Paleta reaproveitando as cores de marca já usadas no projeto (status online/warn/offline
// e o ciano de fibra) — nenhuma cor nova é inventada aqui.
export const PALETA_CORES_ENLACE: { valor: string; nome: string }[] = [
  { valor: '#2FD771', nome: 'Verde' },
  { valor: '#00E5FF', nome: 'Ciano' },
  { valor: '#38BDF8', nome: 'Azul' },
  { valor: '#A78BFA', nome: 'Violeta' },
  { valor: '#FFB224', nome: 'Âmbar' },
  { valor: '#FF2B3A', nome: 'Vermelho' },
  { valor: '#94A3B8', nome: 'Cinza' },
  { valor: '#E9EAF2', nome: 'Branco' },
];

export const TIPOS_VISUAIS_ANTENAS = [
  { valor: 'antena_ptp', rotulo: 'PTP Parábola / Dish', Icone: IconAntenaPtp },
  { valor: 'antena_setorial', rotulo: 'Setorial PTMP (AP)', Icone: IconAntenaSetorial },
  { valor: 'antena_omni', rotulo: 'Antena Omni 360°', Icone: IconAntenaOmni },
  { valor: 'torre', rotulo: 'Torre Telecom / Site', Icone: IconTorreTelecom },
  { valor: 'repetidora', rotulo: 'POP / Repetidora', Icone: IconRepetidora },
  { valor: 'antena_cpe', rotulo: 'CPE Cliente (Station)', Icone: IconAntenaCpe },
  { valor: 'cliente_casa', rotulo: 'Cliente (Casa)', Icone: IconClienteCasa },
  { valor: 'access_point', rotulo: 'Access Point Wi-Fi', Icone: IconAccessPoint },
  { valor: 'roteador', rotulo: 'Roteador / Borda', Icone: IconRoteador },
  { valor: 'switch', rotulo: 'Switch', Icone: IconSwitch },
  { valor: 'switch_poe', rotulo: 'Switch PoE de Torre', Icone: IconSwitchPoe },
  { valor: 'firewall', rotulo: 'Firewall', Icone: IconFirewall },
  { valor: 'servidor', rotulo: 'Servidor / NVR', Icone: IconServidor },
  { valor: 'olt', rotulo: 'OLT (Fibra/GPON)', Icone: IconOlt },
  { valor: 'onu', rotulo: 'ONU / ONT', Icone: IconOnu },
  { valor: 'cto', rotulo: 'CTO / Splitter', Icone: IconCto },
  { valor: 'nobreak', rotulo: 'Nobreak / UPS', Icone: IconNobreak },
  { valor: 'datacenter', rotulo: 'POP / Datacenter', Icone: IconDatacenter },
  { valor: 'nuvem', rotulo: 'Internet / Nuvem', Icone: IconNuvem },
];

export function iconeAntenaPorTipo(tipo: string) {
  return TIPOS_VISUAIS_ANTENAS.find((t) => t.valor === tipo)?.Icone ?? IconAntenaPtp;
}

export function corFabricante(fab?: FabricanteAntena | string): {
  badge: string;
  borda: string;
  texto: string;
  bg: string;
} {
  switch (fab) {
    case 'ubiquiti':
      return {
        badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
        borda: 'border-sky-500/40',
        texto: 'text-sky-400',
        bg: 'bg-sky-500/10',
      };
    case 'mikrotik':
      return {
        badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        borda: 'border-rose-500/40',
        texto: 'text-rose-400',
        bg: 'bg-rose-500/10',
      };
    case 'mimosa':
      return {
        badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
        borda: 'border-cyan-500/40',
        texto: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
      };
    case 'cambium':
      return {
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        borda: 'border-amber-500/40',
        texto: 'text-amber-400',
        bg: 'bg-amber-500/10',
      };
    case 'intelbras':
      return {
        badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        borda: 'border-emerald-500/40',
        texto: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
      };
    default:
      return {
        badge: 'bg-white/10 text-slate-300 border-white/15',
        borda: 'border-white/20',
        texto: 'text-slate-300',
        bg: 'bg-white/5',
      };
  }
}
