// Service worker: que la app ABRA sin red una vez visitada (el mismo fichero en el Translator y
// en el Copiloto; cada uno lo sirve desde su raíz).
//
// Guarda la página y sus módulos (red primero: con red siempre se sirve lo último desplegado) y
// el motor de jsDelivr, que va con versión fija y no cambia (caché primero). Los modelos NO pasan
// por aquí: los guarda el almacén compartido de models.elffuss.com, que tiene su propio service
// worker. Todo lo demás del sitio (el blog, por ejemplo) no se toca.
//
// Cambiar VERSION si cambia la lista o la versión fijada del motor: el despliegue la renueva.
const VERSION = '1';
const PREFIJO = 'elffuss-app-' + new URL(self.registration.scope).hostname + '-';
const CACHE = PREFIJO + VERSION;
const PROPIOS = ['./', 'diarize.mjs', 'splash-gl.js', 'model-cache.mjs', 'model-broker.js', 'manifest.webmanifest', 'icon.svg',
  'copilot-llm.mjs', 'copilot-grammar.mjs'];
const MOTOR = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const abs = p => new URL(p, self.registration.scope).href;
const RAIZ = abs('./');
const RUTAS = new Set(PROPIOS.map(p => new URL(abs(p)).pathname).concat(new URL(abs('index.html')).pathname));

self.addEventListener('install', e => {
  // Lo que falte (el Translator no tiene los dos módulos del Copiloto) no impide instalar.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(PROPIOS.map(p => c.add(abs(p)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIJO) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function redPrimero(req, clave) {
  try {
    const res = await fetch(req);
    if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(clave, copia)).catch(() => {}); }
    return res;
  } catch (err) {
    const guardada = await caches.match(clave, { ignoreSearch: true });
    if (guardada) return guardada;
    throw err;
  }
}
async function cachePrimero(req) {
  const guardada = await caches.match(req.url);
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req.url, copia)).catch(() => {}); }
  return res;
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (r.mode === 'navigate') {
    if (u.origin === location.origin && (u.pathname === new URL(RAIZ).pathname || u.pathname === new URL(abs('index.html')).pathname)) e.respondWith(redPrimero(r, RAIZ));
    return;
  }
  if (u.origin === location.origin && RUTAS.has(u.pathname)) e.respondWith(redPrimero(r, u.origin + u.pathname));
  else if (r.url.startsWith(MOTOR + '/') || r.url === MOTOR) e.respondWith(cachePrimero(r));
});

// La página pide guardar el motor cuando ya lo ha usado (por si este service worker aún no
// estaba activo cuando lo importó).
self.addEventListener('message', e => {
  const urls = (e.data && e.data.tipo === 'guardar' && Array.isArray(e.data.urls)) ? e.data.urls.filter(u => typeof u === 'string' && (u === MOTOR || u.startsWith(MOTOR + '/'))) : [];
  if (!urls.length) return;
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(async u => {
    if (await c.match(u)) return;
    const res = await fetch(u, { mode: 'cors' }).catch(() => null);
    if (res && res.ok) await c.put(u, res);
  }))));
});
