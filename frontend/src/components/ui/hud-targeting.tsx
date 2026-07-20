import * as React from 'react';

/**
 * Mira HUD de abertura da Visão Macro — adaptação do animated-hud-targeting-ui
 * (21st.dev) pra este projeto: sem framer-motion/next-themes, todo o desenho
 * progressivo em CSS (.hud-draw/.hud-pop/.hud-spin) e a fin da uptimeX
 * travando no centro no lugar do triângulo original.
 */

const TRACO = 'rgba(255, 77, 90, 0.8)';
const TRACO_SUAVE = 'rgba(255, 77, 90, 0.4)';
const PONTO = 'rgba(233, 234, 242, 0.9)';

const atraso = (s: number, dur?: number) =>
  ({ '--delay': `${s}s`, ...(dur ? { '--dur': `${dur}s` } : {}) }) as React.CSSProperties;

function Ponto({ cx, cy, d }: { cx: number; cy: number; d: number }) {
  return <circle cx={cx} cy={cy} r={0.9} fill={PONTO} className="hud-pop" style={atraso(d)} />;
}

export function HudTargeting({ tamanho = 280 }: { tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={(tamanho / 237) * 220}
      viewBox="0 0 237 220"
      fill="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="hudfin" x1="130" y1="18" x2="170" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff6a52" />
          <stop offset="0.45" stopColor="#e02832" />
          <stop offset="1" stopColor="#70101f" />
        </linearGradient>
      </defs>

      {/* suportes superiores: diagonais fecham na linha central */}
      <line x1="0.2" y1="0.8" x2="74.2" y2="74.8" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.2, 0.8)} />
      <line x1="74" y1="74.75" x2="164" y2="74.75" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.05, 0.6)} />
      <line x1="236.8" y1="0.8" x2="163.8" y2="74.8" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.2, 0.8)} />

      {/* suportes inferiores (espelhados) */}
      <line x1="0.2" y1="219.2" x2="74.2" y2="145.2" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.2, 0.8)} />
      <line x1="74" y1="145.25" x2="164" y2="145.25" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.05, 0.6)} />
      <line x1="236.8" y1="219.2" x2="163.8" y2="145.2" stroke={TRACO} strokeWidth="0.6" pathLength={1} className="hud-draw" style={atraso(0.2, 0.8)} />

      {/* leques de ticks (arcos tracejados) */}
      <path d="M97 61 A 27 27 0 0 1 140 61" stroke={TRACO_SUAVE} strokeWidth="2.2" strokeDasharray="1.6 3" className="hud-pop" style={atraso(0.8)} />
      <path d="M97 159 A 27 27 0 0 0 140 159" stroke={TRACO_SUAVE} strokeWidth="2.2" strokeDasharray="1.6 3" className="hud-pop" style={atraso(0.8)} />

      {/* anéis: cada um traça de um lado, o conjunto gira ao entrar */}
      <g className="hud-spin">
        <circle cx="118.5" cy="109.5" r="87" stroke={TRACO_SUAVE} strokeWidth="0.6" pathLength={1} strokeLinecap="round" className="hud-draw" style={atraso(0.25, 1.1)} />
        <circle cx="118.5" cy="109.5" r="80" stroke={TRACO} strokeWidth="0.6" pathLength={1} strokeLinecap="round" className="hud-draw" style={atraso(0.25, 1.1)} />
        <g transform="rotate(180 118.5 109.5)">
          <circle cx="118.5" cy="109.5" r="72" stroke={TRACO} strokeWidth="0.6" pathLength={1} strokeLinecap="round" className="hud-draw" style={atraso(0.35, 1.1)} />
        </g>
      </g>

      {/* colchetes do alvo central */}
      <path d="M86 96 L92 90 H106" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.1, 0.5)} />
      <path d="M131 90 H145 L151 96" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.1, 0.5)} />
      <path d="M86 124 L92 130 H106" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.25, 0.5)} />
      <path d="M131 130 H145 L151 124" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.25, 0.5)} />
      <path d="M79 102 L75 106 V114 L79 118" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.4, 0.5)} />
      <path d="M158 102 L162 106 V114 L158 118" stroke={TRACO} strokeWidth="0.7" pathLength={1} className="hud-draw" style={atraso(1.4, 0.5)} />

      {/* fin da uptimeX travando no alvo */}
      <g
        className="hud-pop"
        style={{ ...atraso(1.55), filter: 'drop-shadow(0 3px 8px rgba(224,40,50,0.5))' }}
        transform="translate(118.5 111) scale(0.34) translate(-146 -63)"
      >
        <path d="M104 108 C114 72 126 38 148 18 C146 52 162 82 188 108 Z" fill="url(#hudfin)" />
        <path d="M104 108 C114 72 126 38 148 18 C146 34 146 48 148 62 C134 74 118 92 104 108 Z" fill="#ffd9c8" opacity="0.25" />
      </g>

      {/* pontos em L junto às linhas */}
      <Ponto cx={78} cy={66} d={1.2} />
      <Ponto cx={78} cy={70} d={1.3} />
      <Ponto cx={82} cy={70} d={1.4} />
      <Ponto cx={159} cy={66} d={1.2} />
      <Ponto cx={155} cy={70} d={1.3} />
      <Ponto cx={159} cy={70} d={1.4} />
      <Ponto cx={78} cy={154} d={1.2} />
      <Ponto cx={78} cy={150} d={1.3} />
      <Ponto cx={82} cy={150} d={1.4} />
      <Ponto cx={159} cy={154} d={1.2} />
      <Ponto cx={155} cy={150} d={1.3} />
      <Ponto cx={159} cy={150} d={1.4} />

      {/* grades 2x2 laterais */}
      <Ponto cx={15} cy={107} d={1.2} />
      <Ponto cx={20} cy={107} d={1.3} />
      <Ponto cx={15} cy={112} d={1.4} />
      <Ponto cx={20} cy={112} d={1.5} />
      <Ponto cx={217} cy={107} d={1.2} />
      <Ponto cx={222} cy={107} d={1.3} />
      <Ponto cx={217} cy={112} d={1.4} />
      <Ponto cx={222} cy={112} d={1.5} />
    </svg>
  );
}
