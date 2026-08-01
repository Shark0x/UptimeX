import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Empresa } from '../api';

// Visão inicial quando nenhuma empresa tem coordenada ainda (Brasil inteiro)
const CENTRO_PADRAO: [number, number] = [-14.2, -51.9];
const ZOOM_PADRAO = 4;
// Zoom usado quando todas as sedes estão na mesma cidade — mostra a malha urbana
const ZOOM_CIDADE = 13;

function comCoordenadas(empresas: Empresa[]) {
  return empresas.filter((e) => e.latitude != null && e.longitude != null);
}

/** Enquadra o mapa nas sedes com coordenada (uma sede = zoom de cidade). */
function enquadrarNasSedes(mapa: L.Map, pontos: Empresa[]) {
  if (pontos.length === 1) {
    mapa.setView([Number(pontos[0].latitude), Number(pontos[0].longitude)], ZOOM_CIDADE);
  } else if (pontos.length > 1) {
    const limites = L.latLngBounds(pontos.map((e) => [Number(e.latitude), Number(e.longitude)] as [number, number]));
    mapa.fitBounds(limites, { padding: [42, 42], maxZoom: ZOOM_CIDADE });
  }
}

// Nome vai pra dentro do HTML do rótulo — escapar evita quebrar o balão (ou injeção).
function escaparHtml(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

export type StatusMarcador = 'online' | 'degradado' | 'offline' | 'sem';

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
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);
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
  const rotulosRef = useRef<L.Marker[]>([]);
  const declutterRef = useRef<() => void>(() => {});
  function declutter() {
    const ocupados: DOMRect[] = [];
    for (const m of rotulosRef.current) {
      const el = m.getTooltip()?.getElement() as HTMLElement | undefined;
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

    const mapa = L.map(div, {
      center: CENTRO_PADRAO,
      zoom: ZOOM_PADRAO,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
      worldCopyJump: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(mapa);

    camadaRef.current = L.layerGroup().addTo(mapa);
    mapaRef.current = mapa;

    // Ao mover/dar zoom, os rótulos mudam de posição — refaz o anti-sobreposição
    mapa.on('zoomend moveend', () => declutterRef.current());

    // O painel pode mudar de tamanho (responsivo/painéis vizinhos); sem isso o
    // Leaflet renderiza tiles pela metade quando o container cresce depois do mount.
    const observador = new ResizeObserver(() => mapa.invalidateSize());
    observador.observe(div);

    return () => {
      observador.disconnect();
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Marcadores acompanham cadastro E status ao vivo (redesenhados a cada poll)
  useEffect(() => {
    const camada = camadaRef.current;
    if (!camada) return;

    camada.clearLayers();
    rotulosRef.current = [];
    const tamanho = modoVitrine ? 26 : 14;
    comCoordenadas(empresas).forEach((e) => {
      const status = statusPorEmpresa[e.id] ?? 'sem';
      // Queda antiga já foi vista pelo suporte: pino vermelho quieto, sem alarde
      const recente = quedasRecentes ? quedasRecentes.has(e.id) : true;
      const quieto = status === 'offline' && !recente ? ' marcador-quieto' : '';
      const icone = L.divIcon({
        className: '',
        html: `<span class="marcador-empresa marcador-${status}${modoVitrine ? ' marcador-grande' : ''}${quieto}"></span>`,
        iconSize: [tamanho, tamanho],
        iconAnchor: [tamanho / 2, tamanho / 2],
      });
      // Clique no pino leva direto ao painel da empresa (config, dispositivos…)
      const marcador = L.marker([Number(e.latitude), Number(e.longitude)], { icon: icone }).on(
        'click',
        () => aoSelecionarRef.current?.(e)
      );

      if (rotularQuedas && status === 'offline' && recente) {
        // Nome fixo em cima da empresa que caiu (Mapa TV). O declutter esconde os
        // que se sobreporiam; a lista lateral mantém todos legíveis.
        marcador.bindTooltip(escaparHtml(e.nome), {
          direction: 'top',
          offset: [0, -tamanho / 2 - 3],
          className: 'tooltip-quedatv',
          permanent: true,
          opacity: 1,
        });
        rotulosRef.current.push(marcador);
      } else {
        const rotulo =
          status === 'offline' ? '🔴 queda' : status === 'degradado' ? '🟡 atenção' : status === 'online' ? '🟢 no ar' : 'sem monitor';
        marcador.bindTooltip(`${e.nome} · ${rotulo}`, {
          direction: 'top',
          offset: [0, -tamanho / 2 - 3],
          className: 'tooltip-mapa',
        });
      }
      marcador.addTo(camada);
    });
    // Espera o Leaflet posicionar os rótulos antes de medir a sobreposição
    requestAnimationFrame(() => declutterRef.current());
  }, [empresas, statusPorEmpresa, rotularQuedas, quedasRecentes]);

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
    mapa.flyTo([foco.latitude, foco.longitude], Math.max(mapa.getZoom(), ZOOM_CIDADE), { duration: 0.8 });
  }, [foco]);

  return (
    <div
      ref={divRef}
      className="w-full h-full min-h-[240px] rounded-xl overflow-hidden border border-white/[0.06] relative z-0"
      aria-label="Mapa com a localização das empresas monitoradas"
    />
  );
}
