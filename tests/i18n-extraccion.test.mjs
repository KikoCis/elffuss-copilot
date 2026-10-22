// Guardia de los TEXTOS en español e inglés y de la FICHA en los dos idiomas.
//
// Dos fallos que no hacen ruido: una clave que existe en español y falta en inglés
// (en inglés sale la clave pelada o el texto en español), y un patrón de la ficha
// que solo entiende «me llamo» cuando la llamada es en inglés y deja la ficha vacía.
//
//   node copilot/tests/i18n-extraccion.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${!cond && extra ? '  — ' + extra : ''}`);
  if (!cond) fallos++;
};

// ── 1. textos ──
const dictSrc = (html.match(/const I18N = (\{[\s\S]*?\n\});/) || [])[1];
const skillsSrc = (html.match(/const SKILLS = (\{[\s\S]*?\n\});/) || [])[1];
if (!dictSrc || !skillsSrc) { console.error('❌ No encuentro I18N o SKILLS en index.html'); process.exit(1); }
const I18N = (0, eval)('(' + dictSrc + ')');
const SKILLS = (0, eval)('(' + skillsSrc + ')');
const es = Object.keys(I18N.es), en = Object.keys(I18N.en);
ok('español e inglés tienen las mismas claves',
  es.length === en.length && es.every(k => k in I18N.en),
  `solo en español: ${es.filter(k => !(k in I18N.en)).join(', ')} · solo en inglés: ${en.filter(k => !(k in I18N.es)).join(', ')}`);

const usadas = new Set([
  ...[...html.matchAll(/data-i18n(?:-title|-ph)?="(\w+)"/g)].map(m => m[1]),
  // solo claves completas: t('sk_' + s.id) es un prefijo, y esas se comprueban abajo con SKILLS
  ...[...html.matchAll(/\bt\('(\w+)'\s*[,)]/g)].map(m => m[1]),
]);
for (const s of Object.values(SKILLS)) {
  usadas.add('sk_' + s.id); usadas.add('sk_' + s.id + '_d');
  for (const k of s.slots) usadas.add((s.goals ? 'goal_' : 'f_') + k);
}
const faltan = [...usadas].filter(k => !(k in I18N.es) || !(k in I18N.en));
ok(`las ${usadas.size} claves que usa la página existen en los dos idiomas`, !faltan.length, faltan.join(', '));
const iguales = en.filter(k => I18N.en[k] === I18N.es[k] && !/^(f_email|no|webhookFail|h2)$/.test(k) && /[a-záéíóúñ]{4,}/i.test(I18N.es[k]));
ok('ningún texto se quedó sin traducir (igual en los dos)', !iguales.length, iguales.join(', '));

// ── 2. extracción de la ficha ──
const bloque = (html.match(/\/\/ ── extracción DETERMINISTA[\s\S]*?(?=\/\/ ── board ──)/) || [])[0];
if (!bloque) { console.error('❌ No encuentro el bloque de extracción en index.html'); process.exit(1); }
const extrae = (frases, goals = false) =>
  new Function('transcript', 'skill', bloque + '\nreturn extractDeterministic();')(frases.map(text => ({ who: 'S2', text })), { goals });
function espera(nombre, obtenido, esperado) {
  const malos = Object.entries(esperado).filter(([k, v]) => (v instanceof RegExp ? !v.test(obtenido[k] || '') : obtenido[k] !== v));
  ok(nombre, !malos.length, malos.map(([k, v]) => `${k}: ${JSON.stringify(obtenido[k])} (esperaba ${v})`).join(' · '));
}

espera('ficha en español', extrae([
  'Hola, me llamo Laura Gómez, de Construcciones Norte.', 'Soy directora de compras.',
  'Mi teléfono es seis uno uno dos tres cuatro cinco seis siete.', 'Escríbeme a laura@norte.es',
  'Tenemos unos 20.000 euros.', 'Lo necesitamos para marzo.',
]), { nombre: 'Laura Gómez', empresa: 'Construcciones Norte', cargo: /directora de compras/i, telefono: '611234567', email: 'laura@norte.es', presupuesto: /20\.000 euros/, plazo: /para marzo/i });

espera('español con mayúscula al empezar («Me llamo…»)', extrae(['Me llamo Pedro Ruiz.']), { nombre: 'Pedro Ruiz' });

espera('ficha en inglés', extrae([
  'Hi, this is Sarah Miller, from Northwind.', 'I’m the head of procurement.',
  'My number is six one seven five five five zero one nine two.', 'Email me at sarah@northwind.com',
  'Our budget is around $50k.', 'We need it by March.',
]), { nombre: 'Sarah Miller', empresa: 'Northwind', cargo: /head of procurement/i, telefono: '6175550192', email: 'sarah@northwind.com', presupuesto: /\$50k/i, plazo: /by march/i });

espera('objetivos en español', extrae(['Me llamo Ana.', 'La verdad es que me interesa.', 'Venga, adelante.'], true), { nombre: true, interes: true, compra: true });
espera('objetivos en inglés', extrae(['My name is John.', 'I’m interested, sounds good.', 'Let’s do it.'], true), { nombre: true, interes: true, compra: true });
espera('«estoy interesado» cuenta como interés', extrae(['Estoy interesado en la propuesta.'], true), { interes: true });
espera('«I’m Interested» no se toma por un nombre', extrae(['I’m Interested in the offer.']), { nombre: undefined });

// Lo que salió mal en una prueba real en inglés (2026-09-14).
const conv = (lineas, goals = false) =>
  new Function('transcript', 'skill', bloque + '\nreturn extractDeterministic();')(lineas.map(([who, text]) => ({ who, text })), { goals });
const limpia = new Function(bloque + '\nreturn cleanText;')();
espera('empresa con «I work in»', extrae(['about my company. I work in Yonikaja.']), { empresa: 'Yonikaja' });
espera('«Trabajo en» con mayúscula', extrae(['Trabajo en Construcciones Norte.']), { empresa: 'Construcciones Norte' });
espera('email dictado en inglés, sin tragarse la frase siguiente', extrae(['My email is sarah at northwind dot com. Our budget is small.']), { email: 'sarah@northwind.com' });
espera('email dictado en español', extrae(['Mi correo es laura arroba norte punto es.']), { email: 'laura@norte.es' });
espera('lo que se atribuyó a «Tú» también cuenta si falta', conv([['S2', 'My name is Sam.'], ['S1', 'My email is sam@mail.com']]), { nombre: 'Sam', email: 'sam@mail.com' });
espera('si los dos lo dicen, gana el cliente', conv([['S1', 'Hi, this is Pedro.'], ['S2', 'My name is Laura.']]), { nombre: 'Laura' });
espera('los objetivos siguen leyendo solo al cliente', conv([['S1', 'Adelante, cuénteme.'], ['S2', 'Me llamo Ana.']], true), { compra: undefined, nombre: true });
ok('las anotaciones de Whisper no son voz', limpia('(upbeat music)') === '' && limpia('about my company. [Music] I work in Yonikaja.') === 'about my company. I work in Yonikaja.', JSON.stringify(limpia('about my company. [Music] I work in Yonikaja.')));

// Lo que salió mal con voz de verdad (prueba de punta a punta, 2026-09-14).
espera('gana el teléfono más largo (un trozo suelto y luego el número entero)', extrae(['555-0192', 'You can call me on 617-555-0192.']), { telefono: '6175550192' });
espera('el presupuesto no arrastra el punto final', extrae(['Our budget is around $50,000.']), { presupuesto: '$50,000' });

console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
