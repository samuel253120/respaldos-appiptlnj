/**
 * Las sumas de un conjunto de servicios.
 *
 * El módulo guardaba, servicio por servicio, cuánta gente asistió y cuánto se
 * ofrendó, y no devolvía una sola suma: para saber cuánto se ofrendó en agosto
 * había que ir fila por fila con una calculadora, y una suma hecha a mano cada
 * mes es una suma que alguna vez sale mal sin que nadie pueda comprobarlo.
 *
 * Acá están las mismas cuentas que usan las dos rutas del módulo —el total de
 * lo que se está viendo y el informe por mes y por tipo—, para que no puedan
 * discrepar entre ellas. QUÉ servicios se suman no se decide acá: llega hecho,
 * en el mismo trozo de consulta con que el motor arma el listado, con su
 * alcance, su búsqueda, sus filtros y su rango de fechas.
 */

const SUMAS = `
  COUNT(*) AS servicios,
  COALESCE(SUM(ofrenda_total), 0)      AS ofrenda,
  COALESCE(SUM(ofrenda_fondo), 0)      AS aporte,
  COALESCE(SUM(ofrenda_iglesia), 0)    AS queda,
  COALESCE(SUM(asistencia_total), 0)   AS asistencia,
  COALESCE(SUM(asistencia_adultos), 0) AS adultos,
  COALESCE(SUM(asistencia_ninos), 0)   AS ninos,
  COALESCE(SUM(CASE WHEN COALESCE(asistencia_total, 0) > 0 THEN 1 ELSE 0 END), 0) AS con_asistencia`;

/**
 * El promedio sale de los servicios que TIENEN la asistencia anotada, no de
 * todos.
 *
 * Un servicio al que nadie le anotó la asistencia no es un servicio al que no
 * fue nadie. Repartiendo entre todos, un mes con dos servicios sin anotar
 * bajaba el promedio como si hubieran ido cero personas, que es decir algo que
 * no pasó. De cuántos salió va en la respuesta —`con_asistencia`— y la pantalla
 * lo dice cuando no son todos.
 */
function conPromedios(fila) {
  return {
    ...fila,
    promedio_asistencia: fila.con_asistencia ? Math.round(fila.asistencia / fila.con_asistencia) : 0,
  };
}

/** El total de los servicios que caen dentro de esta consulta. */
function resumen(db, whereSql, params) {
  return conPromedios(db.prepare(`SELECT ${SUMAS} FROM servicios ${whereSql}`).get(...params));
}

/**
 * Mes por mes, de enero a diciembre: una hoja que se lleva a la reunión se lee
 * hacia adelante, no del último mes hacia atrás. El mes sale de la propia
 * fecha, que se guarda como «2026-08-09».
 */
function porMes(db, whereSql, params) {
  return db
    .prepare(
      `SELECT substr(fecha, 1, 7) AS mes, ${SUMAS}
         FROM servicios ${whereSql}
        GROUP BY mes ORDER BY mes`
    )
    .all(...params)
    .map(conPromedios);
}

/**
 * Por tipo de servicio, empezando por el que más veces se celebró.
 *
 * El agrupado repite la expresión entera en vez de decir `GROUP BY tipo`, y no
 * es por gusto: hay una columna que se llama `tipo`, así que SQLite agrupa por
 * ELLA y no por el nombre que se le puso a la cuenta. Con eso, un servicio sin
 * tipo y otro con el tipo en blanco salían en dos filas distintas, las dos
 * rotuladas «Sin tipo», y el informe mostraba el mismo tipo dos veces. Se vio
 * al probarlo, no al leerlo. (Con el mes no pasa: no hay ninguna columna que se
 * llame `mes`, así que ahí el nombre de la cuenta es el que manda.)
 */
const COMO_SE_LLAMA_EL_TIPO = "COALESCE(NULLIF(TRIM(tipo), ''), 'Sin tipo')";

function porTipo(db, whereSql, params) {
  return db
    .prepare(
      `SELECT ${COMO_SE_LLAMA_EL_TIPO} AS tipo, ${SUMAS}
         FROM servicios ${whereSql}
        GROUP BY ${COMO_SE_LLAMA_EL_TIPO} ORDER BY servicios DESC, tipo`
    )
    .all(...params)
    .map(conPromedios);
}

module.exports = { SUMAS, conPromedios, resumen, porMes, porTipo };
