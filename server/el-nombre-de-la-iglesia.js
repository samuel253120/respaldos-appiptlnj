/**
 * Cuando una iglesia cambia de nombre, sus cajas cambian con ella.
 *
 * Al crear una iglesia, el módulo le abre solas sus dos cuentas de tesorería y
 * les escribe el nombre de la iglesia adentro. Ese nombre se copiaba una vez y
 * no se volvía a mirar. Medido creando «Prueba A» y renombrándola:
 *
 *   al crearla ..................... Tesorería general — Prueba A
 *   renombrada a «Prueba A RENOMBRADA» .. Tesorería general — Prueba A
 *
 * Y ese nombre es el que se ve en el listado de Cuentas de Tesorería, en el
 * desplegable al anotar un movimiento, en el título de la cartola y en la
 * cartola IMPRESA, que es la que se compara contra la del banco. Una
 * congregación que cambia de nombre —se fusiona, se regulariza, se corrige un
 * error de tipeo— quedaba con dos cajas que decían otra cosa.
 *
 * Es el mismo problema que la 1.220.0 resolvió cuando un cuerpo se cambia de
 * iglesia (ver server/lo-que-sigue-al-cuerpo.js): lo que se COPIÓ hay que
 * volver a mirarlo.
 *
 * EL NOMBRE SE ARMA EN UN SOLO LUGAR, que es la mitad del arreglo. La plantilla
 * vivía dentro del gancho que crea las cuentas; escribir el renombrado aparte
 * habría dejado dos textos que tienen que decir exactamente lo mismo en dos
 * archivos distintos, y el día que uno cambiara, el otro dejaría de reconocer
 * las cuentas que él mismo bautizó.
 *
 * Y SOLO SE TOCA LO QUE EL SISTEMA BAUTIZÓ. Una cuenta que alguien renombró a
 * mano —«Caja chica de la sede»— tiene ese nombre porque alguien lo decidió, y
 * un arreglo que se lo pise es peor que el defecto que viene a arreglar.
 */
const { db } = require('./db');

/**
 * Las dos cuentas que el sistema le abre a cada iglesia, y cómo las llama.
 *
 * El `tipo` es el que define el módulo de Cuentas de Tesorería; el `prefijo` y
 * la raya son la plantilla del nombre, y lo que después permite reconocerlas.
 */
const COMO_LAS_BAUTIZA = [
  {
    tipo: 'General',
    prefijo: 'Tesorería general',
    descripcion: 'Tesorería general de la iglesia local.',
  },
  {
    tipo: 'Fondo para la corporación',
    prefijo: 'Fondo para la corporación',
    descripcion: 'Donde la iglesia aparta lo que le corresponde a la corporación, hasta traspasarlo.',
  },
];

/** «Tesorería general — Iglesia Central». La raya es larga, y es la firma. */
const comoSeLlamaria = (prefijo, nombreDeLaIglesia) => `${prefijo} — ${nombreDeLaIglesia}`;

/**
 * Le abre a una iglesia recién creada las cuentas que le faltan.
 *
 * Se pregunta por TIPO y no por nombre: si ya tiene su tesorería general, no se
 * le abre otra aunque se llame de otra manera —puede haberla renombrado
 * alguien—, que es como estaba escrito desde el principio y es correcto.
 */
function abrirLasSuyas(conexion, iglesiaId, nombreDeLaIglesia) {
  const crear = conexion.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial, descripcion)
     VALUES (?, 'Iglesia local', ?, ?, 'Activa', 0, ?)`
  );
  const yaTiene = conexion.prepare(
    'SELECT id FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = ?'
  );
  let abiertas = 0;
  for (const cual of COMO_LAS_BAUTIZA) {
    if (yaTiene.get(iglesiaId, cual.tipo)) continue;
    crear.run(comoSeLlamaria(cual.prefijo, nombreDeLaIglesia), iglesiaId, cual.tipo, cual.descripcion);
    abiertas++;
  }
  return abiertas;
}

/**
 * Al renombrar la iglesia, le pone el nombre nuevo a las cajas que ella misma
 * bautizó. Devuelve cómo se llamaban, para poder decirlo.
 *
 * Se reconocen por comparación EXACTA contra lo que el sistema habría escrito
 * con el nombre viejo. No hace falta adivinar nada: acá se sabe el nombre
 * anterior, así que una cuenta que alguien tocó no calza y se queda como está.
 */
function seguirAlNombre(conexion, iglesiaId, nombreViejo, nombreNuevo) {
  /*
   * SOLO CUANDO EL NOMBRE CAMBIA. El guardia está acá y no en el gancho que
   * llama, para que sea uno solo: escrito en los dos, quitar cualquiera de los
   * dos no rompía nada y el que quedara sostenía la regla en silencio. Sin él,
   * corregirle el teléfono a una iglesia dejaría anotado en el Registro de
   * Cambios que se le renombraron las cuentas, que no pasó.
   */
  if (!nombreViejo || !nombreNuevo || nombreViejo === nombreNuevo) return [];
  /*
   * `cuerpo_id IS NULL`: solo las cajas DE LA IGLESIA. La de un cuerpo también
   * puede ser de tipo «General» —el módulo lo admite, una por cuerpo—, y si
   * alguien la hubiera llamado con esta misma plantilla, sin esta condición se
   * le habría escrito encima el nombre de la iglesia. Esa caja es del cuerpo y
   * su nombre no sale de acá.
   */
  const renombrar = conexion.prepare(
    `UPDATE cuentas_tesoreria SET nombre = ?
      WHERE iglesia_id = ? AND cuerpo_id IS NULL AND tipo = ? AND nombre = ?`
  );
  const cambiadas = [];
  for (const cual of COMO_LAS_BAUTIZA) {
    const antes = comoSeLlamaria(cual.prefijo, nombreViejo);
    const ahora = comoSeLlamaria(cual.prefijo, nombreNuevo);
    if (renombrar.run(ahora, iglesiaId, cual.tipo, antes).changes) cambiadas.push({ antes, ahora });
  }
  return cambiadas;
}

/**
 * Las que ya quedaron atrás, de los renombres de antes de la 1.236.0.
 *
 * Acá no se sabe el nombre viejo, así que se reconocen por otras dos cosas que
 * juntas no dejan lugar a dudas:
 *
 *   · el nombre lleva la plantilla EXACTA del sistema —el prefijo, la raya
 *     larga, y algo detrás que no es el nombre de esta iglesia—; y
 *   · no es la caja de un cuerpo —esas son suyas, no de la iglesia—; y
 *   · NADIE la ha editado nunca: `updated_by` en nulo. El motor escribe ahí
 *     quién guardó cada vez que una persona guarda, así que una cuenta que
 *     alguien renombró a mano lleva su marca y queda fuera. El renombrado
 *     automático de más arriba no la pone, que es lo correcto: no lo hizo una
 *     persona, y así la señal sigue valiendo mañana.
 *
 * Con las dos, lo único que puede caer acá es una cuenta que abrió el sistema y
 * que nadie tocó desde entonces.
 */
function lasQueQuedaronAtras(conexion = db) {
  const arreglar = conexion.prepare('UPDATE cuentas_tesoreria SET nombre = ? WHERE id = ?');
  let arregladas = 0;
  for (const cual of COMO_LAS_BAUTIZA) {
    const candidatas = conexion
      .prepare(
        `SELECT c.id, c.nombre, i.nombre AS iglesia
           FROM cuentas_tesoreria c
           JOIN iglesias i ON i.id = c.iglesia_id
          WHERE c.tipo = ? AND c.cuerpo_id IS NULL
            AND c.updated_by IS NULL AND c.nombre LIKE ?`
      )
      .all(cual.tipo, `${cual.prefijo} — %`);
    for (const c of candidatas) {
      const comoDeberia = comoSeLlamaria(cual.prefijo, c.iglesia);
      if (c.nombre === comoDeberia) continue;
      arreglar.run(comoDeberia, c.id);
      arregladas++;
    }
  }
  return arregladas;
}

/** «"Tesorería general — Prueba A" pasó a "Tesorería general — Prueba B"». */
const comoSeLee = (cambiadas) =>
  cambiadas.map((c) => `«${c.antes}» pasó a «${c.ahora}»`).join('; ');

module.exports = {
  COMO_LAS_BAUTIZA, comoSeLlamaria, abrirLasSuyas, seguirAlNombre, lasQueQuedaronAtras, comoSeLee,
};
