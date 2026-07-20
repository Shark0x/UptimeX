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
}: {
  empresas: Empresa[];
  foco: { latitude: number; longitude: number } | null;
  statusPorEmpresa?: Record<number, StatusMarcador>;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);

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
    comCoordenadas(empresas).forEach((e) => {
      const status = statusPorEmpresa[e.id] ?? 'sem';
      const icone = L.divIcon({
        className: '',
        html: `<span class="marcador-empresa marcador-${status}"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const rotulo =
        status === 'offline' ? '🔴 queda' : status === 'degradado' ? '🟡 atenção' : status === 'online' ? '🟢 no ar' : 'sem monitor';
      L.marker([Number(e.latitude), Number(e.longitude)], { icon: icone })
        .bindTooltip(`${e.nome} · ${rotulo}`, { direction: 'top', offset: [0, -10], className: 'tooltip-mapa' })
        .addTo(camada);
    });
  }, [empresas, statusPorEmpresa]);

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

    if (pontos.length === 1) {
      mapa.setView([Number(pontos[0].latitude), Number(pontos[0].longitude)], ZOOM_CIDADE);
    } else if (pontos.length > 1) {
      const limites = L.latLngBounds(pontos.map((e) => [Number(e.latitude), Number(e.longitude)] as [number, number]));
      mapa.fitBounds(limites, { padding: [42, 42], maxZoom: ZOOM_CIDADE });
    }
  }, [empresas]);

  // Foco vindo do hover nos cards/chips — voa até a sede e fica lá
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa || !foco) return;
    mapa.flyTo([foco.latitude, foco.longitude], Math.max(mapa.getZoom(), ZOOM_CIDADE), { duration: 0.8 });
  }, [foco]);

  return (
    <div
      ref={divRef}
      className="w-full h-full min-h-[380px] rounded-xl overflow-hidden border border-white/[0.06] relative z-0"
      aria-label="Mapa com a localização das empresas monitoradas"
    />
  );
}
