/**
 * Dos pastores casados con la misma persona.
 *
 * El módulo cuidaba lo obvio del vínculo de cónyuge: nadie es su propio
 * cónyuge, es del sexo opuesto, y si el cargo es pastoral tiene que tener trato
 * de Pastor o Pastora por su propio registro. Faltaba lo más simple. Medido
 * antes de la 1.242.0:
 *
 *   casar a Marcos con Sara ................ 200, y queda recíproco
 *   casar a LUCAS con la MISMA Sara ........ 200, aceptado
 *   Marcos.conyuge_id / Lucas.conyuge_id ... 626 / 626, los dos
 *
 * Y el desplegable de «A cargo de la iglesia» pasaba a ofrecer DOS opciones
 * que nombran a la misma esposa —«Pastor Lucas Dos y Pastora Sara Vega» y
 * «Pastor Marcos Uno y Pastora Sara Vega»—, así que quien elige una de las dos
 * para una iglesia deja anotado, y después impreso, un matrimonio que no es.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const conyuges = require('../../server/el-conyuge-del-pastor');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const PASTORES = getModule('pastores');
let n = 0;
const marca = () => `${++n}-${process.pid}`;

const miembro = (nombres, genero) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, genero, estado) VALUES (?, ?, ?, 'Activo')")
  .run(nombres, `Conyuge ${marca()}`, genero).lastInsertRowid;

const pastor = (nombres, { miembroId = null, conyugeId = null } = {}) => db
  .prepare('INSERT INTO pastores (nombres, apellidos, cargo, estado, miembro_id, conyuge_id) VALUES (?, ?, ?, ?, ?, ?)')
  .run(nombres, `Conyuge ${marca()}`, 'Pastor Presbítero', 'Activo', miembroId, conyugeId).lastInsertRowid;

const fichaDe = (id) => db.prepare('SELECT * FROM pastores WHERE id = ?').get(id);
const conyugeDe = (id) => fichaDe(id).conyuge_id;

const alCasar = (pastorId, conyugeId, existing, confirmado = false) =>
  conyuges.avisoSiYaEstaCasada(db, pastorId, { data: { conyuge_id: conyugeId }, existing, confirmado });

// ------------------------------------------------------- con quién ya ----

test('con quién figura casada: los pastores que la nombran', () => {
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  assert.deepEqual(conyuges.conQuienFiguraCasada(db, ella).map((o) => o.id), [uno]);
});

test('sin contar a quien la está eligiendo ahora', () => {
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  assert.deepEqual(conyuges.conQuienFiguraCasada(db, ella, uno), [], 'ya era él: no hay con quién chocar');
});

test('y también el marido que solo existe como miembro', () => {
  /*
   * El vínculo está escrito dos veces —en Pastores / Guías y en las fichas de
   * miembro—, y el marido puede no tener ficha de pastor. Mirando un solo lado
   * ese caso se escapa.
   */
  const ella = miembro('Sara', 'Femenino');
  const el = miembro('Andrés', 'Masculino');
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(el, ella);
  const otros = conyuges.conQuienFiguraCasada(db, ella);
  assert.equal(otros.length, 1);
  assert.equal(otros[0].id, el);
});

test('a alguien sin cónyuge no le figura nadie', () => {
  assert.deepEqual(conyuges.conQuienFiguraCasada(db, miembro('Sara', 'Femenino')), []);
});

// -------------------------------------------------------- la pregunta ----

test('casar a un segundo pastor con la misma persona pregunta', () => {
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  const dos = pastor('Lucas');
  const pregunta = alCasar(dos, ella, fichaDe(dos));
  assert.equal(pregunta.confirmar, 'conyuge_ya_casada');
  assert.match(pregunta.error, /Marcos/, 'el aviso dice CON QUIÉN figura casada ya');
  assert.match(pregunta.error, /A cargo de la iglesia/, 'y por qué importa');
});

test('y dice qué va a pasar si confirma', () => {
  const ella = miembro('Sara', 'Femenino');
  pastor('Marcos', { conyugeId: ella });
  const dos = pastor('Lucas');
  assert.match(alCasar(dos, ella, fichaDe(dos)).error, /se suelta/);
});

test('a alguien libre no se le pregunta nada', () => {
  const dos = pastor('Lucas');
  assert.equal(alCasar(dos, miembro('Sara', 'Femenino'), fichaDe(dos)), null);
});

test('volver a mandar el cónyuge que ya tenía tampoco', () => {
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  assert.equal(alCasar(uno, ella, fichaDe(uno)), null,
    'no se está casando de nuevo: ya estaba');
});

test('ni aunque del otro lado el vínculo esté a medio escribir', () => {
  /*
   * Es el caso que dejaban las bases de antes: Marcos la nombra desde Pastores
   * / Guías, y la ficha de miembro de ella apunta a otro. Abrirlo y corregirle
   * cualquier cosa sin tocar el cónyuge no puede preguntar: volver a
   * preguntarlo cada vez es enseñar a apretar «Está bien» sin leer.
   */
  const ella = miembro('Sara', 'Femenino');
  const suyo = miembro('Marcos', 'Masculino');
  const ajeno = miembro('Andrés', 'Masculino');
  const uno = pastor('Marcos', { miembroId: suyo, conyugeId: ella });
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(ajeno, ella);

  assert.ok(conyuges.conQuienFiguraCasada(db, ella, uno).length,
    'del otro lado sí hay alguien: si no, esta prueba no probaría nada');
  assert.equal(alCasar(uno, ella, fichaDe(uno)), null, 'y aun así no se pregunta');
});

test('ni un guardado que no toca el cónyuge', () => {
  const ella = miembro('Sara', 'Femenino');
  pastor('Marcos', { conyugeId: ella });
  const dos = pastor('Lucas');
  assert.equal(conyuges.avisoSiYaEstaCasada(db, dos, {
    data: { telefono: '+56 9 1111 2222' }, existing: fichaDe(dos), confirmado: false,
  }), null);
});

test('quitarle el cónyuge no pregunta nada', () => {
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  assert.equal(alCasar(uno, null, fichaDe(uno)), null);
});

test('y confirmado, deja pasar', () => {
  const ella = miembro('Sara', 'Femenino');
  pastor('Marcos', { conyugeId: ella });
  const dos = pastor('Lucas');
  assert.equal(alCasar(dos, ella, fichaDe(dos), true), null);
});

// ------------------------------------- y el vínculo anterior se suelta ----

test('al anotar el vínculo, ningún OTRO pastor queda nombrándola', () => {
  /*
   * Ésta es la mitad que faltaba: lo viejo se soltaba del lado de las fichas
   * de MIEMBRO y no del de Pastores / Guías, que es justo donde quedaban los
   * dos apuntando a la misma esposa.
   */
  const ella = miembro('Sara', 'Femenino');
  const uno = pastor('Marcos', { conyugeId: ella });
  const dos = pastor('Lucas', { miembroId: miembro('Lucas', 'Masculino'), conyugeId: ella });

  conyuges.anotarElVinculo(db, fichaDe(dos), db.prepare('SELECT * FROM miembros WHERE id = ?').get(fichaDe(dos).miembro_id));
  assert.equal(conyugeDe(uno), null, 'el anterior queda suelto');
  assert.equal(conyugeDe(dos), ella, 'y el nuevo, escrito');
});

test('el vínculo queda recíproco en las fichas de miembro', () => {
  const ella = miembro('Sara', 'Femenino');
  const suyo = miembro('Lucas', 'Masculino');
  const dos = pastor('Lucas', { miembroId: suyo, conyugeId: ella });
  conyuges.anotarElVinculo(db, fichaDe(dos), db.prepare('SELECT * FROM miembros WHERE id = ?').get(suyo));
  assert.equal(db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(ella).conyuge_id, suyo);
  assert.equal(db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(suyo).conyuge_id, ella);
});

test('un pastor sin cónyuge no toca a nadie, ni a sí mismo', () => {
  /*
   * Con su ficha de miembro puesta, que es el caso corriente: sin el guardia,
   * el guardado de un pastor al que nunca se le puso cónyuge le borraba a SU
   * PROPIA ficha de miembro el vínculo que tuviera escrito.
   */
  const ella = miembro('Sara', 'Femenino');
  const conMarido = miembro('Ruth', 'Femenino');
  const suMarido = miembro('Elías', 'Masculino');
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(suMarido, conMarido);
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(conMarido, suMarido);

  const otro = pastor('Marcos', { conyugeId: ella });
  const suelto = pastor('Elías', { miembroId: suMarido });   // sin cónyuge en su ficha de pastor

  conyuges.anotarElVinculo(db, fichaDe(suelto), db.prepare('SELECT * FROM miembros WHERE id = ?').get(suMarido));

  assert.equal(conyugeDe(otro), ella, 'el vínculo ajeno se queda donde estaba');
  assert.equal(db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(suMarido).conyuge_id,
    conMarido, 'y el suyo propio, también');
});

test('el vínculo se escribe en UN solo lugar', () => {
  /*
   * Escrito en dos, un día uno de los dos soltaría media cosa. Es lo que ya
   * había pasado: el gancho del módulo soltaba un lado y no el otro.
   */
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/pastores.js'), 'utf8');
  assert.match(modulo, /anotarElVinculo\(db, fila, fichaDeMiembro\(fila, db\)\)/);
  assert.doesNotMatch(modulo, /UPDATE miembros SET conyuge_id/,
    'el módulo no puede escribir el vínculo por su cuenta');
});

// ------------------------------------------------ guardando de verdad ----

test('guardando de verdad: pregunta, y al confirmar el desplegable deja de nombrarla dos veces', async () => {
  const api = await elSistemaAndando();
  const m = `conyuge-${process.pid}`;

  // Con su iglesia: crear la ficha de miembro de un pastor la exige, porque un
  // miembro pertenece siempre a una congregación
  const igl = (await api('POST', '/iglesias', {
    nombre: `Iglesia Cónyuge ${m}`, codigo: `CY${process.pid}`, estado: 'Activa',
  })).json;

  const ella = (await api('POST', '/pastores', {
    nombres: 'Sara', apellidos: `Ella ${m}`, cargo: 'Pastora', iglesia_id: igl.id,
  })).json;
  const suFicha = (await api('POST', `/pastores/${ella.id}/ficha-miembro`, {})).json;
  assert.ok(suFicha.miembro_id, `su ficha de miembro: ${JSON.stringify(suFicha)}`);
  db.prepare("UPDATE miembros SET genero = 'Femenino' WHERE id = ?").run(suFicha.miembro_id);

  const crear = async (nombre) => {
    const p = (await api('POST', '/pastores', {
      nombres: nombre, apellidos: `El ${m}`, cargo: 'Pastor Presbítero', iglesia_id: igl.id,
    })).json;
    const f = (await api('POST', `/pastores/${p.id}/ficha-miembro`, {})).json;
    assert.ok(f.miembro_id, `la ficha de ${nombre}: ${JSON.stringify(f)}`);
    db.prepare("UPDATE miembros SET genero = 'Masculino' WHERE id = ?").run(f.miembro_id);
    return p;
  };
  const uno = await crear('Marcos');
  const dos = await crear('Lucas');

  assert.equal((await api('PUT', `/pastores/${uno.id}`, { conyuge_id: suFicha.miembro_id, igual_asi: true })).estado, 200);

  const pregunta = await api('PUT', `/pastores/${dos.id}`, { conyuge_id: suFicha.miembro_id });
  assert.equal(pregunta.estado, 400, 'la segunda tiene que preguntar');
  assert.equal(pregunta.json.confirmar, 'conyuge_ya_casada');
  assert.equal(conyugeDe(uno.id), suFicha.miembro_id, 'y mientras no confirme, no toca nada');

  assert.equal((await api('PUT', `/pastores/${dos.id}`, { conyuge_id: suFicha.miembro_id, igual_asi: true })).estado, 200);
  assert.equal(conyugeDe(uno.id), null, 'el vínculo anterior se soltó');

  /*
   * Acotado a los sembrados por ESTA prueba: las otras de este archivo también
   * crean gente llamada Sara, y en el motor todos los archivos comparten una
   * misma base.
   */
  const laNombran = (await api('GET', '/pastores/con-conyuge')).json
    .filter((o) => o.label.includes(` y Pastora Sara Ella ${m}`));
  assert.equal(laNombran.length, 1,
    `solo uno puede nombrarla como su cónyuge: ${laNombran.map((o) => o.label).join(' | ')}`);
  assert.match(laNombran[0].label, /Lucas/, 'y es el último que se casó con ella');
});

test('y la pregunta tiene su propia cara en la pantalla', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const COMO_SE_PREGUNTA = {');
  const catalogo = app.slice(desde, app.indexOf('\n  };', desde));
  assert.match(catalogo, /conyuge_ya_casada: \{/);
  assert.match(catalogo, /Volver y revisar a quién elegí/);
});

test('las tres preguntas del módulo van ordenadas por lo que cuesta deshacer', () => {
  const modulo = fs.readFileSync(path.join(__dirname, '../../server/modules/pastores.js'), 'utf8');
  const orden = ['avisoSiDejaDeEjercer(', 'avisoSiDejaSuIglesiaSinPastor(', 'avisoSiYaEstaCasada('];
  const donde = orden.map((q) => modulo.indexOf(q));
  assert.ok(donde.every((i) => i > 0), 'las tres tienen que estar');
  assert.deepEqual([...donde].sort((a, b) => a - b), donde,
    'revocar una credencial, dejar una iglesia sin pastor, y recién después soltar un vínculo');
});
