/**
 * La zona horaria: de qué hora habla el sistema cuando anota algo.
 *
 * ESTO ESTUVO MAL Y NADIE LO VIO. Un servidor en internet corre en hora
 * universal si no se le dice otra cosa, y el sistema estampa fechas en 46
 * lugares con el «localtime» de SQLite, que es la hora DEL SERVIDOR. En Chile
 * eso son tres o cuatro horas de más: todo lo que pasara después de las 20:00
 * quedaba anotado con la fecha del día siguiente. Un culto de domingo por la
 * noche quedaba registrado el lunes.
 *
 * Lo que hace difícil de ver un error así es que nada falla: no hay excepción,
 * no hay pantalla roja, las fechas se ven perfectamente normales. Solo están
 * corridas. Por eso hay pruebas: para que si alguien vuelve a dejar el sistema
 * en hora universal sin darse cuenta, algo lo diga.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const ajustes = require('../../server/ajustes');
const zona = require('../../server/zona-horaria');

const comoLoAnota = () => db.prepare("SELECT datetime('now','localtime') AS t").get().t;
const enUtc = () => db.prepare("SELECT datetime('now') AS t").get().t;

// ------------------------------------------------------------- la lista cerrada

test('las zonas que se ofrecen existen de verdad en este servidor', () => {
  // Si al contenedor le faltara la base de zonas horarias, el desplegable
  // ofrecería opciones que no funcionan y el sistema volvería a UTC callado.
  for (const z of zona.LAS_ZONAS) {
    assert.ok(zona.sirve(z.valor), `«${z.valor}» no la entiende este servidor`);
  }
});

test('una zona inventada no se acepta', () => {
  for (const mala of ['America/Narnia', 'Chile', '', null, undefined, 'UTC+4', 'america/santiago']) {
    assert.equal(zona.sirve(mala), false, `«${mala}» no debería pasar`);
  }
});

test('si lo guardado no sirve, se usa Chile continental y no la hora universal', () => {
  // Es la diferencia entre un ajuste roto que se nota y uno que devuelve
  // calladamente al error de origen.
  ajustes.guardar('zona_horaria', 'America/Narnia');
  assert.equal(zona.cual(), 'America/Santiago');
  ajustes.guardar('zona_horaria', 'America/Santiago');
});

test('de fábrica el sistema habla en hora de Chile', () => {
  db.prepare('DELETE FROM configuracion WHERE clave = ?').run('zona_horaria');
  assert.equal(zona.cual(), 'America/Santiago', 'sin elegir nada, tiene que ser Chile');
});

// -------------------------------------------------- lo que de verdad se anota

test('aplicarla cambia la hora con que la base anota, sin reiniciar', () => {
  ajustes.guardar('zona_horaria', 'UTC');
  zona.aplicar();
  assert.equal(comoLoAnota(), enUtc(), 'en UTC, lo anotado y la hora universal coinciden');

  ajustes.guardar('zona_horaria', 'America/Santiago');
  zona.aplicar();
  assert.notEqual(comoLoAnota(), enUtc(), 'en Chile ya no pueden coincidir: hay desfase');
});

test('y el desfase con Chile es el que corresponde, no uno cualquiera', () => {
  ajustes.guardar('zona_horaria', 'America/Santiago');
  zona.aplicar();
  const horas = (new Date(enUtc() + 'Z') - new Date(comoLoAnota() + 'Z')) / 3600000;
  assert.ok(horas === 3 || horas === 4, `Chile está a 3 o 4 horas de UTC, salió ${horas}`);
});

test('EL ERROR ORIGINAL: a las 22:00 en Chile, en UTC ya es el día siguiente', () => {
  // La prueba que da nombre a todo esto. No depende de la hora en que corra:
  // se calcula con una fecha fija.
  const enChile = new Date('2026-08-25T02:03:00Z'); // 22:03 del 24 en Chile
  const dia = (z) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(enChile);

  assert.equal(dia('America/Santiago'), '2026-08-24', 'en Chile todavía es lunes 24');
  assert.equal(dia('UTC'), '2026-08-25', 'en hora universal ya es martes 25');
  assert.notEqual(dia('America/Santiago'), dia('UTC'), 'y por eso un culto del domingo quedaba el lunes');
});

test('la hora que se muestra es la de la zona elegida, no la del servidor', () => {
  ajustes.guardar('zona_horaria', 'UTC');
  zona.aplicar();
  const enUniversal = zona.ahora();
  assert.equal(enUniversal.zona, 'UTC');

  ajustes.guardar('zona_horaria', 'Pacific/Easter');
  zona.aplicar();
  const enPascua = zona.ahora();
  assert.equal(enPascua.zona, 'Pacific/Easter');
  assert.notEqual(enPascua.texto, enUniversal.texto, 'Isla de Pascua no puede marcar la misma hora que UTC');

  ajustes.guardar('zona_horaria', 'America/Santiago');
  zona.aplicar();
});

test('está ofrecida en la configuración, con su lista y su valor de fábrica', () => {
  const opcion = ajustes.POR_CLAVE['zona_horaria'];
  assert.ok(opcion, 'sin esto no aparece en la pantalla de configuración');
  assert.equal(opcion.tipo, 'select', 'tiene que ser lista cerrada: un campo libre admite zonas que no existen');
  assert.equal(opcion.defecto, 'America/Santiago');
  assert.equal(opcion.opciones.length, zona.LAS_ZONAS.length);
});
