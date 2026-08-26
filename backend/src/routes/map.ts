import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';

export const mapRouter = Router();
mapRouter.use(authMiddleware);

mapRouter.get('/geocode', requireRole('admin'), async (req, res) => {
  const consulta = String(req.query.q || '').trim();
  if (consulta.length < 3 || consulta.length > 255) return res.status(400).json({ erro: 'Endereco invalido.' });
  if (String(process.env.EXTERNAL_GEOCODING_ENABLED || 'false').toLowerCase() !== 'true') {
    return res.status(503).json({ erro: 'Geocodificacao externa desativada pelo administrador.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('accept-language', 'pt-BR');
    url.searchParams.set('q', consulta);
    const resposta = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'uptimeX-NetMonitor/1.0' },
      signal: controller.signal,
    });
    if (!resposta.ok) return res.status(502).json({ erro: 'Servico de geocodificacao indisponivel.' });
    const lista: any = await resposta.json();
    const item = Array.isArray(lista) ? lista[0] : null;
    if (!item) return res.json({ resultado: null });
    res.json({
      resultado: {
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        rotulo: String(item.display_name || consulta).slice(0, 500),
      },
    });
  } finally {
    clearTimeout(timer);
  }
});

// Basemap escuro vetorial do OpenFreeMap (gratis, sem API key, open source),
// consumido pelo MapLibre GL no front. Tudo passa por este proxy de proposito:
// assim a CSP do front segue 'connect-src self' e o navegador nunca fala com uma
// CDN externa (nao vaza o IP dos clientes). O style JSON e o TileJSON do
// OpenFreeMap trazem URLs absolutas da CDN, entao reescrevemos essas URLs pro
// proprio proxy; tiles/glyphs/sprites (binarios) sao repassados como vieram.
const OFM_HOST = 'https://tiles.openfreemap.org';
const OFM_PREFIXO_PROXY = '/api/map/basemap';
const OFM_TETO_BYTES = 16 * 1024 * 1024;

// Style (/styles/dark) e TileJSON (/planet) vem sem extensao; alem do content-type
// tratamos esses casos explicitamente pra garantir a reescrita das URLs.
function ehRespostaJson(tipo: string, caminho: string): boolean {
  return (
    tipo.includes('json') ||
    caminho.endsWith('.json') ||
    /\/styles\/[^/]+$/.test(caminho) ||
    /\/planet$/.test(caminho)
  );
}

mapRouter.get(/^\/basemap\/.+/, async (req, res) => {
  // Caminho depois de /basemap/ preservando encoding e querystring originais.
  const marcador = '/basemap/';
  const corte = req.originalUrl.indexOf(marcador);
  const resto = corte >= 0 ? req.originalUrl.slice(corte + marcador.length) : '';

  // Trava anti-SSRF: o caminho so pode resolver DENTRO do host do OpenFreeMap.
  // new URL barra truques como '//evil.com', 'http://...' ou '..' saindo do host.
  let alvo: URL;
  try {
    alvo = new URL(resto, OFM_HOST + '/');
  } catch {
    return res.status(400).json({ erro: 'Caminho de basemap invalido.' });
  }
  if (alvo.origin !== OFM_HOST) {
    return res.status(403).json({ erro: 'Origem de basemap nao permitida.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const upstream = await fetch(alvo, {
      signal: controller.signal,
      headers: { 'User-Agent': 'uptimeX-NetMonitor/1.0', Accept: '*/*' },
    });
    if (!upstream.ok) return res.status(502).end();
    if (Number(upstream.headers.get('content-length') || 0) > OFM_TETO_BYTES) {
      return res.status(502).end();
    }
    const tipo = upstream.headers.get('content-type') || 'application/octet-stream';

    if (ehRespostaJson(tipo, alvo.pathname)) {
      let corpo = await upstream.text();
      if (corpo.length > OFM_TETO_BYTES) return res.status(502).end();
      // Reescreve toda URL da CDN pro proxy: o navegador so enxerga rotas /api/map.
      corpo = corpo.split(OFM_HOST).join(OFM_PREFIXO_PROXY);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(corpo);
    }

    // Binarios (tiles .pbf/.png, glyphs .pbf, sprites .png): repassa como veio.
    // O fetch do Node ja descomprime gzip/br, entao NAO propagamos content-encoding.
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > OFM_TETO_BYTES) return res.status(502).end();
    res.setHeader('Content-Type', tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(bytes);
  } catch {
    res.status(502).end();
  } finally {
    clearTimeout(timer);
  }
});

