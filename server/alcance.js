/**
 * Alcance de cada usuario: qué iglesias y qué cuerpos puede ver y administrar.
 *
 * A un usuario se le pueden asignar:
 *   - una o varias **iglesias**: solo ve los datos de esas congregaciones;
 *   - uno o varios **cuerpos**: además, dentro de esas iglesias solo ve lo de
 *     esos cuerpos (sus integrantes, sus actividades, sus actas, su
 *     inventario, sus directivas…).
 *
 * Sin iglesias asignadas, ve todas (es el caso del administrador general).
 * Sin cuerpos asignados, ve todos los de sus iglesias.
 *
 * Y una tercera cosa, que no es una asignación sino un permiso: de qué
 * TESORERÍA puede ver la plata —la de la iglesia, la de los cuerpos, o las
 * dos—. Se resuelve en server/tesorerias.js y se aplica desde acá, para que
 * entre por las mismas puertas que todo lo demás.
 *
 * El alcance se aplica en el servidor, en cada consulta y en cada guardado:
 * no depende de lo que muestre la pantalla.
 */
const { db } = require('./db');

/** Lee un campo que guarda una lista de ids (multiref) sin reventar. */
function lista(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  try {
    return JSON.parse(valor || '[]').map(Number).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Las iglesias que se le asignaron. Vacío = todas las del sistema.
 *
 * Lo que ve cada persona lo decide «Iglesias que administra», y solo eso. La
 * «iglesia principal» no entra acá: dice con cuál trabaja por omisión —la que
 * se propone al crear un registro—, no a cuáles alcanza. Sumarla acotaba en
 * silencio a quien solo tenía puesta esa, sin que el formulario lo dijera.
 *
 * Se incluye únicamente cuando ya está entre las asignadas, que es donde el
 * propio formulario exige que esté.
 */
function iglesiasAsignadas(usuario) {
  if (!usuario) return [];
  const ids = new Set(lista(usuario.iglesias));
  if (ids.size && usuario.iglesia_id) ids.add(Number(usuario.iglesia_id));
  return [...ids];
}

/**
 * Iglesias que el usuario ve **ahora**. Vacío = todas.
 *
 * Quien tiene varias no siempre quiere verlas todas juntas: el domingo está en
 * una y el lunes revisa otra, y una lista con los miembros de las cinco
 * mezclados no le sirve. Por eso puede elegir con cuál o cuáles trabajar, y
 * eso acota todo el sistema —lo que ve y lo que guarda—, no solo la pantalla.
 *
 * En blanco significa «todas las que tengo», que es como se entra la primera
 * vez. La elección nunca amplía lo asignado: si eligió una que ya no le
 * corresponde, se ignora y vuelve a ver las suyas.
 */
function iglesiasDe(usuario) {
  const asignadas = iglesiasAsignadas(usuario);
  const trabajando = usuario ? lista(usuario.iglesias_trabajando) : [];
  if (!trabajando.length) return asignadas;
  if (!asignadas.length) return trabajando; // sin asignación: manda su elección
  const comunes = asignadas.filter((id) => trabajando.includes(id));
  return comunes.length ? comunes : asignadas;
}

/** Cuerpos que el usuario puede ver. Vacío = todos los de sus iglesias. */
function cuerposDe(usuario) {
  return usuario ? lista(usuario.cuerpos) : [];
}

/** La iglesia con la que trabaja por omisión (la principal, o la única suya). */
function iglesiaPrincipal(usuario) {
  if (usuario && usuario.iglesia_id) return Number(usuario.iglesia_id);
  const suyas = iglesiasDe(usuario);
  return suyas.length === 1 ? suyas[0] : null;
}

/** Ids de quienes pertenecen a unos cuerpos (más sus líderes). */
function miembrosDeCuerpos(cuerpoIds) {
  if (!cuerpoIds.length) return [];
  return require('./integrantes').idsDeVariosCuerpos(db, cuerpoIds);
}

/** `columna IN (1,2,3)` con sus parámetros, o null si la lista está vacía. */
function enLista(columna, ids, params) {
  if (!ids.length) return null;
  params.push(...ids);
  return `${columna} IN (${ids.map(() => '?').join(',')})`;
}

/**
 * Qué cuentas de usuario alcanza quien administra solo algunas iglesias.
 *
 * Este módulo no se puede acotar como los demás. En una ficha cualquiera,
 * «iglesia_id» dice de qué iglesia es ese registro; en una cuenta de usuario
 * dice cuál es su **iglesia principal**, que es solo la que se le propone al
 * crear cosas y que muchas cuentas tienen en blanco. Acotando por ahí
 * pasaban dos cosas, las dos malas: las cuentas sin iglesia principal
 * desaparecían de la lista —incluida la del administrador general— y quien
 * tenía iglesias asignadas **no se veía ni a sí mismo**, porque su propia
 * cuenta también la tenía en blanco. La lista quedaba vacía sin explicación.
 *
 * La regla ahora es la que corresponde:
 *
 *   · uno siempre se ve a sí mismo, pase lo que pase;
 *   · ve a quienes administran alguna de sus iglesias;
 *   · y a quienes tienen alguna de sus iglesias como principal, que es el
 *     caso de las cuentas creadas desde la ficha de un miembro.
 *
 * Lo que **no** alcanza, a propósito, son las cuentas sin ninguna iglesia
 * asignada: esas ven toda la organización, y quien administra una sola
 * iglesia no tiene por qué poder abrirlas ni cambiarles la contraseña.
 */
function usuariosAlAlcance(usuario, iglesias, params) {
  const partes = [];

  // Uno siempre se ve a sí mismo
  if (usuario && usuario.id) {
    partes.push('usuarios.id = ?');
    params.push(Number(usuario.id));
  }

  // Quien administra alguna de sus iglesias. json_each revienta con un texto
  // que no sea JSON, así que primero se comprueba que lo sea.
  const marcas = iglesias.map(() => '?').join(',');
  partes.push(
    `(usuarios.iglesias IS NOT NULL AND json_valid(usuarios.iglesias)
      AND EXISTS (SELECT 1 FROM json_each(usuarios.iglesias) WHERE json_each.value IN (${marcas})))`
  );
  params.push(...iglesias);

  // Y quien tiene alguna de sus iglesias como principal
  partes.push(`usuarios.iglesia_id IN (${marcas})`);
  params.push(...iglesias);

  return `(${partes.join(' OR ')})`;
}


/**
 * Condiciones que acotan un módulo al alcance del usuario.
 * Devuelve una cadena SQL (o null) y va agregando sus parámetros.
 */
function condiciones(def, usuario, params) {
  const partes = [];
  const iglesias = iglesiasDe(usuario);
  const cuerpos = cuerposDe(usuario);
  const tieneCampo = (nombre) => def.fields.some((f) => f.name === nombre);

  // ---- Por iglesia ----
  if (iglesias.length) {
    if (def.name === 'iglesias') {
      partes.push(enLista('id', iglesias, params));
    } else if (def.name === 'usuarios') {
      partes.push(usuariosAlAlcance(usuario, iglesias, params));
    } else if (tieneCampo('iglesia_id')) {
      partes.push(enLista('iglesia_id', iglesias, params));
    }
  }

  // ---- Por cuerpo ----
  if (cuerpos.length) {
    if (def.name === 'cuerpos') {
      partes.push(enLista('id', cuerpos, params));
    } else if (def.name === 'asistencias') {
      // Los cuerpos convocados se guardan como lista
      const marcas = cuerpos.map(() => '?').join(',');
      params.push(...cuerpos);
      partes.push(`EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value IN (${marcas}))`);
    } else if (tieneCampo('cuerpo_id')) {
      partes.push(enLista('cuerpo_id', cuerpos, params));
    } else if (def.name === 'miembros') {
      partes.push(enLista('id', miembrosDeCuerpos(cuerpos), params) || '1 = 0');
    } else if (tieneCampo('miembro_id')) {
      partes.push(enLista('miembro_id', miembrosDeCuerpos(cuerpos), params) || '1 = 0');
    }
  }

  // ---- Por nivel de tesorería ----
  // La plata de la iglesia y la de un cuerpo son dos libros distintos y se
  // permiten aparte (ver server/tesorerias.js). Va acá, junto al resto del
  // alcance, para que lo tomen los mismos listados, fichas y planillas.
  partes.push(require('./tesorerias').condicion(def, usuario));

  const utiles = partes.filter(Boolean);
  return utiles.length ? utiles.join(' AND ') : null;
}

/** ¿Este registro cae dentro del alcance del usuario? */
function alcanza(def, fila, usuario) {
  if (!fila) return false;
  const iglesias = iglesiasDe(usuario);
  const cuerpos = cuerposDe(usuario);

  if (iglesias.length) {
    if (def.name === 'usuarios') {
      // Mismo criterio que el listado, o se vería en la lista una ficha que
      // después no se deja abrir (ver usuariosAlAlcance)
      const esUnoMismo = usuario && usuario.id && Number(fila.id) === Number(usuario.id);
      const administraAlguna = lista(fila.iglesias).some((id) => iglesias.includes(id));
      const suPrincipal = fila.iglesia_id && iglesias.includes(Number(fila.iglesia_id));
      if (!esUnoMismo && !administraAlguna && !suPrincipal) return false;
    } else {
      const suya = def.name === 'iglesias' ? fila.id : fila.iglesia_id;
      // Los registros sin iglesia (p. ej. las cuentas de la corporación) no son
      // de nadie en particular: quedan fuera del alcance de un usuario acotado.
      if (!suya || !iglesias.includes(Number(suya))) return false;
    }
  }

  if (cuerpos.length) {
    if (def.name === 'cuerpos') return cuerpos.includes(Number(fila.id));
    if (def.name === 'asistencias') return lista(fila.cuerpos).some((c) => cuerpos.includes(c));
    if (fila.cuerpo_id !== undefined && def.fields.some((f) => f.name === 'cuerpo_id')) {
      return cuerpos.includes(Number(fila.cuerpo_id));
    }
    if (def.name === 'miembros') return miembrosDeCuerpos(cuerpos).includes(Number(fila.id));
    if (fila.miembro_id !== undefined && def.fields.some((f) => f.name === 'miembro_id')) {
      return miembrosDeCuerpos(cuerpos).includes(Number(fila.miembro_id));
    }
  }

  // Y del nivel de tesorería, que es la otra cosa que acota lo que se ve
  if (!require('./tesorerias').alcanza(def, fila, usuario)) return false;

  return true;
}

/** ¿Puede trabajar con esta iglesia? */
function alcanzaIglesia(usuario, iglesiaId) {
  const iglesias = iglesiasDe(usuario);
  if (!iglesias.length) return true;
  return !!iglesiaId && iglesias.includes(Number(iglesiaId));
}

/** ¿Puede trabajar con este cuerpo? */
function alcanzaCuerpo(usuario, cuerpoId) {
  const cuerpos = cuerposDe(usuario);
  if (!cuerpos.length) return true;
  return !!cuerpoId && cuerpos.includes(Number(cuerpoId));
}

module.exports = {
  lista, iglesiasDe, iglesiasAsignadas, cuerposDe, iglesiaPrincipal, miembrosDeCuerpos,
  condiciones, alcanza, alcanzaIglesia, alcanzaCuerpo,
};
