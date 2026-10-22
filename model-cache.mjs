// SPDX-License-Identifier: Apache-2.0 · Copyright 2026 UtopiaIA
// model-cache.mjs — dónde guardan sus modelos el Translator y el Copiloto (el mismo fichero en
// los dos sitios).
//
// Los pesos van al almacén COMPARTIDO de Elffuss (el broker de models.elffuss.com, un iframe
// oculto): todas las webs de elffuss.com ven una sola copia, así que lo que bajó el Translator
// no lo vuelve a bajar el Copiloto. El broker baja por tramos y reanuda con Range si se corta,
// y pide su propia persistencia. Si el broker no contesta, transformers.js lo baja como
// siempre y se guarda en la Cache API de esta web (`transformers-cache`), que es también
// donde estaba todo antes: lo que haya ahí se sigue usando sin red y, si el broker acepta
// copias, se le pasa una vez y se borra de aquí.
import { getSharedModel, isSharedCached, sharedUsage, clearShared, putShared, brokerPuede } from './model-broker.js';

// Versión FIJA: con `@3` el motor cambiaba solo cuando salía una 3.x nueva, sin despliegue.
export const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
// Lo que el service worker guarda para abrir sin red: el motor y sus dos ficheros de onnxruntime.
export const TF_FICHEROS = [TF_URL, TF_URL + '/dist/ort-wasm-simd-threaded.jsep.mjs', TF_URL + '/dist/ort-wasm-simd-threaded.jsep.wasm'];
const LEGADO = 'transformers-cache';
const HF = 'https://huggingface.co/';

// ── qué pide transformers.js de cada modelo (y cuánto mide en el Hub, en bytes) ──
// Con la lista entera se sabe qué falta de verdad: antes solo se miraba el encoder, y tras un
// corte se bajaba el resto sin preguntar.
const JSON_WHISPER = [['config.json', 2243], ['generation_config.json', 3832], ['preprocessor_config.json', 339], ['tokenizer.json', 2480466], ['tokenizer_config.json', 282682]];
const MODELOS = {
  'onnx-community/whisper-base': { comun: JSON_WHISPER,
    fp32: [['onnx/encoder_model.onnx', 82468078], ['onnx/decoder_model_merged.onnx', 208521528]],
    q8: [['onnx/encoder_model_quantized.onnx', 23201314], ['onnx/decoder_model_merged_quantized.onnx', 53693315]] },
  'onnx-community/pyannote-segmentation-3.0': { comun: [['config.json', 408], ['preprocessor_config.json', 158]],
    fp32: [['onnx/model.onnx', 5986908]], q8: [['onnx/model_quantized.onnx', 1542308]] },
  'onnx-community/wespeaker-voxceleb-resnet34-LM': { comun: [['config.json', 38], ['preprocessor_config.json', 371]],
    fp32: [['onnx/model.onnx', 26535549]], q8: [['onnx/model_quantized.onnx', 6685134]] },
};
// Los opus-mt tienen todos los mismos ficheros; los tamaños son los de es-en (los demás pares
// se le parecen mucho: sirven para avisar, no para comprobar).
const OPUS = { comun: [['config.json', 1450], ['generation_config.json', 293], ['tokenizer.json', 6262682], ['tokenizer_config.json', 282]],
  fp32: [['onnx/encoder_model.onnx', 209938220], ['onnx/decoder_model_merged.onnx', 235839236]],
  q8: [['onnx/encoder_model_quantized.onnx', 52899742], ['onnx/decoder_model_merged_quantized.onnx', 60212804]] };

// [{url, size}] de un modelo con esa precisión ('fp32' o 'q8').
export function ficheros(id, dtype) {
  const m = MODELOS[id] || (/\/opus-mt-/.test(id) ? OPUS : null);
  if (!m) return [];
  return [...m.comun, ...m[dtype === 'fp32' ? 'fp32' : 'q8']].map(([f, size]) => ({ url: HF + id + '/resolve/main/' + f, size }));
}
// Voz = Whisper + quién habla. En GPU va todo sin cuantizar; en CPU, en 8 bits.
export const ficherosVoz = gpu => ['onnx-community/whisper-base', 'onnx-community/pyannote-segmentation-3.0', 'onnx-community/wespeaker-voxceleb-resnet34-LM']
  .flatMap(id => ficheros(id, gpu ? 'fp32' : 'q8'));
export const bytesDe = lista => lista.reduce((s, x) => s + (x.size || 0), 0);

const partes = url => { const m = /^https:\/\/huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+)$/.exec(url); return m ? { name: m[1], file: m[2] } : null; };
// La caché de esta web, solo si existe (abrirla la crearía vacía en cada visita); `crear` para guardar.
async function legado(crear = false) { try { return self.caches && (crear || await caches.has(LEGADO)) ? await caches.open(LEGADO) : null; } catch { return null; } }
const enLegado = async (c, url) => { try { return c ? await c.match(url) : undefined; } catch { return undefined; } };

// ── la caché que usa transformers.js ──
// Lo que sale del almacén no se baja: su progreso no cuenta (transformers.js lo «lee» igual y
// el anillo contaba como descargados los megas que ya estaban en el disco).
const deAlmacen = new Set();
const noGuardados = new Set();
const pedidos = new Set();          // lo que transformers.js ha pedido de verdad en esta sesión
let avisar = null;
export function esDeAlmacen(e) { return !!e && !e.almacen && deAlmacen.has(e.name + '/' + e.file); }

async function match(req) {
  const url = typeof req === 'string' ? req : req?.url;
  if (!url || !url.startsWith('https://')) return undefined;     // transformers.js prueba antes una ruta local
  const p = partes(url), clave = p ? p.name + '/' + p.file : url;
  pedidos.add(url);
  // 1) Lo que ya estaba en la caché de esta web: sin red.
  const viejo = await enLegado(await legado(), url);
  if (viejo) { deAlmacen.add(clave); return viejo; }
  // 2) El almacén compartido: lo da si lo tiene; si no, lo baja él (por tramos, reanudando) y lo guarda.
  try {
    const f = await getSharedModel(url, m => {
      if (p && avisar && (m.loaded || m.total)) avisar({ status: 'progress', name: p.name, file: p.file, loaded: m.loaded || 0, total: m.total || 0, almacen: true });
    });
    deAlmacen.add(clave);
    // Un File respaldado en disco: el Response lo lee por trozos. El Content-Length hace falta para
    // que transformers.js reserve el búfer de una vez (sin él lo agranda copiando en cada trozo).
    return new Response(f, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(f.size) } });
  } catch (e) {
    console.warn('[elffuss] almacén compartido no disponible, se baja aparte:', url.split('/').pop(), '·', e?.message || e);
    return undefined;                                            // lo baja transformers.js y llama a put()
  }
}
async function put(req, res) {
  const url = typeof req === 'string' ? req : req?.url;
  try { const c = await legado(true); if (!c) throw new Error('sin Cache API'); await c.put(url, res); }
  catch (e) { noGuardados.add(url); console.warn('[elffuss] no se pudo guardar', url.split('/').pop(), '·', e?.message || e); }
}

// Engancha la caché a transformers.js. `onProgress` recibe el progreso de lo que baja el broker,
// con la misma forma que el de transformers.js (y `almacen: true`).
export function instalar(TF, { onProgress } = {}) {
  avisar = onProgress || null;
  TF.env.allowLocalModels = false;
  TF.env.useBrowserCache = false;
  TF.env.useCustomCache = true;
  TF.env.customCache = { match, put };
  return TF;
}

// ── qué falta, qué cabe y qué se guardó ──
// Lo que falta de la lista (ni en la caché de esta web ni en el almacén compartido).
export async function faltan(lista) {
  const c = await legado();
  const hay = await Promise.all(lista.map(async x => !!(await enLegado(c, x.url)) || await isSharedCached(x.url).catch(() => false)));
  return lista.filter((_, i) => !hay[i]);
}
// Lo que se cargó en esta sesión y no ha quedado guardado (para avisar de que la próxima vez se
// bajará otra vez). Solo mira lo que transformers.js pidió de verdad.
export async function sinGuardar(lista) {
  lista = lista.filter(x => pedidos.has(x.url));
  if (!lista.length) return [];
  const f = await faltan(lista);
  return [...new Set([...f.map(x => x.url), ...lista.filter(x => noGuardados.has(x.url)).map(x => x.url)])];
}
// Espacio libre donde van a ir los modelos: el del almacén compartido si contesta, si no el de esta web.
export async function espacio() {
  const s = await sharedUsage().catch(() => ({ ok: false }));
  if (s.ok && s.quota) return { libre: Math.max(0, s.quota - s.usage), quota: s.quota, donde: 'compartido' };
  try { const e = await navigator.storage.estimate(); return { libre: Math.max(0, (e.quota || 0) - (e.usage || 0)), quota: e.quota || 0, donde: 'local' }; }
  catch { return null; }
}
// Lo que ocupa el almacén compartido (todas las webs de Elffuss). 0 si no contesta.
export async function usoCompartido() { const s = await sharedUsage().catch(() => ({ ok: false })); return s.ok ? (s.usage || 0) : 0; }
// Vacía el almacén compartido; no espera más de unos segundos (un broker viejo no contesta).
export async function vaciarCompartido() {
  return Promise.race([clearShared().catch(() => ({ ok: false, liberado: 0 })), new Promise(r => setTimeout(() => r({ ok: false, liberado: 0 }), 8000))]);
}

// ── migrar la caché vieja ──
// Lo que esta web guardaba en `transformers-cache` pasa al almacén compartido (sin bajar nada) y
// se borra de aquí. Si el broker aún no acepta copias, o rechaza una (no casa con el Hub), se
// queda donde estaba y se sigue usando.
let migrando = null;
export function migrarLegado() {
  if (migrando) return migrando;
  migrando = (async () => {
    const out = { movidos: 0, quedan: 0 };
    if (!self.caches || !(await caches.has(LEGADO).catch(() => false))) return out;
    if (!(await brokerPuede('put'))) return out;
    const c = await legado(); if (!c) return out;
    for (const req of await c.keys()) {
      try {
        if (!(await isSharedCached(req.url))) { const r = await c.match(req); await putShared(req.url, await r.blob()); }
        await c.delete(req); out.movidos++;
      } catch (e) { out.quedan++; console.warn('[elffuss] se queda en la caché de esta web:', req.url.split('/').pop(), '·', e?.message || e); }
    }
    if (!out.quedan) await caches.delete(LEGADO).catch(() => {});
    return out;
  })().finally(() => { migrando = null; });
  return migrando;
}

// ── service worker: que la página abra sin red una vez visitada ──
export function registrarSW() {
  try {
    const sw = self.isSecureContext ? navigator.serviceWorker : null;
    if (sw) sw.register('./sw.js').catch(() => {});
  } catch { /* sin service worker la app funciona igual, solo que no abre sin red */ }
}
// Tras cargar los modelos, el service worker guarda el motor (lo pide él; casi siempre sale de la
// caché HTTP). Así no depende de que ya estuviera activo cuando se importó transformers.js.
export function guardarMotor() {
  try { navigator.serviceWorker?.ready.then(r => r.active?.postMessage({ tipo: 'guardar', urls: TF_FICHEROS })).catch(() => {}); } catch { /* — */ }
}
