/**
 * De qué nivel es cada peso: de la iglesia o de un cuerpo.
 *
 * La organización lleva dos tesorerías distintas y hasta ahora eran el mismo
 * permiso:
 *
 *   la GENERAL ...  las cuentas de la corporación y de cada iglesia local, sus
 *                   movimientos y los traspasos entre ellas.
 *   la del CUERPO .  la cuenta propia de cada cuerpo o grupo, sus movimientos y
 *                   las cuotas que pagan sus integrantes.
 *
 * Dar «Tesorería» daba las dos, así que para que la tesorera de un cuerpo
 * llevara la plata de su cuerpo había que abrirle también el libro de la
 * iglesia. Ahora son dos llaves (ver LLAVES en server/permissions.js) y esto es
 * lo que las hace valer, fila por fila.
 *
 * QUIÉN DECIDE EL NIVEL DE UNA FILA. La cuenta, siempre. Un movimiento no es
 * del cuerpo porque alguien haya escrito el cuerpo en su ficha, sino porque el
 * dinero entró o salió de una cuenta del cuerpo. Es el único dato que no se
 * puede contradecir consigo mismo, y por eso el nivel se lee de ahí y no del
 * campo suelto.
 *
 * DÓNDE SE APLICA. En un solo lugar: en las dos funciones de server/alcance.js
 * por las que ya pasan todos los listados, las fichas, las planillas, los
 * guardados y los borrados. Colgarlo ahí es lo que hace que no quede una
 * puerta sin cerrar.
 *
 * ESTO NO REEMPLAZA AL ALCANCE. Los cuerpos asignados en la ficha del usuario
 * siguen diciendo SOBRE CUÁLES cuerpos alcanza; esto dice de qué NIVEL puede
 * ver la plata. Se aplican los dos.
 */
const { can } = require('./permissions');

const GENERAL = 'tesoreria_general';
const CUERPO = 'tesoreria_cuerpo';

/**
 * Los módulos que llevan plata y cómo se sabe de qué nivel es cada fila.
 *
 *   `columna`  la columna propia que dice de qué cuerpo es (null = ninguna).
 *   `siempre`  el nivel fijo, para lo que solo puede ser de una clase.
 *   `cuentas`  las columnas que apuntan a una cuenta, cuando el nivel hay que
 *              ir a buscarlo allá.
 */
const LIBROS = {
  cuentas_tesoreria: { columna: 'cuerpo_id' },
  tesoreria: { columna: 'cuerpo_id', cuentas: ['cuenta_id'] },
  /*
   * Una deuda es del nivel de SU CAJA, igual que un movimiento: de ahí sale su
   * cuerpo al guardar, así que la columna es de fiar y la cuenta la respalda.
   */
  deudas: { columna: 'cuerpo_id', cuentas: ['cuenta_id'] },
  cuotas_cuerpo: { siempre: CUERPO },
  /*
   * Un traspaso es de quien lo SACA, y por eso el nivel lo decide su cuenta de
   * origen y no las dos. Miraba las dos, y con eso la tesorera de un cuerpo que
   * le entregaba a su iglesia anotaba un traspaso que después no veía: el
   * destino era de nivel general, el listado se lo escondía y la entrega
   * desaparecía de su vista. Entregar hacia arriba no es alcanzar lo de arriba
   * (ver server/entregar-hacia-arriba.js).
   */
  traspasos: { cuentas: ['cuenta_origen_id'] },
};

/** ¿Este módulo lleva plata? */
function esLibro(def) {
  return !!(def && LIBROS[def.name]);
}

/** ¿Alcanza este nivel? */
function alcanzaNivel(usuario, llave) {
  return can(usuario, llave, 'view');
}

/** Los niveles que esta persona NO alcanza. */
function fuera(usuario) {
  return [GENERAL, CUERPO].filter((llave) => !alcanzaNivel(usuario, llave));
}

/**
 * La condición para el WHERE del listado, o null si no hace falta ninguna.
 *
 * Las cuentas y los movimientos se resuelven con su propia columna cuando la
 * tienen; los traspasos, mirando las dos cuentas que tocan: uno que mueve
 * plata de un cuerpo es del cuerpo, aunque el otro lado sea de la iglesia.
 */
function condicion(def, usuario) {
  if (!esLibro(def)) return null;
  const sinLlave = fuera(usuario);
  if (!sinLlave.length) return null;

  const libro = LIBROS[def.name];
  const tabla = `"${def.name}"`;

  // Lo que solo puede ser de una clase se resuelve sin mirar nada más
  if (libro.siempre) return sinLlave.includes(libro.siempre) ? '1 = 0' : null;

  const partes = [];

  // Por su propia columna, cuando la tiene y es de fiar (se toma de la cuenta
  // al guardar, ver el hook de server/modules/tesoreria.js)
  if (libro.columna) {
    if (sinLlave.includes(CUERPO)) partes.push(`${tabla}."${libro.columna}" IS NULL`);
    if (sinLlave.includes(GENERAL)) partes.push(`${tabla}."${libro.columna}" IS NOT NULL`);
  }

  // Y por las cuentas que toca: no se ve un movimiento cuya cuenta no se ve
  for (const columna of libro.cuentas || []) {
    for (const llave of sinLlave) {
      const deCuerpo = llave === CUERPO ? 'IS NOT NULL' : 'IS NULL';
      partes.push(
        `NOT EXISTS (SELECT 1 FROM cuentas_tesoreria c WHERE c.id = ${tabla}."${columna}" AND c.cuerpo_id ${deCuerpo})`
      );
    }
  }

  return partes.length ? partes.join(' AND ') : null;
}

/** El nivel de una fila que ya se tiene a mano. */
function nivelDe(def, fila, db) {
  const libro = LIBROS[def.name];
  if (!libro) return null;
  if (libro.siempre) return libro.siempre;

  if (libro.columna && fila[libro.columna] !== undefined) {
    return fila[libro.columna] ? CUERPO : GENERAL;
  }

  // Un traspaso toca dos cuentas: si alguna es de un cuerpo, es del cuerpo
  const conexion = db || require('./db').db;
  for (const columna of libro.cuentas || []) {
    const id = fila[columna];
    if (!id) continue;
    const cuenta = conexion.prepare('SELECT cuerpo_id FROM cuentas_tesoreria WHERE id = ?').get(id);
    if (cuenta && cuenta.cuerpo_id) return CUERPO;
  }
  return GENERAL;
}

/** ¿Esta fila cae dentro de los niveles que alcanza? */
function alcanza(def, fila, usuario, db) {
  if (!esLibro(def) || !fila) return true;
  const libro = LIBROS[def.name];

  // Un traspaso puede tocar los dos niveles a la vez: hacen falta los dos
  if (!libro.columna && (libro.cuentas || []).length > 1) {
    const conexion = db || require('./db').db;
    for (const columna of libro.cuentas) {
      const id = fila[columna];
      if (!id) continue;
      const cuenta = conexion.prepare('SELECT cuerpo_id FROM cuentas_tesoreria WHERE id = ?').get(id);
      if (!cuenta) continue;
      if (!alcanzaNivel(usuario, cuenta.cuerpo_id ? CUERPO : GENERAL)) return false;
    }
    return true;
  }

  return alcanzaNivel(usuario, nivelDe(def, fila, db));
}

/**
 * Al guardar: el aviso que corresponde, o null si puede.
 *
 * Sin esto, quien no ve la tesorería de los cuerpos podría igual registrarle
 * un movimiento escribiendo la cuenta a mano, y después no vería lo que
 * acaba de anotar.
 */
function alGuardar(def, fila, usuario, db) {
  if (alcanza(def, fila, usuario, db)) return null;
  return nivelDe(def, fila, db) === CUERPO
    ? 'No tiene permiso sobre la tesorería de los cuerpos'
    : 'No tiene permiso sobre la tesorería de la iglesia y la corporación';
}

module.exports = { GENERAL, CUERPO, LIBROS, esLibro, condicion, nivelDe, alcanza, alGuardar, fuera };
