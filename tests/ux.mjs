// Los arreglos de la auditoría de UX del Copiloto, uno por uno, en un navegador sin cabeza con micro
// falso, modelos de mentira y webhooks locales (tests/browser). Uso: node copilot/tests/ux.mjs
import { launch, newContext, startStatic, startWebhook, checker, sleep, until } from '../../tests/browser/harness.mjs';

const { srv, base } = await startStatic();
const browser = await launch();
const C = checker('Copiloto · UX');
const GiB = 1024 ** 3;
const LAURA = [
  { spk: 1, lang: 'es', text: 'Hola, me llamo Laura Pérez y trabajo en Construcciones Norte.' },
  { spk: 0, lang: 'es', text: 'Encantado, ¿me da un teléfono?' },
  { spk: 1, lang: 'es', text: 'Sí, el seis uno dos tres cuatro cinco seis siete ocho.' },
];

async function open({ query = '?ui=es&lang=es&skill=ficha', fake = { lines: LAURA }, gpu = 0, hfStatus = 200, gform = [], viewport, perms = [], extraInit } = {}) {
  const ctx = await newContext(browser, { base, init: { fake, gpu }, hfStatus, gform, viewport });
  if (perms.length) await ctx.grantPermissions(perms, { origin: base });
  if (extraInit) await ctx.addInitScript(extraInit);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const dialogs = []; page.on('dialog', d => { dialogs.push({ type: d.type(), msg: d.message(), value: d.defaultValue() }); d.accept(); });
  await page.goto(base + '/copilot/' + query);
  return { ctx, page, errors, dialogs };
}
const sendRes = page => page.evaluate(() => { const r = document.getElementById('sendRes'); return { text: r.hidden ? '' : r.textContent, cls: r.className }; });
const lines = page => page.evaluate(() => document.querySelectorAll('#log .tline').length);
// Enviar «no disponible» mientras envía: aria-disabled (con disabled, el foco caía al <body>).
const blocked = (page, id) => page.evaluate(id => document.getElementById(id).getAttribute('aria-disabled') === 'true' || document.getElementById(id).disabled, id);

// ── Micro denegado: Empezar no se queda muerto ──
{
  const { ctx, page, errors, dialogs } = await open();
  await page.evaluate(() => { window.__GUM_DENY = true; });
  await page.click('#start');
  await page.waitForSelector('#startErr:not([hidden])', { timeout: 8000 });
  const r = await page.evaluate(() => ({ err: document.getElementById('startErr').textContent, help: document.querySelector('#startErr a')?.href, disabled: document.getElementById('start').disabled, setup: !document.getElementById('setup').hidden, focus: document.activeElement?.id }));
  await page.evaluate(() => { window.__GUM_DENY = false; });
  await page.click('#start');
  const entered = await page.waitForSelector('#live:not([hidden])', { timeout: 10000 }).then(() => true, () => false);
  const focus = await page.evaluate(() => document.activeElement?.id);
  C.ok('sin micro: el motivo debajo de Empezar, con enlace de ayuda, sin alert', /Sin permiso para el micrófono/.test(r.err) && /support\.google\.com/.test(r.help || '') && !dialogs.length, { r, dialogs });
  C.ok('Empezar vuelve a estar disponible (antes se quedaba desactivado hasta recargar)', !r.disabled && r.setup && r.focus === 'start', r);
  C.ok('al permitirlo, Empezar entra en la llamada sin recargar', entered);
  C.ok('al entrar, el foco va al título de la llamada', focus === 'skName', focus);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Enviar dice lo que pasó de verdad ──
for (const [what, opts, expect] of [
  ['500', { status: 500 }, r => /respondió 500/.test(r.text) && /err/.test(r.cls)],
  ['200 con CORS', { status: 200 }, r => /^Enviado a 127\.0\.0\.1:\d+ ✓$/.test(r.text) && !/err|warn/.test(r.cls)],
  ['sin CORS', { status: 200, cors: false }, r => /sin confirmación del servidor/.test(r.text) && /warn/.test(r.cls)],
]) {
  const hook = await startWebhook(opts);
  const { ctx, page, errors } = await open();
  await page.click('#dest summary');
  await page.fill('#webhook', hook.url + '/secreto-del-cliente');
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
  await page.click('#send');
  await until(page, () => { const r = document.getElementById('sendRes'); return !r.hidden && !/Enviando/.test(r.textContent); }, null, { what: 'resultado del envío' });
  const r = await sendRes(page);
  const n = await lines(page);
  await until(page, k => document.querySelectorAll('#log .tline').length > k, n, { timeout: 12000, what: 'otra frase' });
  const later = await sendRes(page);
  C.ok(`webhook ${what}: el resultado es el de verdad`, expect(r), r);
  C.ok(`webhook ${what}: solo enseña el host, nunca la URL`, !/secreto-del-cliente|\/hook/.test(r.text), r.text);
  C.ok(`webhook ${what}: el resultado sigue ahí tras la siguiente frase`, later.text === r.text, later);
  C.ok(`webhook ${what}: el servidor recibió la ficha`, hook.hits.some(h => h.method === 'POST' && /Laura/.test(h.body)), hook.hits.map(h => h.method));
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close(); hook.srv.close();
}

// ── Un webhook que no contesta: tiempo límite, y «Nueva llamada» suelta el candado ──
// El tiempo límite de la app (15 s) lo fija la prueba con window.__SEND_MS: corto para ver el aviso,
// larguísimo para comprobar que «Nueva llamada» suelta el candado sin depender de él.
{
  const limit = () => { const orig = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = ms => orig(window.__SEND_MS ?? ms); };
  const hang = await startWebhook({ hang: true }), good = await startWebhook({ status: 200 });
  const { ctx, page, errors } = await open({ extraInit: limit });
  await page.click('#dest summary');
  await page.fill('#webhook', hang.url);
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
  await page.evaluate(() => { window.__SEND_MS = 3000; });
  await page.click('#send');
  const during = { res: await page.textContent('#sendRes'), send: await blocked(page, 'send') };
  await page.evaluate(() => document.getElementById('send').click());   // un segundo clic mientras espera no manda otra vez
  await page.waitForTimeout(500);
  const hitsDuring = hang.hits.filter(h => h.method === 'POST').length;
  await until(page, () => /no respondió/.test(document.getElementById('sendRes').textContent), null, { timeout: 15000, what: 'el aviso de que no respondió' });
  const after = { ...await page.evaluate(() => ({ res: document.getElementById('sendRes').textContent, cls: document.getElementById('sendRes').className })), send: await blocked(page, 'send'), send2: await blocked(page, 'send2') };
  // Otra vez al webhook mudo, que ahora espera de sobra, y con el envío pendiente:
  // Parar → Nueva llamada → otro destino → Empezar.
  await page.evaluate(() => { window.__SEND_MS = 600000; });
  await page.click('#send');
  await page.click('#stop'); await page.click('#newCall');
  await page.fill('#webhook', good.url);
  await page.click('#start');
  await page.waitForSelector('#live:not([hidden])');
  await until(page, () => !!document.getElementById('send2'), null, { what: 'la ficha nueva' });
  const fresh = { send: await blocked(page, 'send'), send2: await blocked(page, 'send2') };
  // El envío viejo acaba (el webhook mudo se cierra) con la llamada nueva en marcha: no debe pintar nada.
  hang.srv.closeAllConnections?.(); hang.srv.close();
  await page.waitForTimeout(1500);
  const late = await sendRes(page);
  await page.click('#send');
  await until(page, () => /Enviado/.test(document.getElementById('sendRes').textContent), null, { what: 'enviado al webhook bueno' });
  C.ok('mientras espera, dice «Enviando…» y no deja enviar dos veces', /Enviando/.test(during.res) && during.send && hitsDuring === 1, { during, hitsDuring });
  C.ok('un webhook que no contesta: a su tiempo límite se dice, en rojo, y Enviar vuelve', /127\.0\.0\.1:\d+\) no respondió/.test(after.res) && /err/.test(after.cls) && !after.send && !after.send2, after);
  C.ok('«Nueva llamada» suelta el candado aunque un envío siga esperando', !fresh.send && !fresh.send2, fresh);
  C.ok('…el envío viejo, al acabar, no pinta nada en la llamada nueva', late.text === '', late);
  C.ok('…y el envío siguiente llega', good.hits.some(h => h.method === 'POST'), good.hits.length);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close(); good.srv.close();
}

// ── Un Google Forms que no contesta: el mismo tiempo límite que el webhook ──
// (antes solo lo tenía el webhook: Enviar se quedaba en «Enviando…» el resto de la llamada)
{
  const limit = () => { const orig = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = ms => orig(window.__SEND_MS ?? ms); };
  const { ctx, page, errors } = await open({ extraInit: limit });
  const held = [];
  await ctx.route('https://docs.google.com/forms/**', route => { held.push(route.request().url()); });   // no contesta nunca
  await page.click('#dest summary');
  await page.fill('#gform', 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.111=nombre');
  await page.click('#start');
  await until(page, () => /Laura/.test(document.getElementById('board').textContent), null, { timeout: 15000, what: 'nombre en la ficha' });
  await page.evaluate(() => { window.__SEND_MS = 3000; });
  await page.click('#send');
  const during = { res: await page.textContent('#sendRes'), send: await blocked(page, 'send'), send2: await blocked(page, 'send2') };
  const said = await until(page, () => /Google Forms no respondió/.test(document.getElementById('sendRes').textContent), null, { timeout: 15000, what: 'el aviso de que Forms no respondió' });
  const after = { ...await sendRes(page), send: await blocked(page, 'send'), send2: await blocked(page, 'send2') };
  C.ok('Forms que no contesta: mientras espera, «Enviando…»', /Enviando/.test(during.res) && during.send && during.send2, during);
  C.ok('…a su tiempo límite se dice, en rojo, y los dos Enviar vuelven', held.length === 1 && said && /err/.test(after.cls) && !after.send && !after.send2, { held: held.length, after });
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Google Forms con una skill de objetivos: la vista previa dice lo que de verdad se manda ──
{
  const gform = [];
  // La primera voz que se oye es «Tú» y la segunda el cliente: los objetivos solo leen al cliente.
  const VENTA = [{ spk: 0, lang: 'es', text: 'Buenos días, ¿con quién hablo?' }, { spk: 1, lang: 'es', text: 'Hola, me llamo Laura Pérez.' }];
  const { ctx, page, errors } = await open({ query: '?ui=es&lang=es&skill=ventas', gform, fake: { lines: VENTA } });
  await page.click('#dest summary');
  await page.fill('#gform', 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.111=nombre&entry.333=email&entry.555=empresa');
  const map = await page.textContent('#gformMap');
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#board .slot.done').length >= 1, null, { timeout: 20000, what: 'el nombre en los objetivos' });
  await page.click('#send');
  await until(page, () => /Google Forms/.test(document.getElementById('sendRes').textContent) && !/Enviando/.test(document.getElementById('sendRes').textContent), null, { what: 'enviado a Forms' });
  const body = gform.map(g => decodeURIComponent(g.body)).join(' | ');
  C.ok('la vista previa solo promete lo que esta skill rellena y dice lo que no', /Se rellenarán: entry\.111 → El cliente da su nombre\./.test(map) && /No se rellenan con esta skill: entry\.333 \(email\), entry\.555 \(empresa\)/.test(map) && !/entry\.333 →|entry\.555 →/.test(map), map);
  C.ok('…y se manda justo eso', /entry\.111=sí/.test(body) && !/entry\.333|entry\.555/.test(body), body);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Micro que no está o que está ocupado: se dice eso, no que falta el permiso ──
for (const [name, re] of [['NotFoundError', /No encuentro ningún micrófono/], ['NotReadableError', /lo esté usando otra aplicación/]]) {
  const { ctx, page, errors } = await open();
  await page.evaluate(n => { window.__GUM_ERR = n; }, name);
  await page.click('#start');
  await page.waitForSelector('#startErr:not([hidden])', { timeout: 8000 });
  const r = await page.evaluate(() => ({ err: document.getElementById('startErr').textContent, start: !document.getElementById('start').disabled }));
  C.ok(`micro con ${name}: el motivo de verdad, no el permiso`, re.test(r.err) && !/permiso/i.test(r.err) && r.start, r);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Enviar sin destino: el destino se edita ahí mismo, durante la llamada ──
{
  const hook = await startWebhook({ status: 200 });
  const { ctx, page, errors } = await open();
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
  const label = await page.textContent('#send2');
  await page.click('#send2');
  const r = await page.evaluate(() => ({ res: document.getElementById('sendRes').textContent, open: !document.getElementById('destLive').hidden && document.getElementById('dest').open, inLive: !!document.querySelector('#destLive #dest'), focus: document.activeElement?.id }));
  await page.fill('#webhook', hook.url);
  const label2 = await page.textContent('#send2');
  await page.click('#send');
  await until(page, () => /Enviado/.test(document.getElementById('sendRes').textContent), null, { what: 'enviado' });
  const sent = await sendRes(page);
  C.ok('el botón de la ficha avisa de que falta el destino', /configura destino/.test(label), label);
  C.ok('sin destino, se dice y se abre el destino bajo la barra, con el foco en el webhook', /Falta el destino/.test(r.res) && r.open && r.inLive && r.focus === 'webhook', r);
  C.ok('al escribirlo, el aviso del botón desaparece', !/configura destino/.test(label2), label2);
  C.ok('y Enviar ya llega', /Enviado a 127\.0\.0\.1/.test(sent.text) && hook.hits.length > 0, sent);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close(); hook.srv.close();
}

// ── Google Forms: vista previa del mapeo y nada de «✓» con el cuerpo vacío ──
{
  const gform = [];
  const { ctx, page, errors } = await open({ gform });
  await page.click('#dest summary');
  await page.fill('#gform', 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url');
  const none = await page.evaluate(() => ({ text: document.getElementById('gformMap').textContent, cls: document.getElementById('gformMap').className }));
  await page.fill('#gform', 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.111=nombre&entry.222=telefono&entry.333=email&entry.444=empresa');
  const map = await page.textContent('#gformMap');
  await page.fill('#gform', 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url');
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase' });
  await page.click('#send');
  await until(page, () => !/Enviando/.test(document.getElementById('sendRes').textContent) && !document.getElementById('sendRes').hidden, null, { what: 'resultado' });
  const bad = await sendRes(page);
  await page.evaluate(() => { document.getElementById('gform').value = 'https://docs.google.com/forms/d/e/abc/viewform?usp=pp_url&entry.111=nombre&entry.222=telefono&entry.444=empresa'; });
  await until(page, () => /Laura/.test(document.getElementById('board').textContent), null, { what: 'nombre en la ficha' });
  await page.click('#send');
  await until(page, () => /Google Forms/.test(document.getElementById('sendRes').textContent) && !/Enviando/.test(document.getElementById('sendRes').textContent), null, { what: 'enviado a Forms' });
  const ok = await sendRes(page);
  C.ok('un enlace sin campos avisa al escribirlo', /no tiene campos/.test(none.text) && /warn/.test(none.cls), none);
  C.ok('con campos, enseña qué campo recibe qué dato', /entry\.111 → Nombre/.test(map) && /entry\.222 → Teléfono/.test(map) && /entry\.444 → Empresa/.test(map), map);
  C.ok('sin campos, Enviar no dice «✓»: dice que no se envió', /no se envió/.test(bad.text) && /err/.test(bad.cls) && !/✓/.test(bad.text), bad);
  C.ok('con campos, se envía y se dice que no hay confirmación posible', /Google Forms, sin confirmación/.test(ok.text) && gform.some(g => /entry\.111=Laura/.test(g.body)), { ok, gform });
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Parar → Nueva llamada, sin recargar ──
{
  const { ctx, page, errors, dialogs } = await open();
  await page.click('#start');
  await until(page, () => document.querySelectorAll('#log .tline').length >= 2, null, { timeout: 20000, what: 'dos frases' });
  await page.click('#stop');
  const stopped = await page.evaluate(() => ({ stop: !document.getElementById('stop').hidden, nc: !document.getElementById('newCall').hidden, focus: document.activeElement?.id, csv: !document.getElementById('exp').disabled, status: document.getElementById('status').textContent }));
  await page.click('#newCall');   // la ficha (Laura, Construcciones Norte) no se envió ni se descargó: pregunta, y se acepta
  const home = await page.evaluate(() => ({ setup: !document.getElementById('setup').hidden, ui: !document.getElementById('uiToggle').hidden, focus: document.activeElement?.id, log: document.querySelectorAll('#log .tline').length, board: document.getElementById('board').children.length }));
  await page.click('#start');
  const again = await until(page, () => document.querySelectorAll('#log .tline').length >= 1, null, { timeout: 15000, what: 'una frase en la segunda llamada' });
  C.ok('tras Parar: «Nueva llamada» en su sitio y el foco en CSV (no en «Nueva llamada»), que sigue disponible', !stopped.stop && stopped.nc && stopped.focus === 'exp' && stopped.csv, stopped);
  C.ok('el estado ya no pide recargar', !/Recarga/.test(stopped.status) && /Parado/.test(stopped.status), stopped.status);
  C.ok('«Nueva llamada» con la ficha sin guardar pregunta antes de borrarla', dialogs.some(d => d.type === 'confirm' && /no se ha enviado ni descargado/.test(d.msg)), dialogs);
  C.ok('«Nueva llamada» vuelve al inicio limpio, con el foco en Empezar', home.setup && home.ui && home.focus === 'start' && home.log === 0 && home.board === 0, home);
  C.ok('y la segunda llamada funciona', again);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Cerrar o recargar pide confirmación durante la llamada y con una ficha sin guardar ──
{
  const { ctx, page, errors } = await open();
  const unload = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  const setup = await unload();
  await page.click('#start');
  await until(page, () => /Laura/.test(document.getElementById('board').textContent), null, { timeout: 15000, what: 'la ficha con datos' });
  const live = await unload();
  await page.click('#stop');
  const stopped = await unload();
  await page.click('#exp');   // descargar el CSV la deja guardada
  const saved = await unload();
  C.ok('en el inicio no pide nada', !setup);
  C.ok('durante la llamada, cerrar o recargar pide confirmación', live);
  C.ok('tras Parar, con la ficha sin enviar ni descargar, también', stopped);
  C.ok('ya descargada en CSV, no', !saved);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Skills, URL y enlace para el equipo ──
{
  const { ctx, page, errors } = await open({ query: '?ui=es', perms: ['clipboard-read', 'clipboard-write'] });
  await page.focus('[data-skill="ventas"]');
  await page.keyboard.press('Enter');
  const r = await page.evaluate(() => ({ focus: document.activeElement?.dataset?.skill, pressed: [...document.querySelectorAll('#skGrid button')].map(b => b.dataset.skill + ':' + b.getAttribute('aria-pressed')).join(' '), url: location.search }));
  await page.selectOption('#lang', 'en');
  const url2 = await page.evaluate(() => location.search);
  await page.click('#dest summary');
  await page.fill('#webhook', 'https://crm.example/hook/SECRETO');
  await page.click('#teamLink');
  await until(page, () => /Copiado/.test(document.getElementById('teamLinkRes').textContent), null, { what: 'copiado' });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const u = new URL(link);
  C.ok('elegir con el teclado deja el foco en la tarjeta elegida', r.focus === 'ventas', r);
  C.ok('aria-pressed dice cuál está elegida', r.pressed === 'ficha:false ventas:true facilitador:false', r.pressed);
  C.ok('la URL dice la skill (y la interfaz)', /skill=ventas/.test(r.url) && /ui=es/.test(r.url), r.url);
  C.ok('y el idioma de la conversación', /lang=en/.test(url2), url2);
  C.ok('el enlace del equipo lleva skill, idioma y destino tras la «#», no en la consulta', !u.search && /skill=ventas/.test(u.hash) && /lang=en/.test(u.hash) && /webhook=https/.test(u.hash), link);
  // Abrir ese enlace: llega configurado y el destino no se queda en la barra de direcciones.
  const p2 = await ctx.newPage();
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, base));
  const opened = await p2.evaluate(() => ({ webhook: document.getElementById('webhook').value, open: document.getElementById('dest').open, from: !document.getElementById('fromLink').hidden, skill: document.querySelector('#skGrid [aria-pressed="true"]')?.dataset.skill, lang: document.getElementById('lang').value, href: location.href }));
  C.ok('al abrirlo: destino puesto y avisado («configurado desde un enlace»), misma skill e idioma', opened.webhook === 'https://crm.example/hook/SECRETO' && opened.open && opened.from && opened.skill === 'ventas' && opened.lang === 'en', opened);
  C.ok('…y el webhook desaparece de la barra de direcciones', !/SECRETO|webhook/.test(opened.href), opened.href);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── IA avanzada: opcional, con el motivo y Reintentar si falla ──
{
  const { ctx, page, errors } = await open({ gpu: 4 * GiB, hfStatus: 404 });
  await until(page, () => !document.getElementById('iaOpt').disabled, null, { what: 'IA disponible' });
  const opt = await page.evaluate(() => ({ checked: document.getElementById('iaOpt').checked, link: document.querySelector('#iaLbl a')?.href, label: document.getElementById('iaLbl').textContent }));
  await page.check('#iaOpt');
  await page.click('#start');
  await until(page, () => !document.getElementById('iaRetry').hidden, null, { timeout: 15000, what: 'Reintentar' });
  const fail = await page.evaluate(() => ({ chip: document.getElementById('iaChip').textContent, title: document.getElementById('iaChip').title }));
  // El modelo vuelve a estar disponible: Reintentar lo carga sin parar la llamada.
  await ctx.unroute('**/*').catch(() => {});
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    if (u.startsWith('https://huggingface.co/litert-community/')) return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '65536', 'Access-Control-Allow-Origin': '*' }, body: Buffer.alloc(65536, 7) });
    return route.abort('blockedbyclient');
  });
  await page.click('#iaRetry');
  const ready = await until(page, () => /^IA: Gemma/.test(document.getElementById('iaChip').textContent), null, { timeout: 15000, what: 'IA lista' });
  C.ok('la IA avanzada viene desmarcada (2,8 GB se eligen, no se esquivan)', opt.checked === false, opt);
  C.ok('el nombre del modelo enlaza a su ficha en Hugging Face', /huggingface\.co\/litert-community\/gemma-4-E4B-it-litert-lm$/.test(opt.link || ''), opt.link);
  C.ok('si falla: el chip lo dice, el título da el motivo y aparece Reintentar', /no disponible/.test(fail.chip) && /404/.test(fail.title), fail);
  C.ok('Reintentar la carga sin salir de la llamada', ready);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Descarga: una sola barra para los dos modelos, que no tapa nada, y un porcentaje que no retrocede ──
{
  const { ctx, page, errors } = await open({ fake: { lines: LAURA, dlStep: 120 } });
  await page.evaluate(() => {
    window.__ov = []; const p = document.getElementById('dlBar'), pr = document.getElementById('dlProgress');
    const rec = () => window.__ov.push({ hidden: p.hidden, pct: +pr.getAttribute('aria-valuenow') });
    new MutationObserver(rec).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(rec).observe(pr, { attributes: true, attributeFilter: ['aria-valuenow'] });
  });
  await page.click('#start');
  await until(page, () => window.__ov.length > 2 && document.getElementById('dlBar').hidden, null, { timeout: 20000, what: 'fin de la descarga' });
  const ov = await page.evaluate(() => window.__ov);
  const shows = ov.filter((x, i) => i > 0 && !x.hidden && ov[i - 1].hidden).length + (ov[0] && !ov[0].hidden ? 1 : 0);
  const pcts = ov.filter(x => !x.hidden).map(x => x.pct);
  const a11y = await page.evaluate(() => { const pr = document.getElementById('dlProgress'), bar = document.getElementById('dlBar'); return { role: pr.getAttribute('role'), label: document.getElementById(pr.getAttribute('aria-labelledby'))?.textContent, live: !!bar.closest('[aria-live],[role=status],[role=alert]'), inTop: !!bar.closest('.livetop') }; });
  C.ok('la barra de descarga se abre una vez y se cierra al acabar los dos', shows === 1 && ov.at(-1).hidden, ov.map(x => (x.hidden ? 'oculta' : x.pct)).join(' '));
  C.ok('el porcentaje nunca retrocede', pcts.length > 2 && pcts.every((v, i) => i === 0 || v >= pcts[i - 1]), pcts);
  C.ok('es una barra de progreso con nombre, en la barra de arriba y fuera de las regiones que se leen solas', a11y.role === 'progressbar' && /Descargando/.test(a11y.label || '') && !a11y.live && a11y.inTop, a11y);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Escritorio bajo: la tarjeta de inicio se ve entera desde arriba ──
for (const vp of [{ width: 1280, height: 860 }, { width: 1366, height: 700 }]) {
  const { ctx, page, errors } = await open({ viewport: vp });
  const r = await page.evaluate(() => { const s = document.getElementById('setup'); s.scrollTop = 0; const c = document.querySelector('.setupcard').getBoundingClientRect(); return { cut: Math.round(s.getBoundingClientRect().top - c.top) }; });
  C.ok(`${vp.width}×${vp.height}: no se corta el principio de la tarjeta`, r.cut <= 0, r);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Chip 💾, cabecera y pie ──
{
  const { ctx, page, errors, dialogs } = await open();
  await page.evaluate(async () => { const c = await caches.open('transformers-cache'); await c.put('https://huggingface.co/x', new Response('x'.repeat(8e6))); });
  await page.reload();
  await until(page, () => { const c = document.getElementById('diskChip'); return c && !c.hidden; }, null, { what: 'chip de disco' });
  const label = await page.getAttribute('#diskChip', 'aria-label');
  await page.click('#diskChip');
  await until(page, () => /Borrado/.test(document.getElementById('diskChip').textContent), null, { what: '✓ Borrado' });
  await page.waitForFunction(() => document.getElementById('diskChip').hidden, null, { timeout: 6000 }).catch(() => {});
  const gone = await page.evaluate(async () => ({ hidden: document.getElementById('diskChip').hidden, keys: (await caches.keys()).length }));
  const links = await page.$$eval('a[href]', as => as.map(a => a.href));
  const targets = await page.$$eval('a[href^="https://copilot.elffuss.com/blog/"], a[href^="https://translator.elffuss.com/"], a[href^="https://claw.elffuss.com/"]', as => as.map(a => a.target));
  const need = ['https://copilot.elffuss.com/blog/', 'https://translator.elffuss.com/', 'https://claw.elffuss.com/', 'https://huggingface.co/onnx-community/whisper-base',
    'https://huggingface.co/onnx-community/pyannote-segmentation-3.0', 'https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM', 'https://creativecommons.org/licenses/by/4.0/'];
  C.ok('el chip tiene nombre accesible con el tamaño', /^Modelos guardados: \d+ MB\. Pulsa para vaciar$/.test(label || ''), label);
  C.ok('tras vaciar dice «✓ Borrado» y se esconde (no repite el tamaño viejo)', gone.hidden && gone.keys === 0 && dialogs.length === 1, { gone, dialogs });
  C.ok('cabecera y pie enlazan el blog, el Traductor, Claw y los repositorios ONNX exactos', need.every(u => links.includes(u)), need.filter(u => !links.includes(u)));
  C.ok('el blog, el Traductor y Claw abren en otra pestaña (un clic ya no corta la llamada)', targets.length >= 5 && targets.every(x => x === '_blank'), targets);
  C.ok('sin errores en la página', !errors.length, errors);
  await ctx.close();
}

// ── Lo que se dice durante la primera descarga se transcribe al terminar, también pasadas 30 frases ──
// (antes la cola se quedaba con las 30 últimas y tiraba las primeras, las presentaciones, sin avisar)
// Un micro falso con un tono más corto (una frase cada 1,45 s) para que caigan bastantes más de 30 en una
// descarga de mentira de algo más de un minuto, y un espía que corta las frases con la misma regla que
// la página.
{
  const spy = () => {
    window.__segs = 0;
    const orig = AudioContext.prototype.createScriptProcessor;
    AudioContext.prototype.createScriptProcessor = function (...a) {
      const p = orig.apply(this, a); let fn = null, voiced = false, sil = 0, len = 0; const SR = this.sampleRate;
      p.addEventListener('audioprocess', e => {
        if (!fn) return;
        const d = e.inputBuffer.getChannelData(0); let s = 0; for (const x of d) s += x * x; const r = Math.sqrt(s / d.length);
        if (r > 0.015) { voiced = true; sil = 0; len += d.length; } else if (voiced) { sil += d.length; if (sil > SR * 0.7) { if (len > SR * 0.4) window.__segs++; voiced = false; sil = 0; len = 0; } }
        fn.call(p, e);
      });
      Object.defineProperty(p, 'onaudioprocess', { configurable: true, get: () => fn, set: v => { fn = v; } });
      return p;
    };
  };
  const fast = await launch({ tone: { on: 0.6, off: 0.85 } });
  const call = async (fake, extraInit) => {
    const ctx = await newContext(fast, { base, init: { fake } });
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.addInitScript(spy);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(base + '/copilot/?ui=es&lang=es&skill=ficha');
    await page.click('#start');
    await until(page, () => !document.getElementById('dlBar').hidden, null, { timeout: 10000, what: 'la barra de descarga' });
    return { ctx, page, errors };
  };
  const FRASE = [{ spk: 1, lang: 'es', text: 'Frase {n}.' }];
  // Lo cortado que aún no se ha transcrito: con todo transcrito es 0 (o 1 recién cortada).
  const pending = page => page.evaluate(() => window.__segs - window.__fakeStats.asrCalls);
  {
    const { ctx, page, errors } = await call({ lines: FRASE, dlStep: 11000 });
    const promise = await page.textContent('#status');
    // Los modelos están cuando se transcribe la primera frase (la barra no sirve de señal: con más de
    // 8 s entre aviso y aviso de progreso, su red de seguridad la esconde aunque siga bajando).
    await until(page, () => window.__fakeStats.asrCalls > 0, null, { timeout: 120000, what: 'los modelos listos (primera transcripción)' });
    const cut = await page.evaluate(() => window.__segs);
    const caughtUp = await until(page, () => window.__segs - window.__fakeStats.asrCalls <= 1, null, { timeout: 30000, what: 'todo lo dicho, transcrito' });
    const left = await pending(page);
    C.ok('durante la primera descarga, el estado promete transcribir lo que se diga, con su límite', /lo que digas ahora \(hasta 5 minutos\) se transcribe al terminar/.test(promise), promise);
    // Con el tope viejo (30 en cola y 1 en marcha) se perderían al menos 5: la prueba distingue de sobra.
    C.ok(`bastantes más de 30 frases dichas durante la descarga (${cut})`, cut >= 36, cut);
    C.ok('…y al terminar se transcriben todas: no se tira ninguna', caughtUp && left <= 1, { cut, left });
    C.ok('sin errores en la página', !errors.length, errors);
    await ctx.close();
  }
  {
    // Si se llena (aquí con un tope de 4 s de voz, para no esperar 5 minutos), se dice cuántas no caben,
    // y lo que dice es justo lo que falta al final.
    const { ctx, page, errors } = await call({ lines: FRASE, dlStep: 3000 }, () => { window.__COPILOTO_COLA_CARGA_S = 4; });
    const full = await until(page, () => /no cabe más/.test(document.getElementById('status').textContent), null, { timeout: 30000, what: 'el aviso de cola llena' });
    await until(page, () => document.getElementById('dlBar').hidden, null, { timeout: 60000, what: 'el final de la descarga' });
    const lost = await page.evaluate(() => Math.max(0, ...window.__status.map(s => +((/Frases que no se transcribirán: (\d+)/.exec(s.text) || [])[1] || 0))));
    const settled = await until(page, k => { const d = window.__segs - window.__fakeStats.asrCalls; return d >= k && d <= k + 1; }, lost, { timeout: 30000, what: 'la cola guardada, transcrita' });
    const left = await pending(page);
    const st = (await page.evaluate(() => window.__status.map(s => s.text))).find(t => /no cabe más/.test(t)) || '';
    C.ok('si no cabe más, el estado lo dice y cuántas frases no se transcribirán', full && lost >= 1 && /ya hay 5 minutos de voz esperando y no cabe más\. Frases que no se transcribirán: \d+\./.test(st), st);
    C.ok('…y es verdad: al final faltan justo esas', settled && left >= lost && left <= lost + 1, { lost, left });
    C.ok('sin errores en la página', !errors.length, errors);
    await ctx.close();
  }
  await fast.close();
}

await browser.close(); srv.close();
process.exit(C.done() ? 1 : 0);
