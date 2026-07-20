import * as React from 'react';

/**
 * Fundo de caminhos fluindo (adaptado do BackgroundPaths do 21st.dev pra este
 * projeto): curvas em vermelho-sinal com traço viajando ao longo do caminho,
 * como enlaces de fibra atravessando a tela.
 *
 * Sem framer-motion de propósito — o efeito de pathOffset vira stroke-dashoffset
 * animado em CSS, que roda de graça mesmo atrás do mapa e da topologia.
 */

const TOTAL_CAMINHOS = 22;

function CaminhosFlutuantes({ direcao }: { direcao: 1 | -1 }) {
  const caminhos = Array.from({ length: TOTAL_CAMINHOS }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * direcao} -${189 + i * 6}C-${380 - i * 5 * direcao} -${189 + i * 6} -${
      312 - i * 5 * direcao
    } ${216 - i * 6} ${152 - i * 5 * direcao} ${343 - i * 6}C${616 - i * 5 * direcao} ${470 - i * 6} ${
      684 - i * 5 * direcao
    } ${875 - i * 6} ${684 - i * 5 * direcao} ${875 - i * 6}`,
    opacidade: 0.08 + i * 0.01,
    espessura: 0.6 + i * 0.045,
  }));

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 696 316"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      {caminhos.map((c) => (
        <path
          key={c.id}
          d={c.d}
          stroke="#FF2B3A"
          strokeOpacity={c.opacidade}
          strokeWidth={c.espessura}
          className="caminho-fluxo"
          style={
            {
              '--dur': `${20 + c.id * 0.7}s`,
              '--atraso': `-${c.id * 1.4}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </svg>
  );
}

/** Camada fixa atrás de toda a interface interna. */
export function FundoCaminhos() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <CaminhosFlutuantes direcao={1} />
      <CaminhosFlutuantes direcao={-1} />
    </div>
  );
}
