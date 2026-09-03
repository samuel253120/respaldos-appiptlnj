/**
 * El día de la iglesia, en todas las fechas que el sistema pone solo.
 *
 * `new Date().toISOString()` devuelve SIEMPRE la fecha universal y no mira la
 * zona horaria configurada. En Chile, entre las 20:00 y la medianoche, eso es
 * el día siguiente: un culto de domingo por la noche queda anotado el lunes.
 *
 * El sistema ya sabía esto. Lo arregló en 46 sitios en la v1.298.0, cuando se
 * hizo configurable la zona horaria; volvió a arreglarlo en la v1.304.0 en la
 * fecha de vencimiento de las credenciales —donde le mentía a quien escaneaba
 * el código QR en la puerta—; y otra vez en la v1.324.0, en la fecha del
 * cambio de contraseña. Tres veces el mismo error, y las tres veces se arregló
 * UN SITIO.
 *
 * Buscándolo entero aparecieron CUARENTA SITIOS MÁS —veintinueve en el
 * servidor y once en el navegador, repartidos en veintiséis archivos—:
 *
 *   · la fecha de una anotación de bitácora escrita sin fecha
 *   · la de respuesta de una solicitud, que se pone al cerrarla
 *   · la de retiro de un integrante de un cuerpo
 *   · la de apertura y la de cierre de una cuenta de tesorería
 *   · la de pago de una cuota, en los dos sitios donde se registra
 *   · la de registro de un documento, y la de los cinco archivos adjuntos
 *   · el «Emitido el …» del pie de TODO lo que se imprime en PDF
 *   · el mes que el panel usa para las finanzas
 *   · y en el navegador —donde el reloj es el del teléfono de cada uno— el
 *     «está vencido», el vencimiento que se propone al entregar una
 *     credencial, el mes que se propone al pasar lista, el nombre del archivo
 *     que se baja y el «Emitido el …» de lo que se imprime desde la pantalla
 *
 * Arreglar el sitio número 23 sin dejar quien vigile el 24 sería hacer lo
 * mismo por cuarta vez. Así que esta prueba tiene dos partes: unas cuantas
 * comprobaciones con el reloj movido a esa franja de la noche, y un BARRIDO
 * del código que no deja volver a escribirlo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const fechas = require('../../server/fechas');

const Reloj = Date;

/** Corre algo con el reloj puesto en un instante y en una zona. */
function conElRelojEn(iso, zona, hacer) {
  const zonaAntes = process.env.TZ;
  process.env.TZ = zona;
  class Falso extends Reloj {
    constructor(...a) { if (!a.length) super(iso); else super(...a); }
    static now() { return new Reloj(iso).getTime(); }
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

// 21:30 del lunes 24 de agosto de 2026 en Chile continental.
// En hora universal eso ya es el martes 25 a las 01:30.
const ESA_NOCHE = '2026-08-25T01:30:00.000Z';
const EN_CHILE = '2026-08-24';
const EN_EL_MUNDO = '2026-08-25';

/* --------------------------------------------------------------------- */
/* Las fechas que el sistema pone cuando nadie le dice cuál              */
/* --------------------------------------------------------------------- */

test('LA QUE MÁS SE ESCRIBE: una anotación sin fecha queda con la de hoy en la iglesia', () => {
  const bitacora = require('../../server/modules/bitacora');
  const data = { miembro_id: 1, tipo: 'Visita', descripcion: 'Se le llevó mercadería.' };
  conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => bitacora.hooks.beforeSave(data, { user: { id: 1, nombre: 'Quien Anota' }, isNew: true, existing: null }));
  assert.equal(data.fecha, EN_CHILE, `antes quedaba ${EN_EL_MUNDO}, que todavía no había llegado`);
});

test('la solicitud que se cierra el domingo por la noche se respondió el domingo', () => {
  /**
   * Esta es la que más se nota: la fecha de respuesta es la que después se
   * mira para saber cuánto se demoró el trámite, y sale impresa en la hoja de
   * la solicitud.
   */
  const solicitudes = require('../../server/modules/solicitudes');
  // Sin `solicitante_tipo`: son las solicitudes antiguas, que el módulo deja
  // pasar tal como están, y así esta prueba mira solo la fecha
  const antes = { id: 5, estado: 'En revisión', responsable_id: 1, fecha_respuesta: null,
    iglesia_id: 1, tipo: 'Certificado', solicitante: 'Quien Pidió' };
  const data = { estado: 'Aprobada', respuesta: 'Se entregó el certificado.' };
  conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => solicitudes.hooks.beforeSave(data, { db, isNew: false, id: 5, existing: antes, user: { id: 1 }, confirmado: true }));
  assert.equal(data.fecha_respuesta, EN_CHILE);
});

test('y la cuenta de tesorería se abre el día que se abre', () => {
  const cuentas = require('../../server/modules/cuentas_tesoreria');
  const data = { nombre: `Cuenta del reloj ${process.pid}`, tipo: 'Proyecto / Trabajo', iglesia_id: 1, estado: 'Abierta' };
  conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => cuentas.hooks.beforeSave(data, { db, isNew: true, id: null, existing: null, user: { id: 1 } }));
  assert.equal(data.fecha_apertura, EN_CHILE);
});

test('LA CONTRACARA: con el sistema configurado en hora universal, esa es la correcta', () => {
  /**
   * Lo que se arregló no es «restar cuatro horas» sino «preguntarle al reloj
   * configurado». Una iglesia que elija UTC tiene que ver UTC.
   */
  const bitacora = require('../../server/modules/bitacora');
  const data = { miembro_id: 1, tipo: 'Visita', descripcion: 'La misma anotación.' };
  conElRelojEn(ESA_NOCHE, 'UTC',
    () => bitacora.hooks.beforeSave(data, { user: { id: 1, nombre: 'Quien Anota' }, isNew: true, existing: null }));
  assert.equal(data.fecha, EN_EL_MUNDO);
});

test('y la fecha que alguien escribe a mano manda sobre la de hoy', () => {
  /**
   * La otra contracara: todas estas fechas son un valor por omisión, no una
   * imposición. Quien anota una visita de la semana pasada escribe su fecha y
   * esa es la que queda.
   */
  const bitacora = require('../../server/modules/bitacora');
  const data = { miembro_id: 1, tipo: 'Visita', descripcion: 'De la semana pasada.', fecha: '2026-08-17' };
  conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => bitacora.hooks.beforeSave(data, { user: { id: 1, nombre: 'Quien Anota' }, isNew: true, existing: null }));
  assert.equal(data.fecha, '2026-08-17');
});

test('el día y la hora de `fechas` son los mismos que los de la base', () => {
  /**
   * Las dos maneras que tiene el sistema de preguntar «ahora» —Node y SQLite—
   * tienen que dar lo mismo, porque muchas filas llevan una de cada una.
   */
  const deLaBase = db.prepare("SELECT date('now','localtime') AS d, datetime('now','localtime') AS t").get();
  assert.equal(fechas.hoy(), deLaBase.d);
  assert.ok(Math.abs(new Date(fechas.ahora().replace(' ', 'T')) - new Date(deLaBase.t.replace(' ', 'T'))) <= 2000);
});

/* --------------------------------------------------------------------- */
/* El barrido: que no vuelva a escribirse                                 */
/* --------------------------------------------------------------------- */

/**
 * `new Date().toISOString()` es SIEMPRE un error en este sistema, sin
 * excepciones: significa «ahora, en hora universal», y acá ninguna fecha se
 * anota en hora universal. Para eso están `fechas.hoy()` y `fechas.ahora()` en
 * el servidor, y `hoyISO()` e `ISO()` en el navegador.
 *
 * Los OTROS usos de `toISOString` sí pueden estar bien —formatear una fecha
 * construida con `Date.UTC`, anotar un instante que no es una fecha del
 * calendario de la iglesia— y por eso van uno por uno en la lista de abajo,
 * cada uno con su motivo. Agregar uno nuevo obliga a escribir el motivo, que
 * es exactamente la pregunta que hay que hacerse.
 */
const CON_PERMISO = [
  ['server/modules/evaluaciones_integrantes.js', 'Date.UTC',
    'aritmética de calendario anclada en UTC: entra un día y sale otro, sin preguntarle la hora a nadie'],
  ['server/integrantes.js', 'Date.UTC',
    'lo mismo: el fin del período de prueba se cuenta en meses sobre una fecha dada'],
  ['server/cuerpo-que-no-levanta-actas.js', 'T12:00:00Z',
    'un año hacia atrás desde una fecha dada, anclado al mediodía universal para que ningún huso lo corra de día'],
  ['server/respaldo-automatico.js', 'mtime',
    'la hora en que el sistema de archivos dice que se escribió una copia: un instante, no una fecha anotada'],
  ['public/app.js', 'new Date(ms)',
    'formatea milisegundos que vienen de Date.UTC, en el conteo de días entre dos fechas'],
];

/** Los archivos de código del sistema, sin las dependencias ni el registro de versiones. */
function archivosDelSistema() {
  const raiz = path.join(__dirname, '../..');
  const salida = [];
  const mirar = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) mirar(completo);
      else if (entrada.name.endsWith('.js') && entrada.name !== 'versiones.js') salida.push(completo);
    }
  };
  mirar(path.join(raiz, 'server'));
  salida.push(path.join(raiz, 'public/app.js'));
  return salida.map((f) => [path.relative(raiz, f), fs.readFileSync(f, 'utf8')]);
}

/**
 * Los renglones con `toISOString` que no son comentario.
 *
 * De cada uno se guarda también su CONTEXTO —las dos líneas de antes—, porque
 * una llamada puede venir partida en varias: la que arma la fecha con
 * `Date.UTC` arriba y el `.toISOString()` en el renglón siguiente. Sin eso,
 * el motivo del permiso no se puede reconocer.
 */
function dondeSeUsa() {
  const usos = [];
  for (const [nombre, texto] of archivosDelSistema()) {
    const lineas = texto.split('\n');
    lineas.forEach((linea, i) => {
      if (!linea.includes('toISOString')) return;
      const limpia = linea.trim();
      if (limpia.startsWith('*') || limpia.startsWith('//') || limpia.startsWith('/*')) return;
      usos.push({
        archivo: nombre,
        renglon: i + 1,
        linea: limpia,
        contexto: lineas.slice(Math.max(0, i - 2), i + 1).join('\n'),
      });
    });
  }
  return usos;
}

test('EL BARRIDO: no queda ningún «new Date().toISOString()» en todo el sistema', () => {
  const culpables = dondeSeUsa().filter((u) => u.linea.includes('new Date().toISOString('));
  assert.deepEqual(culpables, [],
    'eso es «ahora, en hora universal», y acá ninguna fecha se anota así: use fechas.hoy() / fechas.ahora() '
    + 'en el servidor, hoyISO() / ISO() en el navegador');
});

test('y los demás usos de toISOString están todos justificados uno por uno', () => {
  const sinPermiso = dondeSeUsa().filter(
    (u) => !CON_PERMISO.some(([archivo, trozo]) => u.archivo === archivo && u.contexto.includes(trozo))
  );
  assert.deepEqual(sinPermiso.map((u) => `${u.archivo}:${u.renglon} · ${u.linea}`), [],
    'un toISOString nuevo tiene que ir con su motivo en CON_PERMISO, o no ir');
});

test('y la lista no tiene sobrantes: cada permiso corresponde a un renglón que existe', () => {
  /**
   * Una lista de excepciones que nadie limpia deja pasar lo que ya no está: si
   * mañana se borra ese renglón, el permiso se queda ahí esperando a cubrir
   * otra cosa que se le parezca.
   */
  const usos = dondeSeUsa();
  const huerfanos = CON_PERMISO.filter(
    ([archivo, trozo]) => !usos.some((u) => u.archivo === archivo && u.contexto.includes(trozo))
  );
  assert.deepEqual(huerfanos.map(([a, t]) => `${a} · ${t}`), []);
});

test('cada permiso dice POR QUÉ, y no solo dónde', () => {
  for (const [archivo, trozo, motivo] of CON_PERMISO) {
    assert.ok(motivo && motivo.length > 25, `${archivo} · ${trozo}: el motivo tiene que explicarse`);
  }
});
