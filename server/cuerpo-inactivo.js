/**
 * Lo que significa que un cuerpo o grupo esté INACTIVO.
 *
 * Hasta acá, nada. El campo «Estado» ofrece dos valores —Activo, Inactivo—, se
 * guarda y se pinta en el listado, y NINGUNA regla del sistema lo consultaba.
 * Medido sobre un cuerpo creado directamente como inactivo:
 *
 *   agregarle un integrante ................... 201
 *   meterle plata en su caja .................. 201
 *   anotarle un acta de reunión ............... 201
 *   convocarlo a una actividad ................ 201
 *   inventariarle un bien ..................... 201
 *   ¿lo ofrece el desplegable de cuerpos? ..... sí, 1 de 17
 *
 * Es la TERCERA vez que este sistema se topa con lo mismo: la 1.232.0 lo
 * arregló para una iglesia retirada (ver server/iglesia-inactiva.js) y la
 * 1.240.0 para un pastor que ya no ejerce (ver server/pastor-que-ejerce.js).
 * La conclusión es la de esas dos: un estado que no hace cumplir nada es peor
 * que no tenerlo, porque promete una protección que no existe.
 *
 * Y acá pesa más que en ninguno de los dos, porque de un cuerpo cuelga más que
 * de nada más en el sistema: sus integrantes, sus cuotas, sus dos cajas, sus
 * directivas, sus actas, su inventario y las actividades a las que se lo
 * convoca. Marcarlo inactivo es la única manera que la organización tiene de
 * decir que dejó de funcionar.
 *
 * LO QUE SE FRENA ES LO NUEVO, NO LO QUE YA ESTÁ. Un cuerpo que funcionó tiene
 * su gente, su plata, sus actas y su historia, y eso se lee, se consulta, se
 * corrige y se imprime. Lo que no se hace es seguir colgándole cosas. Por eso
 * la regla mira solo el alta —y el traslado de un registro HACIA uno inactivo—
 * y no toca ninguna edición de lo que ya vive ahí.
 *
 * SE FRENA Y NO SE PREGUNTA, como en los otros dos: la salida está escrita en
 * el propio aviso —volver a marcarlo Activo— y es una decisión que se toma en
 * la ficha del cuerpo, no de pasada al guardar otra cosa.
 *
 * ── EL ESTADO EN BLANCO ESTÁ ACTIVO ──
 *
 * El campo trae «Activo» de fábrica, pero un valor de fábrica solo se aplica
 * cuando alguien abre el formulario: los cuerpos que ya existían tienen el
 * estado VACÍO, y eran doce de dieciséis. Así que antes de decidir qué hace
 * «Inactivo» había que decidir qué significa el vacío, y la respuesta evidente
 * es que un cuerpo sin estado escrito funciona: si el vacío cerrara la puerta,
 * encender esta regla habría dejado tres cuartas partes de los cuerpos de la
 * organización sin poder recibir nada.
 *
 * Se escribe al arrancar —ver `elEstadoDeCadaCuerpo` en server/migraciones.js,
 * igual que se hizo con el nivel de cada artículo de inventario en la
 * 1.229.0— y además se lee así en todas partes, para que un cuerpo creado por
 * la API sin estado no quede fuera.
 */

/** El estado que cierra la puerta. */
const INACTIVO = 'Inactivo';

/**
 * Lo que SÍ se le puede seguir escribiendo a un cuerpo inactivo.
 *
 * `asistencia_detalle` son las marcas de asistencia de una actividad. La
 * actividad es lo nuevo y por eso se frena convocarlo; PASAR LA LISTA de una
 * que ya estaba convocada no lo es, y frenarlo dejaría una reunión que se hizo
 * sin poder anotarse. Es la misma línea que separa el alta de la corrección.
 *
 * `usuarios` va por otra razón, la misma que ya está escrita para la iglesia
 * inactiva: ahí «Cuerpos que administra» no dice de qué cuerpo es el registro,
 * dice de cuáles se hace cargo esa cuenta, y alguien tiene que poder quedar a
 * cargo de los papeles de un cuerpo que se cerró.
 */
const PUEDEN_ESCRIBIRLE = ['asistencia_detalle', 'usuarios'];

/** ¿Este cuerpo está marcado como inactivo? Devuelve su fila, o null. */
function elInactivo(db, cuerpoId) {
  const id = Number(cuerpoId) || 0;
  if (!id) return null;
  let fila = null;
  try {
    fila = db.prepare('SELECT id, nombre, tipo, estado FROM cuerpos WHERE id = ?').get(id);
  } catch (e) {
    return null; // la tabla se crea al arrancar; si aún no está, no hay regla que correr
  }
  return fila && fila.estado === INACTIVO ? fila : null;
}

/** Cómo se lo nombra en un aviso: «El grupo "Aseo"», «El cuerpo "Damas"». */
const comoSeLlama = (c) => `${c.tipo === 'Grupo' ? 'El grupo' : 'El cuerpo'} "${c.nombre}"`;

/** El texto del aviso, uno solo para las tres puertas por las que se pide. */
function elAviso(cuerpo, que) {
  return (
    `${comoSeLlama(cuerpo)} está marcado como inactivo, así que no puede ${que}: dejó de `
    + 'funcionar y lo suyo quedó como historia —se sigue consultando, corrigiendo e imprimiendo—. '
    + 'Si volvió a funcionar, cámbiele el estado a «Activo» en su ficha y vuelva a intentarlo; si '
    + 'esto corresponde a otro cuerpo o grupo, elíjalo.'
  );
}

/**
 * El aviso de que a un cuerpo inactivo no se le cuelga esto, o null.
 *
 * Mira TODOS los campos que apuntan a Cuerpos / Grupos —la ficha de
 * integrante, el acta, la cuenta, el bien de inventario, la deuda, el
 * movimiento— en vez de escribirse módulo por módulo: la regla es una sola y
 * así no se olvida en el que venga después. Es lo mismo que hace la regla del
 * pastor que ya no ejerce.
 *
 * Los campos de VARIOS entran igual, y hacen falta: a una actividad se la
 * convoca con «Cuerpos convocados», que es un multiref, y ésa era una de las
 * cinco cosas medidas.
 *
 * Se llama DESPUÉS del gancho del módulo, y eso importa: hay módulos que no
 * reciben el cuerpo y lo deducen ahí —un movimiento de tesorería y una deuda
 * lo toman de su cuenta—. Preguntando antes, esos entrarían igual.
 */
function avisoSiElCuerpoEstaInactivo(db, def, { data, existing, isNew }) {
  if (PUEDEN_ESCRIBIRLE.includes(def.name)) return null;

  for (const campo of (def.fields || [])) {
    if (campo.ref !== 'cuerpos') continue;
    if (campo.type !== 'ref' && campo.type !== 'multiref') continue;

    if (campo.type === 'multiref') {
      // Solo los que ESTE guardado agrega: corregirle la fecha a una actividad
      // ya convocada no vuelve a preguntar por los cuerpos que ya tenía
      const ahora = idsDe(data[campo.name]);
      if (!ahora.length) continue;
      const antes = new Set(isNew ? [] : idsDe(existing && existing[campo.name]));
      for (const id of ahora) {
        if (antes.has(id)) continue;
        const cuerpo = elInactivo(db, id);
        if (cuerpo) return elAviso(cuerpo, `convocarse a algo nuevo en «${campo.label || campo.name}»`);
      }
      continue;
    }

    const ahora = data[campo.name];
    if (!ahora) continue;
    const antes = existing ? existing[campo.name] : null;
    if (!isNew && String(antes || '') === String(ahora)) continue;

    const cuerpo = elInactivo(db, ahora);
    if (!cuerpo) continue;
    return elAviso(cuerpo, `${isNew ? 'anotarse' : 'pasarse'} nada nuevo en él`);
  }
  return null;
}

/**
 * El aviso para las puertas que escriben sin pasar por el guardado, o null.
 *
 * Lo pide la planilla de cuotas, que registra el pago derecho —y con él su
 * ingreso en tesorería— desde su propia ruta. Escrita la regla solo en el
 * motor, ésa habría sido la manera de meterle plata nueva a un cuerpo
 * cerrado: es la misma lección que dejó el plan de cuotas de una deuda en la
 * 1.248.0.
 */
function avisoSiEstaInactivo(db, cuerpoId, que) {
  const cuerpo = elInactivo(db, cuerpoId);
  return cuerpo ? elAviso(cuerpo, que) : null;
}

/** Los ids de un campo de varios, venga como arreglo o como texto JSON. */
function idsDe(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  if (typeof valor !== 'string' || !valor.trim()) return [];
  try {
    const v = JSON.parse(valor);
    return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

/**
 * La condición SQL de los que sí reciben cosas nuevas.
 *
 * Un estado en blanco recibe, por lo que está explicado arriba. Sin ese
 * `IS NULL` los doce cuerpos que lo tenían vacío habrían desaparecido de los
 * desplegables de golpe.
 */
const condicionDeActivos = (alias = '') => {
  const c = alias ? `${alias}.estado` : 'estado';
  return `(${c} IS NULL OR ${c} <> '${INACTIVO}')`;
};

/** ¿Este cuerpo funciona? Lo usan el cumplimiento y los desplegables. */
const funciona = (fila) => !fila || fila.estado !== INACTIVO;

module.exports = {
  INACTIVO,
  PUEDEN_ESCRIBIRLE,
  elInactivo,
  avisoSiElCuerpoEstaInactivo,
  avisoSiEstaInactivo,
  condicionDeActivos,
  funciona,
  idsDe,
};
