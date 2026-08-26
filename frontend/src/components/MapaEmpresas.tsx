import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Empresa } from '../api';

// Basemap escuro do OpenFreeMap, servido pelo proxy do backend (/api/map/basemap)
// pra CSP do front seguir 'connect-src self'. Mesma resolucao de base do api.ts:
// em producao VITE_API_URL=/api (mesma origem, atras do nginx).
const HOST_ATUAL = window.location.hostname || 'localhost';
const PROTOCOLO_ATUAL = window.location.protocol === 'https:' ? 'https:' : 'http:';
const API_BASE = import.meta.env.VITE_API_URL || `${PROTOCOLO_ATUAL}//${HOST_ATUAL}:4000/api`;
const ESTILO_MAPA = `${API_BASE}/map/basemap/styles/dark`;

// Visão inicial quando nenhuma empresa tem coordenada ainda (Brasil inteiro).
// MapLibre usa [longitude, latitude] (o inverso do Leaflet).
const CENTRO_PADRAO: [number, number] = [-51.9, -14.2];
const ZOOM_PADRAO = 4;
// Zoom usado quando todas as sedes estão na mesma cidade — mostra a malha urbana
const ZOOM_CIDADE = 13;

function comCoordenadas(empresas: Empresa[]) {
  return empresas.filter((e) => e.latitude != null && e.longitude != null);
}

/** Enquadra o mapa nas sedes com coordenada (uma sede = zoom de cidade). */
function enquadrarNasSedes(mapa: maplibregl.Map, pontos: Empresa[]) {
  if (pontos.length === 1) {
    mapa.jumpTo({ center: [Number(pontos[0].longitude), Number(pontos[0].latitude)], zoom: ZOOM_CIDADE });
  } else if (pontos.length > 1) {
    const limites = new maplibregl.LngLatBounds();
    pontos.forEach((e) => limites.extend([Number(e.longitude), Number(e.latitude)]));
    mapa.fitBounds(limites, { padding: 42, maxZoom: ZOOM_CIDADE, duration: 0 });
  }
}

export type StatusMarcador = 'online' | 'degradado' | 'offline' | 'sem';

const ROTULO_STATUS: Record<StatusMarcador, string> = {
  offline: '🔴 queda',
  degradado: '🟡 atenção',
  online: '🟢 no ar',
  sem: 'sem monitor',
};

/**
 * Mapa fixo na área de atuação: enquadra as sedes cadastradas e só se move
 * quando o operador arrasta/zooma (ou ao focar uma empresa via hover).
 * A cor de cada pin acompanha a saúde da empresa (verde/âmbar/vermelho).
 */
export function MapaEmpresas({
  empresas,
  foco,
  statusPorEmpresa = {},
  modoVitrine = false,
  onSelecionarEmpresa,
  reenquadrarToken,
  rotularQuedas = false,
  quedasRecentes,
}: {
  empresas: Empresa[];
  foco: { latitude: number; longitude: number } | null;
  statusPorEmpresa?: Record<number, StatusMarcador>;
  /** Modo mural/TV: pinos maiores (o mapa continua navegável — arraste/zoom). */
  modoVitrine?: boolean;
  /** Clique num pino abre a empresa (ex.: ir direto ao painel de configuração). */
  onSelecionarEmpresa?: (empresa: Empresa) => void;
  /** Ao incrementar, reenquadra o mapa em todas as sedes (botão "Reenquadrar"). */
  reenquadrarToken?: number;
  /** Mostra o nome fixo em cima das empresas offline (com anti-sobreposição). */
  rotularQuedas?: boolean;
  /**
   * IDs das empresas cuja queda é RECENTE: só elas piscam e ganham rótulo.
   * Queda antiga ("timed out") vira pino vermelho quieto, sem nome.
   * Sem esta prop, toda queda é tratada como recente.
   */
  quedasRecentes?: Set<number>;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<maplibregl.Map | null>(null);
  // Marcadores e popups vivos (recriados a cada poll); guardados pra limpeza.
  const marcadoresRef = useRef<maplibregl.Marker[]>([]);
  const popupsRef = useRef<maplibregl.Popup[]>([]);
  // Callback de clique sempre atual, sem precisar redesenhar os pinos a cada render
  const aoSelecionarRef = useRef(onSelecionarEmpresa);
  useEffect(() => {
    aoSelecionarRef.current = onSelecionarEmpresa;
  }, [onSelecionarEmpresa]);
  // Lista atual acessível fora do ciclo de render (usada pelo "Reenquadrar")
  const empresasRef = useRef(empresas);
  useEffect(() => {
    empresasRef.current = empresas;
  }, [empresas]);

  // Rótulos fixos das quedas + anti-sobreposição. Esconde o rótulo que colidiria
  // com um já visível (recalculado ao mover/zoom); a lista lateral tem todos.
  const rotulosRef = useRef<maplibregl.Popup[]>([]);
  const declutterRef = useRef<() => void>(() => {});
  function declutter() {
    const ocupados: DOMRect[] = [];
    for (const p of rotulosRef.current) {
      const el = p.getElement();
      if (!el) continue;
      el.classList.remove('rotulo-oculto');
      const r = el.getBoundingClientRect();
      const colide = ocupados.some(
        (o) => !(r.right < o.left || r.left > o.right || r.bottom < o.top || r.top > o.bottom)
      );
      if (colide) el.classList.add('rotulo-oculto');
      else ocupados.push(r);
    }
  }
  declutterRef.current = declutter;

  useEffect(() => {
    const div = divRef.current;
    if (!div) return;

    const mapa = new maplibregl.Map({
      container: div,
      style: ESTILO_MAPA,
      center: CENTRO_PADRAO,
      zoom: ZOOM_PADRAO,
      attributionControl: { compact: true },
      // O worker do MapLibre (que baixa os tiles .pbf) não tem document.baseURI,
      // então URL raiz-relativa (/api/map/...) rebenta com "Failed to parse URL".
      // Absolutizamos aqui, na main thread, antes de mandar pro worker. As chamadas
      // do basemap batem em /api/map (mesma origem via nginx) e precisam do cookie
      // de sessão — o proxy fica atrás do login, como antes.
      transformRequest: (url) => {
        const abs = url.startsWith('/') ? window.location.origin + url : url;
        return abs.includes('/api/map/') ? { url: abs, credentials: 'include' } : { url: abs };
      },
    });
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    mapaRef.current = mapa;

    // Ao mover/dar zoom, os rótulos mudam de posição — refaz o anti-sobreposição
    mapa.on('zoomend', () => declutterRef.current());
    mapa.on('moveend', () => declutterRef.current());

    // O painel pode mudar de tamanho (responsivo/painéis vizinhos); sem isso o
    // MapLibre renderiza o canvas pela metade quando o container cresce depois do mount.
    const observador = new ResizeObserver(() => mapa.resize());
    observador.observe(div);

    return () => {
      observador.disconnect();
      marcadoresRef.current.forEach((m) => m.remove());
      popupsRef.current.forEach((p) => p.remove());
      marcadoresRef.current = [];
      popupsRef.current = [];
      rotulosRef.current = [];
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  // Marcadores acompanham cadastro E status ao vivo (redesenhados a cada poll)
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    // Limpa os marcadores/popups do ciclo anterior
    marcadoresRef.current.forEach((m) => m.remove());
    popupsRef.current.forEach((p) => p.remove());
    marcadoresRef.current = [];
    popupsRef.current = [];
    rotulosRef.current = [];

    const tamanho = modoVitrine ? 26 : 14;
    const recuo = tamanho / 2 + 6;
    comCoordenadas(empresas).forEach((e) => {
      const status = statusPorEmpresa[e.id] ?? 'sem';
      // Queda antiga já foi vista pelo suporte: pino vermelho quieto, sem alarde
      const recente = quedasRecentes ? quedasRecentes.has(e.id) : true;
      const quieto = status === 'offline' && !recente ? ' marcador-quieto' : '';

      const el = document.createElement('span');
      el.className = `marcador-empresa marcador-${status}${modoVitrine ? ' marcador-grande' : ''}${quieto}`;
      el.style.cursor = 'pointer';
      // Clique no pino leva direto ao painel da empresa (config, dispositivos…)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        aoSelecionarRef.current?.(e);
      });

      const coord: [number, number] = [Number(e.longitude), Number(e.latitude)];
      const marcador = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(mapa);
      marcadoresRef.current.push(marcador);

      if (rotularQuedas && status === 'offline' && recente) {
        // Nome fixo em cima da empresa que caiu (Mapa TV). O declutter esconde os
        // que se sobreporiam; a lista lateral mantém todos legíveis.
        const rotulo = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          anchor: 'bottom',
          offset: recuo,
          className: 'tooltip-quedatv',
        })
          .setLngLat(coord)
          .setText(e.nome)
          .addTo(mapa);
        popupsRef.current.push(rotulo);
        rotulosRef.current.push(rotulo);
      } else {
        // Tooltip de hover: nome + status. Aparece ao passar o mouse no pino.
        const dica = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          anchor: 'bottom',
          offset: recuo,
          className: 'tooltip-mapa',
        }).setText(`${e.nome} · ${ROTULO_STATUS[status]}`);
        popupsRef.current.push(dica);
        el.addEventListener('mouseenter', () => dica.setLngLat(coord).addTo(mapa));
        el.addEventListener('mouseleave', () => dica.remove());
      }
    });
    // Espera o MapLibre posicionar os rótulos antes de medir a sobreposição
    requestAnimationFrame(() => declutterRef.current());
  }, [empresas, statusPorEmpresa, rotularQuedas, quedasRecentes, modoVitrine]);

  // Enquadramento só quando o CONJUNTO de sedes muda de fato — atualização de
  // status a cada 15s não pode roubar o mapa de quem está navegando nele
  const assinaturaSedes = useRef('');
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    const pontos = comCoordenadas(empresas);
    const assinatura = pontos.map((e) => `${e.id}:${e.latitude},${e.longitude}`).join('|');
    if (assinatura === assinaturaSedes.current) return;
    assinaturaSedes.current = assinatura;
    enquadrarNasSedes(mapa, pontos);
  }, [empresas]);

  // Botão "Reenquadrar" (Mapa TV): volta pra visão geral de todas as sedes
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !reenquadrarToken) return;
    enquadrarNasSedes(mapa, comCoordenadas(empresasRef.current));
  }, [reenquadrarToken]);

  // Foco vindo do hover nos cards/chips — voa até a sede e fica lá
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !foco) return;
    mapa.flyTo({ center: [foco.longitude, foco.latitude], zoom: Math.max(mapa.getZoom(), ZOOM_CIDADE), duration: 800 });
  }, [foco]);

  return (
    <div
      ref={divRef}
      className="w-full h-full min-h-[240px] rounded-xl overflow-hidden border border-white/[0.06] relative z-0"
      aria-label="Mapa com a localização das empresas monitoradas"
    />
  );
}
