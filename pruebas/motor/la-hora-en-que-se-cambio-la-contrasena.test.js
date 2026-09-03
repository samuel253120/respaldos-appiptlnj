/**
 * Con qué reloj se anota que alguien cambió su contraseña.
 *
 * La pantalla de la cuenta le dice al administrador cómo está el acceso de
 * cada persona, y cuando la contraseña es propia dice desde cuándo:
 *
 *     La cambió su dueño el 2026-08-25
 *
 * Esa fecha se estampaba con `new Date().toISOString()`, que devuelve SIEMPRE
 * la hora universal y no mira la zona horaria configurada. MEDIDO con el reloj
 * puesto a las 21:30 del lunes 24 de agosto en Chile continental: se guardaba
 * «2026-08-25 01:30:00» y la pantalla decía «La cambió su dueño el
 * 2026-08-25». Mañana, por algo que acababa de pasar anoche.
 *
 * Y EN LA MISMA SENTENCIA, dos líneas más abajo, `updated_at` se estampa con
 * `datetime('now','localtime')`. La misma fila quedaba escrita con dos relojes
 * distintos, con horas de diferencia entre uno y otro.
 *
 * Es el mismo error que ya se corrigió en la fecha de vencimiento de las
 * credenciales (v1.304.0), donde sí importaba de verdad —lo contestaba la
 * página pública a quien escaneara el código— y que acá se había quedado. Este
 * no le miente a nadie de afuera: le miente al administrador que mira cuándo
 * se cambió una contraseña, y en una pantalla que existe justamente para
 * saberlo. Pasa todos los días entre las 20:00 y la medianoche.
 *
 * Estas pruebas mueven el reloj a esa franja y miran las dos puntas: que la
 * noche del 24 diga 24, y que pasada la medianoche de la iglesia diga 25.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const claves = require('../../server/claves');
const fechas = require('../../server/fechas');
const { digitoVerificador } = require('../../server/rut');

const M = `reloj-${process.pid}`;
let siguiente = 0;
function unaCuenta() {
  const n = 21900000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  const rut = `${n}-${digitoVerificador(String(n))}`;
  return Number(db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(rut, `Del reloj ${rut} ${M}`).lastInsertRowid);
}
const comoQuedo = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

const Reloj = Date;

/**
 * Corre algo con el reloj puesto en un instante y en una zona.
 *
 * La zona se pone en `process.env.TZ`, que es lo que hace
 * `zona-horaria.aplicar()` al arrancar y al guardar la configuración: así la
 * prueba mira lo mismo que mirará el sistema publicado. Es el mismo aparato
 * que usa la prueba del reloj de las credenciales, al lado.
 */
async function conElRelojEn(iso, zona, hacer) {
  const zonaAntes = process.env.TZ;
  process.env.TZ = zona;
  class Falso extends Reloj {
    constructor(...a) { if (!a.length) super(iso); else super(...a); }
    static now() { return new Reloj(iso).getTime(); }
  }
  global.Date = Falso;
  try {
    return await hacer();
  } finally {
    global.Date = Reloj;
    if (zonaAntes === undefined) delete process.env.TZ;
    else process.env.TZ = zonaAntes;
  }
}

// 21:30 del lunes 24 de agosto de 2026 en Chile continental.
// En hora universal eso ya es el martes 25 a las 01:30.
const ESA_NOCHE = '2026-08-25T01:30:00.000Z';
// Y media hora después, cuando la iglesia también cambió de día
const PASADA_LA_MEDIANOCHE = '2026-08-25T04:30:00.000Z';

/* --------------------------------------------------------------------- */
/* La franja en que el servidor ya cambió de día y la iglesia no          */
/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: a las 21:30 en Chile, la cambió HOY, no mañana', async () => {
  const id = unaCuenta();
  await conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => claves.establecer(id, 'Camino.Angosto.4483', 'usuario'));

  const cuando = comoQuedo(id).password_cambiada_en;
  assert.equal(String(cuando).slice(0, 10), '2026-08-24',
    `antes guardaba el día siguiente; quedó «${cuando}»`);
  assert.equal(cuando, '2026-08-24 21:30:00', 'y con la hora de la iglesia, no con la universal');
});

test('y la pantalla de la cuenta dice ese día', async () => {
  /**
   * Es lo único de esto que alguien ve. Sin esta comprobación, la fecha podría
   * quedar bien guardada y mal mostrada, que para quien mira es lo mismo.
   */
  const id = unaCuenta();
  await conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => claves.establecer(id, 'Camino.Angosto.4483', 'usuario'));

  const dice = claves.estado(comoQuedo(id));
  assert.equal(dice.texto, 'La cambió su dueño el 2026-08-24');
  assert.equal(dice.nivel, 'ok');
});

test('LA CONTRACARA: pasada la medianoche de la iglesia, ya es el 25', async () => {
  /**
   * Que no sea «restarle siempre un día», que es como se rompen estos
   * arreglos: media hora después la iglesia también cambió de día, y entonces
   * la fecha que corresponde es la nueva.
   */
  const id = unaCuenta();
  await conElRelojEn(PASADA_LA_MEDIANOCHE, 'America/Santiago',
    () => claves.establecer(id, 'Camino.Angosto.4483', 'usuario'));

  assert.equal(comoQuedo(id).password_cambiada_en, '2026-08-25 00:30:00');
});

test('y con el sistema configurado en hora universal, la universal es la correcta', async () => {
  /**
   * La otra contracara: el ajuste ofrece UTC, y una iglesia que lo elija tiene
   * que ver las horas en UTC. Lo que se arregló no es «restar cuatro horas»
   * sino «preguntarle al reloj configurado».
   */
  const id = unaCuenta();
  await conElRelojEn(ESA_NOCHE, 'UTC', () => claves.establecer(id, 'Camino.Angosto.4483', 'usuario'));
  assert.equal(comoQuedo(id).password_cambiada_en, '2026-08-25 01:30:00');
});

/* --------------------------------------------------------------------- */
/* Los dos relojes de la misma fila                                       */
/* --------------------------------------------------------------------- */

test('LA QUE SE ESCAPABA: las dos fechas de la misma fila se escriben con el mismo reloj', async () => {
  /**
   * `password_cambiada_en` y `updated_at` se estampan en la MISMA sentencia
   * SQL. Con relojes distintos, la fila quedaba diciendo que se cambió la
   * contraseña horas después de la última vez que se guardó la ficha, que es
   * imposible.
   *
   * Se comparan de verdad, sin mover el reloj: `datetime('now','localtime')`
   * lo contesta SQLite y `fechas.ahora()` lo arma Node, y los dos tienen que
   * dar lo mismo.
   */
  const id = unaCuenta();
  await claves.establecer(id, 'Camino.Angosto.4483', 'usuario');
  const fila = comoQuedo(id);

  const distancia = Math.abs(new Date(fila.password_cambiada_en.replace(' ', 'T')).getTime()
    - new Date(String(fila.updated_at).replace(' ', 'T')).getTime());
  assert.ok(distancia <= 2000,
    `los dos relojes de la misma fila se separan ${Math.round(distancia / 1000)} s: `
    + `«${fila.password_cambiada_en}» contra «${fila.updated_at}»`);
});

test('y `fechas.ahora()` habla el mismo idioma que la base', () => {
  /**
   * El formato importa tanto como la hora: la columna se ordena y se recorta
   * como texto —la pantalla muestra sus diez primeros caracteres—, así que un
   * «2026-08-24T21:30:00.000Z» ahí dentro se vería como una fecha y ordenaría
   * distinto que el resto.
   */
  const deLaBase = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const deNode = fechas.ahora();
  assert.match(deNode, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'mismo formato que SQLite');
  assert.equal(deNode.length, deLaBase.length);
  assert.ok(Math.abs(new Date(deNode.replace(' ', 'T')) - new Date(deLaBase.replace(' ', 'T'))) <= 2000,
    `Node dice «${deNode}» y la base «${deLaBase}»`);
});

/**
 * Un reloj que CORRE: cada vez que alguien le pregunta la hora, ha pasado un
 * segundo más. Es lo único que distingue una implementación que pregunta UNA
 * vez de otra que pregunta dos, y con el reloj congelado las dos dan igual.
 */
function conElRelojCorriendo(iso, zona, hacer) {
  const zonaAntes = process.env.TZ;
  process.env.TZ = zona;
  const partida = new Reloj(iso).getTime();
  let vueltas = 0;
  const siguiente = () => partida + 1000 * vueltas++;
  class Falso extends Reloj {
    constructor(...a) { if (!a.length) super(siguiente()); else super(...a); }
    static now() { return siguiente(); }
  }
  global.Date = Falso;
  try {
    return hacer();
  } finally {
    global.Date = Reloj;
    if (zonaAntes === undefined) delete process.env.TZ;
    else process.env.TZ = zonaAntes;
  }
}

test('las partes salen todas del mismo instante, y no de dos', () => {
  /**
   * Armarla preguntando el día por un lado y la hora por el otro deja una
   * rendija de un instante en la que puede cambiar el día: quedaría la fecha
   * de ayer con la hora de hoy, o al revés. Un día entero de diferencia por
   * una milésima.
   *
   * Se comprueba en el peor momento posible —el último segundo del día— y con
   * un reloj que avanza en cada pregunta: preguntando una vez sale
   * «2026-08-24 23:59:59»; preguntando dos, la segunda respuesta ya es del 25
   * y el texto sale partido en dos días.
   */
  const ultimoSegundoDelDia = '2026-08-25T03:59:59.000Z'; // 23:59:59 en Chile
  const texto = conElRelojCorriendo(ultimoSegundoDelDia, 'America/Santiago', () => fechas.ahora());
  assert.equal(texto, '2026-08-24 23:59:59');
});

/* --------------------------------------------------------------------- */
/* Y la que no es propia no lleva fecha                                   */
/* --------------------------------------------------------------------- */

test('la contraseña que puso el administrador no anota fecha de cambio, y lo dice', async () => {
  /**
   * La fecha responde «desde cuándo esta contraseña es SUYA». Una puesta por
   * el administrador no lo es, así que no hay fecha que anotar y la pantalla
   * dice otra cosa: que la cuenta sigue con una contraseña que otro conoce.
   */
  const id = unaCuenta();
  await conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => claves.establecer(id, 'Trueno.Lluvia.9127', 'definida'));

  const fila = comoQuedo(id);
  assert.equal(fila.password_cambiada_en, null);
  assert.equal(fila.debe_cambiar_password, 1, 'y queda obligada a cambiarla');
  assert.match(claves.estado(fila).texto, /puesta por el administrador/);
});

test('y la inicial del sistema, tampoco', async () => {
  const id = unaCuenta();
  await conElRelojEn(ESA_NOCHE, 'America/Santiago', () => claves.establecer(id, claves.inicial(), 'inicial'));
  assert.equal(comoQuedo(id).password_cambiada_en, null);
  assert.match(claves.estado(comoQuedo(id)).texto, /contraseña inicial del sistema/);
});
