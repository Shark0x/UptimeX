/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superfícies: preto profundo → grafite carbono
        deep: {
          950: '#060607',
          900: '#0B0B0F',
          800: '#121218',
          700: '#1B1B23',
          600: '#26262F',
        },
        // Vermelho-sinal: o único acento vivo da interface
        signal: {
          400: '#FF4D5A',
          500: '#FF2B3A',
          600: '#DC1928',
        },
        // Vermelho-brasa mais profundo, usado em gradientes e bordas
        accent: {
          400: '#F2543F',
          500: '#C81E2B',
          600: '#8F0F1D',
        },
        // Verde = vivo; vermelho = queda; âmbar = degradação
        online: '#2FD771',
        offline: '#FF2B3A',
        warn: '#FFB224',
        muted: '#82828E',
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
        body: ['"Inter"', 'sans-serif'],
        // Tipografia da página de entrada — Sora é a fonte da marca uptimeX
        sora: ['"Sora"', 'sans-serif'],
        grotesk: ['"Space Grotesk"', 'sans-serif'],
        // Título-cartaz da Visão Macro — condensada alta, contraponto às larguras da marca
        titulo: ['"Bebas Neue"', 'sans-serif'],
      },
      backgroundImage: {
        'grid-pattern':
          'linear-gradient(rgba(255,43,58,0.030) 1px, transparent 1px), linear-gradient(90deg, rgba(255,43,58,0.030) 1px, transparent 1px)',
        'aurora':
          'radial-gradient(ellipse 70% 45% at 50% -5%, rgba(220,25,40,0.14), transparent), radial-gradient(ellipse 45% 35% at 90% 0%, rgba(143,15,29,0.10), transparent)',
      },
      backgroundSize: {
        grid: '32px 32px',
      },
      boxShadow: {
        'glow-signal': '0 0 0 1px rgba(255,43,58,0.22), 0 8px 32px rgba(220,25,40,0.22)',
        'glow-accent': '0 0 0 1px rgba(200,30,43,0.18), 0 8px 32px rgba(143,15,29,0.25)',
        'glow-online': '0 0 20px rgba(47,215,113,0.32)',
        'glow-offline': '0 0 26px rgba(255,43,58,0.45)',
        'glow-warn': '0 0 20px rgba(255,178,36,0.35)',
        'glass': '0 12px 40px rgba(0,0,0,0.55)',
      },
      keyframes: {
        sonarPing: {
          '0%': { transform: 'scale(0.6)', opacity: '0.7' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        // Pisca forte — usado no ponto de status de dispositivos offline
        alertBlink: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.15', transform: 'scale(0.75)' },
        },
        alertPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,43,58,0.45), 0 0 18px rgba(255,43,58,0.30)' },
          '50%': { boxShadow: '0 0 0 6px rgba(255,43,58,0), 0 0 30px rgba(255,43,58,0.50)' },
        },
        warnPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        drawerIn: {
          '0%': { transform: 'translateX(24px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
      },
      animation: {
        sonar: 'sonarPing 1.8s ease-out infinite',
        blink: 'blink 1.4s ease-in-out infinite',
        'alert-blink': 'alertBlink 0.9s ease-in-out infinite',
        'alert-pulse': 'alertPulse 1.6s ease-in-out infinite',
        'warn-pulse': 'warnPulse 1.8s ease-in-out infinite',
        'drawer-in': 'drawerIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fadeUp 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        scanline: 'scanline 7s linear infinite',
      },
    },
  },
  plugins: [],
};
