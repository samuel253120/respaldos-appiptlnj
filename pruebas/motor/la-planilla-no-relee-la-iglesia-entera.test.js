/**
 * IMPORTAR NO PUEDE SIGNIFICAR LEER LA IGLESIA ENTERA UNA VEZ POR FILA.
 *
 * Mientras una planilla se procesa, el sistema no le contesta a nadie: el
 * servidor atiende de a una cosa por vez y esa cosa dura lo que dure el
 * archivo. Medido en la v1.386.0, una revisión previa de 5.000 filas —que no
 * guarda nada— tardaba 58,6 segundos, y una petición corriente hecha durante
 * ese rato —abrir el listado de miembros— esperó 55,7 segundos.
 *
 * De esos 58 segundos, el 97,5% se iba en UNA regla: la de la ficha repetida,
 * que para preguntar «¿no será la misma persona que ya está?» trae las fichas
 * de la iglesia y las compara acá —sin tildes y en minúsculas, que es algo que
 * la base no sabe hacer—. Una vez por ficha guardada no se nota; una vez por
 * fila de una planilla, sí: 7,4 ms de los 7,6 que costaba cada fila.
 *
 * Ahora ese índice se guarda en la memoria del trabajo que lo pide y se pone
 * al día solo. Lo que se comprueba acá es que se lea UNA vez y que la regla
 * siga contestando exactamente lo mismo, que es lo único que importa.
 *
 * Medido después: 3,2 segundos las mismas 5.000 filas, y 1,3 segundos la
 * petición de al lado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
const admin = { id: 1, rol: 'admin' };
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central IE ${marca}`, `IE-${marca}`).lastInsertRowid;

const CUANTAS = 6;
for (let i = 0; i < CUANTAS; i++) {
  db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Vecino${i}`, `Deahi IE ${marca}`, iglesia);
}

/** Cuántas FILAS de miembros de una iglesia se leen mientras corre `hacer`. */
function filasLeidas(hacer) {
  const original = db.prepare;
  let leidas = 0;
  db.prepare = function (sql) {
    const stmt = original.call(this, sql);
    if (!/FROM miembros WHERE iglesia_id = \?/.test(sql)) return stmt;
    const todas = stmt.all.bind(stmt);
    stmt.all = (...a) => { const r = todas(...a); leidas += r.length; return r; };
    return stmt;
  };
  try { hacer(); } finally { db.prepare = original; }
  return leidas;
}

const unaFila = (i) => ({
  nombres: `Nuevo${i}`, apellidos: `Llegado IE ${marca}`, iglesia_id: String(iglesia), estado: 'Activo',
});

test('con la memoria del trabajo, la iglesia se lee una sola vez', () => {
  const memoria = new Map();
  const leidas = filasLeidas(() => {
    for (let i = 0; i < CUANTAS; i++) prepararFila(getModule('miembros'), unaFila(i), admin, memoria);
  });
  assert.equal(leidas, CUANTAS,
    `${CUANTAS} filas tienen que leer la iglesia una vez (${CUANTAS} fichas) y leyeron ${leidas}`);
});

test('sin memoria —un guardado suelto— se lee como siempre', () => {
  const leidas = filasLeidas(() => {
    for (let i = 0; i < CUANTAS; i++) prepararFila(getModule('miembros'), unaFila(i), admin);
  });
  assert.equal(leidas, CUANTAS * CUANTAS,
    'cada guardado suelto trae las fichas de su iglesia: es lo que siempre hizo');
});

// ------------------------------------------- y la regla contesta lo mismo

test('la ficha repetida se sigue viendo, con memoria y sin ella', () => {
  db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Rosa Elena', `Muñoz IE ${marca}`, iglesia);
  const igual = { nombres: 'Rosa', apellidos: `Muñoz IE ${marca}`, iglesia_id: String(iglesia), estado: 'Activo' };

  const conMemoria = prepararFila(getModule('miembros'), igual, admin, new Map());
  const sinMemoria = prepararFila(getModule('miembros'), igual, admin);
  assert.equal(conMemoria.errores.length, 1, JSON.stringify(conMemoria.errores));
  assert.deepEqual(conMemoria.errores, sinMemoria.errores,
    'las dos maneras de preguntarlo tienen que contestar lo mismo');
  assert.match(conMemoria.errores[0], /Ya hay una ficha de Rosa Elena/);
});

test('y las tildes se siguen pasando por alto', () => {
  db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run('Andrés', `Pérez IE ${marca}`, iglesia);
  const sinTildes = {
    nombres: 'ANDRES', apellidos: `Perez IE ${marca}`, iglesia_id: String(iglesia), estado: 'Activo',
  };
  const { errores } = prepararFila(getModule('miembros'), sinTildes, admin, new Map());
  assert.equal(errores.length, 1, `«Andrés Pérez» y «ANDRES Perez» son la misma: ${JSON.stringify(errores)}`);
  assert.match(errores[0], /Ya hay una ficha de Andrés/);
});

// ------------------------- lo que entró más arriba del mismo archivo se ve

test('dos filas iguales en un mismo archivo: la segunda sale marcada', async () => {
  const api = await elSistemaAndando();
  const fila = {
    nombres: 'Elisa', apellidos: `Repetida IE ${marca}`, iglesia_id: String(iglesia), estado: 'Activo',
  };
  const r = await api('POST', '/importar/miembros', { prueba: true, filas: [fila, { ...fila }] });
  assert.equal(r.json.correctas, 1, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.conError, 1, 'la de más abajo tiene que ver a la de más arriba');
  assert.equal(r.json.errores[0].fila, 2);
  assert.match(r.json.errores[0].errores[0], /Ya hay una ficha de Elisa/);
});
