/**
 * QUEDA CONSTANCIA DE QUIÉN PASÓ LA LISTA Y CUÁNDO.
 *
 * Guardar una lista BORRA y vuelve a insertar la marca de cada persona. Es lo
 * correcto —así dos personas pueden marcar a la vez sin pisarse—, pero tenía
 * un costo que no se veía: la fecha de cada marca pasaba a ser la de la última
 * corrección, no la del día en que se tomó la lista. Medido: corregir una
 * marca dejaba las cuatro con horas distintas y ninguna era la de la toma.
 *
 * Y la asistencia no está entre los módulos que vigila el Registro de Cambios,
 * ni puede estarlo: serían treinta mil líneas, una por persona y por
 * actividad. Así que cambiar a alguien de presente a ausente tres meses
 * después no dejaba rastro en ninguna parte.
 *
 * Lo que cuida este archivo:
 *   · que la primera vez quede guardada aparte y se ARRASTRE al reinsertar
 *   · que la lista sepa decir quién la pasó, cuándo, y quién la corrigió
 *   · que cada corrección deje UNA línea en el Registro de Cambios, con
 *     nombres y con lo que cambió; y que pasar la lista por primera vez no
 *     deje ninguna
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const asistencias = require('../../server/modules/asistencias');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De la constancia', 'IG-CO', 'Activa')")
  .run().lastInsertRowid;

const unCuerpo = (nombre) => db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
  .run(nombre, iglesia).lastInsertRowid;

const damas = unCuerpo('Damas');
const jovenes = unCuerpo('Jóvenes');

let n = 0;
function alguienEn(cuerpoId, nombre) {
  n++;
  const miembro = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(nombre || `Con${n}`, `Stancia${n}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
     VALUES (?, ?, ?, 'Activo', '2024-01-01')`
  ).run(cuerpoId, miembro, iglesia);
  return miembro;
}

const lasDamas = [
  alguienEn(damas, 'Ana Luisa'), alguienEn(damas, 'Berta'), alguienEn(damas, 'Carmen'),
];
const losJovenes = [alguienEn(jovenes, 'Diego'), alguienEn(jovenes, 'Elías')];

const unaCuenta = (nombre, rut, cuerpos) => db
  .prepare("INSERT INTO usuarios (rut, nombre, rol, iglesia_id, activo) VALUES (?, ?, 'consulta', ?, 1)")
  .run(rut, nombre, iglesia).lastInsertRowid;

const anaId = unaCuenta('Ana María Soto Vera', '20000001-1');
const luzId = unaCuenta('Luz Bernardita Fuentes Ríos', '20000002-K');
const jefaId = unaCuenta('Rosa Pinto Vidal', '20000003-8');

const ANA = { id: anaId, rol: 'consulta', iglesias: [iglesia], cuerpos: [damas], nombre: 'Ana María Soto Vera' };
const LUZ = { id: luzId, rol: 'consulta', iglesias: [iglesia], cuerpos: [damas], nombre: 'Luz Bernardita Fuentes Ríos' };
const JEFA = { id: jefaId, rol: 'admin', iglesias: [iglesia], cuerpos: [], nombre: 'Rosa Pinto Vidal' };

const actividadId = db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-03-12', 'Culto', ?, ?)")
  .run(iglesia, JSON.stringify([damas, jovenes])).lastInsertRowid;
const actividad = db.prepare('SELECT * FROM asistencias WHERE id = ?').get(actividadId);

/** Llama a una ruta del módulo como lo haría el servidor. */
function porLaRuta(metodo, cual, usuario, { body, query } = {}) {
  let atender = null;
  const guardar = (ruta, permiso, mano) => { if (ruta === cual) atender = mano; };
  const router = { get: metodo === 'get' ? guardar : () => {}, post: metodo === 'post' ? guardar : () => {} };
  asistencias.extraRoutes(router, {
    db, requirePerm: () => (req, res, next) => next(), can: () => true,
  });
  assert.ok(atender, `la ruta ${cual} tiene que estar registrada`);
  let salida = null; let estado = 200;
  atender(
    { user: usuario, params: { id: String(actividadId) }, query: query || {}, body: body || {} },
    { json: (d) => { salida = d; }, status(c) { estado = c; return this; } }
  );
  return { estado, ...salida };
}

const marcaDe = (miembroId, cuerpoId, estado, motivo) =>
  ({ persona_tipo: 'Miembro', miembro_id: miembroId, no_miembro_id: null, cuerpo_id: cuerpoId, estado, motivo });

const pasar = (usuario, marcas) => porLaRuta('post', '/asistencias/:id(\\d+)/lista', usuario, { body: { marcas } });
const laLista = (usuario) => porLaRuta('get', '/asistencias/:id(\\d+)/lista', usuario);

/** El reloj de la base avanza un segundo, para distinguir una escritura de otra. */
const queAvanceElReloj = () => {
  const t0 = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const hasta = Date.now() + 2500;
  while (Date.now() < hasta) {
    if (db.prepare("SELECT datetime('now','localtime') AS t").get().t !== t0) return;
  }
  throw new Error('el reloj no avanzó');
};

const marcasDe = (cuerpoId) => db
  .prepare('SELECT * FROM asistencia_detalle WHERE asistencia_id = ? AND cuerpo_id = ? ORDER BY id')
  .all(actividadId, cuerpoId);

/*
 * Solo las de ESTA actividad. Las pruebas del motor comparten una misma base y
 * node las corre en paralelo, así que contar todas las líneas del registro
 * hacía que esta prueba fallara o pasara según qué otro archivo estuviera
 * escribiendo en ese momento.
 */
const lineasDelRegistro = () => db
  .prepare("SELECT * FROM registro_cambios WHERE accion = 'Corrección de lista' AND registro_id = ? ORDER BY id")
  .all(actividadId);

// ------------------------------------------------- antes de tomar la lista ---

test('una lista sin tomar no dice que la tomó nadie', () => {
  assert.equal(laLista(ANA).tomada, null);
});

// ------------------------------------------------------- se pasa la lista ---

test('al pasarla queda quién la pasó y cuándo', () => {
  pasar(ANA, lasDamas.map((m) => marcaDe(m, damas, 'Presente')));
  const t = laLista(ANA).tomada;
  // El nombre va como se nombra a la gente en pantalla: el primero y los dos
  // apellidos, no la fila entera de la cuenta
  assert.equal(t.por, 'Ana Soto Vera');
  assert.match(t.en, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('y pasarla por primera vez NO se lee como una corrección', () => {
  const t = laLista(ANA).tomada;
  assert.equal(t.corregida_en, null);
  assert.equal(t.corregida_por, null);
});

test('ni deja línea en el Registro de Cambios: no se corrigió nada', () => {
  assert.equal(lineasDelRegistro().length, 0);
});

test('cada marca lleva cuándo se puso y quién la puso', () => {
  assert.equal(marcasDe(damas).length, 3, 'no se guardó la lista');
  for (const m of marcasDe(damas)) {
    assert.ok(m.tomada_en, 'una marca sin fecha de toma');
    assert.equal(m.tomada_por, anaId);
    assert.equal(m.updated_at, m.tomada_en, 'recién puesta, las dos horas son la misma');
  }
});

// -------------------------------------------------- alguien la corrige ---

test('EL CASO: corregir una marca NO le borra el día en que se tomó', () => {
  const antes = marcasDe(damas).map((m) => m.tomada_en);
  queAvanceElReloj();
  pasar(LUZ, [marcaDe(lasDamas[0], damas, 'Ausente')]);

  const despues = marcasDe(damas);
  assert.deepEqual(despues.map((m) => m.tomada_en).sort(), antes.sort(),
    'la fecha de la toma se movió a la de la corrección');
  assert.deepEqual([...new Set(despues.map((m) => m.tomada_por))], [anaId],
    'quien tomó la lista dejó de ser Ana');
});

test('y la marca corregida sí registra que se volvió a escribir', () => {
  const corregida = marcasDe(damas).find((m) => m.miembro_id === lasDamas[0]);
  assert.equal(corregida.estado, 'Ausente');
  assert.ok(corregida.updated_at > corregida.tomada_en, 'no quedó constancia de la reescritura');
  assert.equal(corregida.created_by, luzId, 'no dice quién la corrigió');
  assert.equal(corregida.tomada_por, anaId, 'la corrección se robó la autoría de la toma');
});

test('la lista dice quién la tomó Y quién la corrigió', () => {
  const t = laLista(ANA).tomada;
  assert.equal(t.por, 'Ana Soto Vera');
  assert.equal(t.corregida_por, 'Luz Fuentes Ríos');
  assert.ok(t.corregida_en > t.en);
});

test('la corrección deja UNA línea en el Registro de Cambios, con nombre y con lo que cambió', () => {
  const lineas = lineasDelRegistro();
  assert.equal(lineas.length, 1, 'ni ninguna ni una por marca: una por corrección');
  const l = lineas[0];
  assert.equal(l.modulo, 'Asistencias');
  assert.equal(l.usuario, 'Luz Bernardita Fuentes Ríos');
  assert.equal(l.registro_id, actividadId);
  assert.match(l.detalle, /Corrigió 1 marca\(s\) de la lista de Damas/);
  assert.match(l.detalle, /Ana \w+: Presente → Ausente/);
  // En el registro la cuenta va con su nombre entero, como en todas las demás
  // líneas; el nombre corto es cosa de la pantalla
  assert.match(l.usuario, /^Luz Bernardita/);
});

test('guardar lo mismo otra vez no anota nada: no se corrigió nada', () => {
  const cuantas = lineasDelRegistro().length;
  pasar(LUZ, [marcaDe(lasDamas[0], damas, 'Ausente')]);
  assert.equal(lineasDelRegistro().length, cuantas);
});

test('el motivo de una justificación también se lee en la línea', () => {
  queAvanceElReloj();
  pasar(LUZ, [marcaDe(lasDamas[1], damas, 'Justificado', 'Enfermedad')]);
  const l = lineasDelRegistro().pop();
  assert.match(l.detalle, /Presente → Justificado \(Enfermedad\)/);
});

test('quitar una marca queda anotado como que quedó sin marcar', () => {
  queAvanceElReloj();
  pasar(LUZ, [marcaDe(lasDamas[2], damas, null)]);
  const l = lineasDelRegistro().pop();
  assert.match(l.detalle, /Presente → sin marcar/);
});

test('y volver a marcar a esa persona empieza su cuenta de nuevo', () => {
  // Se le borró la marca: la que se ponga ahora es una marca nueva, no la de
  // aquel día, y decir lo contrario sería inventar
  queAvanceElReloj();
  pasar(LUZ, [marcaDe(lasDamas[2], damas, 'Presente')]);
  const suya = marcasDe(damas).find((m) => m.miembro_id === lasDamas[2]);
  assert.equal(suya.tomada_por, luzId);
  assert.equal(suya.updated_at, suya.tomada_en);
});

test('una corrección de muchas marcas se resume en vez de escribir una parrafada', () => {
  const gente = [];
  for (let i = 0; i < 9; i++) gente.push(alguienEn(jovenes));
  pasar(JEFA, gente.map((m) => marcaDe(m, jovenes, 'Presente')));
  queAvanceElReloj();
  pasar(JEFA, gente.map((m) => marcaDe(m, jovenes, 'Ausente')));

  const l = lineasDelRegistro().pop();
  assert.match(l.detalle, /Corrigió 9 marca\(s\)/);
  assert.match(l.detalle, /y 4 más$/, 'se nombran cinco y se cuentan los demás');
  assert.ok(l.detalle.length < 400, `la línea mide ${l.detalle.length}: nadie va a leer eso`);
});

// --------------------------------------------------------- por cuerpo ---

test('quien lleva un cuerpo ve quién pasó SU lista, no la del otro', () => {
  // Jóvenes la pasó la jefa; Damas la pasó Ana
  const deDamas = laLista(ANA).tomada;
  assert.equal(deDamas.por, 'Ana Soto Vera');

  const deJovenes = { id: 9, rol: 'consulta', iglesias: [iglesia], cuerpos: [jovenes] };
  assert.equal(laLista(deJovenes).tomada.por, 'Rosa Pinto Vidal');
});

test('quien no tiene cuerpos asignados ve la lista entera de la actividad', () => {
  assert.ok(laLista(JEFA).tomada, 'quien administra se quedó sin saber quién pasó nada');
});

// ------------------------------------- lo que vigila el Registro de Cambios ---

test('la ACTIVIDAD sí se vigila: cambiarle la fecha o los cuerpos deja rastro', () => {
  const bitacora = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const lista = bitacora.slice(bitacora.indexOf('const MODULOS_VIGILADOS'), bitacora.indexOf('BORRADOS_QUE_NO_SE_ANOTAN'));
  assert.match(lista, /'asistencias'/);
});

test('las MARCAS no se vigilan una por una: serían treinta mil líneas', () => {
  const bitacora = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const lista = bitacora.slice(bitacora.indexOf('const MODULOS_VIGILADOS'), bitacora.indexOf('BORRADOS_QUE_NO_SE_ANOTAN'));
  assert.equal(/'asistencia_detalle'/.test(lista), false,
    'vigilar cada marca sepultaría el registro: la constancia va por corrección');
});

test('un campo de varios enlaces se anota con nombres, no con su JSON', () => {
  /*
   * Vigilar las actividades sacó a la luz algo del propio Registro de Cambios:
   * los campos de varios enlaces se guardan como JSON y así salían escritos.
   * «Cuerpos convocados: [2]» no lo puede leer nadie, y el registro existe
   * justamente para poder leerlo después.
   */
  const { registrarGuardado } = require('../../server/bitacora');
  registrarGuardado(asistencias, {
    isNew: true, antes: {}, despues: actividad, datos: actividad, user: JEFA,
  });
  const linea = db
    .prepare("SELECT * FROM registro_cambios WHERE modulo = 'Asistencias' AND accion = 'Creación' ORDER BY id DESC LIMIT 1")
    .get();
  assert.ok(linea, 'no quedó anotada la creación de la actividad');
  assert.match(linea.detalle, /Cuerpos convocados: Damas, Jóvenes/);
  assert.equal(/\[\d/.test(linea.detalle), false, `quedó el JSON crudo: ${linea.detalle}`);
});

test('y un cambio de cuerpos convocados se lee de un lado al otro', () => {
  const { registrarGuardado } = require('../../server/bitacora');
  registrarGuardado(asistencias, {
    isNew: false,
    antes: actividad,
    despues: { ...actividad, cuerpos: JSON.stringify([damas]) },
    datos: { cuerpos: JSON.stringify([damas]) },
    user: JEFA,
  });
  const linea = db
    .prepare("SELECT * FROM registro_cambios WHERE modulo = 'Asistencias' AND accion = 'Cambio' ORDER BY id DESC LIMIT 1")
    .get();
  assert.ok(linea, 'cambiarle los cuerpos a una actividad no dejó rastro');
  assert.match(linea.detalle, /Cuerpos convocados: Damas, Jóvenes → Damas/);
});

// ------------------------------------------------- lo que dice la pantalla ---

/** `quienPasoLaLista` de app.js, sacada del propio archivo y puesta a andar. */
const quienPasoLaLista = (() => {
  const desde = app.indexOf('function quienPasoLaLista(t) {');
  assert.ok(desde > 0, 'app.js tiene que traer quienPasoLaLista');
  const hasta = app.indexOf('\n}', desde) + 2;
  const fechaCorta = (iso) => {
    const s = String(iso || '').slice(0, 10);
    const [y, m, d] = s.split('-');
    return y && m && d ? `${d}-${m}-${y}` : s;
  };
  // eslint-disable-next-line no-new-func
  return new Function('fechaCorta', `${app.slice(desde, hasta)}; return quienPasoLaLista;`)(fechaCorta);
})();

test('la pantalla lo dice en una frase que se entiende', () => {
  assert.equal(
    quienPasoLaLista({ en: '2026-03-12 20:15:00', por: 'Ana Soto Vera' }),
    'Lista tomada por Ana Soto Vera el 12-03-2026 a las 20:15'
  );
});

test('y cuando la corrigieron, dice quién y cuándo', () => {
  assert.equal(
    quienPasoLaLista({
      en: '2026-03-12 20:15:00', por: 'Ana Soto Vera',
      corregida_en: '2026-06-14 09:02:00', corregida_por: 'Luz Fuentes Ríos',
    }),
    'Lista tomada por Ana Soto Vera el 12-03-2026 a las 20:15 · corregida por Luz Fuentes Ríos el 14-06-2026 a las 09:02'
  );
});

test('sin lista tomada no dice nada', () => {
  assert.equal(quienPasoLaLista(null), '');
  assert.equal(quienPasoLaLista({}), '');
});

test('y si la cuenta que la tomó ya no está, igual dice cuándo fue', () => {
  assert.equal(
    quienPasoLaLista({ en: '2026-03-12 20:15:00', por: null }),
    'Lista tomada el 12-03-2026 a las 20:15'
  );
});
