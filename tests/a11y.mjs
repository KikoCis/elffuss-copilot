// Teclado, foco y lector de pantalla en el Copiloto (lo que encontró la revisión tras la auditoría).
//   1. El contador de la grabación no es una región viva (el lector lo leía cada segundo): se anuncia
//      una vez al empezar y otra al guardar.
//   2. Con el foco en «Enviar» de la ficha, una frase nueva no lo tira al <body> (la ficha se rehacía
//      entera con cada frase).
//   3. Borrar los modelos, con el botón del inicio o con el chip 💾, no tira el foco al <body>.
//   4. «Enviar» (arriba y en la ficha) con el teclado: el foco se queda en el botón mientras envía y
//      después, y un segundo Intro no manda otra vez (antes se desactivaba y el foco caía al <body>).
//   5. «Reintentar la IA avanzada» con el teclado: el foco pasa al chip de la IA y cómo acaba se anuncia.
//   6. Parar con el teclado deja el foco en CSV, no en «Nueva llamada»; y «Nueva llamada» con una ficha
//      sin enviar ni descargar pregunta antes de borrarla.
// Navegador sin cabeza, micro falso y modelos de mentira (tests/browser). Uso: node copilot/tests/a11y.mjs
import { launch, newContext, startStatic, startWebhook, checker, until } from '../../tests/browser/harness.mjs';

const { srv, base } = await startStatic();
const browser = await launch();
const C = checker('Copiloto · teclado y lector de pantalla');
const PAGE = base + '/copilot/?ui=es&lang=es&skill=ficha';
const LAURA = [
  { spk: 1, lang: 'es', text: 'Hola, me llamo Laura Pérez y trabajo en Construcciones Norte.' },
  { spk: 0, lang: 'es', text: 'Encantado, ¿me da un teléfono?' },
  { spk: 1, lang: 'es', text: 'Sí, el seis uno dos tres cuatro cinco seis siete ocho.' },
];

async function open(fake = { lines: LAURA }, { gpu = 0, hfStatus = 200 } = {}) {
  const ctx = await newContext(browser, { base, init: { fake, gpu }, hfStatus });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // Los diálogos se aceptan, salvo mientras la prueba ponga page.__dismiss.
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); if (page.__dismiss) d.dismiss(); else d.accept(); });
  await page.goto(PAGE);
  return { ctx, page, errors, dialogs };
}
const focused = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

// 1 ── La grabación se anuncia al empezar y al guardar; el contador no
{
  const { ctx, page, errors } = await open();
  await page.evaluate(() => {
    window.__live = [];
    for (const el of document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]')) {
      if (el.id === 'status') continue;   // el estado de cada frase sí debe leerse
      new MutationObserver(() => { if (el.textContent.trim()) window.__live.push(el.id + ': ' + el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
  await page.check('#recOpt');
  await page.click('#start');
  await page.waitForTimeout(4500);   // unos cuantos segundos del contador
  const during = await page.evaluate(() => ({ live: window.__live.slice(), chipLive: !!document.getElementById('recChip').closest('[aria-live],[role=status],[role=alert],[role=log]'), chip: document.getElementById('recChip').textContent }));
  await page.click('#stop');
  await until(page, () => /guardada/.test(document.getElementById('recChip').textContent), null, { timeout: 6000, what: 'la grabación guardada' });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__live.slice());
  C.ok('el contador de la grabación no está en una región que se lee sola', !during.chipLive && /grabando 00:0\d/.test(during.chip), during);
  C.ok('al empezar se anuncia una vez que graba, sin el contador', during.live.filter(x => /Grabando la llamada/.test(x)).length === 1 && !during.live.some(x => /\d\d:\d\d/.test(x)), during.live);
  C.ok('al parar se anuncia que se guardó', after.some(x => /grabación guardada/.test(x)), after);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 2 ── «Enviar» de la ficha conserva el foco cuando llega otra frase
{
  const { ctx, page, errors } = await open();
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
  await page.focus('#send2');
  const n = await page.evaluate(() => document.querySelectorAll('#log .tline').length);
  const more = await until(page, k => document.querySelectorAll('#log .tline').length > k, n, { timeout: 12000, what: 'otra frase' });
  await page.waitForTimeout(200);
  const f = await focused(page);
  C.ok('con el foco en «Enviar» de la ficha, una frase nueva no lo mueve', more && f === 'send2', f);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 3 ── Borrar los modelos no tira el foco al <body>
{
  const { ctx, page, errors } = await open();
  const fill = () => page.evaluate(async () => { const c = await caches.open('transformers-cache'); await c.put('https://huggingface.co/x', new Response('x'.repeat(8e6))); });
  await fill();
  await page.reload();
  await until(page, () => !document.getElementById('clearCache').hidden, null, { what: 'el botón de borrar' });
  await page.focus('#clearCache');
  await page.keyboard.press('Enter');
  await until(page, () => /Borrando|borrados/.test(document.getElementById('clearCache').textContent), null, { what: 'borrando' });
  const during = await focused(page);
  await page.waitForFunction(() => document.getElementById('clearCache').hidden, null, { timeout: 8000 }).catch(() => {});
  const after = { hidden: await page.evaluate(() => document.getElementById('clearCache').hidden), focus: await focused(page) };
  C.ok('botón del inicio: mientras borra, el foco sigue en él', during === 'clearCache', during);
  C.ok('…y al esconderse pasa a Empezar', after.hidden && after.focus === 'start', after);
  await fill();
  await page.reload();
  await until(page, () => { const c = document.getElementById('diskChip'); return c && !c.hidden; }, null, { what: 'el chip de disco' });
  await page.focus('#diskChip');
  await page.keyboard.press('Enter');
  await until(page, () => /…|Borrado/.test(document.getElementById('diskChip').textContent), null, { what: 'borrando' });
  const chipDuring = await focused(page);
  await page.waitForFunction(() => document.getElementById('diskChip').hidden, null, { timeout: 8000 }).catch(() => {});
  const chipAfter = { hidden: await page.evaluate(() => document.getElementById('diskChip').hidden), focus: await focused(page) };
  C.ok('chip 💾: mientras borra, el foco sigue en él', chipDuring === 'diskChip', chipDuring);
  C.ok('…y al esconderse pasa a Empezar', chipAfter.hidden && chipAfter.focus === 'start', chipAfter);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 4 ── «Enviar» con el teclado, con un webhook que tarda en contestar
{
  const hook = await startWebhook({ status: 200, delay: 1500 });
  for (const id of ['send', 'send2']) {
    const { ctx, page, errors } = await open();
    await page.evaluate(u => { document.getElementById('dest').open = true; const w = document.getElementById('webhook'); w.value = u; w.dispatchEvent(new Event('input')); }, hook.url);
    await page.click('#start');
    await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
    const posts = () => hook.hits.filter(h => h.method === 'POST').length;
    const n0 = posts();
    await page.focus('#' + id);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const during = { focus: await focused(page), res: await page.textContent('#sendRes'), aria: await page.getAttribute('#' + id, 'aria-disabled') };
    await page.keyboard.press('Enter');   // otra vez mientras envía: no manda nada
    await until(page, () => /✓/.test(document.getElementById('sendRes').textContent), null, { timeout: 8000, what: 'el resultado del envío' });
    const after = { focus: await focused(page), aria: await page.getAttribute('#' + id, 'aria-disabled'), posts: posts() - n0 };
    C.ok(`«Enviar» (${id}) con el teclado: mientras envía, el foco sigue en él y dice que no está disponible`, during.focus === id && /Enviando/.test(during.res) && during.aria === 'true', during);
    C.ok(`…al acabar sigue ahí, vuelve a estar disponible y el segundo Intro no mandó otra vez`, after.focus === id && after.aria === null && after.posts === 1, after);
    C.ok('sin errores en la página', !errors.length, errors);
    await ctx.close();
  }
  hook.srv.close();
}

// 5 ── «Reintentar la IA avanzada» con el teclado (la IA no carga: el Hub contesta 404)
{
  const GiB = 1024 ** 3;
  const { ctx, page, errors } = await open({ lines: LAURA }, { gpu: 4 * GiB, hfStatus: 404 });
  await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
  await page.check('#iaOpt');
  await page.click('#start');
  await until(page, () => !document.getElementById('iaRetry').hidden, null, { timeout: 15000, what: 'Reintentar' });
  await page.evaluate(() => { window.__ann = []; const n = document.getElementById('srNote'); new MutationObserver(() => { if (n.textContent) window.__ann.push(n.textContent); }).observe(n, { childList: true, characterData: true, subtree: true }); });
  const name = await page.evaluate(() => { const b = document.getElementById('iaRetry'); return { text: b.textContent, label: b.getAttribute('aria-label') }; });
  await page.focus('#iaRetry');
  await page.keyboard.press('Enter');
  const right = await focused(page);
  await until(page, () => !document.getElementById('iaRetry').hidden, null, { timeout: 15000, what: 'Reintentar otra vez (vuelve a fallar)' });
  await page.waitForTimeout(300);
  const after = { focus: await focused(page), ann: await page.evaluate(() => window.__ann.slice()) };
  C.ok('el botón dice qué reintenta («Reintentar la IA avanzada»)', name.text === 'Reintentar' && name.label === 'Reintentar la IA avanzada', name);
  C.ok('al pulsarlo con el teclado, el foco pasa al chip de la IA (no al <body>) y ahí sigue', right === 'iaChip' && after.focus === 'iaChip', { right, after: after.focus });
  C.ok('…y cómo acaba se anuncia (otra vez no carga, y por qué)', after.ann.some(t => /No se pudo cargar la IA \(descarga 404\)/.test(t)), after.ann);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// 6 ── Parar con el teclado, y «Nueva llamada» con una ficha sin guardar
{
  const { ctx, page, errors, dialogs } = await open();
  await page.click('#start');
  await until(page, () => /Laura/.test(document.getElementById('board').textContent), null, { timeout: 15000, what: 'la ficha con datos' });
  await page.focus('#stop');
  await page.keyboard.press('Enter');
  const afterStop = await focused(page);
  await page.focus('#newCall');
  page.__dismiss = true;
  await page.keyboard.press('Enter');   // pregunta, y se dice que no
  await page.waitForTimeout(300);
  const kept = { ...await page.evaluate(() => ({ live: !document.getElementById('live').hidden, board: /Laura/.test(document.getElementById('board').textContent) })), asked: dialogs.length };
  page.__dismiss = false;
  await page.keyboard.press('Enter');   // pregunta, y se dice que sí
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => ({ setup: !document.getElementById('setup').hidden, board: document.getElementById('board').textContent.trim() }));
  C.ok('Parar con el teclado deja el foco en CSV, no en «Nueva llamada»', afterStop === 'exp', afterStop);
  C.ok('«Nueva llamada» con la ficha sin guardar pregunta; si se dice que no, la llamada y la ficha siguen', kept.asked === 1 && /no se ha enviado ni descargado/.test(dialogs[0]) && kept.live && kept.board, { dialogs, kept });
  C.ok('…y si se dice que sí, vuelve al inicio con la ficha borrada', dialogs.length === 2 && gone.setup && gone.board === '', { dialogs, gone });
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

await browser.close(); srv.close();
process.exit(C.done() ? 1 : 0);
