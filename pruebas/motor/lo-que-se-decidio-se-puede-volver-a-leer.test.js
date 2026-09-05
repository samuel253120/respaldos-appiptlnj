/**
 * LA DECISIÓN MÁS IMPORTANTE SOBRE ALGUIEN, Y NO HABÍA POR DÓNDE LEERLA.
 *
 * El módulo de Evaluaciones guarda si un integrante sigue o no sigue en su
 * cuerpo. Su cabecera dice para qué existe: que el recorrido de cada integrante
 * «se pueda leer completo años después». Se buscó por dónde, en la v1.399.0:
 *
 *   el menú principal .....................  no está (menu: false)
 *   la ficha de la persona · 9 pestañas ...  no hay pestaña
 *   la pestaña «Cuerpos» de la persona ....  dice el estado, no la evaluación
 *   la ficha del cuerpo · 7 pestañas ......  no hay pestaña
 *   la lista del cuerpo ...................  solo el botón de crear una nueva
 *   escribiendo la dirección a mano .......  sí
 *
 * Y lo notable: la ruta que dibuja esa lista YA CONTABA las evaluaciones de
 * cada uno —una consulta por integrante— y la pantalla nunca las dibujó. Un
 * dato que viajaba para no pintarse en ninguna parte, como el RUT de la 1.395.0
 * pero al revés: éste sí servía.
 *
 * Ahora la lista del cuerpo dice, en la línea de cada persona, cuántas
 * evaluaciones tiene y en qué quedó la última, y enlaza a las suyas. Va ahí
 * porque es donde uno está cuando se hace la pregunta, y donde ya estaba el
 * botón «Evaluar».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central LE ${marca}`, `LE-${marca}`).lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?,'Cuerpo',?,'Activo')")
  .run(`Damas LE ${marca}`, iglesia).lastInsertRowid;

function enPrueba() {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Sirve LE ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, fecha_fin_prueba, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'En prueba', '2026-01-10', '2026-04-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Sirve LE ${marca}`, iglesia).lastInsertRowid;
}

const NO_APROBADO = 'No aprobado (se extiende la prueba)';

test('la lista del cuerpo dice cuántas evaluaciones tiene cada uno y en qué quedó la última', async () => {
  const api = await elSistemaAndando();
  const conDos = enPrueba();
  const sinNinguna = enPrueba();

  await api('POST', '/evaluaciones_integrantes',
    { integrante_id: conDos, fecha: '2026-04-01', resultado: NO_APROBADO, meses_extension: 2, evaluado_por: 'La directiva' });
  await api('POST', '/evaluaciones_integrantes',
    { integrante_id: conDos, fecha: '2026-07-10', resultado: NO_APROBADO, meses_extension: 3, evaluado_por: 'La directiva' });

  const r = await api('GET', `/cuerpos/${cuerpo}/integrantes`);
  assert.equal(r.estado, 200, r.texto);
  const suyo = r.json.integrantes.find((g) => g.id === conDos);
  const elOtro = r.json.integrantes.find((g) => g.id === sinNinguna);

  assert.equal(suyo.evaluaciones, 2);
  assert.deepEqual(suyo.ultima_evaluacion, { fecha: '2026-07-10', resultado: NO_APROBADO },
    'la última por fecha, que es la que contesta en qué quedó');
  assert.equal(elOtro.evaluaciones, 0);
  assert.equal(elOtro.ultima_evaluacion, null, 'y a quien no tiene ninguna no se le inventa una');
});

test('a igual fecha, la última es la que se anotó después', async () => {
  const api = await elSistemaAndando();
  const ficha = enPrueba();
  await api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, fecha: '2026-06-01', resultado: NO_APROBADO, meses_extension: 2, evaluado_por: 'A' });
  await api('POST', '/evaluaciones_integrantes',
    { integrante_id: ficha, fecha: '2026-06-01', resultado: 'Aprobado', evaluado_por: 'B' });

  const r = await api('GET', `/cuerpos/${cuerpo}/integrantes`);
  const suyo = r.json.integrantes.find((g) => g.id === ficha);
  assert.equal(suyo.evaluaciones, 2);
  assert.equal(suyo.ultima_evaluacion.resultado, 'Aprobado',
    'el mismo criterio con que la evaluación mueve la ficha');
});

test('y se pide en UNA consulta, no en una por integrante', () => {
  /*
   * El cuerpo más grande de la base de trabajo tiene 63 integrantes, así que
   * eran 63 consultas cada vez que se abre el panel. Se mira la forma porque
   * es lo que decide: dentro del `map` que arma cada integrante no puede haber
   * una consulta.
   */
  const cuerpos = fs.readFileSync(path.join(__dirname, '../../server/modules/cuerpos.js'), 'utf8');
  const ruta = cuerpos.slice(cuerpos.indexOf("router.get('/cuerpos/:id(\\\\d+)/integrantes'"));
  const laRuta = ruta.slice(0, ruta.indexOf('\n    });') + 8);
  assert.ok(laRuta.length > 500, `se encontró la ruta: mide ${laRuta.length}`);
  const elMap = laRuta.slice(laRuta.indexOf('.map((f) => ({'), laRuta.indexOf('      }));'));
  assert.ok(elMap.length > 200, `se encontró el map: mide ${elMap.length}`);
  assert.ok(!/db\s*\n?\s*\.prepare|db\.prepare/.test(elMap),
    'una consulta dentro del map es una consulta por integrante');
  assert.match(laRuta, /GROUP BY e\.integrante_id/, 'se piden todas de una vez');
});

test('la pantalla lo dibuja, y enlaza a las evaluaciones de esa persona', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const panel = app.slice(app.indexOf('const loQueSeDecidio = (g) =>'));
  const suyo = panel.slice(0, panel.indexOf('\n  };') + 5);
  assert.ok(suyo.length > 100, `se encontró la función: mide ${suyo.length}`);
  assert.match(suyo, /f_integrante_id=\$\{g\.id\}/, 'el enlace lleva a las suyas y no a todas');
  assert.match(suyo, /evaluaciones_integrantes/);
  assert.match(suyo, /ultima_evaluacion/, 'y dice en qué quedó la última');
  assert.match(suyo, /!g\.evaluaciones/, 'a quien no tiene ninguna no se le pone nada');
  assert.match(suyo, /MOD\['evaluaciones_integrantes'\]/,
    'y a quien no alcanza el módulo tampoco se le ofrece: sería un enlace a un 403');
  // Y la fila lo usa de verdad, que es lo que se olvidaba antes
  assert.match(app.slice(app.indexOf('ul class="integrantes"')), /\$\{loQueSeDecidio\(g\)\}/,
    'escrito y no llamado sería lo mismo que no escribirlo');
});

test('el estilo del enlace existe: sin él sale como texto suelto', () => {
  /*
   * Se mira la regla BASE y no cualquier aparición del nombre. La primera
   * versión de esta comprobación buscaba la clase en toda la hoja, y con eso
   * bastaba la línea del `:hover` para darla por buena: se rompió la regla que
   * pinta el enlace y la prueba siguió verde. Un enlace sin su regla base sale
   * como texto azul subrayado dentro de una línea gris, y eso no da error
   * ninguno —es la lección de la 1.277.0—.
   */
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const reglas = css.match(/ul\.integrantes \.dt \.evaluaciones-de[^{]*\{/g) || [];
  const base = reglas.filter((r) => !r.includes(':hover'));
  assert.equal(base.length, 1, `reglas base encontradas: ${JSON.stringify(reglas)}`);
});
