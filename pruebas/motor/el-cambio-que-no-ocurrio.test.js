/**
 * Una línea del Registro de Cambios que no cuenta ningún cambio.
 *
 * Medido en la v1.275.0, sobre un acta de reunión recién creada: su PRIMERA
 * edición —cualquiera, aunque solo se corrigiera una coma— dejaba anotado:
 *
 *   Cambio | Lugar: (vacío) → Salón A · Asistentes (escritos a mano): (vacío) → (ninguno)
 *
 * «Asistentes (escritos a mano)» es el campo retirado del formulario: ya no se
 * ve ni se puede tocar. Lo que pasaba es que en la base está en blanco y el
 * formulario lo manda como una lista vacía, y comparados como texto no se
 * parecen. No cambió nada: cambió la manera de escribir «nada».
 *
 * Es menor y corroe justo lo que hace útil a un registro de cambios: que cada
 * línea signifique algo. Si la mitad son ruido, se deja de leer.
 *
 * Y no era de este módulo: la comparación es del motor, así que le pasaba a
 * cualquier campo de lista múltiple del sistema.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unCuerpo() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `FAN${m}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${m}`, iglesia).lastInsertRowid;
  return { m, iglesia, cuerpo };
}

async function comoElFormulario(api, id, cambios) {
  const ficha = (await api('GET', `/actas_reuniones/${id}`)).json;
  const cuerpo = { ...ficha, ...cambios };
  delete cuerpo.id;
  return api('PUT', `/actas_reuniones/${id}`, cuerpo);
}

/** Las líneas de «Cambio» que el registro dejó de ese acta, en orden. */
const susCambios = (numero) => db.prepare(
  `SELECT detalle FROM registro_cambios
    WHERE modulo = 'Actas de Reuniones' AND accion = 'Cambio' AND registro LIKE ?
    ORDER BY id`
).all(`%${numero}%`).map((f) => f.detalle);

// -------------------------------------------------------------------------

test('la primera edición de un acta no anota un cambio que no ocurrió', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: `${e.m}-uno`, fecha: '2026-03-15', cuerpo_id: e.cuerpo, agenda: 'Punto único',
  });
  assert.equal(a.estado, 201);

  await comoElFormulario(api, a.json.id, { lugar: 'Salón A' });
  const lineas = susCambios(a.json.numero_acta);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /Lugar/, 'lo que de verdad cambió sigue anotado');
  assert.ok(!/Asistentes/.test(lineas[0]),
    'y el campo retirado, que nadie tocó, no aparece');
});

test('guardar sin cambiar nada no deja ninguna línea', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: `${e.m}-dos`, fecha: '2026-03-15', cuerpo_id: e.cuerpo, agenda: 'Punto único',
  });
  await comoElFormulario(api, a.json.id, {});
  assert.equal(susCambios(a.json.numero_acta).length, 0,
    'un guardado que no cambia nada no es un cambio');
});

test('un cambio de verdad en una lista múltiple sí se anota', async () => {
  /*
   * La otra mitad, que es la que importa: normalizar no puede volverse ciego.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const persona = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run('Quien', `Sea ${e.m}`, e.iglesia).lastInsertRowid;
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: `${e.m}-tres`, fecha: '2026-03-15', cuerpo_id: e.cuerpo, agenda: 'Punto único',
  });
  await comoElFormulario(api, a.json.id, { asistentes: JSON.stringify([persona]) });

  const lineas = susCambios(a.json.numero_acta);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0], /Asistentes/, 'agregar a alguien a la lista es un cambio');
});

test('el blanco, el nulo y la lista vacía son lo mismo', async () => {
  /*
   * Las tres maneras de escribir «nadie» que conviven en el sistema: la columna
   * en blanco de una ficha antigua, el nulo de una recién creada y el «[]» que
   * manda el formulario. Se pone cada una por detrás y se guarda por la puerta
   * de siempre, que es como llega el caso de verdad.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  for (const escrito of [null, '', '[]']) {
    const a = await api('POST', '/actas_reuniones', {
      numero_acta: `${e.m}-${escrito === null ? 'nulo' : escrito === '' ? 'blanco' : 'vacia'}`,
      fecha: '2026-03-15', cuerpo_id: e.cuerpo, agenda: 'Punto único',
    });
    db.prepare('UPDATE actas_reuniones SET asistentes = ? WHERE id = ?').run(escrito, a.json.id);
    await comoElFormulario(api, a.json.id, { lugar: 'Salón A' });

    const lineas = susCambios(a.json.numero_acta);
    assert.equal(lineas.length, 1, `guardado con la lista escrita como ${JSON.stringify(escrito)}`);
    assert.ok(!/Asistentes/.test(lineas[0]), `con la lista escrita como ${JSON.stringify(escrito)}`);
  }
});

test('la regla de las listas se le aplica solo a las listas', async () => {
  /*
   * La comparación de listas mira los ids y no el texto, así que si se le
   * aplicara a cualquier campo, un texto que parezca una lista se volvería
   * invisible: escribir «[]» en el lugar de la reunión y después borrarlo sería
   * «lo mismo» para el registro, y es un cambio de verdad.
   *
   * Se prueba porque romper el guardia de tipo —dejándolo en «siempre»— no
   * ponía roja ninguna otra prueba: el `catch` que atiende los datos torcidos lo
   * tapa para casi todos los valores, y esta es la esquina donde no lo tapa.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await api('POST', '/actas_reuniones', {
    numero_acta: `${e.m}-corchetes`, fecha: '2026-03-15', cuerpo_id: e.cuerpo,
    agenda: 'Punto único', lugar: '[]',
  });
  await comoElFormulario(api, a.json.id, { lugar: '' });

  const lineas = susCambios(a.json.numero_acta);
  assert.equal(lineas.length, 1, 'borrar el lugar es un cambio, diga lo que diga el texto');
  assert.match(lineas[0], /Lugar/);
});

test('y el orden de la lista se conserva, no se ordena por detrás', () => {
  /*
   * Ninguna lista de este sistema usa hoy su orden, pero ordenarlas al comparar
   * escondería un cambio real el día que alguna sí lo use, y ese es el error
   * caro de los dos.
   */
  const fs = require('fs');
  const path = require('path');
  const bit = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const regla = bit.slice(bit.indexOf('function mismoValor'), bit.indexOf('function cambios'));
  assert.ok(regla, 'la comparación existe');
  assert.ok(!/\.sort\(/.test(regla), 'no ordena');
});

test('le sirve a todo el sistema, no solo al libro de actas', async () => {
  /*
   * La comparación es del motor, así que el fantasma le pasaba a cualquier
   * campo de lista múltiple. Se comprueba sobre una cuenta de usuario —que
   * lleva dos: las iglesias que administra y sus cuerpos— para que se note si
   * alguien vuelve a atar el arreglo al libro de actas.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const usuarios = getModule('usuarios');
  assert.ok((usuarios.fields || []).some((f) => f.type === 'multiref'),
    'las cuentas llevan listas múltiples');

  const suRut = `${21400000 + (process.pid % 500000)}`;
  const cuenta = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesia_id) VALUES (?, ?, 'secretario', 1, ?)`
  ).run(`${suRut}-${require('../../server/rut').digitoVerificador(suRut)}`,
        `Cuenta fantasma ${e.m}`, e.iglesia).lastInsertRowid;

  const ficha = (await api('GET', `/usuarios/${cuenta}`)).json;
  const r = await api('PUT', `/usuarios/${cuenta}`, { ...ficha, id: undefined, telefono: '+56 9 1234 5678', igual_asi: true });
  assert.equal(r.estado, 200);

  const lineas = db.prepare(
    `SELECT detalle FROM registro_cambios
      WHERE modulo = 'Usuarios' AND accion = 'Cambio' AND registro LIKE ? ORDER BY id`
  ).all(`%fantasma ${e.m}%`).map((f) => f.detalle);
  assert.ok(lineas.length <= 1, 'una sola línea, la del cambio de verdad');
  for (const l of lineas) {
    assert.ok(!/\(ninguno\)/.test(l), `salió un cambio que no ocurrió: «${l}»`);
  }
});
