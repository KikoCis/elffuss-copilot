// Parar tiene que dejar la llamada quieta: ni frases nuevas, ni la ficha cambiando, ni la IA.
//   1. Con la IA avanzada pensando: tras Parar, la ficha y la transcripción no cambian y el turno de
//      la IA se corta (conversation.cancel()).
//   2. Con una frase transcribiéndose: tras Parar no aparece.
//   3. Parar a mitad de una frase y empezar otra llamada en seguida: la frase vieja no se cuela en la
//      nueva y nunca hay dos transcripciones a la vez.
//   4. Parar durante la primera descarga de los modelos, con el micro y la grabación ya en marcha:
//      nada tapa Parar, CSV ni Enviar (antes un velo a pantalla completa los tapaba toda la descarga).
//   5. La IA avanzada tras Parar: su descarga se sigue viendo (el chip se congelaba) y Reintentar
//      sigue sirviendo (no hacía nada).
//   6. La IA aún bajando al volver al inicio (Parar → Nueva llamada): se ve con su porcentaje, la nota no
//      dice «Modelos ya descargados», y desmarcar la casilla o «Cancelar la descarga» la cortan de
//      verdad (antes seguía bajando gigas sin nada a la vista, también en una llamada sin la IA).
// Navegador sin cabeza, micro falso y modelos de mentira (tests/browser). Uso: node copilot/tests/stop.mjs
import { launch, newContext, startStatic, checker, sleep, until, ficherosVoz } from '../../tests/browser/harness.mjs';

const { srv, base } = await startStatic();
const browser = await launch();
const C = checker('Copiloto · Parar');
const PAGE = base + '/copilot/?ui=es&lang=es&skill=ficha';
const GiB = 1024 ** 3;

async function open(fake, { gpu = 0, hfStatus = 200, extraInit } = {}) {
  const ctx = await newContext(browser, { base, init: { fake, gpu }, hfStatus });
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(PAGE);
  return { ctx, page, errors };
}
// Pulsa Parar y, en el mismo instante, apunta cómo están la ficha y la transcripción.
const stopAndSnap = page => page.evaluate(() => {
  document.getElementById('stop').click();
  return { board: document.getElementById('board').innerHTML, log: document.getElementById('log').innerText };
});
const now = page => page.evaluate(() => ({
  board: document.getElementById('board').innerHTML, log: document.getElementById('log').innerText,
  status: document.getElementById('status').textContent, stop: !document.getElementById('stop').hidden, newCall: !!document.getElementById('newCall') && !document.getElementById('newCall').hidden,
  llm: window.__llm || null, asr: { calls: window.__fakeStats.asrCalls, max: window.__fakeStats.asrMax, active: window.__fakeStats.asrActive },
}));

// 1 ── IA avanzada pensando
{
  const { ctx, page, errors } = await open({ lines: [{ spk: 1, lang: 'es', text: 'Me llamo Laura Pérez y quiero una reforma de la cocina, frase {n}.' }] }, { gpu: 4 * GiB });
  await page.evaluate(() => { window.__FAKE_LLM_STEP = 350; });
  await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
  await page.check('#iaOpt');
  await page.click('#start');
  const thinking = await until(page, () => window.__llm && window.__llm.active > 0 && window.__llm.chunks > 0, null, { timeout: 20000, what: 'la IA a mitad de un turno' });
  const at = await stopAndSnap(page);
  await sleep(5000);   // la IA habría terminado su turno y habría llegado otra frase
  const s = await now(page);
  C.ok('la IA estaba a mitad de un turno al pulsar Parar', thinking);
  C.ok('la ficha no cambia después de Parar', s.board === at.board);
  C.ok('la transcripción no cambia después de Parar', s.log === at.log, { antes: at.log, despues: s.log });
  C.ok('el turno de la IA se corta (cancel)', s.llm && s.llm.cancels >= 1 && s.llm.active === 0, s.llm);
  C.ok('el estado dice que está parado', /^Parado/.test(s.status), s.status);
  C.ok('Parar se convierte en «Nueva llamada»', !s.stop && s.newCall, s);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 2 ── una frase transcribiéndose
{
  const { ctx, page, errors } = await open({ asrDelay: 2500, lines: [{ spk: 1, lang: 'es', text: 'Trabajo en Construcciones Norte, frase {n}.' }] });
  await page.click('#start');
  const busy = await until(page, () => window.__fakeStats?.asrActive > 0, null, { timeout: 15000, what: 'una frase transcribiéndose' });
  const at = await stopAndSnap(page);
  await page.waitForFunction(() => window.__fakeStats?.asrActive === 0, null, { timeout: 8000 });
  await sleep(4500);
  const s = await now(page);
  C.ok('había una frase transcribiéndose al pulsar Parar', busy);
  C.ok('esa frase no aparece después', s.log === at.log && !/frase 1\./.test(s.log), { antes: at.log, despues: s.log });
  C.ok('la ficha no cambia', s.board === at.board);
  C.ok('no se transcribe nada más', s.asr.calls === 1, s.asr);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 3 ── Parar a mitad de una frase y empezar otra llamada en seguida
{
  const { ctx, page, errors } = await open({ asrDelay: 2500, lines: [{ spk: 1, lang: 'es', text: 'Frase {n} de la llamada.' }] });
  await page.click('#start');
  await until(page, () => window.__fakeStats?.asrActive > 0, null, { timeout: 15000, what: 'una frase transcribiéndose' });
  await page.click('#stop');
  await page.click('#newCall');
  const backHome = await page.evaluate(() => !document.getElementById('setup').hidden && document.getElementById('live').hidden && !document.getElementById('start').disabled);
  await page.click('#start');
  const got = await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 20000, what: 'una frase en la llamada nueva' });
  await sleep(300);
  const s = await now(page);
  C.ok('«Nueva llamada» vuelve al inicio sin recargar', backHome);
  C.ok('la llamada nueva escucha', got, s.log);
  C.ok('la frase de la llamada parada (Frase 1) no se cuela en la nueva', !/Frase 1 /.test(s.log), s.log);
  C.ok('nunca hay dos transcripciones a la vez', s.asr.max === 1, s.asr);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 4 ── Parar durante la primera descarga, con el micro y la grabación ya en marcha
{
  const { ctx, page, errors } = await open({ dlStep: 800, lines: [{ spk: 1, lang: 'es', text: 'Hola, soy Laura, frase {n}.' }] });
  await page.check('#recOpt');
  await page.click('#start');
  const downloading = () => ['dlBar', 'dlProg'].some(id => { const e = document.getElementById(id); return !!e && !e.hidden; });
  const dl = await until(page, downloading, null, { timeout: 15000, what: 'la descarga en marcha' });
  await sleep(1200);   // en plena descarga, con la grabación ya contando
  const r = await page.evaluate(() => {
    const at = id => { const b = document.getElementById(id).getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el && el.closest('#' + id) ? 'ok' : (el ? (el.id || el.className || el.tagName) : 'nada'); };
    return { stop: at('stop'), exp: at('exp'), send: at('send'), mic: window.__streams.flatMap(s => s.getTracks().map(t => t.readyState)), rec: document.getElementById('recChip').textContent };
  });
  const clicked = await page.click('#stop', { timeout: 1500 }).then(() => true, () => false);
  const stillDl = await page.evaluate(downloading);
  await until(page, () => /guardada/.test(document.getElementById('recChip').textContent), null, { timeout: 6000, what: 'la grabación guardada' });
  const after = await page.evaluate(() => ({ mic: window.__streams.flatMap(s => s.getTracks().map(t => t.readyState)), rec: document.getElementById('recChip').textContent, newCall: !document.getElementById('newCall').hidden }));
  C.ok('durante la primera descarga el micro ya está abierto y grabando', dl && r.mic.includes('live') && /grabando/.test(r.rec), r);
  C.ok('…y nada tapa Parar, CSV ni Enviar', r.stop === 'ok' && r.exp === 'ok' && r.send === 'ok', r);
  C.ok('Parar se puede pulsar con la descarga aún en marcha', clicked && stillDl, { clicked, stillDl });
  C.ok('…y apaga el micro y la grabación', after.mic.length > 0 && after.mic.every(x => x === 'ended') && /guardada/.test(after.rec) && after.newCall, after);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 5 ── La IA avanzada tras Parar
{
  // a) Descarga lenta del modelo (un fetch de mentira que entrega el fichero a trozos).
  const slow = () => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith('https://huggingface.co/litert-community/')) return real(input, init);
      let i = 0; const N = 30, SZ = 16384;
      const body = new ReadableStream({ async pull(c) { if (i++ >= N) return c.close(); await new Promise(r => setTimeout(r, 200)); c.enqueue(new Uint8Array(SZ)); } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(N * SZ) } }));
    };
  };
  const { ctx, page, errors } = await open({ lines: [{ spk: 1, lang: 'es', text: 'Me llamo Laura, frase {n}.' }] }, { gpu: 4 * GiB, extraInit: slow });
  await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
  await page.check('#iaOpt');
  await page.click('#start');
  const dl = await until(page, () => /descargando [1-9]\d* %/.test(document.getElementById('iaChip').textContent), null, { timeout: 15000, what: 'la IA bajando' });
  await page.click('#stop');
  const at = await page.textContent('#iaChip');
  const moved = await until(page, t => document.getElementById('iaChip').textContent !== t, at, { timeout: 5000, what: 'el chip avanzando tras Parar' });
  const ready = await until(page, () => /^IA: Gemma/.test(document.getElementById('iaChip').textContent), null, { timeout: 15000, what: 'la IA lista tras Parar' });
  C.ok('la IA estaba bajando al pulsar Parar', dl, at);
  C.ok('tras Parar, la descarga de la IA se sigue viendo (el chip no se congela) y acaba en «lista»', moved && ready, await page.textContent('#iaChip'));
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}
{
  // b) La IA no carga (el Hub contesta 404): tras Parar, Reintentar sigue sirviendo.
  const { ctx, page, errors } = await open({ lines: [{ spk: 1, lang: 'es', text: 'Me llamo Laura, frase {n}.' }] }, { gpu: 4 * GiB, hfStatus: 404 });
  await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
  await page.check('#iaOpt');
  await page.click('#start');
  await until(page, () => !document.getElementById('iaRetry').hidden, null, { timeout: 15000, what: 'Reintentar' });
  await page.click('#stop');
  const visible = await page.evaluate(() => !document.getElementById('iaRetry').hidden);
  await ctx.unroute('**/*').catch(() => {});
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    if (u.startsWith('https://huggingface.co/litert-community/')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '65536', 'Access-Control-Allow-Origin': '*' }, body: Buffer.alloc(65536, 7) });
    return route.abort('blockedbyclient');
  });
  const clicked = await page.click('#iaRetry', { timeout: 3000 }).then(() => true, () => false);
  const ready = await until(page, () => /^IA: Gemma/.test(document.getElementById('iaChip').textContent), null, { timeout: 15000, what: 'la IA lista tras Reintentar' });
  C.ok('tras Parar, Reintentar sigue a la vista y carga la IA (lista para la próxima llamada)', visible && clicked && ready, { visible, clicked, chip: await page.textContent('#iaChip') });
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 6 ── La IA aún bajando al volver al inicio: se ve, y se puede cortar
{
  // Un fetch de mentira que entrega el modelo a trozos lentos y, como el de verdad, deja de entregar y
  // falla si se aborta su señal. Cuenta trozos, peticiones y cortes en window.__ia.
  const slowAbortable = () => {
    const real = window.fetch.bind(window);
    window.__ia = { requests: 0, pulled: 0, aborted: 0 };
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (!url.startsWith('https://huggingface.co/litert-community/')) return real(input, init);
      const signal = init.signal; window.__ia.requests++;
      if (signal?.aborted) return Promise.reject(new DOMException('cortada', 'AbortError'));
      let i = 0; const N = 80, SZ = 16384;
      const body = new ReadableStream({
        start(c) { signal?.addEventListener('abort', () => { window.__ia.aborted++; try { c.error(new DOMException('cortada', 'AbortError')); } catch { /* */ } }); },
        async pull(c) {
          if (i++ >= N) return c.close();
          await new Promise(r => setTimeout(r, 200));
          if (signal?.aborted) return;
          window.__ia.pulled++; c.enqueue(new Uint8Array(SZ));
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(N * SZ) } }));
    };
  };
  // Sin datos en la ficha (Nueva llamada no tiene nada que preguntar).
  const FRASE = [{ spk: 1, lang: 'es', text: 'Frase {n}.' }];
  const WHISPER_GPU = ficherosVoz(true).map(x => x.url);   // toda la voz en GPU
  for (const how of ['desmarcar', 'Cancelar']) {
    const { ctx, page, errors } = await open({ lines: FRASE }, { gpu: 4 * GiB, extraInit: slowAbortable });
    // El modelo de voz ya en la caché: con todo lo demás descargado, la nota decía «Modelos ya descargados».
    await page.evaluate(async us => { const c = await caches.open('transformers-cache'); for (const u of us) await c.put(u, new Response('x')); }, WHISPER_GPU);
    await page.reload();
    await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
    await page.check('#iaOpt');
    await page.click('#start');
    await until(page, () => /descargando [1-9]\d* %/.test(document.getElementById('iaChip').textContent), null, { timeout: 15000, what: 'la IA bajando' });
    await page.click('#stop');
    await page.click('#newCall');
    // La nota se pinta tras mirar la caché (asíncrono): se espera a que diga algo de la voz, como mucho 5 s.
    await until(page, () => !document.getElementById('setup').hidden && /modelo de voz|descargados/.test(document.getElementById('dlNote').textContent), null, { timeout: 5000, what: 'la nota del inicio' });
    await page.waitForTimeout(300);
    // (Con ?. para que, sin la línea ni el Cancelar —como antes—, la prueba falle en vez de romperse.)
    const home = await page.evaluate(() => ({ line: document.getElementById('iaDl')?.hidden === false ? document.getElementById('iaDlMsg').textContent : '', cancel: document.getElementById('iaCancel')?.hidden === false && document.getElementById('iaCancel').textContent, note: document.getElementById('dlNote').textContent, pulled: window.__ia.pulled }));
    await page.waitForTimeout(1200);
    const moving = await page.evaluate(() => ({ line: document.getElementById('iaDlMsg')?.textContent ?? '', pulled: window.__ia.pulled }));
    if (how === 'desmarcar') await page.uncheck('#iaOpt');
    else if (await page.$('#iaCancel')) { await page.focus('#iaCancel'); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(600);
    const cut = await page.evaluate(() => ({ pulled: window.__ia.pulled, aborted: window.__ia.aborted, line: document.getElementById('iaDl')?.hidden === false, checked: document.getElementById('iaOpt').checked, focus: document.activeElement?.id, note: document.getElementById('dlNote').textContent, pref: localStorage.getItem('elffuss_cop_ia') }));
    await page.waitForTimeout(1500);
    const still = await page.evaluate(() => window.__ia.pulled);
    // Una llamada sin la IA: nada vuelve a pedir el modelo.
    await page.click('#start');
    await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 20000, what: 'una frase en la llamada sin IA' });
    const call = await page.evaluate(async () => ({ pulled: window.__ia.pulled, requests: window.__ia.requests, chip: !document.getElementById('iaChip').hidden, cached: (await (await caches.open('elffuss-copiloto-llm-v1')).keys()).length }));
    if (how === 'desmarcar') {
      C.ok('de vuelta al inicio, la descarga de la IA se ve con su porcentaje y un «Cancelar la descarga»', /IA avanzada: descargando \d+ %/.test(home.line) && home.cancel === 'Cancelar la descarga' && moving.pulled > home.pulled && moving.line !== home.line, { home, moving });
      C.ok('…y la nota no dice que ya está todo descargado: dice que la IA aún baja', !/ya descargados/.test(home.note) && /modelo de voz ya está descargado/.test(home.note) && /IA avanzada aún se está descargando/.test(home.note), home.note);
    }
    C.ok(`${how} corta la descarga: se aborta y deja de bajar`, cut.aborted >= 1 && still === cut.pulled, { cut, still });
    C.ok(`${how}: la línea se va, la casilla queda desmarcada y se recuerda`, !cut.line && !cut.checked && cut.pref === 'off', cut);
    if (how === 'Cancelar') C.ok('Cancelar con el teclado deja el foco en la casilla de la IA', cut.focus === 'iaOpt', cut.focus);
    C.ok(`${how}: en la llamada siguiente, sin la IA, nada vuelve a pedirla y no queda nada a medias en la caché`, call.pulled === still && call.requests === 1 && !call.chip && call.cached === 0, call);
    C.ok('sin errores en la página', !errors.length, errors);
    await ctx.close();
  }
}

await browser.close(); srv.close();
process.exit(C.done() ? 1 : 0);
