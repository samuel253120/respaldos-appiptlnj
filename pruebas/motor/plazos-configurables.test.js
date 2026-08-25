/**
 * Los plazos que antes estaban escritos en el código y ahora se fijan en la
 * pantalla de configuración.
 *
 * Lo que estas pruebas cuidan no es que se puedan cambiar —eso se ve— sino las
 * dos cosas que se rompen en silencio al hacer configurable algo que era fijo:
 *
 *   · QUE EL VALOR DE FÁBRICA SIGA HACIENDO LO MISMO DE ANTES. Si al exponer
 *     un número se corre aunque sea un peldaño, el día que se publique cambia
 *     el comportamiento de todas las iglesias que nunca tocaron el ajuste, y
 *     nadie lo pidió.
 *
 *   · QUE NINGÚN VALOR DEJE EL SISTEMA INCOHERENTE. Las esperas por errores de
 *     contraseña son tres peldaños que salen de un solo número; si con algún
 *     valor el peldaño de más errores diera MENOS espera que el anterior,
 *     insistir saldría más barato que rendirse.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const intentos = require('../../server/intentos');
const credenciales = require('../../server/modules/credenciales');

const situacionDe = credenciales.computed.find((c) => c.name === 'situacion').calc;

let cuantos = 0;
const otroRut = () => `probador-${++cuantos}`;

/** Falla tantas veces seguidas y devuelve los minutos que queda esperando. */
function fallarTantasVeces(veces) {
  const rut = otroRut();
  const ip = `10.0.0.${cuantos}`;
  for (let i = 0; i < veces; i++) intentos.fallo(rut, ip);
  return intentos.esperaQueLeFalta(rut, ip);
}

// ------------------------------------- cuánto queda cerrada la puerta

test('de fábrica queda la escala de siempre: 1, 5 y 15 minutos', () => {
  ajustes.guardar('acceso_intentos', '5');
  ajustes.guardar('acceso_espera_minutos', '15');
  assert.equal(fallarTantasVeces(4), 0, 'antes del quinto error todavía puede intentar');
  assert.equal(fallarTantasVeces(5), 1);
  assert.equal(fallarTantasVeces(10), 5);
  assert.equal(fallarTantasVeces(15), 15);
});

test('subir la espera larga alarga los tres peldaños', () => {
  ajustes.guardar('acceso_espera_minutos', '60');
  assert.equal(fallarTantasVeces(5), 4, 'una quinceava parte de 60');
  assert.equal(fallarTantasVeces(10), 20, 'un tercio de 60');
  assert.equal(fallarTantasVeces(15), 60);
  ajustes.guardar('acceso_espera_minutos', '15');
});

test('con la espera más corta posible, ningún peldaño queda en cero', () => {
  // Un peldaño de cero minutos sería no cerrar nada: quien prueba contraseñas
  // a máquina no notaría diferencia.
  ajustes.guardar('acceso_espera_minutos', '1');
  for (const veces of [5, 10, 15]) {
    assert.ok(fallarTantasVeces(veces) >= 1, `con ${veces} errores la espera quedó en cero`);
  }
  ajustes.guardar('acceso_espera_minutos', '15');
});

test('nunca insistir sale más barato que rendirse, con ningún valor', () => {
  for (const espera of [1, 2, 3, 7, 15, 30, 60, 120]) {
    ajustes.guardar('acceso_espera_minutos', String(espera));
    const uno = fallarTantasVeces(5);
    const dos = fallarTantasVeces(10);
    const tres = fallarTantasVeces(15);
    assert.ok(uno <= dos && dos <= tres,
      `con espera ${espera} la escala quedó al revés: ${uno} · ${dos} · ${tres}`);
  }
  ajustes.guardar('acceso_espera_minutos', '15');
});

test('un valor disparatado se acota, no se usa tal cual', () => {
  ajustes.guardar('acceso_espera_minutos', '99999');
  assert.ok(fallarTantasVeces(15) <= 120, 'el tope son 120 minutos');
  ajustes.guardar('acceso_espera_minutos', '15');
});

// ------------------------------ con cuánta anticipación se avisa un vencimiento

const enTantosDias = (dias) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};
const unaCredencial = (dias) => ({ estado: 'Vigente', fecha_vencimiento: enTantosDias(dias) });

test('de fábrica, una credencial figura «Por vencer» desde 60 días antes', () => {
  ajustes.guardar('credencial_aviso_dias', '60');
  assert.equal(situacionDe(unaCredencial(90)), 'Vigente');
  assert.equal(situacionDe(unaCredencial(59)), 'Por vencer');
  assert.equal(situacionDe(unaCredencial(-1)), 'Vencida');
});

test('y ese plazo se puede acortar o alargar', () => {
  ajustes.guardar('credencial_aviso_dias', '15');
  assert.equal(situacionDe(unaCredencial(30)), 'Vigente', 'con 15 días, a 30 todavía no avisa');

  ajustes.guardar('credencial_aviso_dias', '180');
  assert.equal(situacionDe(unaCredencial(90)), 'Por vencer', 'con 180, a 90 ya avisa');

  ajustes.guardar('credencial_aviso_dias', '60');
});

test('cambiar el plazo no resucita una credencial ya vencida', () => {
  ajustes.guardar('credencial_aviso_dias', '365');
  assert.equal(situacionDe(unaCredencial(-5)), 'Vencida', 'lo vencido está vencido');
  ajustes.guardar('credencial_aviso_dias', '60');
});

test('lo que decidió una persona manda sobre el calendario', () => {
  // Una revocación no se deshace porque cambie un plazo.
  assert.equal(situacionDe({ estado: 'Revocada', fecha_vencimiento: enTantosDias(365) }), 'Revocada');
  assert.equal(situacionDe({ estado: 'Borrador', fecha_vencimiento: enTantosDias(1) }), 'Borrador');
});

// --------------------------------------- cada cuánto se asoma el vigía

test('los tres plazos están ofrecidos en la configuración, con sus topes', () => {
  for (const [clave, defecto, min, max] of [
    ['acceso_espera_minutos', '15', 1, 120],
    ['avisos_revisar_minutos', '30', 5, 180],
    ['credencial_aviso_dias', '60', 7, 365],
  ]) {
    const o = ajustes.POR_CLAVE[clave];
    assert.ok(o, `${clave} no aparece en la pantalla de configuración`);
    assert.equal(o.defecto, defecto, `${clave} cambió su valor de fábrica`);
    assert.equal(o.min, min);
    assert.equal(o.max, max);
    assert.ok(o.ayuda && o.ayuda.length > 40, `${clave} no explica para qué sirve`);
  }
});
