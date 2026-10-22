// Gramática de salida del copiloto: lo que el modelo dice solo entra si encaja.
//
// Portada de Elffuss Claw (web/js/copilot-grammar.js), donde se midió que el
// copiloto es de facto una feature de Gemma: los cerebros pequeños marcan todo
// «sí» desde el turno 1, se ponen a conversar como si fueran el cliente o se
// inventan un teléfono que nadie dijo. Dos cambios respecto a Claw: es bilingüe
// (dígitos dictados, diálogo y consejo de respaldo en español e inglés) y las
// ranuras son las de la ficha de este Copiloto.
//
// LA FORMA (patrón CRANE — «razona libre, restringe al final»): el CONSEJO va en
// prosa, pero todo lo que ALIMENTA LA FICHA pasa por un espacio cerrado:
//   · ACCION  → vocabulario cerrado de 5 opciones.
//   · DATOS   → cada valor pasa el validador de SU ranura y tiene que estar
//               ANCLADO en lo que se ha dicho: si nadie lo dijo, no entra.
//   · CONSEJO → se tira si es eco del interlocutor, plantilla o diálogo.
// Si el consejo se cae, la ACCION más el estado de la ficha dan uno determinista.
//
// Las marcas del contrato (CONSEJO, ACCION, DATOS, OBJETIVOS) son las mismas en
// los dos idiomas: son formato, no texto para el usuario.
//
// Sin dependencias ni DOM: se prueba en node (tests/grammar.test.mjs).

export const ACCIONES = ['preguntar', 'rebatir', 'cerrar', 'profundizar', 'esperar'];

// Sinónimos que el modelo escribe en lugar del verbo del contrato: en una llamada en inglés Gemma
// contesta «ACTION: ask» aunque el contrato liste los verbos en español, y eso se rechazaba como
// acción inventada. Solo equivalentes claros; lo demás sigue fuera de vocabulario.
const ALIAS_ACCION = {
  preguntar: ['ask', 'question', 'confirm', 'clarify', 'verify', 'pregunta', 'confirmar', 'aclarar'],
  rebatir: ['rebut', 'counter', 'reframe', 'object', 'objection', 'objecion', 'refutar'],
  cerrar: ['close', 'closing', 'book', 'schedule', 'commit', 'cierra', 'agendar'],
  profundizar: ['deepen', 'probe', 'explore', 'dig', 'investigate', 'indagar', 'explorar'],
  esperar: ['wait', 'listen', 'hold', 'pause', 'escuchar'],
};
const ACCION_DE = Object.fromEntries(Object.entries(ALIAS_ACCION).flatMap(([k, v]) => v.map(x => [x, k])));

// Valores-plantilla que el modelo copia del propio ejemplo del contrato.
const VACIO = /^(…|\.\.\.|—|–|-|_+|n\/a|na|null|none|nada|nothing|desconocido|unknown|sin datos|pendiente|pending|\?+)$/i;
const PLANTILLA = /(<[^>]*>|una l[ií]nea accionable|one actionable line|reesc[rí]ibelo|los que hayan salido|las abiertas|nombre del campo|field name|ejemplo:|example:)/i;

export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const palabras = s => norm(s).split(/[^a-z0-9@.+]+/).filter(w => w.length > 2);

// ── validadores por ranura ───────────────────────────────────────────────────
const RE_TEL = /^\+?[\d\s.\-()]{7,20}$/;
const RE_MAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const RE_NOMBRE = /^[^\d@]{2,40}$/;
const VALIDADOR = {
  telefono: v => RE_TEL.test(v) && (v.match(/\d/g) || []).length >= 7,
  email: v => RE_MAIL.test(v),
  nombre: v => RE_NOMBRE.test(v) && v.trim().split(/\s+/).length <= 4,
};

// Dígitos de un texto contando los DICTADOS («seis uno uno…», «six one one…»):
// sin esto un teléfono bien extraído parecería inventado.
const NUM = {
  cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
const digitosDe = t => norm(t).replace(/[a-z]+/g, w => (w in NUM ? NUM[w] : ' ')).replace(/\D/g, '');

// ¿Está el valor ANCLADO en lo que se ha dicho?
function anclado(valor, transcript) {
  if (!transcript) return true;
  const t = norm(transcript), digitosT = digitosDe(transcript);
  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length >= 6) return digitosT.includes(digitos);
  // Texto libre: al menos la MITAD de sus palabras con contenido (más de 3 letras)
  // tienen que haberse dicho. En Claw bastaba una palabra cualquiera, y «las» dejaba
  // pasar un ejemplo del contrato copiado tal cual («renovar las furgonetas»).
  const ws = palabras(valor).filter(w => w.length > 3);
  if (!ws.length) return t.includes(norm(valor));
  return ws.filter(w => t.includes(w)).length >= Math.ceil(ws.length / 2);
}

// ── consejo ─────────────────────────────────────────────────────────────────
function esEco(advice, transcript) {
  if (!transcript) return false;
  const a = palabras(advice);
  if (a.length < 3) return false;
  for (const linea of String(transcript).split('\n')) {
    const l = palabras(linea);
    if (l.length < 3) continue;
    const comunes = a.filter(w => l.includes(w)).length;
    if (comunes / a.length > 0.75 && Math.abs(a.length - l.length) <= 4) return true;
  }
  return false;
}
// El modelo haciendo de interlocutor en vez de soplarle al usuario qué decir.
const DIALOGO = /^(hola|buenos d[ií]as|buenas tardes|s[ií],? claro|por supuesto|encantad|gracias por|perfecto,? le|hi|hello|good (morning|afternoon|evening)|sure|of course|thanks for|thank you for)\b|¿en qu[eé] puedo ayudar|how can i help/i;

/**
 * Parsea la respuesta del modelo contra la gramática de la skill.
 * @param {string} text  salida cruda del modelo
 * @param {object} sk    {tag:'DATOS'|'OBJETIVOS', kind:'fields'|'goals', slots:[{key,label}]}
 * @param {object} ctx   {transcript} para anclar datos y detectar ecos
 * @returns {{advice:string, action:string, updates:object, rejected:string[]}}
 */
export function parse(text, sk, ctx = {}) {
  const s = String(text || '');
  const transcript = ctx.transcript || '';
  const rejected = [];

  let advice = (s.match(/(?:CONSEJO|ADVICE):\s*(.+)/i) || [])[1] || '';
  advice = advice.trim().replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
  if (advice && (VACIO.test(advice) || advice.length < 4)) { rejected.push('consejo-vacio'); advice = ''; }
  if (advice && PLANTILLA.test(advice)) { rejected.push('consejo-plantilla'); advice = ''; }
  if (advice && DIALOGO.test(advice)) { rejected.push('consejo-dialogo'); advice = ''; }
  if (advice && esEco(advice, transcript)) { rejected.push('consejo-eco'); advice = ''; }
  if (advice.length > 220) advice = advice.slice(0, 217).replace(/\s+\S*$/, '') + '…';

  let action = '';
  const am = s.match(/(?:ACCI[OÓ]N|ACTION):\s*([a-záéíóúñ]+)/i);
  if (am) {
    const cand = norm(am[1]);
    if (ACCIONES.includes(cand)) action = cand;
    else if (ACCION_DE[cand]) action = ACCION_DE[cand];
    else rejected.push('accion-fuera-de-vocabulario');
  }

  const updates = {};
  const claves = new Set((sk.slots || []).map(x => x.key));
  const alias = sk.kind === 'goals' ? 'GOALS' : 'DATA';
  const om = s.match(new RegExp('(?:' + sk.tag + '|' + alias + '):\\s*(.+)', 'i'));
  if (om) for (const par of om[1].split(';')) {
    const m = par.match(/\s*([\wáéíóúñÁÉÍÓÚÑ]+)\s*=\s*(.+)/);
    if (!m) continue;
    const key = norm(m[1]);
    const raw = m[2].trim().replace(/^["'“]|["'”]$/g, '').trim();
    if (!claves.has(key)) { rejected.push('ranura-inventada:' + key); continue; }
    if (sk.kind === 'goals') {
      if (/^(si|s|yes|y|true|1)$/i.test(norm(raw))) updates[key] = true;
      continue;
    }
    if (!raw || VACIO.test(raw) || PLANTILLA.test(raw)) { rejected.push('valor-plantilla:' + key); continue; }
    const val = VALIDADOR[key];
    if (val && !val(raw)) { rejected.push('valor-mal-formado:' + key); continue; }
    if (!anclado(raw, transcript)) { rejected.push('valor-inventado:' + key); continue; }
    updates[key] = raw;
  }
  return { advice, action, updates, rejected };
}

// Qué ranuras faltan (misma noción de «lleno» que la ficha).
export function faltan(sk, data = {}) {
  return (sk.slots || [])
    .filter(s => (sk.kind === 'goals' ? data[s.key] !== true : !(data[s.key] && String(data[s.key]).trim())))
    .map(s => s.label);
}

// Consejo determinista desde la ACCION + la ficha, cuando el modelo no dio uno usable.
export function fallbackAdvice(sk, data = {}, action = '', lang = 'es') {
  const pend = faltan(sk, data);
  const en = lang === 'en';
  const dos = pend.slice(0, 2).join(en ? ' and ' : ' y ');
  switch (action) {
    case 'rebatir': return en
      ? 'There’s an objection: acknowledge it, answer briefly and get back on track' + (pend.length ? ' — still missing ' + dos + '.' : '.')
      : 'Hay una objeción: recógela, contesta corto y vuelve al hilo' + (pend.length ? ' — falta ' + dos + '.' : '.');
    case 'cerrar': return pend.length
      ? (en ? 'Before wrapping up you still need ' + dos + '. Ask for it and propose the next step.' : 'Antes de cerrar te falta ' + dos + '. Pídelo y propón el siguiente paso.')
      : (en ? 'You have everything: close by proposing a concrete next step (day and time).' : 'Está todo: cierra proponiendo el siguiente paso concreto (día y hora).');
    case 'profundizar': return en ? 'Dig into what they just said before moving on: ask why.' : 'Tira de lo último que ha dicho antes de avanzar: pregúntale por qué.';
    case 'esperar': return en ? 'Let them finish. Listen and don’t interrupt.' : 'Deja que termine. Escucha y no interrumpas.';
    case 'preguntar':
    default:
      return pend.length
        ? (en ? 'Ask now about ' + dos + '.' : 'Pregunta ahora por ' + dos + '.')
        : (en ? 'You have everything you need: lock in the next step.' : 'Ya tienes todo lo que necesitas: cierra el siguiente paso.');
  }
}

// El contrato que se le pone al modelo: vive junto al validador para que no se separen.
export function contrato(sk, lang = 'es') {
  return `CONSEJO: <${lang === 'en' ? 'one actionable line for the user, in their language' : 'una línea accionable para el usuario, en su idioma'}>
ACCION: ${ACCIONES.join('|')}
${sk.rule}`;
}
