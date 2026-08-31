/**
 * Borrar una iglesia creada por error.
 *
 * Que una iglesia con gente adentro no se borre está bien. El problema era la
 * otra: la que se creó hace un minuto con el nombre mal escrito. Medido sobre
 * una recién creada, sin tocarla:
 *
 *   borrarla al segundo de crearla ....... 400 · «cuelgan de ella 3 registros»
 *   cuáles son esos tres ................. 2 cuentas de tesorería + 1 historial
 *   quién los creó ....................... el propio sistema, al crearla
 *   después de editarla una vez .......... 400 · ahora son 4
 *
 * El sistema fabricaba los motivos por los que después se negaba a borrarla, y
 * cada vez que alguien la tocaba sumaba uno más. Y como marcarla inactiva
 * tampoco la sacaba de ninguna parte, una iglesia mal escrita quedaba para
 * siempre en el listado, en los desplegables y en el selector de arriba.
 *
 * La distinción que arregla eso está en server/iglesia-vacia.js: lo que la
 * iglesia TIENE frena el borrado; lo que el sistema ESCRIBIÓ sobre ella, no.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const dependencias = require('../../server/dependencias');
const vacia = require('../../server/iglesia-vacia');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const IGLESIAS = getModule('iglesias');
const referencias = () => dependencias.referenciasHacia('iglesias');
const cuelga = (id) => vacia.loQueCuelga(db, id, referencias(), dependencias.cuantasApuntan);
const plan = (id) => dependencias.planDe(db, IGLESIAS, db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id));

let n = 0;
/** Una iglesia como la deja el sistema al crearla: dos cuentas y su historial. */
function reciénCreada() {
  const marca = `${++n}-${process.pid}`;
  const id = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia mal escrita ${marca}`, `MAL${marca}`).lastInsertRowid;
  const cuenta = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial)
     VALUES (?, 'Iglesia local', ?, ?, 'Activa', 0)`
  );
  cuenta.run(`Tesorería general — ${marca}`, id, 'General');
  cuenta.run(`Fondo para la corporación — ${marca}`, id, 'Fondo para la corporación');
  db.prepare(
    `INSERT INTO historial_iglesias (iglesia_id, fecha, tipo, descripcion, origen)
     VALUES (?, '2026-08-31', 'Otro', 'Iglesia creada', 'Automático')`
  ).run(id);
  return id;
}

// ------------------------------------------- qué es el rastro y qué no ----

test('una iglesia recién creada solo tiene encima el rastro de haberla creado', () => {
  const { contenido, rastro } = cuelga(reciénCreada());
  assert.deepEqual(contenido, [], 'no debería colgar nada que haya puesto una persona');
  assert.deepEqual(
    rastro.map((r) => `${r.label}:${r.n}:${r.que}`).sort(),
    ['Cuentas de Tesorería:2:arrastra', 'Historial de Iglesias:1:arrastra']
  );
});

test('y el plan de su borrado se las lleva a las tres', () => {
  const p = plan(reciénCreada());
  assert.equal(p.freno, null, 'no tendría que frenarse');
  assert.deepEqual(
    p.arrastrar.map((a) => a.def.name).sort(),
    ['cuentas_tesoreria', 'cuentas_tesoreria', 'historial_iglesias']
  );
});

test('una cuenta con UN movimiento deja de ser rastro: ahí hay plata anotada', () => {
  const id = reciénCreada();
  const caja = db.prepare('SELECT id FROM cuentas_tesoreria WHERE iglesia_id = ? LIMIT 1').get(id);
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES ('2026-08-20','Ingreso','Diezmos','Una ofrenda', 1000, ?, ?)`
  ).run(caja.id, id);
  const { contenido } = cuelga(id);
  assert.ok(contenido.some((c) => c.campo.def.name === 'cuentas_tesoreria'),
    'si una sola cuenta tiene algo, ninguna es rastro');
  assert.match(String(plan(id).freno), /No se puede eliminar/);
});

test('y una con saldo inicial tampoco es rastro, aunque no tenga movimientos', () => {
  const id = reciénCreada();
  db.prepare('UPDATE cuentas_tesoreria SET saldo_inicial = 250000 WHERE iglesia_id = ?').run(id);
  assert.equal(vacia.lasCuentasEstanVacias(db, id), false,
    'una cuenta que empieza con plata dentro es plata anotada igual');
});

test('ni una que es de un cuerpo: esa es del cuerpo, no de la iglesia', () => {
  const id = reciénCreada();
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Coro ${id}`, id).lastInsertRowid;
  db.prepare('UPDATE cuentas_tesoreria SET cuerpo_id = ? WHERE iglesia_id = ? LIMIT 1').run(cuerpo, id);
  assert.equal(vacia.lasCuentasEstanVacias(db, id), false);
});

test('ni una que aparece en un traspaso, por cualquiera de sus dos lados', () => {
  for (const lado of ['cuenta_origen_id', 'cuenta_destino_id']) {
    const id = reciénCreada();
    const caja = db.prepare('SELECT id FROM cuentas_tesoreria WHERE iglesia_id = ? LIMIT 1').get(id);
    db.prepare(
      `INSERT INTO traspasos (fecha, ${lado}, monto, concepto) VALUES ('2026-08-20', ?, 5000, 'Uno')`
    ).run(caja.id);
    assert.equal(vacia.lasCuentasEstanVacias(db, id), false, `por ${lado} tendría que contar`);
  }
});

test('una nota escrita a mano en su historial ya es su historia', () => {
  const id = reciénCreada();
  db.prepare(
    `INSERT INTO historial_iglesias (iglesia_id, fecha, tipo, descripcion, origen)
     VALUES (?, '2026-08-31', 'Otro', 'Lo que contó el pastor', 'Manual')`
  ).run(id);
  assert.equal(vacia.elHistorialEsAutomatico(db, id), false);
  assert.match(String(plan(id).freno), /Historial de Iglesias/);
});

test('y una anotación sin origen escrito se toma por escrita a mano', () => {
  /*
   * La bitácora automática marca «Automático» (ver server/bitacora.js). Lo que
   * llegue sin marca es de antes de esa columna o lo escribió otra cosa: en la
   * duda, se frena. Equivocarse hacia frenar deja una iglesia de más; hacia
   * borrar, se lleva algo que alguien escribió.
   */
  const id = reciénCreada();
  db.prepare(
    "INSERT INTO historial_iglesias (iglesia_id, fecha, tipo, descripcion) VALUES (?, '2026-08-31','Otro','Vieja')"
  ).run(id);
  assert.equal(vacia.elHistorialEsAutomatico(db, id), false);
});

test('el Registro de Cambios no se va con ella: se queda y se le suelta el enlace', () => {
  /*
   * Es la auditoría, y su propio módulo se niega a que se borre una línea:
   * «el registro de cambios no se borra: para eso está». Lo que se suelta es
   * el enlace, no la línea.
   */
  const id = reciénCreada();
  db.prepare(
    `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, iglesia_id)
     VALUES ('2026-08-31','10:00','Cuentas de Tesorería','Cambio','Una cuenta', ?)`
  ).run(id);
  const { contenido, rastro } = cuelga(id);
  assert.deepEqual(contenido, [], 'la auditoría no frena un borrado');
  const suyo = rastro.find((r) => r.campo.def.name === 'registro_cambios');
  assert.equal(suyo.que, vacia.SE_QUEDA);
  const p = plan(id);
  assert.ok(p.soltar.some((s) => s.campo.def.name === 'registro_cambios'), 'y se suelta, no se arrastra');
  assert.ok(!p.arrastrar.some((a) => a.def.name === 'registro_cambios'));
});

// -------------------------------------------------- lo que sí la frena ----

test('con un miembro adentro se frena, y el aviso cuenta TODO lo que hay', () => {
  const id = reciénCreada();
  const rut = `${17000000 + (process.pid % 900000)}`;
  db.prepare(
    "INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES ('Alguien', ?, ?, ?, 'Activo')"
  ).run(`Delaquesecreo ${id}`, `${rut}-${digitoVerificador(rut)}-${id}`, id);
  const freno = String(plan(id).freno);
  assert.match(freno, /No se puede eliminar/);
  assert.match(freno, /1 en Miembros/);
  assert.match(freno, /márquela como inactiva/,
    'y ofrece la salida que sí existe, que desde la 1.232.0 hace algo');
});

test('si lo único que cuelga son cuentas de usuario, el aviso dice el otro motivo', () => {
  /*
   * Éste no es «su gente y su historia»: es que soltarlas dejaría a esas
   * cuentas SIN NINGUNA iglesia asignada, y en este sistema una cuenta sin
   * iglesias asignadas las alcanza TODAS (ver server/alcance.js). Borrar una
   * iglesia le abriría el sistema entero a quien solo administraba esa.
   */
  const id = reciénCreada();
  const rut = `${18000000 + (process.pid % 900000)}`;
  db.prepare("INSERT INTO usuarios (rut, nombre, rol, activo, iglesias) VALUES (?,?,'secretario',1,?)")
    .run(`${rut}-${digitoVerificador(rut)}-${id}`, `Secretaria de la ${id}`, JSON.stringify([id]));
  const freno = String(plan(id).freno);
  assert.match(freno, /1 en Usuarios/);
  assert.match(freno, /Quítesela primero a esas cuentas/);
  assert.match(freno, /pasaría a alcanzarlas todas/, 'y dice por qué, que es lo que no se ve solo');
  assert.doesNotMatch(freno, /márquela como inactiva/, 'marcarla inactiva no arregla esto');
});

// ------------------------------------------------------- la pregunta ----

test('el gancho pregunta antes de borrar, y no se prohíbe', () => {
  const id = reciénCreada();
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  const pregunta = IGLESIAS.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.equal(pregunta.confirmar, 'iglesia_sin_nada');
  assert.match(pregunta.error, new RegExp(fila.nombre), 'la nombra');
  assert.match(pregunta.error, /no tiene nada anotado todavía/);
  assert.match(pregunta.error, /2 en Cuentas de Tesorería y 1 en Historial de Iglesias/,
    'y dice exactamente qué se va con ella');
  assert.match(pregunta.error, /Una vez borrada no se recupera/);
  assert.match(pregunta.error, /márquela como inactiva/,
    'y ofrece la otra salida, que desde la 1.232.0 hace algo de verdad');
});

test('y pregunta también cuando no cuelga absolutamente nada', () => {
  /*
   * La primera versión se saltaba la pregunta ahí —«no hay nada que advertir»—
   * y dejaba la cosa al revés: la iglesia más vacía de todas era la única que
   * se borraba de un clic. Se quitó ese atajo al comprobar que quitarlo no
   * rompía ninguna prueba, que es la señal de que la línea no defendía nada.
   */
  const id = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia pelada ${process.pid}`, `PEL${process.pid}`).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  assert.deepEqual(cuelga(id), { contenido: [], rastro: [] }, 'guardia: no cuelga nada de nada');

  const pregunta = fila && IGLESIAS.hooks.beforeDelete(fila, { db, confirmado: false });
  assert.equal(pregunta.confirmar, 'iglesia_sin_nada', 'igual se pregunta');
  assert.match(pregunta.error, /Una vez borrada no se recupera/);
  assert.doesNotMatch(pregunta.error, /rastro de haberla creado/,
    'y no se inventa un rastro que no hay');
});

test('y contestada, deja pasar', () => {
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(reciénCreada());
  assert.equal(IGLESIAS.hooks.beforeDelete(fila, { db, confirmado: true }), null);
});

test('con algo adentro no pregunta: el aviso lo escribe el motor, y uno solo', () => {
  /*
   * Si el gancho también hablara, habría dos textos distintos para lo mismo y
   * la persona vería el que llegara primero.
   */
  const id = reciénCreada();
  db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Damas ${id}`, id);
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(id);
  assert.equal(IGLESIAS.hooks.beforeDelete(fila, { db, confirmado: false }), null);
  assert.match(String(plan(id).freno), /1 en Cuerpos/);
});

// --------------------------------------- borrando de verdad, por el motor ----

test('borrando de verdad: la iglesia mal escrita se puede deshacer', async () => {
  const api = await elSistemaAndando();
  const marca = `borrable-${process.pid}`;

  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia mal escrita ${marca}`, codigo: `BOR${process.pid}`, estado: 'Activa',
  });
  assert.equal(nueva.estado, 201, nueva.texto.slice(0, 200));
  const id = nueva.json.id;

  // El sistema le abrió sus dos cuentas solo, que es de donde venía el problema
  const suyas = (await api('GET', `/cuentas_tesoreria?f_iglesia_id=${id}&pageSize=20`)).json.rows || [];
  assert.equal(suyas.filter((c) => String(c.iglesia_id) === String(id)).length, 2,
    'guardia: el módulo le abre dos cuentas al crearla');

  const primera = await api('DELETE', `/iglesias/${id}`);
  assert.equal(primera.estado, 400, 'no se borra de una: se pregunta');
  assert.equal(primera.json.confirmar, 'iglesia_sin_nada',
    'y se pregunta con dos botones, no se prohíbe');

  const segunda = await api('DELETE', `/iglesias/${id}?igual_asi=1`);
  assert.equal(segunda.estado, 200, `contestada, tiene que borrarse: ${segunda.texto.slice(0, 200)}`);
  assert.equal((await api('GET', `/iglesias/${id}`)).estado, 404, 'y ya no está');
});

test('y no deja sus cuentas ni su historial colgando de una iglesia que no existe', async () => {
  const api = await elSistemaAndando();
  const marca = `sinhuerfanos-${process.pid}`;
  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia mal escrita ${marca}`, codigo: `HUE${process.pid}`, estado: 'Activa',
  });
  const id = nueva.json.id;
  assert.equal((await api('DELETE', `/iglesias/${id}?igual_asi=1`)).estado, 200);

  for (const modulo of ['cuentas_tesoreria', 'historial_iglesias']) {
    const quedan = db.prepare(`SELECT COUNT(*) AS n FROM "${modulo}" WHERE iglesia_id = ?`).get(id).n;
    assert.equal(quedan, 0, `quedaron ${quedan} en ${modulo} apuntando a una iglesia borrada`);
  }
});

test('el Registro de Cambios conserva sus líneas y anota el borrado', async () => {
  const api = await elSistemaAndando();
  const marca = `auditada-${process.pid}`;
  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia auditada ${marca}`, codigo: `AUD${process.pid}`, estado: 'Activa',
  });
  const id = nueva.json.id;

  // Tocarle una cuenta deja una línea en la auditoría, que es lo que hay que
  // conservar: sin esto la prueba comprobaría que no se pierde algo que no había
  const caja = ((await api('GET', `/cuentas_tesoreria?f_iglesia_id=${id}&pageSize=20`)).json.rows || [])
    .find((c) => String(c.iglesia_id) === String(id));
  await api('PUT', `/cuentas_tesoreria/${caja.id}`, { descripcion: `renombrada ${marca}`, igual_asi: true });
  const antes = db.prepare('SELECT COUNT(*) AS n FROM registro_cambios WHERE iglesia_id = ?').get(id).n;
  assert.ok(antes > 0, 'guardia: tocar una cuenta tiene que quedar anotado en la auditoría');

  assert.equal((await api('DELETE', `/iglesias/${id}?igual_asi=1`)).estado, 200);

  const sobreviven = db
    .prepare("SELECT COUNT(*) AS n FROM registro_cambios WHERE registro LIKE ?").get(`%${marca}%`).n;
  assert.ok(sobreviven >= antes, `la auditoría perdió líneas: había ${antes} y quedan ${sobreviven}`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro_cambios WHERE iglesia_id = ?').get(id).n, 0,
    'y ninguna quedó apuntando a la iglesia borrada');
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM registro_cambios WHERE accion = 'Eliminación' AND registro LIKE ?")
      .get(`%${marca}%`).n, 1,
    'el borrado mismo tiene que quedar anotado: es lo que después explica el hueco'
  );
});

test('borrando de verdad: con un peso adentro no se borra ni contestando que sí', async () => {
  const api = await elSistemaAndando();
  const marca = `conplata-${process.pid}`;
  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia con plata ${marca}`, codigo: `PLA${process.pid}`, estado: 'Activa',
  });
  const id = nueva.json.id;
  const caja = ((await api('GET', `/cuentas_tesoreria?f_iglesia_id=${id}&pageSize=20`)).json.rows || [])
    .find((c) => String(c.iglesia_id) === String(id));
  const mov = await api('POST', '/tesoreria', {
    fecha: '2026-08-20', tipo: 'Ingreso', categoria: 'Diezmos', concepto: `Ofrenda ${marca}`,
    monto: 1000, cuenta_id: caja.id, iglesia_id: id, igual_asi: true,
  });
  assert.equal(mov.estado, 201, `guardia: el movimiento tiene que entrar: ${mov.texto.slice(0, 200)}`);

  const r = await api('DELETE', `/iglesias/${id}?igual_asi=1`);
  assert.equal(r.estado, 400, 'mil pesos anotados alcanzan para que no se borre');
  assert.match(r.json.error, /1 en Tesorería/);
  assert.equal((await api('GET', `/iglesias/${id}`)).estado, 200, 'y sigue ahí');
});

test('borrando de verdad: con una cuenta de usuario asignada tampoco', async () => {
  const api = await elSistemaAndando();
  const marca = `conusuaria-${process.pid}`;
  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia con usuaria ${marca}`, codigo: `USU${process.pid}`, estado: 'Activa',
  });
  const id = nueva.json.id;
  const rut = `${19500000 + (process.pid % 400000)}`;
  const cuenta = await api('POST', '/usuarios', {
    rut: `${rut}-${digitoVerificador(rut)}`, nombre: `Secretaria ${marca}`, rol: 'secretario',
    activo: 1, password: 'Cordillera47', iglesias: [id], iglesia_id: id,
  });
  assert.equal(cuenta.estado, 201, cuenta.texto.slice(0, 200));

  const r = await api('DELETE', `/iglesias/${id}?igual_asi=1`);
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /pasaría a alcanzarlas todas/);
  const suyas = db.prepare('SELECT iglesias FROM usuarios WHERE id = ?').get(cuenta.json.id).iglesias;
  assert.match(String(suyas), new RegExp(String(id)), 'y la cuenta conserva su iglesia');
});
