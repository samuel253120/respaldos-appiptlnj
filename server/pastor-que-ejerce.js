/**
 * Lo que significa que un pastor ya no ejerza.
 *
 * Hasta acá, nada. El campo «Estado» de su ficha ofrece cinco valores —Activo,
 * Inactivo, Jubilado, Trasladado, Fallecido—, se guarda y se pinta como
 * etiqueta en la ficha y en el listado, y NINGUNA regla del sistema lo
 * consultaba. Medido sobre un pastor creado directamente como fallecido:
 *
 *   designarlo pastor principal de una iglesia ..... 200
 *   marcar fallecido al que YA está a cargo ........ 200, sin decir nada
 *   ¿la iglesia lo sigue nombrando después? ........ sí
 *   ¿lo ofrece el desplegable de pastores? ......... sí, 9 de 9
 *   ¿y al jubilado? ................................ también
 *
 * No es un rótulo cualquiera. Del campo «Pastor principal» sale «A cargo de la
 * iglesia», que nombra al pastor Y A SU CÓNYUGE, y es lo que la organización
 * lee para saber quién responde por esa congregación. Un estado que no hace
 * cumplir nada es peor que no tenerlo: promete una protección que no existe.
 *
 * LO QUE SE FRENA ES DESIGNARLO DE NUEVO, NO LO QUE YA ESTÁ ESCRITO. Un pastor
 * jubilado o fallecido fue el pastor de esa iglesia hasta el día que dejó de
 * serlo, y su historial, sus documentos y las credenciales que tuvo son el
 * registro de eso: se leen, se consultan, se corrigen y se imprimen. Lo que no
 * se hace es seguir nombrándolo para cosas nuevas.
 *
 * SE FRENA Y NO SE PREGUNTA al designarlo, como con una iglesia inactiva (ver
 * server/iglesia-inactiva.js): la salida está escrita en el propio aviso
 * —cambiarle el estado— y es una decisión que se toma en la ficha del pastor,
 * no de pasada al guardar otra cosa.
 *
 * PERO SÍ SE PREGUNTA al revés: cuando alguien lo jubila o lo marca fallecido y
 * una iglesia lo está nombrando. Ahí no hay nada que corregir —la persona dejó
 * de ejercer y eso es un hecho— y lo que hay que decidir es qué pasa con esa
 * congregación. Es la misma puerta que la 1.237.0 cerró para el traslado.
 */

const suIglesia = require('./pastor-de-la-iglesia');

/**
 * Los estados en que ya no ejerce. Todo lo que no sea «Activo».
 *
 * Se listan los que cierran la puerta y no los que la dejan abierta a
 * propósito: si algún día se agrega un estado nuevo a la ficha, lo prudente es
 * que por omisión NO frene nada hasta que alguien decida que sí.
 */
const YA_NO_EJERCEN = ['Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'];

/**
 * Los módulos que SÍ pueden seguir nombrando a un pastor que no ejerce.
 *
 * Son los que existen para contar lo que le pasó —su historial ministerial y
 * su carpeta—, y dejar de ejercer es justamente lo que hay que poder anotar
 * ahí. Y los certificados, porque un certificado registra un hecho con SU
 * fecha: el matrimonio de 1998 lo ofició quien lo ofició, aunque hoy ya no
 * esté. `registro_cambios` va por lo mismo que en la iglesia inactiva: lo
 * escribe el sistema, no una persona.
 */
const PUEDEN_NOMBRARLO = [
  'historial_pastores', 'documentos_pastores', 'certificados', 'registro_cambios',
];

/** La condición SQL de los que sí ejercen. Un estado en blanco ejerce. */
const condicionDeQuienesEjercen = (alias = '') => {
  const c = alias ? `${alias}.estado` : 'estado';
  return `(${c} IS NULL OR ${c} NOT IN (${YA_NO_EJERCEN.map((e) => `'${e}'`).join(', ')}))`;
};

/** ¿Este pastor dejó de ejercer? Devuelve su fila, o null. */
function elQueNoEjerce(db, pastorId) {
  const id = Number(pastorId) || 0;
  if (!id) return null;
  let fila = null;
  try {
    fila = db.prepare('SELECT id, nombres, apellidos, estado FROM pastores WHERE id = ?').get(id);
  } catch (e) {
    return null; // la tabla se crea al arrancar; si aún no está, no hay regla que correr
  }
  return fila && YA_NO_EJERCEN.includes(fila.estado) ? fila : null;
}

/** Cómo se llama un pastor en un aviso. */
const comoSeLlama = (p) => `${p.nombres} ${p.apellidos}`.trim();

/**
 * El aviso de que no se puede nombrar a un pastor que ya no ejerce, o null.
 *
 * Mira TODOS los campos que apuntan a Pastores / Guías —el pastor principal de
 * una iglesia, el titular de una credencial— en vez de escribirse módulo por
 * módulo: la regla es una y así no se olvida en el que venga después.
 *
 * Solo cuando ESTE guardado lo nombra por primera vez o lo cambia. Corregirle
 * el teléfono a una iglesia cuyo pastor falleció no se frena: eso es
 * exactamente lo que hay que poder seguir haciendo.
 */
function avisoSiElPastorYaNoEjerce(db, def, { data, existing, isNew }) {
  if (PUEDEN_NOMBRARLO.includes(def.name)) return null;

  for (const campo of (def.fields || [])) {
    if (campo.type !== 'ref' || campo.ref !== 'pastores') continue;
    const ahora = data[campo.name];
    if (!ahora) continue;
    const antes = existing ? existing[campo.name] : null;
    if (!isNew && String(antes || '') === String(ahora)) continue;

    const pastor = elQueNoEjerce(db, ahora);
    if (!pastor) continue;
    return (
      `${comoSeLlama(pastor)} figura como «${pastor.estado}» en Pastores / Guías, así que ya no `
      + `ejerce y no se le puede designar de nuevo en «${campo.label || campo.name}». Lo que ya `
      + 'estaba escrito con su nombre se conserva y se sigue consultando; esto es una designación '
      + 'nueva. Si volvió a ejercer, cámbiele el estado en su ficha y vuelva a intentarlo; si no, '
      + 'elija a otra persona.'
    );
  }
  return null;
}

/**
 * Al guardar un PASTOR al que se le está poniendo un estado en que ya no
 * ejerce: el aviso de que hay una iglesia nombrándolo, o null.
 *
 * Dice lo que va a pasar si confirma, porque va a pasar: la designación se
 * suelta. Es la misma forma del aviso del traslado (1.237.0), y por el mismo
 * motivo: dejarla puesta sería que la ficha de esa iglesia dijera que su
 * pastor es alguien que ya no ejerce, y quitarla sin avisar sería peor.
 */
function avisoSiDejaDeEjercerYEstaACargo(db, pastorId, { data, existing, confirmado }) {
  if (confirmado) return null;
  if (!pastorId || !existing) return null;          // una ficha nueva no deja nada atrás
  if (data.estado === undefined) return null;
  if (!YA_NO_EJERCEN.includes(data.estado)) return null;
  if (String(existing.estado || '') === String(data.estado || '')) return null;

  const suyas = suIglesia.lasQueLoSiguenNombrando(db, pastorId, null);
  if (!suyas.length) return null;

  const cuales = suyas.map((i) => `«${i.nombre}»`).join(' y ');
  const plural = suyas.length > 1;
  return {
    error:
      `${comoSeLlama(existing)} figura como pastor(a) principal de ${cuales}, y lo está marcando `
      + `como «${data.estado}». Si confirma, ${plural ? 'esas iglesias quedan' : 'esa iglesia queda'} `
      + 'sin pastor principal anotado y hay que designarle otro: de ese campo sale «A cargo de la '
      + 'iglesia», que es lo que se lee para saber quién responde por esa congregación.',
    confirmar: 'deja_de_ejercer_y_esta_a_cargo',
  };
}

module.exports = {
  YA_NO_EJERCEN,
  PUEDEN_NOMBRARLO,
  condicionDeQuienesEjercen,
  elQueNoEjerce,
  avisoSiElPastorYaNoEjerce,
  avisoSiDejaDeEjercerYEstaACargo,
};
