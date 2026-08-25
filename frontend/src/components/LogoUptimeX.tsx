/**
 * Marca uptimeX by SHARKP — variante 4c "Rede neural" do projeto de design
 * do Kevin (claude.ai/design): nós de rede conectados à barbatana.
 * Versão para fundo escuro.
 *
 * Com `animada`, roda a sequência de entrada (rede se desenha → nós acendem
 * em cascata → barbatana emerge) e mantém um pulso ambiente nos nós.
 */

// Ordem da cascata segue o fluxo da rede até a barbatana
const ATRASO_NOS: Record<string, string> = {
  'no-1': '0.30s',
  'no-2': '0.42s',
  'no-3': '0.54s',
  'no-4': '0.66s',
  'no-5': '0.78s',
  'no-6': '1.05s',
};

export function MarcaUptimeX({ largura = 240, animada = false }: { largura?: number; animada?: boolean }) {
  const altura = (largura / 240) * 140;
  const clsNo = animada ? 'uptx-no' : undefined;
  const atraso = (id: string) => (animada ? ({ '--atraso': ATRASO_NOS[id] } as React.CSSProperties) : undefined);

  return (
    <svg width={largura} height={altura} viewBox="0 0 240 140" fill="none" aria-hidden>
      <defs>
        <linearGradient id="uptx-fin" x1="130" y1="18" x2="170" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff6a52" />
          <stop offset="0.45" stopColor="#e02832" />
          <stop offset="1" stopColor="#70101f" />
        </linearGradient>
        <linearGradient id="uptx-rim" x1="120" y1="16" x2="140" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd9c8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffd9c8" stopOpacity="0" />
        </linearGradient>
        <filter id="uptx-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#e02832" floodOpacity="0.38" />
        </filter>
      </defs>
      <path
        className={animada ? 'uptx-arestas' : undefined}
        d="M30 108 L66 84 M66 84 L52 52 M66 84 L104 96 M52 52 L104 96 M52 52 L112 44"
        stroke="rgb(var(--logo-ink))"
        strokeWidth="2.5"
        opacity="0.45"
      />
      <g className={animada ? 'uptx-fin-entrada' : undefined} filter="url(#uptx-glow)">
        <path d="M104 108 C114 72 126 38 148 18 C146 52 162 82 188 108 Z" fill="url(#uptx-fin)" />
        <path
          className={animada ? 'uptx-rim-brilho' : undefined}
          d="M104 108 C114 72 126 38 148 18 C146 34 146 48 148 62 C134 74 118 92 104 108 Z"
          fill="url(#uptx-rim)"
          opacity="0.32"
        />
      </g>
      <g className={clsNo} style={atraso('no-1')}>
        <circle cx="30" cy="108" r="6" fill="rgb(var(--logo-ink))" opacity="0.55" />
      </g>
      <g className={clsNo} style={atraso('no-2')}>
        <circle cx="52" cy="52" r="6" fill="rgb(var(--logo-ink))" opacity="0.8" />
      </g>
      <g className={clsNo} style={atraso('no-3')}>
        <circle cx="66" cy="84" r="7" fill="rgb(var(--logo-ink))" />
      </g>
      <g className={clsNo} style={atraso('no-4')}>
        <circle cx="112" cy="44" r="6" fill="#ff6a52" />
      </g>
      <g className={clsNo} style={atraso('no-5')}>
        <circle cx="104" cy="96" r="6" fill="#ff6a52" />
      </g>
      <g className={clsNo} style={atraso('no-6')}>
        <circle cx="188" cy="108" r="6" fill="#e02832" />
      </g>
    </svg>
  );
}

/** Versão compacta horizontal pra navbar: símbolo pequeno + wordmark. */
export function LogoUptimeXNav() {
  return (
    <span className="flex items-center gap-2">
      <MarcaUptimeX largura={52} />
      <span className="flex items-baseline font-sora font-extrabold tracking-[-0.03em] text-lg leading-none">
        <span style={{ color: 'rgb(var(--logo-ink))' }}>uptime</span>
        <span
          className="text-transparent bg-clip-text"
          style={{ backgroundImage: 'linear-gradient(160deg, #ff6a52, #e02832)' }}
        >
          X
        </span>
      </span>
    </span>
  );
}

/** Lockup completo: barbatana + wordmark "uptimeX" + assinatura BY SHARKP. */
export function LockupUptimeX({ larguraMarca = 240, animada = false }: { larguraMarca?: number; animada?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <MarcaUptimeX largura={larguraMarca} animada={animada} />
      <div className="flex items-baseline font-sora font-extrabold tracking-[-0.03em] text-5xl md:text-6xl leading-none">
        <span style={{ color: 'rgb(var(--logo-ink))' }}>uptime</span>
        <span
          className="text-transparent bg-clip-text"
          style={{ backgroundImage: 'linear-gradient(160deg, #ff6a52, #e02832)' }}
        >
          X
        </span>
      </div>
      <span className="font-grotesk font-medium text-xs tracking-[0.5em] text-[#7a6f72] pl-1 mt-1">
        BY SHARKP
      </span>
    </div>
  );
}
