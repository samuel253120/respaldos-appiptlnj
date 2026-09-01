/**
 * Borrar un cuerpo o grupo no se lleva a su gente en silencio.
 *
 * Medido antes de esto, sobre un cuerpo con SEIS integrantes desde 2019 y una
 * directiva vigente, pidiendo borrarlo sin confirmar nada:
 *
 *   se pregunta antes ................. no
 *   la respuesta ...................... 200, borrado
 *   sus 6 fichas de integrante ........ quedan 0
 *   su directiva vigente .............. queda 0
 *   sus 2 cuentas de tesorería ........ quedan 0
 *
 * La ficha de integrante no es un dato administrativo: lleva desde cuándo
 * entró cada uno, su período de prueba, su fecha de oficialización y, si se
 * retiró, cuándo y por qué. Con plata en su caja o con un acta sí se frenaba,
 * y eso estaba bien; el hueco era todo lo que quedaba en medio.
 *
 * Lo único que se borra preguntando es el que TODAVÍA NO FUE NADA: el que se
 * creó hace un minuto con el nombre mal tecleado, cuyo único contenido son las
 * dos cajas vacías que el propio sistema le abrió. Es la misma distinción que
 * la 1.233.0 hizo con una iglesia (ver server/cuerpo-vacio.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const vacio = require('../../server/cuerpo-vacio');
const dependencias = require('../../server/dependencias');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const laIglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
  .run(`Iglesia CV ${marca()}`, `CV${marca()}`).lastInsertRowid;

const cuerpo = ({ tipo = 'Cuerpo', estado = 'Activo', conCajas = true } = {}) => {
  const id = db
    .prepare('INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, ?, ?, ?)')
    .run(`Cuerpo CV ${marca()}`, tipo, laIglesia, estado).lastInsertRowid;
  if (conCajas) require('../../server/cuentas-de-cuerpos').crearLasQueFalten(db, { id, nombre: `Cuerpo CV ${id}`, iglesia_id: laIglesia });
  return id;
};
const fila = (id) => db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(id);

const loSuyo = (id) =>
  vacio.loQueCuelga(db, id, dependencias.referenciasHacia('cuerpos'), dependencias.cuantasApuntan);
const planDe = (id) => dependencias.planDe(db, getModule('cuerpos'), fila(id));
const alBorrar = (id, confirmado = false) =>
  getModule('cuerpos').hooks.beforeDelete(fila(id), { db, user: { id: 1, rol: 'admin' }, confirmado });

// ------------------------------------------- el que todavía no fue nada ----

test('un cuerpo recién creado tiene sus dos cajas y nada más', () => {
  const cu = cuerpo();
  const { contenido, rastro } = loSuyo(cu);
  assert.equal(contenido.length, 0, 'no tiene nada suyo todavía');
  assert.deepEqual(rastro.map((r) => r.campo.clave), ['cuentas_tesoreria.cuerpo_id']);
  assert.equal(rastro[0].n, 2, 'las dos que le abre el sistema: su tesorería y la de las cuotas');
});

test('y borrarlo PREGUNTA, diciendo qué se va con él', () => {
  const cu = cuerpo();
  const aviso = alBorrar(cu);
  assert.equal(aviso && aviso.confirmar, 'cuerpo_sin_nada', 'es una pregunta, no una negativa');
  assert.match(aviso.error, /no tiene nada anotado todavía/i);
  assert.match(aviso.error, /2 en Cuentas de Tesorería/, 'y dice qué se lleva');
  assert.match(aviso.error, /márquelo como inactivo en vez de eliminarlo/i, 'y ofrece la otra salida');
});

test('contestando que sí, se borra y sus dos cajas se van con él', () => {
  const cu = cuerpo();
  assert.equal(alBorrar(cu, true), null, 'ya contestada, no se vuelve a preguntar');
  const plan = planDe(cu);
  assert.equal(plan.freno, null);
  assert.equal(plan.arrastrar.filter((a) => a.def.name === 'cuentas_tesoreria').length, 2);
});

test('se pregunta aunque no cuelgue absolutamente nada', () => {
  /*
   * Borrar no se deshace, y el mismo botón apretado sobre el cuerpo de al lado
   * es irreparable: en un listado de dieciséis, todos con el mismo icono, eso
   * no es una hipótesis. Sin esto, el cuerpo MÁS vacío sería el único que se
   * borra de un clic.
   */
  const aviso = alBorrar(cuerpo({ conCajas: false }));
  assert.equal(aviso && aviso.confirmar, 'cuerpo_sin_nada');
});

test('a un grupo se le dice grupo', () => {
  assert.match(alBorrar(cuerpo({ tipo: 'Grupo' })).error, /^El grupo «/);
  assert.match(alBorrar(cuerpo({ tipo: 'Cuerpo' })).error, /^El cuerpo «/);
});

// --------------------------------------------- el que tiene gente adentro ----

/** Le mete a un cuerpo una ficha de integrante, como la de cualquiera. */
const integrante = (cuerpoId) => {
  const m = db
    .prepare("INSERT INTO miembros (nombres, apellidos, estado, iglesia_id) VALUES (?, ?, 'Activo', ?)")
    .run('Persona', `CV ${marca()}`, laIglesia).lastInsertRowid;
  return db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, iglesia_id, fecha_ingreso, estado)
              VALUES (?, 'Miembro', ?, ?, '2019-03-01', 'Activo')`)
    .run(cuerpoId, m, laIglesia).lastInsertRowid;
};

test('un cuerpo con seis integrantes desde 2019 NO se borra', () => {
  const cu = cuerpo();
  for (let i = 0; i < 6; i++) integrante(cu);

  assert.equal(alBorrar(cu), null, 'el gancho no pregunta: lo frena el motor, con sus mismas palabras');
  const plan = planDe(cu);
  assert.match(String(plan.freno), /No se puede eliminar el cuerpo/);
  assert.match(plan.freno, /6 en Integrantes de Cuerpos/, 'y dice cuántas fichas hay dentro');
  assert.match(plan.freno, /márquelo como inactivo/i, 'y cuál es la salida');
  assert.equal(plan.arrastrar, undefined, 'frenado, no hay nada que arrastrar');
});

test('ni contestando que sí: acá no hay pregunta que contestar', () => {
  /*
   * Preguntar habría sido lo cómodo. Pero la pregunta se contesta que sí, y lo
   * que se pierde no se recupera: no hay papelera. Un cuerpo que se cierra no
   * necesita borrarse, necesita quedar cerrado.
   */
  const cu = cuerpo();
  integrante(cu);
  assert.equal(alBorrar(cu, true), null);
  assert.match(String(planDe(cu).freno), /No se puede eliminar el cuerpo/);
});

test('el aviso cuenta TODOS sus módulos de una vez, no el primero que aparezca', () => {
  /*
   * Quien va a borrar un cuerpo necesita ver el tamaño de lo que estaba por
   * hacer, no enterarse de a un módulo por vez.
   */
  const cu = cuerpo();
  for (let i = 0; i < 3; i++) integrante(cu);
  db.prepare(`INSERT INTO directivas (cuerpo_id, periodo, fecha_inicio, estado, iglesia_id)
              VALUES (?, '2026-2027', '2026-01-01', 'Vigente', ?)`).run(cu, laIglesia);

  const freno = planDe(cu).freno;
  assert.match(freno, /cuelgan de él 4 registro\(s\)/);
  assert.match(freno, /3 en Integrantes de Cuerpos/);
  assert.match(freno, /1 en Directivas/);
});

test('con una directiva y sin nadie tampoco se borra', () => {
  const cu = cuerpo();
  db.prepare(`INSERT INTO directivas (cuerpo_id, periodo, fecha_inicio, estado, iglesia_id)
              VALUES (?, '2026-2027', '2026-01-01', 'Vigente', ?)`).run(cu, laIglesia);
  assert.match(String(planDe(cu).freno), /1 en Directivas/);
});

test('y uno YA INACTIVO con gente adentro tampoco', () => {
  /*
   * Marcarlo inactivo es la salida que el aviso ofrece; si después se borrara
   * igual, la salida no sería ninguna.
   */
  const cu = cuerpo({ estado: 'Inactivo' });
  integrante(cu);
  const freno = planDe(cu).freno;
  assert.match(String(freno), /No se puede eliminar/);
  assert.doesNotMatch(freno, /márquelo como inactivo/i,
    'ya lo está: mandarlo a hacer lo que ya hizo no es una salida');
  assert.match(freno, /Ya está marcado como inactivo/i);
});

// ------------------------------------------ la plata sigue frenando igual ----

test('una caja con plata deja de ser rastro, y frena', () => {
  const cu = cuerpo();
  const caja = db.prepare("SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ? AND tipo = 'General'").get(cu);
  assert.equal(vacio.susCajasEstanVacias(db, cu), true, 'guardia: recién creadas están vacías');
  db.prepare(`INSERT INTO tesoreria (cuenta_id, tipo, categoria, monto, fecha, concepto, iglesia_id, cuerpo_id)
              VALUES (?, 'Ingreso', 'Ofrenda', 5000, '2026-02-01', ?, ?, ?)`)
    .run(caja.id, `CV ${marca()}`, laIglesia, cu);

  assert.equal(vacio.susCajasEstanVacias(db, cu), false);
  const { contenido, rastro } = loSuyo(cu);
  assert.equal(rastro.length, 0, 'con plata dentro, la caja ya no es el rastro de haber creado nada');
  assert.ok(contenido.some((c) => c.campo.def.name === 'cuentas_tesoreria'));
  assert.match(String(planDe(cu).freno), /No se puede eliminar el cuerpo/);
});

test('un saldo inicial también cuenta como plata', () => {
  const cu = cuerpo();
  db.prepare("UPDATE cuentas_tesoreria SET saldo_inicial = 1000 WHERE cuerpo_id = ? AND tipo = 'General'").run(cu);
  assert.equal(vacio.susCajasEstanVacias(db, cu), false);
});

test('y una DEUDA en su caja también, que era lo que faltaba contar', () => {
  /*
   * La pregunta «¿esta caja está vacía?» estaba escrita dentro de la regla de
   * la iglesia (1.233.0) y contaba tres cosas: movimientos, traspasos y saldo
   * inicial. Las deudas son de la 1.247.0 y nadie volvió a esa pregunta, así
   * que una caja con una deuda viva y sin un solo movimiento contaba como
   * vacía. Ahora la pregunta vive en un solo lugar y las dos reglas la leen de
   * ahí (ver server/caja-vacia.js).
   */
  const cu = cuerpo();
  const caja = db.prepare("SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ? AND tipo = 'General'").get(cu);
  db.prepare(`INSERT INTO deudas (direccion, clase, concepto, monto, fecha, cuenta_id, estado, iglesia_id, cuerpo_id)
              VALUES ('Por pagar', 'Compra a crédito', ?, 100000, '2026-02-01', ?, 'Vigente', ?, ?)`)
    .run(`Sillas CV ${marca()}`, caja.id, laIglesia, cu);

  assert.equal(vacio.susCajasEstanVacias(db, cu), false,
    'una caja con una deuda encima no es un casillero vacío');
  assert.match(String(planDe(cu).freno), /No se puede eliminar el cuerpo/);
});

test('la misma pregunta la usa la regla de la iglesia', () => {
  /*
   * Escritas dos veces, un día una contaría algo que la otra no. Que las dos
   * pidan el mismo archivo es lo que este archivo comprueba.
   */
  const fs = require('fs');
  const path = require('path');
  const iglesia = fs.readFileSync(path.join(__dirname, '../../server/iglesia-vacia.js'), 'utf8');
  const cuerpoJs = fs.readFileSync(path.join(__dirname, '../../server/cuerpo-vacio.js'), 'utf8');
  assert.match(iglesia, /require\('\.\/caja-vacia'\)\.estaVacia/);
  assert.match(cuerpoJs, /require\('\.\/caja-vacia'\)\.estaVacia/);
});

// ------------------------------- lo que ya frenaba sigue frenando igual ----

test('un acta de reunión lo frena, como antes', () => {
  const cu = cuerpo();
  db.prepare(`INSERT INTO actas_reuniones (cuerpo_id, iglesia_id, numero_acta, fecha, estado)
              VALUES (?, ?, ?, '2026-02-10', 'Aprobada')`).run(cu, laIglesia, `CV ${marca()}`);
  assert.match(String(planDe(cu).freno), /1 en Actas de Reuniones/);
});

test('una cuenta de usuario que lo administra lo frena, y dice por qué', () => {
  /*
   * Soltarla sin más dejaría esa cuenta SIN NINGÚN cuerpo asignado, y en este
   * sistema eso significa alcanzarlos TODOS los de sus iglesias (ver
   * server/alcance.js): un borrado que reparte permisos. Es la misma trampa
   * que ya estaba escrita para las iglesias.
   */
  const cu = cuerpo();
  db.prepare(`INSERT INTO usuarios (nombre, rut, password, rol, cuerpos)
              VALUES (?, ?, 'x', 'consulta', ?)`)
    .run(`Encargado CV ${marca()}`, `9${String(1000000 + n).slice(-7)}-0`, JSON.stringify([cu]));

  const freno = planDe(cu).freno;
  assert.match(String(freno), /1 en Usuarios/);
  assert.match(freno, /sin ningún cuerpo asignado pasaría a alcanzar todos los de sus iglesias/i);
});

// ------------------------------------ y el motor lo aplica, de verdad ----

const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: el cuerpo con gente se queda, el recién creado se va', async () => {
  const api = await elSistemaAndando();
  const m = `borrado-${process.pid}`;

  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia del borrado ${m}`, codigo: `BRR${process.pid}`, estado: 'Activa',
  })).json;
  assert.ok(igl && igl.id);

  const crear = async (sufijo) => (await api('POST', '/cuerpos', {
    nombre: `${sufijo} ${m}`, tipo: 'Cuerpo', iglesia_id: igl.id, estado: 'Activo',
  })).json;

  // ── el que todavía no fue nada
  const nuevo = await crear('Recien creado');
  assert.ok(nuevo && nuevo.id);
  const sinConfirmar = await api('DELETE', `/cuerpos/${nuevo.id}`);
  assert.equal(sinConfirmar.estado, 400, `se borró de un clic: ${sinConfirmar.texto.slice(0, 200)}`);
  assert.equal(sinConfirmar.json.confirmar, 'cuerpo_sin_nada', 'y es una pregunta, no una negativa');
  assert.equal((await api('GET', `/cuerpos/${nuevo.id}`)).estado, 200, 'sin contestar, sigue ahí');
  assert.equal((await api('DELETE', `/cuerpos/${nuevo.id}?igual_asi=1`)).estado, 200);
  assert.equal((await api('GET', `/cuerpos/${nuevo.id}`)).estado, 404, 'contestado que sí, se fue');

  // ── el que tiene gente
  const conGente = await crear('Con gente');
  const suGente = [];
  for (let i = 0; i < 6; i++) {
    const p = (await api('POST', '/miembros', {
      nombres: 'Gente', apellidos: `Adentro${i} ${m}`, iglesia_id: igl.id, estado: 'Activo',
    })).json;
    const f = await api('POST', '/integrantes_cuerpo', {
      cuerpo_id: conGente.id, persona_tipo: 'Miembro', miembro_id: p.id,
      fecha_ingreso: '2019-03-01', estado: 'Activo',
    });
    assert.equal(f.estado, 201, `guardia: la ficha tiene que entrar: ${f.texto.slice(0, 200)}`);
    suGente.push(f.json.id);
  }

  const igualAsi = await api('DELETE', `/cuerpos/${conGente.id}?igual_asi=1`);
  assert.equal(igualAsi.estado, 400,
    `se llevó por delante a seis personas: ${igualAsi.texto.slice(0, 250)}`);
  assert.match(igualAsi.json.error, /6 en Integrantes de Cuerpos/);
  assert.ok(!igualAsi.json.confirmar, 'y no es una pregunta: no hay manera de contestarla que sí');

  assert.equal((await api('GET', `/cuerpos/${conGente.id}`)).estado, 200, 'el cuerpo sigue');
  for (const id of suGente) {
    assert.equal((await api('GET', `/integrantes_cuerpo/${id}`)).estado, 200, 'y su gente también');
  }

  // ── y la salida que el aviso ofrece funciona
  assert.equal((await api('PUT', `/cuerpos/${conGente.id}`, { estado: 'Inactivo' })).estado, 200);
  assert.equal((await api('GET', `/cuerpos/${conGente.id}`)).json.estado, 'Inactivo');
});

test('guardando de verdad: una iglesia se sigue borrando como antes', async () => {
  /*
   * La regla del cuerpo entró por el mismo camino que la de la iglesia —el
   * motor mira una lista de módulos que no arrastran nada— así que conviene
   * comprobar que al agregar el segundo el primero siguió andando.
   */
  const api = await elSistemaAndando();
  const m = `iglesiaigual-${process.pid}`;
  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia recien creada ${m}`, codigo: `IRC${process.pid}`, estado: 'Activa',
  })).json;

  const sinConfirmar = await api('DELETE', `/iglesias/${igl.id}`);
  assert.equal(sinConfirmar.estado, 400);
  assert.equal(sinConfirmar.json.confirmar, 'iglesia_sin_nada');
  assert.equal((await api('DELETE', `/iglesias/${igl.id}?igual_asi=1`)).estado, 200);

  const conCuerpo = (await api('POST', '/iglesias', {
    nombre: `Iglesia con cuerpo ${m}`, codigo: `ICC${process.pid}`, estado: 'Activa',
  })).json;
  await api('POST', '/cuerpos', {
    nombre: `Coro ${m}`, tipo: 'Cuerpo', iglesia_id: conCuerpo.id, estado: 'Activo',
  });
  const frenada = await api('DELETE', `/iglesias/${conCuerpo.id}?igual_asi=1`);
  assert.equal(frenada.estado, 400, 'una iglesia con un cuerpo dentro no se borra');
  assert.match(frenada.json.error, /Cuerpos/);
});
