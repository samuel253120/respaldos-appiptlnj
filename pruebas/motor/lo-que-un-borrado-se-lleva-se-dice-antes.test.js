/**
 * Un borrado que se lleva otras fichas por delante lo dice ANTES de hacerlo.
 *
 * La regla estaba escrita dos veces en este mismo sistema —«quien va a borrar
 * una iglesia necesita ver el tamaño de lo que estaba por hacer»
 * (server/iglesia-vacia.js) y «quien borra tiene que saber qué se lleva ANTES,
 * y quien lo revise después tiene que poder saberlo también» (la v1.376.0, al
 * hacérselo decir a una actividad de asistencia)— y se aplicaba módulo por
 * módulo, a los que alguien se acordó de ir a escribírsela.
 *
 * MEDIDO en la v1.431.0, borrando sin confirmar por las tres puertas que se
 * llevan papeles escaneados:
 *
 *   DELETE /miembros     (2 papeles, 3 líneas de bitácora)   ....  200 · sin decir nada
 *   DELETE /solicitudes  (2 papeles, 3 líneas de trámite)    ....  200 · sin decir nada
 *   DELETE /pastores     (3 papeles, 4 líneas de historial)  ....  200 · sin decir nada
 *
 * El hallazgo SA-03 nombraba solo al pastor. Escribir la regla general en vez
 * del caso destapó los otros dos, y son peores: lo que desaparecía era el
 * carnet escaneado de una persona y su certificado de bautismo.
 *
 * ── LO QUE EL INFORME DIJO DE MÁS ──
 *
 * El informe afirmaba además que la constancia del Registro de Cambios no
 * nombraba los papeles. Es falso, y se comprobó acá: el motor escribe «Se
 * llevó consigo 11 registro(s): 8 en Historial de Pastores, 3 en Documentos de
 * Pastores» desde la v1.59.0. Al medir se leyó la columna equivocada
 * —`descripcion`, que va vacía— en vez de `detalle`. Lo que faltaba era la
 * mitad de ANTES, no la de después, y por eso la prueba de más abajo comprueba
 * que las dos dicen lo mismo: salen del mismo plan.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../../server/db');
const { allModules, getModule } = require('../../server/registry');
const dependencias = require('../../server/dependencias');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let cuantos = 0;
const unRut = () => {
  const n = `${14000000 + (marca * 17 + cuantos++ * 7919) % 5000000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Lo que se lleva ${marca}`, `LQL-${marca}`).lastInsertRowid;

const papel = (nombre) => {
  const archivo = `lql-${marca}-${nombre}.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, archivo), 'papel');
  return archivo;
};

// ------------------------------------------- la regla ----------------------

test('todo módulo que se lleve fichas por delante tiene con qué avisarlo', () => {
  /*
   * No se comprueba módulo por módulo a mano: se le pregunta al motor cuáles
   * arrastran algo, que es la misma lista de la que sale el borrado. El día que
   * un módulo nuevo arrastre algo, entra solo en esta comprobación.
   */
  const arrastran = allModules().filter((def) =>
    dependencias.referenciasHacia(def.name).some((c) => c.regla && c.regla.que === dependencias.ARRASTRA));

  assert.ok(arrastran.length >= 9, `solo se vieron ${arrastran.length} módulos que arrastren algo`);
  assert.ok(arrastran.some((d) => d.name === 'pastores'), 'el del hallazgo tiene que estar en la lista');
  for (const n of ['miembros', 'solicitudes']) {
    assert.ok(arrastran.some((d) => d.name === n), `${n} arrastra papeles y tiene que estar`);
  }

  // Y el aviso lo escribe UN solo sitio, para los nueve y para el décimo
  assert.equal(typeof dependencias.preguntaDeLoQueSeLleva, 'function');
  assert.equal(typeof dependencias.loQueSeLleva, 'function');
});

test('una ficha de la que no cuelga nada no tiene nada que avisar', () => {
  // Importa tanto como lo otro: un aviso que sale siempre se aprende a saltar.
  const suelta = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`Sin nada ${marca}`, `SN-${marca}`).lastInsertRowid;
  const fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(suelta);
  assert.equal(dependencias.loQueSeLleva(db, getModule('iglesias'), fila), null);
  assert.equal(dependencias.preguntaDeLoQueSeLleva(db, getModule('iglesias'), fila), null);
});

// ------------------------------------------- las tres puertas --------------

test('borrar a un pastor avisa de su carnet, su ordenación y su historial', async () => {
  const api = await elSistemaAndando();
  const p = await api('POST', '/pastores', {
    nombres: 'Elías', apellidos: `Vera LQL ${marca}`, rut: unRut(),
    iglesia_id: iglesia, estado: 'Activo', cargo: 'Pastor Presbítero',
  });
  assert.equal(p.estado, 201, p.texto.slice(0, 200));
  for (const [tipo, nombre] of [['Carnet de Identidad', 'Carnet'],
    ['Certificado de Nombramiento (Ordenacion)', 'Ordenacion'],
    ['Certificado de Antecedentes', 'Antecedentes']]) {
    const r = await api('POST', '/documentos_pastores', {
      pastor_id: p.json.id, tipo, nombre: `${nombre} ${marca}`, archivo: papel(nombre),
    });
    assert.equal(r.estado, 201, r.texto.slice(0, 200));
  }
  // Que no sea él quien figura a cargo: eso es la OTRA pregunta, y va aparte
  db.prepare('UPDATE iglesias SET pastor_id = NULL WHERE pastor_id = ?').run(p.json.id);

  const sinConfirmar = await api('DELETE', `/pastores/${p.json.id}`);
  assert.equal(sinConfirmar.estado, 400, 'se llevaba tres papeles y un historial sin decir nada');
  assert.equal(sinConfirmar.json.confirmar, 'se_lleva_lo_que_cuelga', 'es una pregunta, no una negativa');
  assert.match(sinConfirmar.json.error, /Documentos de Pastores/);
  assert.match(sinConfirmar.json.error, /Historial de Pastores/);
  assert.match(sinConfirmar.json.error, /no se recupera/);

  // Y sigue siendo posible: una ficha creada por error hay que poder deshacerla
  const confirmado = await api('DELETE', `/pastores/${p.json.id}?igual_asi=true`);
  assert.equal(confirmado.estado, 200, confirmado.texto.slice(0, 200));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM documentos_pastores WHERE pastor_id = ?').get(p.json.id).n, 0
  );
});

test('y borrar a un miembro avisa de su carpeta y de su bitácora', async () => {
  const api = await elSistemaAndando();
  const m = await api('POST', '/miembros', {
    nombres: 'Rosa', apellidos: `Díaz LQL ${marca}`, rut: unRut(), iglesia_id: iglesia, estado: 'Activo',
  });
  assert.equal(m.estado, 201, m.texto.slice(0, 200));
  const d = await api('POST', '/documentos_miembros', {
    miembro_id: m.json.id, tipo: 'Otro', nombre: `Carnet ${marca}`, archivo: papel('m-carnet'),
  });
  assert.equal(d.estado, 201, d.texto.slice(0, 200));

  const r = await api('DELETE', `/miembros/${m.json.id}`);
  assert.equal(r.estado, 400, 'se llevaba su carnet escaneado sin decir nada');
  assert.equal(r.json.confirmar, 'se_lleva_lo_que_cuelga');
  assert.match(r.json.error, /Documentos de Miembros/);
});

test('y borrar una solicitud avisa de sus papeles y de su tramitación', async () => {
  const api = await elSistemaAndando();
  const m = await api('POST', '/miembros', {
    nombres: 'Ana', apellidos: `Soto LQL ${marca}`, rut: unRut(), iglesia_id: iglesia, estado: 'Activo',
  });
  const s = await api('POST', '/solicitudes', {
    fecha: '2026-09-05', iglesia_id: iglesia, solicitante_tipo: 'Miembro', miembro_id: m.json.id,
    tipo: 'Otro', asunto: `Papeles ${marca}`, estado: 'Pendiente',
  });
  assert.equal(s.estado, 201, s.texto.slice(0, 200));
  const d = await api('POST', '/documentos_solicitudes', {
    solicitud_id: s.json.id, tipo: 'Otro', nombre: `Carta ${marca}`, archivo: papel('s-carta'),
  });
  assert.equal(d.estado, 201, d.texto.slice(0, 200));

  const r = await api('DELETE', `/solicitudes/${s.json.id}`);
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /Documentos de Solicitudes/);
  assert.match(r.json.error, /Historial de Solicitudes/);
});

// ------------------------------------------- una sola pregunta -------------

test('al pastor que está a cargo de una iglesia se le dice todo en un solo aviso', async () => {
  /*
   * `igual_asi` es UNO para todo el borrado: si fueran dos avisos seguidos,
   * quien contestara el primero nunca vería el segundo. Y justamente el pastor
   * con iglesia a cargo es el que más papeles tiene.
   */
  const api = await elSistemaAndando();
  const propia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
    .run(`A cargo ${marca}`, `AC-${marca}`).lastInsertRowid;
  const p = await api('POST', '/pastores', {
    nombres: 'Elías', apellidos: `Rojas LQL ${marca}`, rut: unRut(),
    iglesia_id: propia, estado: 'Activo', cargo: 'Pastor Presbítero',
  });
  assert.equal(p.estado, 201, p.texto.slice(0, 200));
  const doc = await api('POST', '/documentos_pastores', {
    pastor_id: p.json.id, tipo: 'Carnet de Identidad', nombre: `Carnet ${marca}`, archivo: papel('p-carnet'),
  });
  assert.equal(doc.estado, 201, doc.texto.slice(0, 200));
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.json.id, propia);

  const r = await api('DELETE', `/pastores/${p.json.id}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'borrarlo_deja_su_iglesia_sin_pastor', 'manda el aviso del módulo');
  assert.match(r.json.error, /sin pastor principal/, 'la consecuencia para la congregación');
  assert.match(r.json.error, /Documentos de Pastores/, 'y lo que se lleva, en el MISMO aviso');
});

// ------------------------------------------- antes y después --------------

test('lo que el aviso promete es lo mismo que después queda anotado', async () => {
  /*
   * Las dos mitades salen del mismo plan, y ésta es la prueba de que no se
   * separaron: la pregunta de antes y la constancia de después tienen que
   * nombrar los mismos módulos con las mismas cifras.
   */
  const api = await elSistemaAndando();
  const p = await api('POST', '/pastores', {
    nombres: 'Job', apellidos: `Pérez LQL ${marca}`, rut: unRut(),
    iglesia_id: iglesia, estado: 'Activo', cargo: 'Pastor Diácono',
  });
  for (const n of ['uno', 'dos']) {
    await api('POST', '/documentos_pastores', {
      pastor_id: p.json.id, tipo: 'Otro Documento', nombre: `Papel ${n} ${marca}`, archivo: papel(`ad-${n}`),
    });
  }
  db.prepare('UPDATE iglesias SET pastor_id = NULL WHERE pastor_id = ?').run(p.json.id);

  const aviso = (await api('DELETE', `/pastores/${p.json.id}`)).json.error;
  assert.equal((await api('DELETE', `/pastores/${p.json.id}?igual_asi=true`)).estado, 200);

  const anotado = db
    .prepare("SELECT detalle FROM registro_cambios WHERE registro_id = ? AND accion = 'Eliminación' ORDER BY id DESC LIMIT 1")
    .get(p.json.id);
  assert.ok(anotado, 'el borrado quedó en el Registro de Cambios');

  // El «y» que une los dos últimos se cuela en el recorte del aviso y no está
  // en la constancia, que va con comas: se quita para comparar lo que importa.
  const cifras = (t) => (t.match(/\d+ en [A-Za-zÁÉÍÓÚÑáéíóúñ /]+/g) || [])
    .map((x) => x.trim().replace(/\s+y$/, ''))
    .sort();
  assert.deepEqual(cifras(aviso), cifras(anotado.detalle),
    `el aviso decía «${cifras(aviso).join(' · ')}» y la constancia «${cifras(anotado.detalle).join(' · ')}»`);
  assert.ok(cifras(aviso).length, 'y de verdad nombraban algo');
});
