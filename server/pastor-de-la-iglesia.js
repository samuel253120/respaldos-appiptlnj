/**
 * Que la iglesia y su pastor digan lo mismo.
 *
 * La relación está escrita DOS VECES Y EN DOS DIRECCIONES: la ficha de la
 * iglesia tiene «Pastor principal», y la del pastor tiene «Iglesia». Nadie
 * comprobaba que las dos dijeran lo mismo, y se contradicen por los dos lados.
 *
 * Medido, poniéndole a una iglesia el pastor de otra:
 *
 *   guardar ......................... 200, aceptado sin decir nada
 *   la ficha de «Iglesia A» dice .... su pastor es Pedro
 *   la ficha de Pedro dice .......... soy de «Iglesia B»
 *
 * Y por el otro lado, que es peor porque nadie iría a mirarlo:
 *
 *   a Pedro se lo traslada a «Iglesia A» ....... 200, sin decir nada
 *   «Iglesia B» sigue diciendo ................. mi pastor es Pedro
 *   «Iglesia A» dice ........................... no tengo pastor
 *
 * No es un rótulo cualquiera: de «Pastor principal» sale «A cargo de la
 * iglesia», que nombra al pastor Y A SU CÓNYUGE, y es lo que la organización
 * lee para saber quién responde por esa congregación.
 *
 * SE PREGUNTA, NO SE PROHÍBE, como al nombrar responsable de una cuenta a
 * alguien de otra iglesia (1.221.0): hay casos legítimos —un pastor que
 * atiende dos congregaciones, un interinato mientras se designa a alguien—. Y
 * el aviso dice DE QUÉ IGLESIA ES HOY ese pastor, que es el dato con que se
 * decide.
 *
 * NO SE CORRIGE NADA DE LO YA GUARDADO, y es a propósito. A diferencia de las
 * cajas que se quedaron con el nombre viejo de su iglesia (1.236.0), acá lo que
 * está escrito pudo escribirse a sabiendas: ese pastor de otra congregación
 * puede estar ahí porque alguien lo decidió. Corregirlo al arrancar sería
 * deshacer decisiones que nadie pidió deshacer.
 */

/** El nombre de una iglesia, para poder nombrarla en el aviso. */
function nombreDeLaIglesia(db, id) {
  const i = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id);
  return i ? i.nombre : `la iglesia n.º ${id}`;
}

/** Cómo se llama un pastor en un aviso. */
const comoSeLlama = (p) => `${p.nombres} ${p.apellidos}`.trim();

/**
 * Al guardar una IGLESIA: el aviso de que el pastor que le están poniendo es de
 * otra congregación, o null.
 *
 * Se pregunta solo cuando ESTE guardado cambia el pastor. Volver a preguntarlo
 * cada vez que alguien le corrige el teléfono a una iglesia cuyo pastor ya se
 * aceptó no es cuidar el dato: es enseñar a apretar «Está bien» sin leer.
 */
function avisoSiElPastorEsDeOtraIglesia(db, iglesiaId, { data, existing, confirmado }) {
  if (confirmado) return null;
  /*
   * Con esto salen las dos maneras de no estar poniendo un pastor: que este
   * guardado no lo toque —`undefined`— y que se lo estén quitando —nulo—.
   * Estaban escritas por separado y quitar la primera no rompía nada, porque la
   * segunda ya la cubría.
   */
  const quien = data.pastor_id;
  if (!quien) return null;
  if (existing && String(existing.pastor_id || '') === String(quien)) return null;

  const pastor = db
    .prepare('SELECT id, nombres, apellidos, iglesia_id FROM pastores WHERE id = ?')
    .get(quien);
  // Sin iglesia escrita en su ficha no contradice nada, que es la misma
  // excepción que hace el aviso del responsable de una cuenta
  if (!pastor || !pastor.iglesia_id) return null;
  if (iglesiaId && Number(pastor.iglesia_id) === Number(iglesiaId)) return null;

  const suya = nombreDeLaIglesia(db, pastor.iglesia_id);
  const esta = iglesiaId ? `«${nombreDeLaIglesia(db, iglesiaId)}»` : 'la que está creando';
  return {
    error:
      `${comoSeLlama(pastor)} figura hoy como pastor(a) de «${suya}», y lo está poniendo como pastor `
      + `principal de ${esta}. Las dos fichas van a decir cosas distintas: de este campo sale «A cargo `
      + 'de la iglesia», que es lo que se lee para saber quién responde por esta congregación. Si es '
      + 'a propósito —atiende las dos, o está de interino mientras se designa a alguien—, confirme; '
      + 'si no, cámbiele la iglesia en su propia ficha y vuelva a intentarlo.',
    confirmar: 'pastor_de_otra_iglesia',
  };
}

/**
 * Al guardar un PASTOR que se cambia de iglesia: las congregaciones que lo
 * siguen nombrando como su pastor principal.
 *
 * Devuelve las filas de esas iglesias —normalmente una— o vacío.
 */
function lasQueLoSiguenNombrando(db, pastorId, iglesiaNueva) {
  if (!pastorId) return [];
  return db
    .prepare('SELECT id, nombre FROM iglesias WHERE pastor_id = ?')
    .all(pastorId)
    .filter((i) => !iglesiaNueva || Number(i.id) !== Number(iglesiaNueva));
}

/**
 * El aviso de que trasladarlo deja a su iglesia anterior sin pastor anotado, o
 * null. Se pregunta solo cuando ESTE guardado le cambia la iglesia.
 *
 * Y dice lo que va a pasar si confirma, porque va a pasar: la designación que
 * queda atrás se borra. Dejarla sería justamente el defecto —una iglesia
 * diciendo que su pastor es alguien que ya es de otra—, y borrarla sin avisar
 * sería peor.
 */
function avisoSiDejaSuIglesiaSinPastor(db, pastorId, { data, existing, confirmado }) {
  if (confirmado) return null;
  if (!pastorId || !existing) return null;                     // una ficha nueva no deja nada atrás
  if (data.iglesia_id === undefined) return null;
  if (String(existing.iglesia_id || '') === String(data.iglesia_id || '')) return null;

  const huerfanas = lasQueLoSiguenNombrando(db, pastorId, data.iglesia_id);
  if (!huerfanas.length) return null;

  const suNuevaIglesia = data.iglesia_id
    ? `«${nombreDeLaIglesia(db, data.iglesia_id)}»`
    : 'ninguna iglesia';
  const cuales = huerfanas.map((i) => `«${i.nombre}»`).join(' y ');
  return {
    error:
      `${comoSeLlama(existing)} figura como pastor(a) principal de ${cuales}, y lo está pasando a `
      + `${suNuevaIglesia}. Si confirma, ${huerfanas.length > 1 ? 'esas iglesias quedan' : 'esa iglesia queda'} `
      + 'sin pastor principal anotado y hay que designarle otro: dejarlo puesto haría que su ficha '
      + 'dijera que su pastor es alguien que ya es de otra congregación.',
    confirmar: 'deja_su_iglesia_sin_pastor',
  };
}

/**
 * Y, ya confirmado, se le quita: es lo que la pregunta dijo que iba a pasar.
 * Devuelve las iglesias que quedaron sin pastor anotado, para poder decirlo.
 */
function soltarLasQueLoNombraban(db, pastorId, iglesiaNueva) {
  const huerfanas = lasQueLoSiguenNombrando(db, pastorId, iglesiaNueva);
  if (!huerfanas.length) return [];
  const soltar = db.prepare('UPDATE iglesias SET pastor_id = NULL WHERE id = ?');
  for (const i of huerfanas) soltar.run(i.id);
  return huerfanas;
}

module.exports = {
  avisoSiElPastorEsDeOtraIglesia,
  avisoSiDejaSuIglesiaSinPastor,
  lasQueLoSiguenNombrando,
  soltarLasQueLoNombraban,
};
