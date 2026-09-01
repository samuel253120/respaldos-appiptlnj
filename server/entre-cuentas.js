/**
 * La plata que solo cambió de bolsillo.
 *
 * Un servicio deja tres movimientos: la ofrenda entra a la cuenta de la
 * iglesia, sale el aporte que le toca a la corporación y ese mismo aporte entra
 * al «Fondo para la corporación» de esa misma iglesia. Y cuando el fondo se
 * traspasa a la corporación, el traspaso deja otros dos.
 *
 * El resumen los sumaba todos. Medido en un día sin nada anotado: una ofrenda
 * de $100.000 hacía decir «entraron $110.000», y al traspasar el aporte,
 * «$120.000». Entraron cien mil. El balance salía bien de casualidad —cada peso
 * de más estaba las dos veces, como ingreso y como egreso—, pero las dos cifras
 * que la tesorera lee en voz alta en la reunión estaban infladas.
 *
 * ── Cuándo un traslado es interno ──
 *
 * No siempre. Un traslado tiene dos lados, y que sea «plata que no entró ni
 * salió» depende de SI LOS DOS LADOS ESTÁN A LA VISTA:
 *
 *   · Mirando toda la organización, el aporte de una ofrenda tiene sus dos
 *     lados dentro: no entró nada, solo cambió de cuenta. Se descuenta.
 *   · Mirando UNA iglesia, el traspaso de su fondo a la corporación tiene un
 *     solo lado dentro —el egreso—: de esa iglesia esa plata SÍ salió. Se
 *     cuenta como egreso, que es lo que fue.
 *
 * Por eso no basta con marcar los movimientos: hay que contar, dentro de lo que
 * se está mirando, cuántos lados de cada par quedaron. Los pares completos se
 * descuentan; los que quedaron a medias, no.
 */

/**
 * Con qué se emparejan los dos lados de un traslado.
 *
 * Los dos movimientos de un traspaso comparten su traspaso_id; los dos del
 * aporte de una ofrenda, su servicio_id. Los ingresos de la ofrenda propiamente
 * tal también llevan servicio_id, así que la marca `entre_cuentas` es la que
 * dice cuáles son los dos lados del traslado y cuáles son plata que entró.
 *
 * Y los dos de un préstamo entre dos cajas de la organización comparten su
 * `espejo_de` —el id del original, que ambos llevan escrito—. Va PRIMERO en el
 * CASE porque un pago de deuda no tiene ni traspaso ni servicio, y sin esa
 * rama los dos lados caerían en el mismo cajón «S nulo» junto con todo lo
 * demás que tampoco los tiene.
 */
const PAR = `CASE WHEN espejo_de IS NOT NULL THEN 'M' || espejo_de
                  WHEN traspaso_id IS NOT NULL THEN 'T' || traspaso_id
                  ELSE 'S' || servicio_id END`;

/**
 * Un movimiento está marcado como traslado.
 *
 * Con COALESCE y no `entre_cuentas = 1` a secas, porque la marca puede venir en
 * blanco: la lleva la columna desde esta versión, y los movimientos anteriores a
 * la migración la tienen nula. Sin el COALESCE, la comparación no da ni sí ni
 * no —da nulo—, y al NEGARLA (que es como la usa el desglose por categoría)
 * sigue siendo nula: la fila no entra ni por marcada ni por no marcada, y
 * desaparece del informe sin que nadie lo note.
 */
const MARCADO = 'COALESCE(entre_cuentas, 0) = 1';

/** La condición que deja solo los traslados con SUS DOS LADOS dentro de lo mirado. */
function completosDentro(whereSql) {
  const dentro = `FROM tesoreria ${whereSql}${whereSql ? ' AND' : 'WHERE'} ${MARCADO}`;
  return `${MARCADO} AND (${PAR}) IN (
            SELECT ${PAR} ${dentro} GROUP BY 1 HAVING COUNT(*) > 1)`;
}

/**
 * Lo que entró, lo que salió y lo que solo se movió, dentro de lo que se está
 * mirando. `whereSql` y `params` son el recorte que ya venía armado.
 */
function totalesDe(db, whereSql, params) {
  const suma = (extra) =>
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
           COALESCE(SUM(CASE WHEN tipo = 'Egreso'  THEN monto ELSE 0 END), 0) AS egresos,
           COUNT(*) AS movimientos
         FROM tesoreria ${whereSql}${extra ? `${whereSql ? ' AND ' : 'WHERE '}${extra}` : ''}`
      )
      .get(...params, ...(extra ? params : []));

  const todo = suma(null);
  const movido = suma(completosDentro(whereSql));

  /*
   * Y lo que nació de una DEUDA sale también de las dos cifras corrientes: un
   * préstamo no es un ingreso de la iglesia, y devolverlo no es un gasto suyo.
   * Se dice aparte, en sus propias líneas (ver server/lo-prestado.js).
   *
   * Se excluye lo que la resta de arriba ya sacó, para no restar dos veces la
   * misma plata: un préstamo entre dos cajas de la casa, con sus dos lados a la
   * vista, ya se fue como traslado.
   */
  const prestado = require('./lo-prestado')
    .deLoQueSeMira(db, whereSql, params, completosDentro(whereSql));
  const entraron = todo.ingresos - movido.ingresos - prestado.recibido - prestado.cobrado;
  const salieron = todo.egresos - movido.egresos - prestado.entregado - prestado.devuelto;

  return {
    ingresos: entraron,
    egresos: salieron,
    balance: entraron - salieron,
    /*
     * Las cuatro de lo prestado, cada una por su nombre. Van acá y no en otra
     * consulta para que el balance impreso y la pantalla salgan del mismo
     * lugar y no puedan discrepar.
     */
    prestado_recibido: prestado.recibido,
    prestado_devuelto: prestado.devuelto,
    prestado_entregado: prestado.entregado,
    prestado_cobrado: prestado.cobrado,
    movimientos_de_deudas: prestado.movimientos,
    /*
     * Lo movido se dice UNA vez, no dos: los dos lados de un traslado son el
     * mismo dinero. Se toma el lado que entró, que es idéntico al que salió.
     */
    movido: movido.ingresos,
    movimientos_entre_cuentas: movido.movimientos,
    movimientos: todo.movimientos,
  };
}

/**
 * Mes por mes, con la misma resta.
 *
 * Los dos lados de un traslado caen siempre en el mismo mes —los del traspaso
 * comparten su fecha, y los del aporte, la del servicio—, así que emparejarlos
 * sobre todo lo que se está mirando y después agrupar por mes da lo mismo que
 * emparejarlos mes a mes, y se hace en una sola pasada.
 */
function porMesDe(db, whereSql, params) {
  const dentro = completosDentro(whereSql);
  const suma = (cuando) => `SUM(CASE WHEN ${cuando} THEN monto ELSE 0 END)`;
  return db
    .prepare(
      `SELECT substr(fecha, 1, 7) AS mes,
              COALESCE(${suma(`tipo = 'Ingreso' AND NOT (${dentro})`)}, 0) AS ingresos,
              COALESCE(${suma(`tipo = 'Egreso'  AND NOT (${dentro})`)}, 0) AS egresos,
              COALESCE(${suma(`tipo = 'Ingreso' AND (${dentro})`)}, 0)     AS movido,
              COUNT(*) AS movimientos
         FROM tesoreria ${whereSql}
        GROUP BY substr(fecha, 1, 7)
        ORDER BY substr(fecha, 1, 7)`
    )
    .all(...params, ...params, ...params, ...params);
}

/**
 * Cuenta por cuenta, con la misma resta: cuánto entró y cuánto salió de cada una.
 *
 * Sin JOIN y con la tabla sin alias, a propósito: el recorte que llega
 * (`whereSql`) trae los nombres de columna a secas —así los emite
 * server/alcance.js— y la condición de los traslados también. Poner un alias
 * obligaría a reescribir las dos a mano, que es la clase de arreglo que un día
 * se olvida. Los nombres de las cuentas se pegan después, en una sola consulta.
 */
function porCuentaDe(db, whereSql, params) {
  const dentro = completosDentro(whereSql);
  const suma = (cuando) => `SUM(CASE WHEN ${cuando} THEN monto ELSE 0 END)`;
  const filas = db
    .prepare(
      `SELECT cuenta_id,
              COALESCE(${suma(`tipo = 'Ingreso' AND NOT (${dentro})`)}, 0) AS ingresos,
              COALESCE(${suma(`tipo = 'Egreso'  AND NOT (${dentro})`)}, 0) AS egresos,
              COUNT(*) AS movimientos
         FROM tesoreria ${whereSql}
        GROUP BY cuenta_id`
    )
    .all(...params, ...params, ...params);
  if (!filas.length) return [];

  const cuentas = db
    .prepare(
      `SELECT id, nombre, ambito, tipo FROM cuentas_tesoreria
        WHERE id IN (${filas.map(() => '?').join(',')})`
    )
    .all(...filas.map((f) => f.cuenta_id));
  const porId = new Map(cuentas.map((c) => [c.id, c]));

  return filas
    .map((f) => {
      const c = porId.get(f.cuenta_id) || {};
      return {
        id: f.cuenta_id,
        nombre: c.nombre || `Cuenta ${f.cuenta_id}`,
        ambito: c.ambito || '',
        tipo: c.tipo || '',
        ingresos: f.ingresos, egresos: f.egresos, movimientos: f.movimientos,
      };
    })
    .sort((a, b) => (a.ambito + a.nombre).localeCompare(b.ambito + b.nombre, 'es'));
}

/** El desglose por categoría, sin los traslados: dice en qué se gastó, no de dónde a dónde se movió. */
function porCategoriaDe(db, whereSql, params) {
  const fuera = completosDentro(whereSql);
  return db
    .prepare(
      `SELECT tipo, categoria, COALESCE(SUM(monto),0) AS total
         FROM tesoreria ${whereSql}${whereSql ? ' AND' : 'WHERE'} NOT (${fuera})
        GROUP BY tipo, categoria ORDER BY total DESC`
    )
    .all(...params, ...params);
}

module.exports = { PAR, MARCADO, completosDentro, totalesDe, porCategoriaDe, porMesDe, porCuentaDe };
