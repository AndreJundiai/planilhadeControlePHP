import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Salva no disco (pasta osm-cache/) cada bloco do mapa baixado do OpenStreetMap.
// Assim cada pedaço de Jundiaí é baixado UMA vez só, mesmo trocando de navegador ou limpando os dados.
const DIR = path.resolve('osm-cache');
const MAX = 60 * 1024 * 1024;

function osmDiskCache() {
  const mw = (req, res, next) => {
    if (!req.url.startsWith('/osm-cache/')) return next();
    const name = decodeURIComponent(req.url.slice('/osm-cache/'.length).split('?')[0]).replace(/[^\w.,-]/g, '_');
    if (!name.endsWith('.json')) { res.statusCode = 400; return res.end(); }
    const file = path.join(DIR, name);
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST') {
      const parts = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= MAX) parts.push(c); });
      req.on('end', () => {
        if (size > MAX) { res.statusCode = 413; return res.end(); }
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(file, Buffer.concat(parts));
        res.end('ok');
      });
      return;
    }
    next();
  };
  return { name: 'osm-disk-cache', configureServer: (s) => { s.middlewares.use(mw); }, configurePreviewServer: (s) => { s.middlewares.use(mw); } };
}

export default defineConfig({ base: './', plugins: [osmDiskCache()], build: { chunkSizeWarningLimit: 4000, minify: process.env.NOMIN ? false : 'esbuild' } });
