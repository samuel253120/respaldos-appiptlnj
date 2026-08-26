/**
 * Que la configuración y los permisos cubran lo que el sistema fue sumando.
 *
 * POR QUÉ EXISTE. Un módulo nuevo aparece solo en el editor de permisos —se
 * arma del registro— pero un valor que quedó escrito dentro del programa no
 * aparece en ninguna parte: sigue fijo y nadie se entera hasta que una iglesia
 * lo necesita distinto. Y un rol que no declara qué hace con un módulo nuevo
 * se queda con lo que le dé el comodín, que puede ser lo correcto por
 * casualidad o no serlo sin que nada lo diga.
 *
 * Estas pruebas fijan lo que se revisó, para que la próxima cosa que se agregue
 * no vuelva a quedar suelta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const directiva = require('../../server/directiva');
const numeracion = require('../../server/numeracion');
const { MATRIX, todoLoQueSePuedePermitir } = require('../../server/permissions');
const { allModules } = require('../../server/registry');

/* ── Ningún rol acotado depende del comodín para las listas ────────── */

const LISTAS_DE_LA_IGLESIA = ['tipos_actividad', 'motivos_ausencia', 'formatos_certificado', 'categorias_tesoreria'];

test('las listas que mantiene la iglesia están declaradas en TODOS los roles', () => {
  // Caer por comodín no es una decisión: es lo que sobró. Con «*: view», un
  // módulo nuevo queda en solo lectura para todos sin que nadie lo pensara.
  for (const [rol, permisos] of Object.entries(MATRIX)) {
    if ((permisos['*'] || []).length === 4) continue; // el comodín ya da todo
    for (const lista of LISTAS_DE_LA_IGLESIA) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(permisos, lista),
        `«${rol}» no dice qué hace con «${lista}»: cae por comodín`
      );
    }
  }
});

test('quien pasa lista puede mantener los motivos y los tipos de actividad', () => {
  // Si no, todo termina anotado como «Otro motivo», que es no anotar.
  assert.ok(MATRIX.secretario.motivos_ausencia.includes('create'));
  assert.ok(MATRIX.secretario.tipos_actividad.includes('create'));
});

test('pero no los formatos de certificado', () => {
  // Cambiarlos altera cómo se imprimen los certificados YA emitidos.
  assert.deepEqual(MATRIX.secretario.formatos_certificado, ['view']);
});

/* ── El editor explica lo que no se explica solo ───────────────────── */

test('los módulos cuyo nombre no alcanza traen su explicación', () => {
  const todo = todoLoQueSePuedePermitir();
  for (const name of ['formatos_certificado', 'tipos_actividad', 'motivos_ausencia', 'certificados']) {
    const fila = todo.find((x) => x.name === name);
    assert.ok(fila, `«${name}» no aparece en el editor`);
    assert.ok(String(fila.ayuda || '').trim(), `«${name}» se ofrece sin explicar qué significa concederlo`);
  }
});

test('todo módulo del sistema se puede permitir desde el editor', () => {
  // Un módulo que el registro conoce y el editor no ofrece es un permiso que
  // el sistema comprueba y nadie puede conceder.
  const ofrecidos = new Set(todoLoQueSePuedePermitir().filter((x) => !x.esLlave).map((x) => x.name));
  for (const m of allModules()) {
    assert.ok(ofrecidos.has(m.name), `«${m.name}» no se puede conceder desde el editor`);
  }
});

/* ── La categoría que arma la directiva ────────────────────────────── */

test('de fábrica la directiva la componen los Miembro Líder, como estaba fija', () => {
  assert.equal(directiva.categoriaQueCompone(), 'Miembro Líder');
});

test('y se puede cambiar desde la configuración, sin reiniciar', () => {
  ajustes.guardar('directiva_categoria', 'Miembro Activo');
  assert.equal(directiva.categoriaQueCompone(), 'Miembro Activo');
  // El motivo del retiro nombra la categoría: si no la siguiera, la bitácora
  // diría que alguien «dejó de ser Miembro Líder» cuando nunca lo fue.
  assert.equal(directiva.motivoDeSalida(), 'Dejó de ser Miembro Activo');
  ajustes.guardar('directiva_categoria', 'Miembro Líder');
  assert.equal(directiva.categoriaQueCompone(), 'Miembro Líder');
});

test('vacía o inventada vuelve a la de fábrica', () => {
  ajustes.guardar('directiva_categoria', '');
  assert.equal(directiva.categoriaQueCompone(), 'Miembro Líder');
});

test('las categorías que ofrece el ajuste son las del módulo de miembros', () => {
  // Con dos listas separadas, agregar una categoría dejaría de ofrecerse acá y
  // nadie lo notaría hasta querer usarla.
  const opcion = ajustes.OPCIONES.flatMap((g) => g.items).find((i) => i.clave === 'directiva_categoria');
  const ofrecidas = opcion.opciones.map((o) => o.valor);
  assert.deepEqual(ofrecidas, require('../../server/modules/miembros').TIPOS_DE_MIEMBRO);
});

/* ── El número del certificado ─────────────────────────────────────── */

const { db } = require('../../server/db');
const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Num', 'IG-NUM', 'Activa')")
  .run().lastInsertRowid;

test('el certificado estrena su número, como las actas', () => {
  // Se escribía entero a mano: había que ir a mirar cuál fue el último, y
  // bastaba una distracción para repetir uno. En un papel que se firma y se
  // entrega, dos con el mismo número son dos que dicen ser el mismo.
  assert.equal(numeracion.proximoNumero('certificados', iglesia, '2026-03-04'), 'CERT-001-2026');
});

test('y el siguiente sigue al último de esa iglesia y ese año', () => {
  db.prepare(
    `INSERT INTO certificados (numero, tipo, iglesia_id, nombre_titular, fecha_emision, estado)
     VALUES ('CERT-007-2026', 'Bautismo', ?, 'Alguien', '2026-03-04', 'Emitido')`
  ).run(iglesia);
  assert.equal(numeracion.proximoNumero('certificados', iglesia, '2026-03-04'), 'CERT-008-2026');
});

test('el correlativo vuelve a empezar con el año', () => {
  assert.equal(numeracion.proximoNumero('certificados', iglesia, '2027-01-02'), 'CERT-001-2027');
});

test('se numera POR IGLESIA, que es donde el módulo exige que no se repita', () => {
  const otra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Num2', 'IG-NUM2', 'Activa')")
    .run().lastInsertRowid;
  assert.equal(numeracion.proximoNumero('certificados', otra, '2026-03-04'), 'CERT-001-2026');
});

test('el prefijo lo pone la iglesia, y vale en cuanto se cambia', () => {
  ajustes.guardar('certificado_prefijo', 'C/');
  assert.equal(numeracion.proximoNumero('certificados', iglesia, '2026-03-04'), 'C/001-2026');
  ajustes.guardar('certificado_prefijo', 'CERT-');
});

test('sin iglesia no se propone nada, en vez de inventar el 001', () => {
  assert.equal(numeracion.proximoNumero('certificados', null, '2026-03-04'), null);
});
