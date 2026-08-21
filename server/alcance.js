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

/** Iglesias que el usuario puede ver. Vacío = todas. */
function iglesiasDe(usuario) {
  if (!usuario) return [];
  const ids = new Set(lista(usuario.iglesias));
  if (usuario.iglesia_id) ids.add(Number(usuario.iglesia_id));
  return [...ids];
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

  const utiles = partes.filter(Boolean);
  return utiles.length ? utiles.join(' AND ') : null;
}

/** ¿Este registro cae dentro del alcance del usuario? */
function alcanza(def, fila, usuario) {
  if (!fila) return false;
  const iglesias = iglesiasDe(usuario);
  const cuerpos = cuerposDe(usuario);

  if (iglesias.length) {
    const suya = def.name === 'iglesias' ? fila.id : fila.iglesia_id;
    // Los registros sin iglesia (p. ej. las cuentas de la corporación) no son
    // de nadie en particular: quedan fuera del alcance de un usuario acotado.
    if (!suya || !iglesias.includes(Number(suya))) return false;
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
  lista, iglesiasDe, cuerposDe, iglesiaPrincipal, miembrosDeCuerpos,
  condiciones, alcanza, alcanzaIglesia, alcanzaCuerpo,
};
