// Guardia de la HISTORIA DE CAPTURA del Copiloto.
//
// La promesa del producto es que el copiloto dice ANTES de empezar lo que va a
// poder oír. Capturar el audio de la videollamada (getDisplayMedia con pista de
// audio) solo existe en Chromium de ESCRITORIO: Firefox y Safari comparten
// pantalla sin audio, y en móvil no hay vía. Si esta detección se rompe, el
// copiloto vuelve a prometer algo que no cumple y el fallo se descubre en mitad
// de una llamada real.
//
//   node copilot/tests/capability.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const src = (html.match(/const CAP = \(\(\) => \{[\s\S]*?\}\)\(\);/) || [])[0];
if (!src) { console.error('❌ No encuentro el bloque CAP en index.html'); process.exit(1); }

// `navigator` es global en Node ≥21 y no se puede reasignar: se SOMBREA como
// parámetro para que el bloque real vea el navegador falso de cada caso.
const probe = new Function('navigator', src + '\nreturn CAP;');
const nav = (ua, uad, display) => ({
  userAgent: ua,
  userAgentData: uad || undefined,
  mediaDevices: display ? { getDisplayMedia() {} } : {},
});

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  safariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
  operaMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
};
const CH = (mobile, ...brands) => ({ mobile, brands: brands.map(brand => ({ brand })) });

// [nombre, navigator falso, ¿puede capturar el audio de la llamada?]
const CASES = [
  ['Chrome escritorio', nav(UA.chromeMac, CH(false, 'Chromium', 'Google Chrome', 'Not)A;Brand'), true), true],
  ['Edge escritorio', nav(UA.edgeWin, CH(false, 'Microsoft Edge', 'Chromium'), true), true],
  ['Chrome sin UA-CH', nav(UA.chromeLinux, null, true), true],
  ['Opera escritorio', nav(UA.operaMac, CH(false, 'Chromium', 'Opera'), true), true],
  ['Firefox escritorio', nav(UA.firefoxMac, null, true), false],
  ['Safari escritorio', nav(UA.safariMac, null, true), false],
  ['Chrome Android', nav(UA.chromeAndroid, CH(true, 'Chromium', 'Google Chrome'), true), false],
  ['Chrome Android sin UA-CH', nav(UA.chromeAndroid, null, true), false],
  ['Firefox Android', nav(UA.firefoxAndroid, null, true), false],
  ['Safari iOS', nav(UA.safariIOS, null, false), false],
  ['Chrome iOS (CriOS)', nav(UA.chromeIOS, null, false), false],
  ['Sin getDisplayMedia', nav(UA.chromeMac, CH(false, 'Chromium'), false), false],
];

let bad = 0;
for (const [name, n, want] of CASES) {
  const cap = probe(n);
  const ok = cap.systemAudio === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(26)} systemAudio=${String(cap.systemAudio).padEnd(5)} esperado=${String(want).padEnd(5)} mobile=${cap.mobile} chromium=${cap.chromium}`);
}
console.log(bad ? `\n${bad} fallo(s)` : `\n${CASES.length}/${CASES.length} correctos`);
process.exit(bad ? 1 : 0);
