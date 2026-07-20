import { SVGProps } from 'react';

/**
 * Ícones de equipamentos de rede — traço fino, estilo blueprint.
 * Todos herdam a cor via currentColor pra reagir ao estado do nó.
 */

type P = SVGProps<SVGSVGElement>;

const base: P = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconRoteador(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 16.5h.01M10.5 16.5h.01" />
      <path d="M17 16.5h1.5" />
      <path d="M8 13V9.5a4 4 0 0 1 8 0V13" opacity="0.55" />
      <path d="M12 13V4" />
      <path d="M9.5 5.5 12 3l2.5 2.5" />
    </svg>
  );
}

export function IconSwitch(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.5" />
      <path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01" />
      <path d="M7 5.5 9.5 3M9.5 3v3M9.5 3h-3" opacity="0.6" />
      <path d="M17 18.5 14.5 21M14.5 21v-3M14.5 21h3" opacity="0.6" />
    </svg>
  );
}

export function IconFirewall(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 4.5 6v5c0 4.5 3 8.2 7.5 10 4.5-1.8 7.5-5.5 7.5-10V6L12 3Z" />
      <path d="M8 9.5h8M8 12.5h8" opacity="0.55" />
      <path d="M12 8v9" opacity="0.55" />
    </svg>
  );
}

export function IconServidor(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="16" height="6" rx="1.5" />
      <rect x="4" y="15" width="16" height="6" rx="1.5" />
      <path d="M8 6h.01M8 18h.01" />
      <path d="M13 6h4M13 18h4" opacity="0.55" />
      <path d="M12 9v6" opacity="0.4" />
    </svg>
  );
}

export function IconDatacenter(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 21V8.5L12 3l8.5 5.5V21" />
      <path d="M3.5 21h17" />
      <rect x="7.5" y="11" width="4" height="4" rx="0.5" opacity="0.6" />
      <rect x="13.5" y="11" width="3" height="4" rx="0.5" opacity="0.6" />
      <path d="M10 21v-3.5h4V21" />
    </svg>
  );
}

export function IconOlt(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="9" width="19" height="6.5" rx="1.5" />
      <path d="M6 12.2h.01M9 12.2h.01" />
      <path d="M14 12.2h4.5" opacity="0.55" />
      <path d="M5 9V6.5M12 9V5M19 9V6.5" opacity="0.6" />
      <path d="M5 15.5v2.2M9.5 15.5v3M14.5 15.5v3M19 15.5v2.2" opacity="0.6" />
    </svg>
  );
}

export function IconOnu(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="10" width="12" height="8" rx="1.5" />
      <path d="M9.5 14h.01M12 14h.01" />
      <path d="M12 10V7" opacity="0.7" />
      <path d="M8.5 5.5a5 5 0 0 1 7 0" opacity="0.55" />
      <path d="M10 7.4a2.8 2.8 0 0 1 4 0" opacity="0.75" />
    </svg>
  );
}

export function IconInternet(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" opacity="0.6" />
      <path d="M12 3.5c2.6 2.3 3.9 5.2 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.2-3.9-8.5S9.4 5.8 12 3.5Z" opacity="0.6" />
    </svg>
  );
}

export function IconBackbone(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="19" cy="5.5" r="2.2" />
      <circle cx="19" cy="18.5" r="2.2" />
      <path d="M7 11 16.9 6.3M7 13l9.9 4.7" opacity="0.7" />
      <path d="M19 7.7v8.6" opacity="0.4" />
    </svg>
  );
}

export function IconCliente(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21" />
      <path d="M14 9.5h4.5A1.5 1.5 0 0 1 20 11v10" />
      <path d="M2.5 21h19" />
      <path d="M7 8h4M7 11.5h4M7 15h4" opacity="0.55" />
      <path d="M16.8 13.5h.01M16.8 16.5h.01" opacity="0.7" />
    </svg>
  );
}

export function IconAp(props: P) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="17" r="2" />
      <path d="M12 15v-2" opacity="0.4" />
      <path d="M7.7 10.3a6 6 0 0 1 8.6 0" opacity="0.75" />
      <path d="M5 7.5a10 10 0 0 1 14 0" opacity="0.5" />
    </svg>
  );
}

export function IconPop(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s-6.5-5.4-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.5" opacity="0.7" />
    </svg>
  );
}

export function IconLink(props: P) {
  return (
    <svg {...base} {...props}>
      <path d="M9.5 14.5 5 19M14.5 9.5 19 5" opacity="0.6" />
      <path d="M10.5 7.5 13 5a3.5 3.5 0 0 1 5 5l-2.5 2.5" />
      <path d="M13.5 16.5 11 19a3.5 3.5 0 0 1-5-5l2.5-2.5" />
    </svg>
  );
}

export function IconOutro(props: P) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M12 9v.01M12 12v4" opacity="0.7" />
    </svg>
  );
}

export interface TipoEquipamento {
  valor: string;
  rotulo: string;
  Icone: (props: P) => JSX.Element;
}

/** Catálogo de tipos exibido no seletor da topologia e usado pra resolver o ícone do nó */
export const TIPOS_EQUIPAMENTO: TipoEquipamento[] = [
  { valor: 'roteador', rotulo: 'Roteador', Icone: IconRoteador },
  { valor: 'switch', rotulo: 'Switch', Icone: IconSwitch },
  { valor: 'firewall', rotulo: 'Firewall', Icone: IconFirewall },
  { valor: 'servidor', rotulo: 'Servidor', Icone: IconServidor },
  { valor: 'datacenter', rotulo: 'Datacenter', Icone: IconDatacenter },
  { valor: 'pop', rotulo: 'POP', Icone: IconPop },
  { valor: 'backbone', rotulo: 'Backbone', Icone: IconBackbone },
  { valor: 'olt', rotulo: 'OLT', Icone: IconOlt },
  { valor: 'onu', rotulo: 'ONU', Icone: IconOnu },
  { valor: 'ap', rotulo: 'Access Point', Icone: IconAp },
  { valor: 'internet', rotulo: 'Internet / Link', Icone: IconInternet },
  { valor: 'cliente', rotulo: 'Cliente corporativo', Icone: IconCliente },
  { valor: 'link', rotulo: 'Enlace', Icone: IconLink },
  { valor: 'outro', rotulo: 'Outro', Icone: IconOutro },
];

export function iconePorTipo(tipo: string) {
  return TIPOS_EQUIPAMENTO.find((t) => t.valor === tipo)?.Icone ?? IconOutro;
}

export function rotuloPorTipo(tipo: string) {
  return TIPOS_EQUIPAMENTO.find((t) => t.valor === tipo)?.rotulo ?? tipo;
}
