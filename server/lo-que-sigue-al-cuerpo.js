/**
 * Cuando un cuerpo se cambia de iglesia, lo suyo se va con él.
 *
 * La iglesia de un cuerpo no es un rótulo: es lo que decide QUIÉN VE cada cosa
 * suya. Y varias tablas no la eligen, la COPIAN del cuerpo al guardarse —la
 * cuenta de tesorería toma la del cuerpo, la ficha de integrante toma la del
 * cuerpo, la cuota toma la de la ficha, el movimiento toma la de la cuenta—.
 * Esa copia se hacía una vez y no se volvía a mirar.
 *
 * Medido sobre un cuerpo con 52 integrantes al mudarlo de la Iglesia Central a
 * la Norte:
 *
 *   sus 2 cuentas de tesorería ......  se quedaron en la Central
 *   sus 52 fichas de integrante .....  se quedaron en la Central
 *   los movimientos de sus cuentas ..  se quedaron en la Central
 *
 * Lo que queda es un cuerpo que dice pertenecer a una iglesia donde no está
 * nada de lo suyo: la tesorera de la iglesia nueva no ve su caja, la de la
 * vieja la sigue viendo con su plata, y la suma en su balance. No es un rótulo
 * desactualizado: es una diferencia de alcance, o sea de quién tiene acceso a
 * esa plata y a esa gente.
 *
 * EL CRITERIO. Sigue al cuerpo lo que COPIÓ su iglesia. No sigue lo que la
 * lleva escrita por derecho propio: un acta de reunión y una ficha de
 * inventario tienen «Iglesia» como un campo que alguien elige, y ahí ese dato
 * dice dónde pasó la cosa. Si algún día se decide que también deben seguir al
 * cuerpo, el lugar es este archivo y la línea es una.
 */
const { db } = require('./db');

/**
 * Las tablas que copian del cuerpo su iglesia, y por dónde se las alcanza.
 *
 * `por` es la columna que las ata al cuerpo. `porSuCuenta` es para los
 * movimientos de tesorería: heredan la iglesia de la CUENTA, y no todos llevan
 * escrito el cuerpo, así que se los busca por la cuenta y no por el cuerpo.
 */
const LO_SUYO = [
  { tabla: 'cuentas_tesoreria', que: 'cuenta(s) de tesorería' },
  { tabla: 'integrantes_cuerpo', que: 'ficha(s) de integrante' },
  { tabla: 'cuotas_cuerpo', que: 'cuota(s) registrada(s)' },
  { tabla: 'directivas', que: 'directiva(s)' },
  { tabla: 'evaluaciones_integrantes', que: 'evaluación(es) de período de prueba' },
  { tabla: 'tesoreria', que: 'movimiento(s) de sus cuentas', porSuCuenta: true },
];

/**
 * La lista de arriba está escrita a mano y el esquema está escrito en otra
 * parte: si alguien renombra una tabla o le saca `cuerpo_id`, los dos textos
 * dejan de coincidir y nadie se entera.
 *
 * La primera versión de esto se saltaba en silencio la tabla que no calzaba.
 * Era el peor final posible: la plata del cuerpo dejaba de seguirlo y el
 * sistema no decía nada, que es exactamente el defecto que este archivo vino a
 * arreglar. Así que se revisa al cargar y revienta. Es un error de
 * programación, no de datos: mejor que se caiga en la máquina de quien lo
 * cambió y no que se descubra el día que una tesorera no encuentre su caja.
 */
function revisar(lista = LO_SUYO, conexion = db) {
  const hay = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  for (const cual of lista) {
    if (!hay(cual.tabla)) {
      throw new Error(
        `server/lo-que-sigue-al-cuerpo.js nombra la tabla "${cual.tabla}", que no existe. ` +
        'Si el módulo se quitó o cambió de nombre, corrija LO_SUYO; si no, lo del cuerpo ' +
        'se quedaría en la iglesia anterior sin que nadie lo note.'
      );
    }
    const suyas = conexion.prepare(`PRAGMA table_info("${cual.tabla}")`).all().map((c) => c.name);
    const faltan = ['iglesia_id', cual.porSuCuenta ? 'cuenta_id' : 'cuerpo_id']
      .filter((c) => !suyas.includes(c));
    if (faltan.length) {
      throw new Error(
        `La tabla "${cual.tabla}" no tiene ${faltan.join(' ni ')}, que es por donde ` +
        'server/lo-que-sigue-al-cuerpo.js la alcanza para mudarla con el cuerpo.'
      );
    }
  }
  return true;
}

/**
 * Le pasa a lo del cuerpo la iglesia que el cuerpo tiene ahora. Devuelve qué
 * se movió, para poder decirlo: mover filas de dinero y de gente sin dejar
 * constancia es justo lo que el Registro de Cambios existe para evitar.
 *
 * El orden importa poco salvo en un punto: los movimientos se buscan POR SU
 * CUENTA, así que se resuelven mirando `cuentas_tesoreria`, que en esta misma
 * pasada también se actualiza. Se los busca por `cuerpo_id` de la cuenta, que
 * no cambia, así que da lo mismo cuál vaya primero.
 */
function mudarLoSuyo(cuerpoId, iglesiaId, conexion = db) {
  const movidas = [];
  for (const cual of LO_SUYO) {
    const donde = cual.porSuCuenta
      ? 'cuenta_id IN (SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ?)'
      : 'cuerpo_id = ?';

    // El `!=` del final no es de más: lo que ya está donde va no se cuenta
    // como movido. `changes` es lo que después se anota en el Registro de
    // Cambios, y «se movieron 2 cuentas» cuando una ya estaba ahí es una cifra
    // falsa en el único lugar donde se va a buscar la verdad de esto.
    const cambios = conexion
      .prepare(
        `UPDATE "${cual.tabla}" SET iglesia_id = ?
          WHERE ${donde} AND (iglesia_id IS NULL OR iglesia_id != ?)`
      )
      .run(iglesiaId, cuerpoId, iglesiaId).changes;
    if (cambios) movidas.push({ tabla: cual.tabla, que: cual.que, cuantas: cambios });
  }
  return movidas;
}

/** «2 cuenta(s) de tesorería, 52 ficha(s) de integrante». */
function comoSeLee(movidas) {
  return movidas.map((m) => `${Number(m.cuantas).toLocaleString('es-CL')} ${m.que}`).join(', ');
}

revisar();

module.exports = { LO_SUYO, mudarLoSuyo, comoSeLee, revisar };
