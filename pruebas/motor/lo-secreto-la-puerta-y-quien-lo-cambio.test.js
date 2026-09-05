/**
 * Tres cosas chicas de la configuración que decían algo que no era.
 *
 * CO-07 · MIRAR LA CONFIGURACIÓN ERA SABER LA CONTRASEÑA QUE ABRE TODA CUENTA
 * NUEVA. La pantalla devolvía las setenta opciones con su valor, y una de ellas
 * es la contraseña con que nace cada cuenta y con la que queda cada cuenta
 * restablecida. Medido en la v1.423.0 con una cuenta que solo podía VER la
 * configuración: no podía guardarla (403), no podía restablecerle la contraseña
 * a nadie (403), y leía «Zarza.Ardiente.99» en claro. Quien la sepa y vea que se
 * creó una cuenta puede entrar antes que su dueño, y en esa primera entrada
 * cambiar la contraseña no pide la anterior.
 *
 * CO-08 · QUIEN PASABA LA PUERTA DEL MANTENIMIENTO NO SIEMPRE PODÍA ABRIRLA.
 * Con el sistema en mantenimiento entraba quien pudiera cambiar la
 * configuración, «que es exactamente quien puede apagar el mantenimiento». Eso
 * dejó de ser verdad cuando el mantenimiento tuvo llave propia. Medido: la
 * encargada de configuración entraba con 200 y, al apagarlo, recibía 403.
 *
 * CO-09 · «QUIÉN LO CAMBIÓ» DECÍA QUIÉN APRETÓ GUARDAR. La pantalla manda los
 * setenta campos, y cada uno se escribía cambiara o no, así que las columnas
 * `actualizado_por` y `actualizado_en` de cada opción quedaban con la última
 * persona que apretó Guardar. Medido, apretando Guardar sin cambiar nada: 72
 * filas reescritas, una sola persona anotada en todas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const ajustes = require('../../server/ajustes');
const { bloqueoPorMantenimiento } = require('../../server/auth');

test.after(cerrarElSistema);

const marca = process.pid % 100000;

let cuantas = 0;
function unaCuenta(permisos, nombre) {
  const numero = `${13000000 + (marca * 17 + cuantas++) % 900000}`;
  return db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, permisos) VALUES (?,?,?,1,?)')
    .run(`${numero}-${digitoVerificador(numero)}`, `${nombre} CO789 ${marca}`, 'secretario',
      JSON.stringify(permisos))
    .lastInsertRowid;
}

const soloMira = unaCuenta({ sistema_configuracion: ['view'] }, 'Mirón');
const laCambia = unaCuenta({ sistema_configuracion: ['view', 'edit'] }, 'Encargada');
const laApaga = unaCuenta(
  { sistema_configuracion: ['view', 'edit'], sistema_mantenimiento: ['view'] }, 'Con las dos'
);

/** La opción tal como se la mandan a esa cuenta. */
async function comoLaVe(api, clave) {
  const r = await api('GET', '/configuracion');
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  return r.json.grupos.flatMap((g) => g.items).find((o) => o.clave === clave);
}

// ------------------------------------------- CO-07 · lo secreto ------------

test('la contraseña inicial está declarada como secreta, una sola vez', () => {
  assert.equal(ajustes.POR_CLAVE.password_inicial.secreta, true);
  // Y es la única: si mañana hay otra, esta prueba dice que hay que mirarla
  const secretas = ajustes.OPCIONES.flatMap((g) => g.items).filter((o) => o.secreta).map((o) => o.clave);
  assert.deepEqual(secretas, ['password_inicial']);
});

test('a quien solo mira la configuración no le llega la contraseña inicial', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(soloMira);
  const habia = ajustes.obtener('password_inicial');
  try {
    ajustes.guardar('password_inicial', `Secreta.CO07.${marca}`);
    const o = await comoLaVe(suya, 'password_inicial');
    assert.equal(o.valor, '', 'no viaja');
    assert.equal(o.oculta, true, 'y se dice que está escondida');
    assert.equal(o.puesta, true, 'y que hay una puesta, para que no parezca vacía');
  } finally {
    ajustes.guardar('password_inicial', habia);
  }
});

test('pero a quien la puede cambiar, sí: si no, no podría trabajar con ella', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(laCambia);
  const habia = ajustes.obtener('password_inicial');
  try {
    const cual = `Secreta.CO07b.${marca}`;
    ajustes.guardar('password_inicial', cual);
    const o = await comoLaVe(suya, 'password_inicial');
    assert.equal(o.valor, cual);
    assert.equal(o.oculta, undefined);
  } finally {
    ajustes.guardar('password_inicial', habia);
  }
});

test('lo demás le llega igual a quien solo mira', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(soloMira);
  const o = await comoLaVe(suya, 'iglesia_nombre');
  assert.ok(o.valor, 'esconder lo secreto no puede vaciar el resto de la pantalla');
  assert.equal(o.oculta, undefined);
});

test('y su valor tampoco se escribe en el Registro de Cambios', async () => {
  const api = await elSistemaAndando();
  const cual = `Cordillera.Nube.${marca}`;
  const r = await api('PUT', '/configuracion', { password_inicial: cual });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  const linea = db.prepare(
    `SELECT detalle FROM registro_cambios
      WHERE modulo = 'Configuración del sistema' AND detalle LIKE 'Contraseña inicial%'
      ORDER BY id DESC LIMIT 1`
  ).get();
  assert.ok(linea, 'el cambio sí queda anotado');
  assert.ok(!linea.detalle.includes(cual), `quedó escrita en claro: ${linea.detalle}`);
  assert.match(linea.detalle, /\(no se anota\)/);
});

// ------------------------------------------- CO-08 · la puerta -------------

const filaDe = (id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

test('con el sistema en mantenimiento entra quien lo puede apagar, y solo ése', () => {
  const habia = ajustes.obtener('mantenimiento_activo');
  try {
    ajustes.guardar('mantenimiento_activo', '1');
    assert.equal(bloqueoPorMantenimiento(filaDe(laApaga)), null, 'tiene las dos llaves: pasa');
    assert.ok(bloqueoPorMantenimiento(filaDe(laCambia)),
      'puede cambiar la configuración, pero no apagar el mantenimiento: no pasa');
    assert.ok(bloqueoPorMantenimiento(filaDe(soloMira)));
    assert.ok(bloqueoPorMantenimiento(null), 'y sin cuenta, tampoco');
  } finally {
    ajustes.guardar('mantenimiento_activo', habia);
  }
});

test('y apagado no le cierra la puerta a nadie', () => {
  const habia = ajustes.obtener('mantenimiento_activo');
  try {
    ajustes.guardar('mantenimiento_activo', '0');
    for (const quien of [laApaga, laCambia, soloMira]) {
      assert.equal(bloqueoPorMantenimiento(filaDe(quien)), null);
    }
  } finally {
    ajustes.guardar('mantenimiento_activo', habia);
  }
});

// ------------------------------------------- CO-09 · quién lo cambió -------

const comoQuedo = (clave) => db
  .prepare('SELECT valor, actualizado_por, actualizado_en FROM configuracion WHERE clave = ?')
  .get(clave);

test('guardar sin cambiar nada no toca ninguna fila', async () => {
  const api = await elSistemaAndando();
  const cual = 'cumpleanos_cantidad';
  ajustes.guardar(cual, '4');
  db.prepare('UPDATE configuracion SET actualizado_por = ?, actualizado_en = ? WHERE clave = ?')
    .run(9999, '2020-01-01 00:00:00', cual);
  const antes = comoQuedo(cual);

  // Se manda ese campo con el MISMO valor, que es lo que hace la pantalla con
  // los setenta en cada guardado
  const r = await api('PUT', '/configuracion', { cumpleanos_cantidad: '4' });
  assert.equal(r.estado, 200);

  const despues = comoQuedo(cual);
  assert.equal(despues.actualizado_por, antes.actualizado_por,
    'la fila dice quién CAMBIÓ la opción, no quién apretó Guardar');
  assert.equal(despues.actualizado_en, antes.actualizado_en);
});

test('y cambiarlo sí la toca, con quien lo cambió', async () => {
  await elSistemaAndando();
  const suya = comoOtroUsuario(laCambia);
  const cual = 'cumpleanos_cantidad';
  ajustes.guardar(cual, '4');
  db.prepare('UPDATE configuracion SET actualizado_por = ? WHERE clave = ?').run(9999, cual);

  const r = await suya('PUT', '/configuracion', { cumpleanos_cantidad: '6' });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const despues = comoQuedo(cual);
  assert.equal(despues.valor, '6');
  assert.equal(despues.actualizado_por, laCambia, 'queda anotada la persona que lo cambió');
  ajustes.guardar(cual, '4');
});
