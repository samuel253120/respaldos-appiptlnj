/**
 * A quien se le delega la configuración, se le delega de verdad.
 *
 * El modo mantenimiento tiene su propia llave desde que se separó del permiso
 * de configuración, y con buen motivo: deja a TODA la iglesia fuera del sistema
 * hasta que alguien lo apague, y se puede querer delegar la configuración sin
 * entregar eso.
 *
 * Pero la comprobación preguntaba si alguna de las dos claves del mantenimiento
 * VENÍA en lo que se mandaba —`c in cambios`— y la pantalla no manda lo que uno
 * tocó: manda los setenta campos, en cada guardado. Medido en la v1.423.0, con
 * una cuenta que tenía la llave de la configuración y no la del mantenimiento:
 *
 *   PUT con una sola clave, a mano ...........  200 · entra
 *   PUT con los 70 campos (el botón Guardar) .  403 · «No tiene permiso para
 *                                               dejar el sistema en mantenimiento»
 *
 * Y el interruptor iba tal como estaba guardado: ni siquiera lo había tocado.
 * El permiso que existía para poder delegar dejaba la pantalla completamente
 * inservible para quien lo recibía (hallazgo CO-01).
 *
 * Ahora se pregunta por el CAMBIO. Lo que esta prueba vigila es eso y las dos
 * mitades que lo sostienen: que la llave siga sirviendo para lo suyo, y que las
 * dos maneras de normalizar un valor —la del permiso y la del guardado— sigan
 * siendo una sola.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const ajustes = require('../../server/ajustes');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

/** Una cuenta con exactamente las llaves que se le den. */
let cuantas = 0;
function unaCuenta(permisos, nombre) {
  const numero = `${16000000 + (marca * 7 + cuantas++) % 900000}`;
  return db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, permisos) VALUES (?,?,?,1,?)')
    .run(`${numero}-${digitoVerificador(numero)}`, `${nombre} CO ${marca}`, 'secretario',
      JSON.stringify(permisos))
    .lastInsertRowid;
}

// La que recibió la configuración delegada, sin la llave del mantenimiento
const encargada = unaCuenta({ sistema_configuracion: ['view', 'edit'] }, 'Encargada');
// Y una que sí tiene las dos
const conLasDos = unaCuenta(
  { sistema_configuracion: ['view', 'edit'], sistema_mantenimiento: ['view'] }, 'Con las dos'
);

/** Todo lo que manda la pantalla al apretar Guardar: los setenta campos. */
async function comoAprietaGuardar(api, cambios = {}) {
  const r = await api('GET', '/configuracion');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const cuerpo = {};
  for (const grupo of r.json.grupos) {
    for (const o of grupo.items) {
      cuerpo[o.clave] = o.tipo === 'boolean' ? String(o.valor) === '1' : (o.valor || '');
    }
  }
  return api('PUT', '/configuracion', { ...cuerpo, ...cambios });
}

const valorDe = (clave) => ajustes.obtener(clave);

// ------------------------------------------- lo que se rompía ---------------

test('la encargada guarda desde la pantalla, con los setenta campos y todo', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);

  const lema = `Lema de la revisión CO ${marca}`;
  const r = await comoAprietaGuardar(suya, { iglesia_lema: lema });
  assert.equal(r.estado, 200, r.texto.slice(0, 250));
  assert.equal(valorDe('iglesia_lema'), lema, 'y lo que escribió quedó guardado');
});

test('y el interruptor del mantenimiento viaja en cada guardado sin estorbar', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);
  // Es el caso exacto que fallaba: la clave viene, con el mismo valor que ya
  // tiene, porque la pantalla manda todos los campos siempre
  const comoEsta = valorDe('mantenimiento_activo');
  const r = await comoAprietaGuardar(suya, { mantenimiento_activo: comoEsta === '1' });
  assert.equal(r.estado, 200, r.texto.slice(0, 250));
  assert.equal(valorDe('mantenimiento_activo'), comoEsta, 'y quedó como estaba');
});

test('mandarlo escrito de otra manera tampoco es cambiarlo', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);
  ajustes.guardar('mantenimiento_activo', '0');
  // El mismo apagado, dicho de las cuatro formas que el guardado acepta
  for (const apagado of [false, 0, '0', 'false']) {
    const r = await suya('PUT', '/configuracion', { mantenimiento_activo: apagado });
    assert.equal(r.estado, 200, `con ${JSON.stringify(apagado)}: ${r.texto.slice(0, 200)}`);
  }
  assert.equal(valorDe('mantenimiento_activo'), '0');
});

// ------------------------------------------- lo que la llave sigue guardando -

test('pero encenderlo sigue pidiendo la llave del mantenimiento', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);
  ajustes.guardar('mantenimiento_activo', '0');

  const r = await suya('PUT', '/configuracion', { mantenimiento_activo: true });
  assert.equal(r.estado, 403, r.texto.slice(0, 200));
  assert.match(r.json.error, /mantenimiento/);
  assert.equal(valorDe('mantenimiento_activo'), '0', 'y no quedó encendido');
});

test('ni cambiarle el aviso que verá la iglesia', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);
  const antes = valorDe('mantenimiento_mensaje');

  const r = await suya('PUT', '/configuracion', { mantenimiento_mensaje: `Otra cosa CO ${marca}` });
  assert.equal(r.estado, 403, r.texto.slice(0, 200));
  assert.equal(valorDe('mantenimiento_mensaje'), antes);
});

test('y un guardado rechazado no deja entrar lo que venía al lado', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(encargada);
  ajustes.guardar('mantenimiento_activo', '0');
  const antes = valorDe('iglesia_web');

  const r = await suya('PUT', '/configuracion', {
    mantenimiento_activo: true, iglesia_web: `https://co-${marca}.cl`,
  });
  assert.equal(r.estado, 403);
  assert.equal(valorDe('iglesia_web'), antes, 'se rechaza el guardado entero, no media parte');
});

test('quien tiene las dos llaves sí lo enciende y lo apaga', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(conLasDos);
  ajustes.guardar('mantenimiento_activo', '0');

  assert.equal((await suya('PUT', '/configuracion', { mantenimiento_activo: true })).estado, 200);
  assert.equal(valorDe('mantenimiento_activo'), '1');
  assert.equal((await suya('PUT', '/configuracion', { mantenimiento_activo: false })).estado, 200);
  assert.equal(valorDe('mantenimiento_activo'), '0');
});

// ------------------------------------------- una sola manera de normalizar ---

test('el permiso y el guardado preguntan lo mismo, y se lo preguntan al mismo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/configuracion.js'), 'utf8');
  assert.ok(!/DEL_MANTENIMIENTO\.some\(\(c\) => c in cambios\)/.test(fuente),
    'la presencia de la clave no puede volver a ser la pregunta: la pantalla las manda todas');
  assert.match(fuente, /quedaDistinta\(c, cambios\[c\]\)/, 'se pregunta por el cambio');
  // Y las dos cuentas salen del mismo sitio: dos maneras de normalizar serían
  // dos verdades, y ese fue exactamente el defecto
  assert.equal((fuente.match(/comoQuedaria\(/g) || []).length, 3,
    'se declara una vez y la usan las dos: el permiso y el bucle que escribe');
});

test('la pantalla tampoco le dibuja el interruptor a quien no lo puede mover', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const trozo = app.slice(app.indexOf('async function viewConfiguracion('),
    app.indexOf('async function viewConfiguracion(') + 2200);
  assert.match(trozo, /tieneLlave\('sistema_mantenimiento'\)/);
  /*
   * Se mira DENTRO de la decisión y no que el nombre exista.
   *
   * La primera versión de esta prueba pedía que apareciera «seBloquea» en el
   * trozo, y con eso se le podía vaciar el cuerpo —dejarlo en `!puedeCambiarla`,
   * que es como estaba antes— sin que se pusiera roja. El nombre no dice nada:
   * lo que importa es que la decisión pregunte por la llave del mantenimiento.
   */
  const decision = trozo.slice(trozo.indexOf('const seBloquea = '));
  const hastaElCampo = decision.slice(0, decision.indexOf('const campo = '));
  assert.match(hastaElCampo, /DEL_MANTENIMIENTO/, 'el bloqueo distingue esos dos campos');
  assert.match(hastaElCampo, /puedeElMantenimiento/, 'y los bloquea a quien no tenga la llave');
});
