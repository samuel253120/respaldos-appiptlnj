/**
 * El Registro de Cambios se puede filtrar por quién hizo el cambio.
 *
 * Este libro existe para contestar «¿quién cambió este monto?», y eso se
 * contesta mirando una línea. La otra mitad de la pregunta —«¿qué tocó esta
 * persona?»— pide recorrer el libro entero por alguien, y hasta acá había que
 * bajar la planilla y filtrar en Excel: el campo «Quién» estaba en la tabla, se
 * podía buscar por él escribiendo el nombre, pero no había un desplegable que
 * lo acotara, como sí lo hay para el módulo y para qué pasó.
 *
 * ── LO QUE HAY QUE CUIDAR AL AGREGARLO ──
 *
 * Un filtro de este libro son cuatro cosas a la vez, y las cuatro se comprueban
 * acá porque cada una se puede romper sola:
 *
 *   1. que la barra lo DIBUJE. Un filtro declarado que la barra no sabe dibujar
 *      se descartaba en silencio —la v1.371.0 encontró nueve así— y desde
 *      entonces el sistema no arranca con uno. Tiene que ser un desplegable con
 *      su lista, no un texto.
 *   2. que la lista salga de LOS DATOS y no de la tabla de usuarios: se ofrece
 *      filtrar por quien de verdad dejó líneas, no por toda cuenta que exista.
 *   3. que esté ACOTADA. Ofrecerle a la secretaria del Norte el nombre de
 *      alguien que solo aparece en líneas del Sur sería contarle algo que su
 *      propio listado no le muestra.
 *   4. que se guarde el NOMBRE y no el número de la cuenta. Un `ref` a Usuarios
 *      dejaría el libro cambiando de contenido cada vez que alguien edita su
 *      ficha, que es justo lo que un registro no puede hacer.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const modulo = require('../../server/modules/registro_cambios');
const { getModule } = require('../../server/registry');
const alcance = require('../../server/alcance');

/* ------------------------------------------------------------ el mundo */

const norte = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte del Quién', 'IG-QN', 'Activa')")
  .run().lastInsertRowid;
const sur = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Sur del Quién', 'IG-QS', 'Activa')")
  .run().lastInsertRowid;

const anotar = (quien, iglesia, modu) => db
  .prepare(
    `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, usuario, iglesia_id)
     VALUES ('2026-09-06', '10:31', ?, 'Cambio', 'Una ficha', ?, ?)`
  )
  .run(modu, quien, iglesia).lastInsertRowid;

anotar('Secretaria del Quién Norte', norte, 'Miembros');
anotar('Secretaria del Quién Norte', norte, 'Asistencias');
anotar('Tesorero Bueno del Quién', sur, 'Tesorería');
anotar('Sin nombre puesto', norte, 'Miembros');
db.prepare("UPDATE registro_cambios SET usuario = '' WHERE usuario = 'Sin nombre puesto'").run();

/** Quien mira: acotada a su congregación, como una secretaria de verdad. */
const delNorte = { id: 90, rol: 'admin', iglesia_id: norte, iglesias: [norte] };
const delSur = { id: 91, rol: 'admin', iglesia_id: sur, iglesias: [sur] };

/** Corre una ruta del módulo sin levantar el servidor, con su alcance de verdad. */
function ruta(cual) {
  let handler = null;
  const router = { get(r, ...resto) { if (r === cual) handler = resto[resto.length - 1]; } };
  modulo.extraRoutes(router, {
    db,
    requirePerm: () => (req, res, next) => next(),
    scopeClause: (user, params) => alcance.condiciones(getModule('registro_cambios'), user, params) || null,
  });
  assert.ok(handler, `la ruta ${cual} tiene que existir`);
  return (user) => {
    let cuerpo = null;
    handler({ user, query: {} }, { json: (d) => { cuerpo = d; } });
    return cuerpo;
  };
}

const quienes = ruta('/registro_cambios/usuarios');
const modulos = ruta('/registro_cambios/modulos');

// ------------------------------------------- 1. la barra lo dibuja ---------

test('«Quién» está entre los filtros de la barra', () => {
  assert.ok((modulo.filterFields || []).includes('usuario'),
    'sin esto el desplegable no se dibuja y solo queda ?f_usuario= escrito a mano');
});

test('y está declarado de una forma que la barra sepa dibujar', () => {
  /*
   * Ésta es la que impide que vuelva lo de la v1.371.0. El arranque ya lo
   * comprueba para los cuarenta y un módulos; acá se dice para éste, que es
   * donde importa: un `text` en filterFields se descartaba sin decir nada.
   */
  const campo = modulo.fields.find((f) => f.name === 'usuario');
  assert.equal(campo.type, 'select', 'un texto en la barra se descarta en silencio');
  assert.ok(campo.optionsRoute, 'su lista tiene que salir de una ruta');
  assert.ok(campo.readonly, 'el registro no se escribe a mano, tampoco este campo');
});

test('se guarda el nombre y no el número de la cuenta', () => {
  const campo = modulo.fields.find((f) => f.name === 'usuario');
  assert.equal(campo.type === 'ref' || !!campo.ref, false,
    'un ref a Usuarios dejaría el libro cambiando de contenido cuando alguien edita su ficha');
});

// --------------------------------- 2 y 3. la lista, y acotada --------------

test('la lista ofrece a quienes de verdad dejaron líneas', () => {
  const lista = quienes(delNorte).map((o) => o.label);
  assert.ok(lista.includes('Secretaria del Quién Norte'), 'dejó dos líneas: tiene que estar');
  // Aparece una sola vez aunque tenga dos líneas, y en dos módulos distintos.
  assert.equal(lista.filter((n) => n === 'Secretaria del Quién Norte').length, 1);
  assert.ok(!lista.includes(''), 'una línea sin nombre no agrega una opción en blanco');
});

test('la lista está acotada a lo que quien pregunta alcanza', () => {
  const enElNorte = quienes(delNorte).map((o) => o.label);
  const enElSur = quienes(delSur).map((o) => o.label);

  assert.ok(!enElNorte.includes('Tesorero Bueno del Quién'),
    'ese nombre solo aparece en líneas del Sur: ofrecerlo sería contar algo que su listado no muestra');
  assert.ok(!enElSur.includes('Secretaria del Quién Norte'), 'y al revés');
  assert.ok(enElSur.includes('Tesorero Bueno del Quién'), 'el suyo sí');
});

test('la de módulos, que ya existía, sigue contestando lo suyo', () => {
  // Las dos listas se escriben con la misma función: si una se rompiera al
  // juntarlas, se rompen las dos, y ésta es la que ya estaba en producción.
  const enElNorte = modulos(delNorte).map((o) => o.label);
  assert.ok(enElNorte.includes('Miembros') && enElNorte.includes('Asistencias'));
  assert.ok(!enElNorte.includes('Tesorería'), 'esa línea es del Sur');
});

// ------------------------------------- 4. y el filtro acota de verdad ------

test('filtrar por una persona deja solo sus líneas', () => {
  /*
   * El filtro lo aplica el motor —`?f_usuario=` sobre un campo declarado— así
   * que acá se comprueba el efecto sobre la base con el mismo alcance, que es
   * lo que el listado termina devolviendo.
   */
  const params = [];
  const suyo = alcance.condiciones(getModule('registro_cambios'), delNorte, params);
  const contar = (quien) => db
    .prepare(`SELECT COUNT(*) AS c FROM registro_cambios WHERE usuario = ?${suyo ? ` AND ${suyo}` : ''}`)
    .get(quien, ...params).c;

  assert.equal(contar('Secretaria del Quién Norte'), 2);
  assert.equal(contar('Tesorero Bueno del Quién'), 0, 'sus líneas son del Sur');
});
