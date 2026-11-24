// Versão PC do Auto Theft Jundiaí (Electron): o mesmo jogo web, num executável para Windows/Linux.
// - O jogo é servido pelo protocolo app:// (seguro, com fetch e Web Worker funcionando como num site).
// - Os blocos do mapa baixados ficam salvos na pasta do usuário (baixa cada pedaço de Jundiaí uma vez só).
// - Tela cheia com F11, sem barra de menu, GPU sempre ligada e sem frear o jogo quando a janela perde o foco.
const { app, BrowserWindow, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, 'app');
const CACHE = path.join(app.getPath('userData'), 'osm-cache');
const MAX = 60 * 1024 * 1024;

app.commandLine.appendSwitch('ignore-gpu-blocklist'); // placas antigas também usam a GPU
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('touch-events', 'disabled'); // notebook com tela de toque: controles de PC, não de celular

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function cacheFile(url) {
  const name = decodeURIComponent(url.pathname.slice('/osm-cache/'.length)).replace(/[^\w.,-]/g, '_');
  return name.endsWith('.json') ? path.join(CACHE, name) : null;
}

async function handle(req) {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/osm-cache/')) { // cache em disco dos blocos do mapa (mesma API do servidor de desenvolvimento)
    const file = cacheFile(url);
    if (!file) return new Response(null, { status: 400 });
    if (req.method === 'POST') {
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length > MAX) return new Response(null, { status: 413 });
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(file, buf);
      return new Response('ok');
    }
    if (!fs.existsSync(file)) return new Response(null, { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'Content-Type': 'application/json' } });
  }
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return new Response(null, { status: 403 }); // não sai da pasta do jogo
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: '#14112b', title: 'Auto Theft Jundiaí', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.key === 'Enter' && input.alt) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // links externos (créditos do mapa etc.) abrem no navegador, não dentro do jogo
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://jogo/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', handle);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'pointerLock' || perm === 'fullscreen'));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
