/**
 * La ayuda social que nace sola de una solicitud aprobada.
 *
 * LO QUE SE CUIDA ACÁ es lo que pasa cuando el sistema escribe por su cuenta
 * en un registro que después se rinde. Tres cosas, y ninguna se nota si falla:
 *
 *   · QUE NO SE DUPLIQUE. Cada vez que alguien corrija una coma en una
 *     solicitud ya aprobada se vuelve a pasar por acá. Sin el enlace guardado,
 *     nacería otra ayuda idéntica en cada guardado y el listado de lo
 *     entregado quedaría inflado sin que nadie entienda por qué.
 *
 *   · QUE NO NAZCA CUANDO NO CORRESPONDE. Una solicitud de certificado, o una
 *     ayuda rechazada, no pueden dejar una ayuda registrada. Sería decir que
 *     la iglesia entregó algo que no entregó.
 *
 *   · QUE LOS DATOS SEAN LOS DE LA SOLICITUD. Si la ayuda naciera a nombre de
 *     otra persona, o con el tipo equivocado, sería peor que no tenerla: nadie
 *     revisa lo que el sistema escribió solo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { generarSiCorresponde, leToca, CONCEDIDA } = require('../../server/solicitud-ayuda');
const { TIPOS_DE_AYUDA } = require('../../server/tipos-de-ayuda');
const ayudas = require('../../server/modules/ayudas_sociales');
const solicitudes = require('../../server/modules/solicitudes');

const usuario = { id: 1, nombre: 'La Encargada' };
let cuantos = 0;

function unaIglesia() {
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${++cuantos}`, `AY-${cuantos}`).lastInsertRowid;
}
function unNoMiembro(nombres = 'María', apellidos = 'Soto') {
  return db.prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?, ?, ?)')
    .run(nombres, apellidos, unaIglesia()).lastInsertRowid;
}
function unMiembro(nombres = 'Pedro', apellidos = 'Rojas') {
  return db.prepare('INSERT INTO miembros (nombres, apellidos, iglesia_id, rut) VALUES (?, ?, ?, ?)')
    .run(nombres, apellidos, unaIglesia(), `${60000000 + cuantos}-0`).lastInsertRowid;
}

/** Una solicitud como la que deja el sistema, ya guardada. */
function unaSolicitud(campos = {}) {
  const base = {
    // Ojo: todos los archivos de pruebas del motor comparten UNA base. El
    // número de solicitud es único, así que se usa un año que ninguna otra
    // prueba toca; con el formato de siempre chocaba con los que asigna la
    // prueba de la migración a sus solicitudes antiguas.
    numero: `${String(++cuantos).padStart(4, '0')}-2099`,
    fecha: '2026-08-20', fecha_respuesta: '2026-08-25', iglesia_id: unaIglesia(),
    solicitante_tipo: 'No miembro', no_miembro_id: null, miembro_id: null,
    solicitante: 'María Soto', tipo: 'Ayuda social', ayuda_tipo: 'Alimentos', ayuda_monto: 45000,
    asunto: 'Caja de mercadería', descripcion: 'Quedó sin trabajo', estado: 'Pendiente',
    ayuda_social_id: null, ...campos,
  };
  const cols = Object.keys(base);
  const info = db.prepare(
    `INSERT INTO solicitudes (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map((c) => base[c]));
  return { ...base, id: info.lastInsertRowid };
}

const laAyuda = (id) => db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id);
const cuantasAyudas = () => db.prepare('SELECT COUNT(*) c FROM ayudas_sociales').get().c;

// ------------------------------------------------- que nazca con lo que dice

test('al conceder una solicitud de ayuda social, la ayuda queda registrada', () => {
  const nm = unNoMiembro('María', 'Soto');
  const sol = unaSolicitud({ no_miembro_id: nm, estado: 'Aprobada' });
  const id = generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } });
  assert.ok(id, 'no se creó ninguna ayuda');

  const a = laAyuda(id);
  assert.equal(a.beneficiario, 'María Soto', 'la ayuda quedó a nombre de otra persona');
  assert.equal(a.beneficiario_tipo, 'No miembro');
  assert.equal(a.no_miembro_id, nm);
  assert.equal(a.miembro_id, null, 'no puede quedar enganchada a los dos registros');
  assert.equal(a.tipo_ayuda, 'Alimentos');
  assert.equal(a.valor_estimado, 45000);
  assert.equal(a.iglesia_id, sol.iglesia_id);
  assert.equal(a.estado, 'Aprobada');
  assert.equal(a.solicitud_id, sol.id, 'sin esto no se puede volver a la solicitud que la originó');
  assert.match(a.descripcion, /Caja de mercadería/);
  assert.match(a.descripcion, /Quedó sin trabajo/);
  assert.equal(a.aprobada_por, 'La Encargada');
});

test('la fecha de la ayuda es la de la resolución, no la de cuando se pidió', () => {
  // Es cuando la iglesia se comprometió a entregarla. La fecha en que alguien
  // la pidió ya está guardada en la solicitud.
  const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado: 'Aprobada', fecha: '2026-01-10', fecha_respuesta: '2026-03-04' });
  const a = laAyuda(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } }));
  assert.equal(a.fecha, '2026-03-04');
});

test('si la solicitud es de un miembro, la ayuda queda enganchada a su ficha', () => {
  const m = unMiembro('Pedro', 'Rojas');
  const sol = unaSolicitud({ solicitante_tipo: 'Miembro', miembro_id: m, estado: 'Aprobada' });
  const a = laAyuda(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } }));
  assert.equal(a.beneficiario_tipo, 'Miembro');
  assert.equal(a.miembro_id, m);
  assert.equal(a.no_miembro_id, null);
  assert.equal(a.beneficiario, 'Pedro Rojas');
});

test('«Completada» también la genera, no solo «Aprobada»', () => {
  for (const estado of CONCEDIDA) {
    const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado });
    assert.ok(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } }),
      `«${estado}» tendría que generar la ayuda`);
  }
});

// ------------------------------------------------------- que no se duplique

test('guardar de nuevo una solicitud ya aprobada NO crea otra ayuda', () => {
  const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado: 'Aprobada' });
  const id = generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } });
  const habia = cuantasAyudas();

  // Tres guardados más, como quien corrige el asunto tres veces
  for (let i = 0; i < 3; i++) {
    assert.equal(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Aprobada' } }), null);
  }
  assert.equal(cuantasAyudas(), habia, 'se duplicó la ayuda al volver a guardar');
  assert.equal(sol.ayuda_social_id, id);
});

test('el enlace queda guardado en la solicitud, no solo en memoria', () => {
  const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado: 'Aprobada' });
  const id = generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } });
  const guardada = db.prepare('SELECT ayuda_social_id FROM solicitudes WHERE id = ?').get(sol.id);
  assert.equal(guardada.ayuda_social_id, id, 'sin esto, al reiniciar el sistema se duplicaría');
});

// --------------------------------------------- que no nazca cuando no toca

test('una solicitud que no es de ayuda social no genera nada', () => {
  for (const tipo of ['Certificado', 'Credencial', 'Traslado de membresía', 'Otro']) {
    const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), tipo, estado: 'Aprobada' });
    assert.equal(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } }), null,
      `«${tipo}» no puede dejar una ayuda registrada`);
  }
});

test('una ayuda rechazada o anulada tampoco', () => {
  // Sería decir que la iglesia entregó algo que no entregó.
  for (const estado of ['Rechazada', 'Anulada']) {
    const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado });
    assert.equal(generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } }), null);
  }
});

test('mientras sigue en trámite, no se adelanta', () => {
  for (const estado of ['Pendiente', 'En revisión', 'En espera de antecedentes']) {
    const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado });
    assert.equal(generarSiCorresponde(sol, { db, user: usuario, existing: null }), null);
  }
});

test('lo que dispara la ayuda es el momento de conceder, no estar concedida', () => {
  const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado: 'Aprobada' });
  assert.equal(leToca(sol, { estado: 'Pendiente' }), true, 'de pendiente a aprobada: sí');
  assert.equal(leToca(sol, { estado: 'Aprobada' }), false, 'ya estaba aprobada: no');
  assert.equal(leToca({ ...sol, ayuda_social_id: 7 }, { estado: 'Pendiente' }), false, 'ya generó la suya: no');
});

// ----------------------------------------------- que no se borre sola

test('si después se rechaza, la ayuda ya registrada NO se borra', () => {
  /*
   * Es la diferencia con los movimientos que genera una ofrenda: aquellos son
   * un cálculo y se rehacen; esto es la constancia de algo que se entregó. Si
   * de verdad no se entregó, alguien tiene que borrarla a conciencia.
   */
  const sol = unaSolicitud({ no_miembro_id: unNoMiembro(), estado: 'Aprobada' });
  const id = generarSiCorresponde(sol, { db, user: usuario, existing: { estado: 'Pendiente' } });

  const rechazada = { ...sol, estado: 'Rechazada' };
  generarSiCorresponde(rechazada, { db, user: usuario, existing: { estado: 'Aprobada' } });
  assert.ok(laAyuda(id), 'la ayuda desapareció sola');
});

// -------------------------------------- que los dos módulos digan lo mismo

test('los tipos de ayuda que ofrece la solicitud son EXACTAMENTE los de la ayuda', () => {
  // Si la solicitud admitiera uno que la ayuda no conoce, la ficha nacería con
  // un valor que su propio desplegable no ofrece: imposible de corregir sin
  // borrarla y empezar de nuevo.
  const enLaAyuda = ayudas.fields.find((f) => f.name === 'tipo_ayuda').options;
  const enLaSolicitud = solicitudes.fields.find((f) => f.name === 'ayuda_tipo').options;
  assert.deepEqual(enLaSolicitud, enLaAyuda);
  assert.deepEqual(enLaAyuda, TIPOS_DE_AYUDA);
});

test('el tipo de ayuda solo se exige en las solicitudes de ayuda social', () => {
  const campo = solicitudes.fields.find((f) => f.name === 'ayuda_tipo');
  assert.equal(campo.required, true);
  assert.deepEqual(campo.showIf, { field: 'tipo', equals: 'Ayuda social' });
});

test('«Ayuda social» sigue siendo un tipo de solicitud que existe', () => {
  // Si alguien le cambiara el nombre a esa opción, todo esto dejaría de
  // dispararse en silencio y nadie se enteraría hasta meses después.
  const tipos = solicitudes.fields.find((f) => f.name === 'tipo').options;
  assert.ok(tipos.includes('Ayuda social'), 'sin esta opción, la ayuda no se genera nunca más');
});

test('el enlace de ida y el de vuelta existen en los dos módulos', () => {
  const ida = solicitudes.fields.find((f) => f.name === 'ayuda_social_id');
  const vuelta = ayudas.fields.find((f) => f.name === 'solicitud_id');
  assert.equal(ida.ref, 'ayudas_sociales');
  assert.equal(ida.readonly, true, 'lo escribe el sistema: a mano se podría apuntar a cualquier ayuda');
  assert.equal(vuelta.ref, 'solicitudes');
  assert.equal(vuelta.readonly, true);
});
