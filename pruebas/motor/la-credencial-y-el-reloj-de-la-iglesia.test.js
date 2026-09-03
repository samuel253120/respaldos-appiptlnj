/**
 * Qué día es hoy para una credencial.
 *
 * De las tres situaciones que calcula el sistema —vigente, por vencer,
 * vencida— depende lo único que la tarjeta impresa NO puede decir por sí sola,
 * y que la página pública contesta a quien escanee su código en la puerta de
 * una iglesia. Así que la fecha con que se compara tiene que ser la de la
 * iglesia, no la del servidor.
 *
 * ESTO ESTUVO MAL. `situacionDe` comparaba contra
 * `new Date().toISOString().slice(0, 10)`, y `toISOString` devuelve SIEMPRE la
 * fecha universal: no mira la zona horaria configurada, que es justamente el
 * ajuste que existe para esto. Medido con el reloj puesto en el lunes 24 de
 * agosto de 2026 a las 21:30 en Chile continental, una credencial que vencía
 * ese mismo 24 salía como VENCIDA —le quedaban dos horas y media— y así la
 * mostraba la página pública. Ocurría entre las 20:00 y la medianoche en
 * invierno y entre las 21:00 y la medianoche en verano, todos los días.
 *
 * Estas pruebas mueven el reloj a esa franja y comprueban las dos puntas: que
 * el día que vence todavía valga, y que al día siguiente ya no.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const credenciales = require('../../server/modules/credenciales');
const fechas = require('../../server/fechas');

const Reloj = Date;

/**
 * Corre algo con el reloj puesto en un instante y en una zona.
 *
 * La zona se pone en `process.env.TZ`, que es lo que hace `zona-horaria.aplicar()`
 * al arrancar y al guardar la configuración: así la prueba mira lo mismo que
 * mirará el sistema publicado.
 */
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

const comoEsta = (vence) => credenciales.situacionDe({ estado: 'Vigente', fecha_vencimiento: vence });

/* --------------------------------------------------------------------- */
/* La franja en que el servidor ya cambió de día y la iglesia no          */
/* --------------------------------------------------------------------- */

// 21:30 del lunes 24 de agosto de 2026 en Chile continental.
// En hora universal eso ya es el martes 25 a las 01:30.
const ESA_NOCHE = '2026-08-25T01:30:00.000Z';

test('a las 21:30 en Chile, la credencial que vence HOY todavía vale', () => {
  const situacion = conElRelojEn(ESA_NOCHE, 'America/Santiago', () => comoEsta('2026-08-24'));
  assert.notEqual(situacion, 'Vencida',
    'le quedan dos horas y media de vigencia: no puede decir que está vencida');
});

test('y la que venció ayer, sí está vencida', () => {
  const situacion = conElRelojEn(ESA_NOCHE, 'America/Santiago', () => comoEsta('2026-08-23'));
  assert.equal(situacion, 'Vencida');
});

test('pasada la medianoche de la iglesia, la de ayer ya no vale', () => {
  // 00:30 del martes 25 en Chile = 04:30 UTC del mismo 25
  const situacion = conElRelojEn('2026-08-25T04:30:00.000Z', 'America/Santiago', () => comoEsta('2026-08-24'));
  assert.equal(situacion, 'Vencida');
});

test('la fecha de hoy sale de la zona de la iglesia y no de la universal', () => {
  /**
   * La comprobación de fondo, escrita aparte porque es la que explica las
   * otras tres: en esa franja las dos fechas NO son la misma, y el sistema
   * tiene que usar la de la iglesia.
   */
  const laDeLaIglesia = conElRelojEn(ESA_NOCHE, 'America/Santiago', () => fechas.hoy());
  const laUniversal = new Reloj(ESA_NOCHE).toISOString().slice(0, 10);
  assert.equal(laDeLaIglesia, '2026-08-24', 'en Chile todavía es el 24');
  assert.equal(laUniversal, '2026-08-25', 'en hora universal ya es el 25');
  assert.notEqual(laDeLaIglesia, laUniversal, 'si fueran iguales, esta prueba no probaría nada');
});

/* --------------------------------------------------------------------- */
/* Y el aviso de «por vencer» se corre con la misma fecha                 */
/* --------------------------------------------------------------------- */

test('el aviso de «por vencer» también cuenta desde el día de la iglesia', () => {
  /**
   * Con siete días de anticipación —lo que trae el sistema de fábrica—, una
   * credencial que vence el 31 está «por vencer» el 24 y todavía «vigente» el
   * 23. Mirado en esa misma franja de la noche, si la fecha viniera en hora
   * universal el corte caería un día antes de lo que corresponde.
   */
  const dias = credenciales.diasPorVencer();
  const alBorde = new Reloj('2026-08-24T00:00:00.000Z');
  alBorde.setUTCDate(alBorde.getUTCDate() + dias);
  const justoEnElCorte = alBorde.toISOString().slice(0, 10);
  const unDiaMas = new Reloj(alBorde.getTime() + 86400000).toISOString().slice(0, 10);

  const enElCorte = conElRelojEn(ESA_NOCHE, 'America/Santiago', () => comoEsta(justoEnElCorte));
  const masAlla = conElRelojEn(ESA_NOCHE, 'America/Santiago', () => comoEsta(unDiaMas));
  assert.equal(enElCorte, 'Por vencer', `a ${dias} días tiene que avisar`);
  assert.equal(masAlla, 'Vigente', `a ${dias + 1} días todavía no`);
});

/* --------------------------------------------------------------------- */
/* Lo que no cambia                                                       */
/* --------------------------------------------------------------------- */

test('lo que decidió una persona manda sobre el calendario', () => {
  // Una revocada sigue revocada aunque su fecha de vencimiento no haya pasado
  const revocada = { estado: 'Revocada', fecha_vencimiento: '2030-01-01' };
  const reemplazada = { estado: 'Reemplazada', fecha_vencimiento: '2030-01-01' };
  const borrador = { estado: 'Borrador', fecha_vencimiento: '2030-01-01' };
  conElRelojEn(ESA_NOCHE, 'America/Santiago', () => {
    assert.equal(credenciales.situacionDe(revocada), 'Revocada');
    assert.equal(credenciales.situacionDe(reemplazada), 'Reemplazada');
    assert.equal(credenciales.situacionDe(borrador), 'Borrador');
  });
});

test('una credencial sin fecha de vencimiento no caduca sola', () => {
  const situacion = conElRelojEn(ESA_NOCHE, 'America/Santiago',
    () => credenciales.situacionDe({ estado: 'Vigente', fecha_vencimiento: null }));
  assert.equal(situacion, 'Vigente');
});
