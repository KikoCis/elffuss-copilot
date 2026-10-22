// La IA avanzada del Copiloto: Gemma por LiteRT-LM, en la GPU del navegador.
//
// QUÉ APORTA sobre las reglas: lo que no tiene forma fija. La NECESIDAD del cliente,
// el SIGUIENTE PASO y un consejo en vivo. Lo que sí tiene forma (teléfono, email,
// nombre, empresa, cargo, presupuesto, plazo) lo siguen mandando las reglas del
// index.html, y todo lo que proponga el modelo pasa por copilot-grammar.mjs: si no
// encaja o nadie lo dijo, no entra.
//
// QUÉ MODELO: en Elffuss Claw se midió que solo Gemma sigue bien una llamada
// (Qwen3.5-0.8B marca todo «sí», LFM2.5 no marca nada). E4B donde la GPU da de sí;
// E2B si va más justa; sin WebGPU, nada: el Copiloto sigue con reglas.
// En MÓVIL está sin medir todavía (pendiente del iPhone): se intenta E2B.
//
// CÓMO: cada turno abre una conversación NUEVA con la ventana reciente de la
// transcripción y la cierra al acabar. Así el contexto no crece ni se desborda, y un
// fallo de un turno no arrastra a los siguientes. Un turno a la vez, pero sin perder
// ninguno: si llega texto mientras piensa, el siguiente ve la conversación entera.
import * as gram from './copilot-grammar.mjs';

const LITERT = 'https://cdn.jsdelivr.net/npm/@litert-lm/core@0.15.0/+esm';   // versión fijada: 0.16.0 no tiene +esm en jsdelivr
export const MODELOS = {
  'gemma-e4b': { etiqueta: 'Gemma 4 E4B', mb: 2832, url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm', ficha: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm' },
  'gemma-e2b': { etiqueta: 'Gemma 4 E2B', mb: 1915, url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm', ficha: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm' },
};
const CACHE = 'elffuss-copiloto-llm-v1';
const VENTANA = 14;          // líneas de transcripción que ve el modelo en cada turno

export const esMovil = () => /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

// Qué modelo cabe aquí, o null si ninguno.
export async function elegirModelo() {
  if (!navigator.gpu) return null;
  let a = null;
  try { a = await navigator.gpu.requestAdapter(); } catch { /* sin adaptador */ }
  if (!a) return null;
  const mb = a.limits.maxBufferSize / 1048576;
  if (esMovil()) return mb >= 1024 ? 'gemma-e2b' : null;
  return mb >= 2048 ? 'gemma-e4b' : mb >= 1024 ? 'gemma-e2b' : null;
}

// Descarga con progreso y guardado en Cache Storage. SIN tee(): con gigabytes, tee()
// hacía que el navegador bufferizara la diferencia entre ramas y el modelo no se
// guardaba nunca (medido en Claw con E4B). Un solo consumidor que cuenta al vuelo.
// `senal` corta la descarga (ver cancelarCarga): la petición se aborta y no queda nada a medias en la
// caché (put() no guarda una respuesta cuyo cuerpo falla; se borra igualmente por si acaso).
async function blobCacheado(url, onProgress, senal) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) { onProgress?.(1, 1, true); return hit.blob(); }
  try {
    const res = await fetch(url, { signal: senal });
    if (!res.ok || !res.body) throw new Error('descarga ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    let cargado = 0;
    const contado = res.body.pipeThrough(new TransformStream({
      transform(trozo, c) { cargado += trozo.byteLength; onProgress?.(cargado, total, false); c.enqueue(trozo); },
    }));
    await cache.put(url, new Response(contado, { headers: { 'Content-Type': 'application/octet-stream', ...(total ? { 'Content-Length': String(total) } : {}) } }));
  } catch (e) {
    if (senal?.aborted) { try { await cache.delete(url); } catch { /* */ } throw cancelada(); }
    throw e;
  }
  const guardado = await cache.match(url);
  if (!guardado) throw new Error('no se pudo guardar el modelo');
  return guardado.blob();
}
const cancelada = () => new DOMException('descarga cancelada', 'AbortError');
export const esCancelada = e => e?.name === 'AbortError';

let engine = null, cargando = null, modelo = null, progreso = null, corte = null;
export const listo = () => !!engine;
export const modeloActivo = () => modelo;

// Si se vuelve a pedir mientras aún carga (otra llamada), el progreso pasa a quien lo pidió ahora.
export function cargar(clave, onProgress) {
  progreso = onProgress;
  if (cargando) return cargando;
  const mio = corte = new AbortController();
  cargando = (async () => {
    const lit = await import(LITERT);
    if (mio.signal.aborted) throw cancelada();
    const model = await blobCacheado(MODELOS[clave].url, (...a) => progreso?.(...a), mio.signal);
    if (corte === mio) corte = null;   // descargado: preparar ya no se puede cortar, y es local
    let ultimo = null;
    for (const n of [8192, 4096]) {
      try { engine = await lit.Engine.create({ model, mainExecutorSettings: { maxNumTokens: n } }); modelo = clave; return clave; }
      catch (e) { ultimo = e; if (/not supported|tokenizer|format/i.test(String(e?.message))) throw e; }
    }
    throw ultimo || new Error('el modelo no cabe en la GPU');
  })();
  cargando.catch(() => { cargando = null; }).finally(() => { if (corte === mio) corte = null; });
  return cargando;
}
// Quien la pidió ya no la quiere (desmarcó la IA o pulsó Cancelar): se corta la descarga que esté en
// marcha. Antes no había forma: tras «Nueva llamada» seguía bajando gigas sin nada a la vista, aunque
// la casilla estuviera desmarcada. Devuelve si había algo que cortar.
export function cancelarCarga() {
  if (!corte) return false;
  corte.abort(cancelada()); corte = null; return true;
}
export const descargando = () => !!corte;

let ocupado = false, pendiente = null, gen = 0, activa = null;
// estado: {sk, lineas:[{who,text}], lang:'es'|'en', idioma:'español'|…}; alTerminar(resultado)
export function turno(estado, alTerminar) {
  pendiente = { estado, alTerminar };
  if (!ocupado && engine) bucle();
}
// Parar: se tira el turno pendiente y el que está pensando se corta (conversation.cancel() existe en
// la versión fijada, como en Elffuss Claw). Cada turno compara la generación al despertar: si cambió,
// no entrega nada. Antes, tras Parar, la respuesta en curso seguía llegando y cambiaba la ficha.
export function cancelar() {
  gen++; pendiente = null;
  try { activa?.cancel?.(); } catch { /* ya no generaba */ }
}
async function bucle() {
  ocupado = true;
  try {
    while (pendiente && engine) {
      const { estado, alTerminar } = pendiente; pendiente = null;
      const g = gen;
      try { const r = await pensar(estado, g); if (g === gen && r) alTerminar(r); }
      catch (e) { if (g === gen) console.warn('[copiloto IA] turno fallido:', e?.message || e); }
    }
  } finally { ocupado = false; }
}

function sistema(sk, lang, idioma) {
  return lang === 'en'
    ? `You are the copilot for “${sk.nombre}”. You are listening to someone else’s conversation and you HELP the person having it (usually Speaker 1; the customer is usually Speaker 2). NEVER reply as if you were one of the speakers and never continue the dialogue.
ALWAYS answer in exactly three lines, no quotes, nothing else:
${gram.contrato(sk, 'en')}
ACCION is ONE of those words, exactly as written. In ${sk.tag} only what was actually SAID: nothing made up.
Write the CONSEJO in ${idioma}. If there is nothing useful to say: CONSEJO: —`
    : `Eres el copiloto de «${sk.nombre}». Escuchas una conversación ajena y AYUDAS a quien la mantiene (normalmente el Hablante 1; el cliente suele ser el Hablante 2). NUNCA respondas como si fueras un interlocutor ni continúes el diálogo.
Responde SIEMPRE exactamente en tres líneas, sin comillas y sin nada más:
${gram.contrato(sk, 'es')}
ACCION es UNA de esas palabras, tal cual. En ${sk.tag} solo lo que se haya DICHO: nada inventado.
Escribe el CONSEJO en ${idioma}. Si no hay nada útil que decir: CONSEJO: —`;
}

async function pensar({ sk, lineas, lang = 'es', idioma = 'español' }, g = gen) {
  const etiqueta = lang === 'en' ? 'Speaker' : 'Hablante';
  const ventana = lineas.slice(-VENTANA).map(l => `[${etiqueta} ${l.who === 'S1' ? 1 : 2}] ${l.text}`).join('\n');
  const recordatorio = lang === 'en'
    ? `\n\n(Answer ONLY with the three lines: CONSEJO: … / ACCION: … / ${sk.tag}: …)`
    : `\n\n(Responde SOLO con las tres líneas: CONSEJO: … / ACCION: … / ${sk.tag}: …)`;
  const conv = await engine.createConversation({ preface: { messages: [{ role: 'system', content: sistema(sk, lang, idioma) }] } });
  activa = conv;
  try {
    if (g !== gen) return null;
    let out = '';
    for await (const trozo of conv.sendMessageStreaming(ventana + recordatorio)) {
      if (g !== gen) break;                 // Parar: no se lee ni un trozo más
      for (const it of (trozo.content || [])) if (it.type === 'text') out += it.text;
    }
    if (g !== gen) return null;
    const transcript = lineas.map(l => l.text).join('\n');
    return { crudo: out, ...gram.parse(out, sk, { transcript }) };
  } catch (e) {
    if (g !== gen) return null;             // cortado por Parar: no es un fallo
    throw e;
  } finally {
    if (activa === conv) activa = null;
    try { await conv.delete(); } catch { /* ya no estaba */ }
  }
}
