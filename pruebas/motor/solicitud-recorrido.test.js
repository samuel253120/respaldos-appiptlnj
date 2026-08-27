/**
 * El recorrido de una solicitud: por dónde puede pasar y con qué.
 *
 * Una solicitud no es una ficha que se llena y se archiva. Entra, alguien la
 * lleva, y termina resuelta. Las tres reglas que se prueban acá son las que
 * hacen que ese recorrido signifique algo; sin ellas el estado era un campo
 * más de la ficha, con la lista completa siempre disponible.
 *
 *   · NO SE SALTA DE UN CIERRE A OTRO. Se comprobó, antes de esto, pasar una
 *     solicitud de «Anulada» a «Completada» y que se guardara. Eso es dar por
 *     entregado algo que se anuló. Para retomarla hay que reabrirla, y esa
 *     decisión queda escrita.
 *
 *   · NO SE CIERRA EN BLANCO. Rechazar una solicitud sin escribir por qué deja
 *     a quien pidió sin respuesta y al historial diciendo «De Pendiente a
 *     Rechazada», que no es constancia de nada.
 *
 *   · NO SE QUEDA SIN NADIE A CARGO mientras está abierta. Sin responsable no
 *     le llega aviso a nadie ni aparece en la bandeja de nadie: es una
 *     solicitud que nadie mira.
 *
 * Se prueba el gancho directamente —es donde vive la regla— y además que la
 * lista que usa el formulario en el navegador diga exactamente lo mismo que la
 * del servidor: si se separan, la pantalla ofrece un camino que el servidor
 * después rechaza.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const solicitudes = require('../../server/modules/solicitudes');

const { ESTADOS, CERRADOS, ABIERTOS, sePuedePasar } = solicitudes;
const guardar = solicitudes.hooks.beforeSave;

let cuantos = 0;
const usuario = { id: 1, nombre: 'La Encargada', rol: 'admin' };

/** Una solicitud ya guardada, como la que se está editando. */
function comoEstaba(campos = {}) {
  return {
    id: ++cuantos,
    numero: `${String(cuantos).padStart(4, '0')}-2098`,
    fecha: '2026-08-20',
    iglesia_id: 1,
    solicitante_tipo: null,
    solicitante: 'Quien pidió',
    tipo: 'Otro',
    asunto: 'Un asunto',
    estado: 'Pendiente',
    respuesta: null,
    fecha_respuesta: null,
    responsable_id: usuario.id,
    ...campos,
  };
}

/**
 * Corre el gancho sobre una edición y devuelve el error, o null si pasó.
 *
 * Recibe el objeto de cambios tal cual —sin copiarlo— porque el gancho escribe
 * en él: la fecha de respuesta la pone ahí, y varias pruebas la miran después.
 */
function alGuardar(existing, cambios) {
  return guardar(cambios, { isNew: false, existing, user: usuario, db });
}

// --------------------------------------- de qué estado se pasa a cuál ------

test('quedarse en el mismo estado siempre se puede', () => {
  for (const e of ESTADOS) assert.equal(sePuedePasar(e, e), true, e);
});

test('entre los estados abiertos se anda libremente', () => {
  for (const desde of ABIERTOS) {
    for (const hasta of ABIERTOS) {
      assert.equal(sePuedePasar(desde, hasta), true, `${desde} → ${hasta}`);
    }
  }
});

test('desde cualquier abierto se cierra de las cuatro maneras', () => {
  for (const desde of ABIERTOS) {
    for (const hasta of CERRADOS) {
      assert.equal(sePuedePasar(desde, hasta), true, `${desde} → ${hasta}`);
    }
  }
});

test('desde uno cerrado siempre se puede reabrir', () => {
  for (const desde of CERRADOS) {
    for (const hasta of ABIERTOS) {
      assert.equal(sePuedePasar(desde, hasta), true, `${desde} → ${hasta}`);
    }
  }
});

test('de un cierre a otro, NO: hay que reabrirla primero', () => {
  const saltos = [];
  for (const desde of CERRADOS) {
    for (const hasta of CERRADOS) {
      if (desde === hasta) continue;
      if (sePuedePasar(desde, hasta)) saltos.push(`${desde} → ${hasta}`);
    }
  }
  assert.deepEqual(saltos, ['Aprobada → Completada'],
    'lo único que va de un cierre a otro es completar lo aprobado, que es su final natural');
});

test('lo aprobado se completa: es el final de una solicitud concedida', () => {
  assert.equal(sePuedePasar('Aprobada', 'Completada'), true);
});

test('de anulada a completada, no; de anulada a en revisión, sí', () => {
  assert.equal(sePuedePasar('Anulada', 'Completada'), false);
  assert.equal(sePuedePasar('Anulada', 'En revisión'), true);
});

test('de rechazada a aprobada sin reabrir, no', () => {
  assert.equal(sePuedePasar('Rechazada', 'Aprobada'), false);
});

test('el gancho lo rechaza al guardar, y dice cómo seguir', () => {
  const error = alGuardar(
    comoEstaba({ estado: 'Anulada', respuesta: 'Se desistió', fecha_respuesta: '2026-08-21' }),
    { estado: 'Completada' }
  );
  assert.match(String(error), /no pasa a «completada»/i);
  assert.match(String(error), /vuelva a ponerla en trámite/i,
    'un «no se puede» sin salida deja a la persona detenida');
});

test('una solicitud nueva puede nacer en cualquier estado', () => {
  for (const estado of ESTADOS) {
    const error = guardar(
      { estado, responsable_id: usuario.id, respuesta: 'Resuelto al ingresar', fecha: '2026-08-20' },
      { isNew: true, existing: null, user: usuario, db }
    );
    assert.equal(error, null, `nueva en ${estado}: ${error}`);
  }
});

// ------------------------------------ no se cierra sin decir qué se resolvió --

test('cerrar con la resolución en blanco, no, de ninguna de las cuatro maneras', () => {
  for (const estado of CERRADOS) {
    const error = alGuardar(comoEstaba(), { estado });
    assert.match(String(error), /Respuesta \/ Resolución/,
      `se dejó cerrar como ${estado} sin decir qué se resolvió`);
  }
});

test('ni con espacios en blanco por respuesta', () => {
  const error = alGuardar(comoEstaba(), { estado: 'Rechazada', respuesta: '   \n  ' });
  assert.match(String(error), /Respuesta \/ Resolución/);
});

test('con la resolución escrita se cierra, y el sistema le pone la fecha', () => {
  const datos = { estado: 'Aprobada', respuesta: 'Se aprueba la ayuda solicitada.' };
  assert.equal(alGuardar(comoEstaba(), datos), null);
  assert.equal(datos.fecha_respuesta, new Date().toISOString().slice(0, 10));
});

test('lo aprobado se completa sin volver a escribir la resolución', () => {
  const antes = comoEstaba({
    estado: 'Aprobada', respuesta: 'Se aprueba la ayuda solicitada.', fecha_respuesta: '2026-08-21',
  });
  assert.equal(alGuardar(antes, { estado: 'Completada' }), null);
});

test('reabrir no pide resolución, y le borra la fecha de respuesta', () => {
  const antes = comoEstaba({ estado: 'Anulada', respuesta: 'Se desistió', fecha_respuesta: '2026-08-21' });
  const datos = { estado: 'En revisión' };
  assert.equal(alGuardar(antes, datos), null);
  assert.equal(datos.fecha_respuesta, null);
});

test('corregir una coma de una solicitud ya cerrada no vuelve a pedir nada', () => {
  const antes = comoEstaba({ estado: 'Rechazada', respuesta: 'No corresponde.', fecha_respuesta: '2026-08-21' });
  assert.equal(alGuardar(antes, { asunto: 'Un asunto, corregido' }), null);
});

// --------------------------------- no se queda sin nadie a cargo -----------

test('vaciar el responsable de una solicitud abierta, no', () => {
  for (const estado of ABIERTOS) {
    const error = alGuardar(comoEstaba({ estado }), { responsable_id: null });
    assert.match(String(error), /necesita a alguien a cargo/i, `quedó sin dueño estando ${estado}`);
  }
  assert.match(String(alGuardar(comoEstaba(), { responsable_id: '' })), /a alguien a cargo/i);
  assert.match(String(alGuardar(comoEstaba(), { responsable_id: 0 })), /a alguien a cargo/i);
});

test('una cerrada sí puede quedarse sin responsable', () => {
  for (const estado of CERRADOS) {
    const antes = comoEstaba({ estado, respuesta: 'Resuelto', fecha_respuesta: '2026-08-21' });
    assert.equal(alGuardar(antes, { responsable_id: null }), null, `${estado} no dejó soltar el enlace`);
  }
});

test('no tocar el responsable deja el que tenía', () => {
  assert.equal(alGuardar(comoEstaba(), { asunto: 'Otro asunto' }), null);
});

test('una abierta guardada sin responsable desde antes tampoco pasa', () => {
  const error = alGuardar(comoEstaba({ responsable_id: null }), { asunto: 'Otro asunto' });
  assert.match(String(error), /necesita a alguien a cargo/i);
});

// --------------------------- la pantalla ofrece lo mismo que acepta el servidor --

test('la tabla del navegador dice exactamente lo mismo que la del servidor', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const trozo = app.match(/const SOL_SIGUIENTES\s*=\s*(\{[\s\S]*?\n\});/);
  assert.ok(trozo, 'el formulario tiene que llevar su copia de SIGUIENTES para no ofrecer caminos cerrados');
  // eslint-disable-next-line no-new-func
  const delNavegador = new Function(`return ${trozo[1]}`)();
  assert.deepEqual(delNavegador, solicitudes.SIGUIENTES,
    'si las dos listas se separan, la pantalla ofrece un estado que el servidor después rechaza');
});
