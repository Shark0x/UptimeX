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

mapRouter.get('/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const limite = Number.isInteger(z) && z >= 0 && z <= 20 ? 2 ** z : 0;
  if (!limite || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= limite || y >= limite) {
    return res.status(400).json({ erro: 'Coordenada de tile invalida.' });
  }
  const subdominio = ['a', 'b', 'c', 'd'][(x + y) % 4];
  const url = `https://${subdominio}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resposta = await fetch(url, { signal: controller.signal });
    if (!resposta.ok) return res.status(502).end();
    const tamanho = Number(resposta.headers.get('content-length') || 0);
    if (tamanho > 2 * 1024 * 1024) return res.status(502).end();
    const buffer = Buffer.from(await resposta.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) return res.status(502).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } finally {
    clearTimeout(timer);
  }
});

