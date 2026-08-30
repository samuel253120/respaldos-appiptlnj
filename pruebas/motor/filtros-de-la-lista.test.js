/**
 * PREGUNTARLE AL LISTADO POR EDAD Y POR CUERPO.
 *
 * Dos preguntas de todas las semanas que no se podían hacer, medidas sobre las
 * 603 fichas cargadas:
 *
 *   · «los menores de 18 para el cuerpo de Infantiles», «los mayores de 60
 *     para la visita». La edad no es una columna —se calcula al leer la ficha,
 *     así nunca queda vieja— y por eso no se podía filtrar ni ordenar por
 *     ella: pedir el listado por edad devolvía el orden de siempre y nadie
 *     avisaba.
 *
 *   · «las damas de este cuerpo, con su teléfono». La ficha de cada persona
 *     muestra en qué cuerpos participa, pero el listado no se podía acotar a
 *     uno: había que abrir el cuerpo, mirar sus integrantes y volver a
 *     Miembros a buscar a cada uno.
 *
 * Las dos se armaban bajando la planilla entera y filtrando en Excel.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');
const noMiembros = require('../../server/modules/no_miembros');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los filtros', 'IG-FIL', 'Activa')")
  .run().lastInsertRowid;
const damas = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de los filtros', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;
const taller = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Taller de los filtros', 'Grupo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

/** Una fecha de nacimiento que hoy da exactamente esta edad. */
const naceHace = (anios, dias = 0) => db
  .prepare("SELECT date('now','localtime', ?, ?) d").get(`-${anios} years`, `-${dias} days`).d;

let n = 0;
/*
 * Las fichas que crea ESTE archivo. Los archivos del motor comparten una sola
 * base y corren en paralelo, así que cualquier cuenta sobre el total de la
 * tabla puede cambiar en el medio por fichas de otra prueba: lo que se compare
 * tiene que ser lo propio.
 */
const lasDeEsteArchivo = [];
function alguien(anios, cuerpos = [], opciones = {}) {
  n++;
  const id = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, fecha_nacimiento) VALUES (?, ?, ?, 'Activo', ?)")
    .run(`Filtro${n}`, `Delalista${n}`, iglesia, anios === null ? opciones.fecha ?? null : naceHace(anios))
    .lastInsertRowid;
  for (const c of cuerpos) {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso, persona_tipo)
       VALUES (?, ?, ?, ?, '2024-01-01', 'Miembro')`
    ).run(c, id, iglesia, opciones.como || 'Activo');
  }
  lasDeEsteArchivo.push(id);
  return id;
}

/**
 * El listado como lo arma el motor. Se llama a la consulta de verdad y no a
 * una copia: una copia probaría otra cosa que la que corre en el sistema.
 */
const { consultaDeUnListado } = require('../../server/crud');
function listar(consulta, def = miembros) {
  const req = { query: consulta, user: { id: 1, rol: 'admin' } };
  const { params, whereSql, ordenSql } = consultaDeUnListado(def, req);
  return db.prepare(`SELECT id, fecha_nacimiento FROM "${def.name}" ${whereSql} ${ordenSql}`).all(...params);
}
const ids = (consulta, def) => listar(consulta, def).map((r) => r.id);

// El escenario: gente de edades conocidas, en cuerpos conocidos
const guagua = alguien(0, [damas]);
const nina = alguien(12, [damas]);
const justo18 = alguien(18, [damas]);
const casi18 = alguien(17, [damas, taller]);
const treinta = alguien(30, [taller]);
const justo31 = alguien(31, []);
const abuela = alguien(72, [damas]);
const sinFecha = alguien(null, [damas]);
const retirada = alguien(40, [damas], { como: 'Retirado' });
const enPrueba = alguien(25, [taller], { como: 'En prueba' });

// -------------------------------- por edad ---------------------------------

test('«los menores de 18» trae a los menores de 18, y a nadie más', () => {
  const menores = ids({ edad_hasta: '17' });
  assert.ok(menores.includes(guagua) && menores.includes(nina) && menores.includes(casi18));
  assert.ok(!menores.includes(justo18), 'quien cumplió 18 hoy ya no es menor de edad');
  assert.ok(!menores.includes(abuela));
});

test('«de 18 para arriba» incluye a quien los cumple hoy', () => {
  const mayores = ids({ edad_desde: '18' });
  assert.ok(mayores.includes(justo18), 'cumplir años hoy cuenta: ya los tiene');
  assert.ok(!mayores.includes(casi18), 'a quien le falta un día, todavía no');
});

test('«hasta 30» deja fuera a quien acaba de cumplir 31', () => {
  const hasta30 = ids({ edad_hasta: '30' });
  assert.ok(hasta30.includes(treinta));
  assert.ok(!hasta30.includes(justo31), 'quien cumplió 31 hoy tiene 31, no 30');
});

test('los dos bordes juntos acotan por los dos lados', () => {
  const rango = ids({ edad_desde: '18', edad_hasta: '30' });
  assert.ok(rango.includes(justo18) && rango.includes(treinta) && rango.includes(enPrueba));
  assert.ok(!rango.includes(casi18) && !rango.includes(justo31) && !rango.includes(abuela));
});

test('a quien no tiene una fecha usable no se le inventa una edad', () => {
  /*
   * Sin fecha, con la fecha en blanco, o con cualquier cosa escrita donde iba
   * la fecha: en los tres casos la persona no tiene edad y no puede caer
   * dentro de un rango. Lo resuelve `date()`, que devuelve nulo con lo que no
   * sea una fecha; se prueba acá porque de eso depende que el filtro no mienta.
   */
  const enBlanco = alguien(null, [], { fecha: '' });
  const cualquierCosa = alguien(null, [], { fecha: 'no se sabe' });

  for (const quien of [sinFecha, enBlanco, cualquierCosa]) {
    assert.ok(!ids({ edad_desde: '0' }).includes(quien), 'se coló en «de 0 para arriba»');
    assert.ok(!ids({ edad_hasta: '130' }).includes(quien), 'se coló en «hasta 130»');
    assert.ok(ids({}).includes(quien), 'pero sin preguntar por edad, ahí está');
  }
});

test('una edad que no es un número no filtra nada', () => {
  /*
   * Se compara sobre las fichas de este archivo y no sobre el total de la
   * tabla. La primera versión contaba el total dos veces —una sin filtro y una
   * con basura— y las comparaba: con los archivos corriendo en paralelo, una
   * ficha creada por otra prueba entre las dos cuentas hacía fallar esta, que
   * no tiene nada que ver con eso. Sobre un conjunto conocido dice lo mismo y
   * lo dice mejor: no cambia el largo Y son exactamente las mismas.
   */
  const mias = new Set(lasDeEsteArchivo);
  const lasPropias = (consulta) => ids(consulta).filter((id) => mias.has(id)).sort((a, b) => a - b);
  const sinFiltrar = lasPropias({});
  assert.ok(sinFiltrar.length >= 10, `el escenario de este archivo tiene ${sinFiltrar.length} fichas`);
  for (const basura of ['', 'dieciocho', '-4', '999', 'null', '18; DROP TABLE miembros']) {
    assert.deepEqual(lasPropias({ edad_desde: basura }), sinFiltrar, `«${basura}» no tendría que acotar`);
  }
  assert.ok(db.prepare('SELECT COUNT(*) c FROM miembros').get().c > 0, 'la tabla sigue ahí');
});

// -------------------------------- por cuerpo -------------------------------

test('«los de este cuerpo» trae a los suyos y a nadie de otro', () => {
  const suyas = ids({ cuerpo_id: String(damas) });
  assert.ok(suyas.includes(nina) && suyas.includes(abuela) && suyas.includes(casi18));
  assert.ok(!suyas.includes(treinta), 'ese es del taller');
});

test('cuenta quien pertenece hoy: en prueba sí, retirada no', () => {
  assert.ok(ids({ cuerpo_id: String(taller) }).includes(enPrueba), 'en prueba también pertenece');
  assert.ok(!ids({ cuerpo_id: String(damas) }).includes(retirada), 'a quien se retiró no se le sigue contando');
});

test('quien está en dos cuerpos sale en los dos', () => {
  assert.ok(ids({ cuerpo_id: String(damas) }).includes(casi18));
  assert.ok(ids({ cuerpo_id: String(taller) }).includes(casi18));
});

test('un cuerpo que no existe no trae a nadie, y en blanco no filtra', () => {
  assert.equal(ids({ cuerpo_id: '999999' }).length, 0);
  assert.equal(ids({ cuerpo_id: 'ni un número' }).length, 0);
  assert.equal(ids({ cuerpo_id: '' }).length, ids({}).length, 'en blanco es no haber preguntado');
});

test('los dos filtros juntos se suman, no se pisan', () => {
  const damasMayores = ids({ cuerpo_id: String(damas), edad_desde: '18' });
  assert.ok(damasMayores.includes(justo18) && damasMayores.includes(abuela));
  assert.ok(!damasMayores.includes(nina), 'es de Damas pero tiene 12');
  assert.ok(!damasMayores.includes(treinta), 'tiene la edad pero es del taller');
});

test('la gente que no está en la membresía se acota por su propio enlace', () => {
  /*
   * A un GRUPO lo puede integrar alguien que no está inscrito en la membresía,
   * y su ficha de integrante apunta al otro registro. Sin declarar el filtro
   * también ahí, los dos listados de gente contestarían distinto.
   */
  assert.ok(Array.isArray(noMiembros.filtrosPropios), 'No miembros no ofrece el filtro por cuerpo');
  assert.equal(noMiembros.filtrosPropios[0].nombre, 'cuerpo_id');
  assert.match(noMiembros.filtrosPropios[0].donde(1).sql, /no_miembro_id/,
    'tiene que mirar el enlace del otro registro, no el de miembros');
});

// ------------------------------- ordenar por edad --------------------------

test('ordenar por edad ordena de verdad', () => {
  const conFecha = (filas) => filas.filter((r) => r.fecha_nacimiento).map((r) => r.fecha_nacimiento);

  const jovenes = conFecha(listar({ sort: 'edad', dir: 'asc' }));
  assert.deepEqual(jovenes, [...jovenes].sort().reverse(),
    'de menor a mayor edad es de fecha de nacimiento más nueva a más vieja');

  const viejos = conFecha(listar({ sort: 'edad', dir: 'desc' }));
  assert.deepEqual(viejos, [...viejos].sort(), 'y al revés');
});

test('quien no tiene fecha va al final, se pida como se pida', () => {
  /*
   * SQLite pone los vacíos primero al ordenar hacia arriba, y ordenar por edad
   * hacia abajo es ordenar por fecha hacia arriba: sin esto, «los más viejos»
   * abría con las fichas en blanco, que no tienen edad ninguna.
   *
   * Se mira que TODAS las que no tienen fecha queden al final, no solo una: si
   * quedara una sola bien puesta, la prueba pasaría con el resto desordenado.
   */
  for (const dir of ['asc', 'desc']) {
    const filas = listar({ sort: 'edad', dir });
    const enBlanco = (r) => !r.fecha_nacimiento;
    const cuantas = filas.filter(enBlanco).length;
    assert.ok(cuantas > 0, 'el escenario tiene que traer alguna sin fecha, o esto no prueba nada');
    assert.ok(filas.slice(-cuantas).every(enBlanco), `con dir=${dir} alguna quedó adelante`);
    assert.ok(filas.slice(0, -cuantas).every((r) => !enBlanco(r)), `con dir=${dir} quedó una fecha después de las vacías`);
  }
});

test('ordenar por un calculado que no sabe por dónde no rompe nada', () => {
  const porTrato = ids({ sort: 'tratamiento' });
  assert.equal(porTrato.length, ids({}).length, 'trae lo mismo, en el orden de siempre');
});

// ------------------------------ dónde está puesto --------------------------

test('el módulo declara por dónde se ordena la edad', () => {
  const edad = miembros.computed.find((c) => c.name === 'edad');
  assert.deepEqual(edad.ordenarPor, { campo: 'fecha_nacimiento', invertido: true });
});

test('y la pantalla sabe que esa cabecera sí se puede tocar', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /f\.computed && !f\.ordenable/,
    'las columnas calculadas estaban todas marcadas como no ordenables: la cabecera «Edad» '
    + 'seguía siendo un rótulo muerto aunque el servidor ya supiera ordenarla');
  assert.match(app, /params\.set\('edad_desde', st\.edadDesde\)/);
  assert.match(app, /for \(const \[k, v\] of Object\.entries\(st\.propios \|\| \{\}\)\) if \(v\) params\.set\(k, v\)/);
});

test('la barra de filtros ofrece las cajas nuevas', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /id="fEdadDesde"/);
  assert.match(app, /id="fp_\$\{esc\(f\.nombre\)\}"/);
  assert.match(app, /\+ \(st\.edadDesde \? 1 : 0\)/,
    'el botón de filtros tiene que contarlos: uno puesto y no visible parece una lista a la que le faltan fichas');
});

test('la caja de la edad se ve como las demás de la barra', () => {
  const css = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/styles.css'), 'utf8'
  );
  assert.match(css, /\.toolbar input\[type="number"\]/,
    'sin esto salía sin formato: 19 px de alto contra los 34 de sus vecinas, imposible de tocar');
});
