/**
 * Cuánta de esta plata es prestada.
 *
 * Un préstamo entra a la caja y se lee como si la iglesia lo hubiera reunido.
 * Medido antes de esto, siguiendo un caso real: un hermano presta $ 400.000 y
 * se le devuelve, y el balance de la reunión decía «entraron $ 1.400.000,
 * salieron $ 1.400.000» donde la iglesia reunió y gastó un millón. Un 40 % de
 * más en las dos cifras que la tesorera lee en voz alta. Y la caja de un cuerpo
 * con un préstamo de $ 150.000 decía tener $ 150.000, teniendo cero y debiendo
 * todo.
 *
 * El balance salía cuadrado —cada peso de más estaba las dos veces— pero no
 * decía la verdad: un préstamo no es un ingreso de la iglesia, es plata de otro
 * que hay que devolver.
 *
 * ── QUÉ SE DICE APARTE, Y POR QUÉ ASÍ ──
 *
 * Todo movimiento enlazado a una deuda sale de los ingresos y de los egresos
 * corrientes y se dice en su propia línea. Los dos lados: lo que entró prestado
 * y lo que se devolvió, porque el defecto medido inflaba las DOS cifras —el
 * préstamo entró una vez y salió otra—.
 *
 * Y NO SE RESTA DOS VECES. Un préstamo entre dos cajas de la propia
 * organización ya se descuenta como traslado cuando sus dos lados están a la
 * vista (ver server/entre-cuentas.js): eso no es plata prestada por nadie de
 * afuera, es plata que cambió de bolsillo. Por eso lo de acá excluye
 * expresamente lo que aquello ya sacó. Mirando UNA de las dos cajas el par
 * queda a medias, no se descuenta como traslado, y entonces sí aparece acá: a
 * esa caja esa plata le entró prestada, que es exactamente lo que pasó.
 *
 * ── Y LO QUE SE DEBE HOY ──
 *
 * Eso no sale de los movimientos de un período sino del estado de las deudas
 * en este momento, así que no lleva el rango de fechas: la pregunta «¿cuánto
 * debe la iglesia?» se contesta hoy, no en agosto. Sale de restarle a cada
 * deuda viva lo que suman sus pagos, que es la misma cuenta que hace su plan de
 * cuotas —y no una cifra guardada, que habría que acordarse de corregir cada
 * vez que entra un peso—.
 */
const { POR_PAGAR, POR_COBRAR, CERRADAS } = require('./modules/deudas');

/** Un movimiento nacido de una deuda. */
const DE_UNA_DEUDA = 'deuda_id IS NOT NULL';

/**
 * Lo prestado dentro de lo que se está mirando, en sus cuatro cifras.
 *
 * `yaDescontado` es la condición de los traslados que el resumen ya sacó, para
 * no restar dos veces la misma plata.
 */
function deLoQueSeMira(db, whereSql, params, yaDescontado) {
  /*
   * SIN descartar los espejos, a propósito. Acá se mira lo que le pasó a las
   * cajas que se están mirando, y desde la caja que PUSO la plata en un
   * préstamo interno el movimiento suyo es el espejo: descartarlo dejaba esa
   * salida fuera de «préstamos entregados» y sumando en sus egresos
   * corrientes, como si la iglesia se hubiera gastado lo que prestó.
   *
   * No hay riesgo de contar dos veces: si las dos cajas del par están a la
   * vista, `yaDescontado` las saca a las dos —esa plata solo cambió de
   * bolsillo—; y si está una sola, hay una sola fila que contar. Lo de contar
   * dos veces sí importa donde se suma lo PAGADO de una deuda, que no se acota
   * por caja: eso lo cuida `LO_QUE_FALTA`, más abajo.
   */
  const donde = `${whereSql}${whereSql ? ' AND ' : 'WHERE '}${DE_UNA_DEUDA}`
    + `${yaDescontado ? ` AND NOT (${yaDescontado})` : ''}`;
  const veces = yaDescontado ? 2 : 1;
  const f = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' AND desembolso = 1 THEN monto ELSE 0 END), 0) AS recibido,
         COALESCE(SUM(CASE WHEN tipo = 'Egreso'  AND desembolso = 1 THEN monto ELSE 0 END), 0) AS entregado,
         COALESCE(SUM(CASE WHEN tipo = 'Egreso'  AND desembolso = 0 THEN monto ELSE 0 END), 0) AS devuelto,
         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' AND desembolso = 0 THEN monto ELSE 0 END), 0) AS cobrado,
         COUNT(*) AS movimientos
       FROM tesoreria ${donde}`
    )
    .get(...Array.from({ length: veces }, () => params).flat());
  return f;
}

/**
 * Lo que falta pagar de una deuda, en SQL: su monto menos lo que suman sus
 * pagos. La misma cuenta que hace su plan de cuotas.
 */
const LO_QUE_FALTA = `
  MAX(0, deudas.monto - COALESCE((
    SELECT SUM(t.monto) FROM tesoreria t
     WHERE t.deuda_id = deudas.id AND t.desembolso = 0 AND (t.espejo_de IS NULL OR t.espejo_de = t.id)
  ), 0))`;

/**
 * Las deudas vivas que esta persona alcanza, con los mismos filtros de la
 * pantalla MENOS las fechas.
 *
 * Sin las fechas a propósito: «¿cuánto debe la iglesia?» se contesta hoy, no en
 * agosto. Pero con los demás filtros sí, porque si la tesorera de un cuerpo
 * está mirando su caja, lo que se debe es lo de su caja: una cifra que no
 * respeta el recorte de la pantalla en la que está puesta dice de otra cosa.
 *
 * Los parámetros se ponen EN EL ORDEN EN QUE APARECEN EN EL SQL y no en el que
 * resulte cómodo: `condiciones` los va agregando al arreglo que se le pasa, así
 * que llamarla antes de meter los estados hace que la consulta pida los estados
 * en el lugar de los ids. Se vio: devolvía cero siempre.
 */
function suyasYVivas(db, usuario, params, filtros = {}) {
  const huecos = CERRADAS.map(() => '?').join(',');
  params.push(...CERRADAS);
  const donde = [`estado NOT IN (${huecos})`];
  for (const [columna, valor] of [
    ['iglesia_id', filtros.iglesia_id], ['cuerpo_id', filtros.cuerpo_id],
    ['cuenta_id', filtros.cuenta_id],
  ]) {
    if (!valor) continue;
    donde.push(`${columna} = ?`);
    params.push(valor);
  }
  const suyas = require('./alcance')
    .condiciones(require('./registry').getModule('deudas'), usuario, params);
  if (suyas) donde.push(suyas);
  return `WHERE ${donde.join(' AND ')}`;
}

/** Lo que se debe y lo que le deben, hoy, dentro de lo que esta persona alcanza. */
function loQueSeDebeHoy(db, usuario, filtros) {
  const params = [];
  const donde = suyasYVivas(db, usuario, params, filtros);
  const f = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direccion = ? THEN ${LO_QUE_FALTA} ELSE 0 END), 0) AS se_debe,
         COALESCE(SUM(CASE WHEN direccion = ? THEN ${LO_QUE_FALTA} ELSE 0 END), 0) AS le_deben,
         COUNT(*) AS deudas_vivas
       FROM deudas ${donde}`
    )
    .get(POR_PAGAR, POR_COBRAR, ...params);
  return f;
}

/**
 * Cuánto del saldo de cada caja es plata prestada que hay que devolver.
 *
 * Devuelve un mapa por id de caja. Lo pide el resumen para poder decir
 * «$ 150.000 · de eso, $ 150.000 son prestados», que es la diferencia entre un
 * cuerpo que tiene con qué y uno que no.
 */
function loPrestadoPorCaja(db, usuario, filtros) {
  const params = [];
  const donde = suyasYVivas(db, usuario, params, filtros);
  const filas = db
    .prepare(
      `SELECT cuenta_id, COALESCE(SUM(${LO_QUE_FALTA}), 0) AS prestado
         FROM deudas ${donde} AND direccion = ? GROUP BY cuenta_id`
    )
    .all(...params, POR_PAGAR);
  return new Map(filas.map((f) => [f.cuenta_id, Number(f.prestado) || 0]));
}

module.exports = { DE_UNA_DEUDA, deLoQueSeMira, loQueSeDebeHoy, loPrestadoPorCaja, LO_QUE_FALTA };
