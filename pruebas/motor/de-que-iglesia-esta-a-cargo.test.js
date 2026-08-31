/**
 * De qué congregación está a cargo un pastor, dicho en SU ficha.
 *
 * La relación está escrita en la ficha de la IGLESIA —su campo «Pastor
 * principal»— y desde la del pastor no se veía por ninguna parte. Su ficha
 * mostraba «Iglesia», que es a la que PERTENECE, y eso es otra cosa: se puede
 * pertenecer a una congregación sin encabezarla, y se puede encabezar una a la
 * que la ficha no lo asigna. Medido antes de la 1.246.0, con una pastora
 * puesta como pastora principal de la Iglesia Central, su propia ficha no lo
 * mencionaba en ninguna parte.
 *
 * Importa porque es la relación de la que cuelgan las dos preguntas que este
 * módulo hace —al jubilarlo (1.240.0) y al borrarlo (1.245.0)—: quien va a
 * hacer cualquiera de las dos abre esta ficha, y ahí tenía que estar dicho.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const PASTORES = getModule('pastores');
const A_CARGO = PASTORES.computed.find((c) => c.name === 'a_cargo_de');

let n = 0;
const marca = () => `${++n}-${process.pid}`;

const iglesia = (nombre, pastorId = null) => db
  .prepare('INSERT INTO iglesias (nombre, pastor_id) VALUES (?, ?)')
  .run(`${nombre} ACargo ${marca()}`, pastorId).lastInsertRowid;

const pastor = (nombres, { iglesiaId = null } = {}) => {
  const id = db
    .prepare(`INSERT INTO pastores (nombres, apellidos, cargo, estado, iglesia_id)
              VALUES (?, ?, 'Pastor Presbítero', 'Activo', ?)`)
    .run(nombres, `ACargo ${marca()}`, iglesiaId).lastInsertRowid;
  return db.prepare('SELECT * FROM pastores WHERE id = ?').get(id);
};

const calcular = (fila) => A_CARGO.calc(fila, { db });
const nombreDe = (id) => db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id).nombre;

// -------------------------------------------------------- el dato mismo ----

test('el campo existe, es calculado y se llama como se lee', () => {
  assert.ok(A_CARGO, 'tiene que existir el calculado a_cargo_de');
  assert.equal(A_CARGO.label, 'A cargo de');
  assert.equal(A_CARGO.type, 'badge');
});

test('a quien ninguna congregación encabeza no le dice nada', () => {
  assert.equal(calcular(pastor('Timoteo')), null);
});

test('pertenecer a una iglesia no es estar a cargo de ella', () => {
  const casa = iglesia('Antioquía');
  assert.equal(calcular(pastor('Timoteo', { iglesiaId: casa })), null);
});

test('al que una congregación encabeza le dice cuál, y lleva a su ficha', () => {
  const casa = iglesia('Éfeso');
  const p = pastor('Tito', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);
  const dato = calcular(p);
  assert.equal(dato.texto, nombreDe(casa));
  assert.equal(dato.ir, `#/m/iglesias/ficha/${casa}`);
});

test('también cuando la ficha no lo asigna a esa iglesia', () => {
  // El caso legítimo del interinato: encabeza una a la que no pertenece
  const suya = iglesia('Creta');
  const otra = iglesia('Corinto');
  const p = pastor('Apolos', { iglesiaId: suya });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, otra);
  assert.equal(calcular(p).texto, nombreDe(otra));
});

test('con dos congregaciones las nombra a las dos y lleva al listado', () => {
  const p = pastor('Bernabé');
  const una = iglesia('Listra', p.id);
  const otra = iglesia('Derbe', p.id);
  const dato = calcular(p);
  assert.match(dato.texto, new RegExp(nombreDe(una)));
  assert.match(dato.texto, new RegExp(nombreDe(otra)));
  assert.equal(dato.ir, '#/m/iglesias', 'con dos no elige una por su cuenta');
});

// ------------------------------------------------- dónde sale a la vista ----

test('va entre las columnas del listado, para que la cabecera lo muestre', () => {
  assert.ok(PASTORES.listFields.includes('a_cargo_de'));
});

test('y va en su hoja impresa: no pide quedarse fuera del papel', () => {
  assert.notEqual(A_CARGO.enElPapel, false);
});

test('la pantalla recibe el campo con su ayuda', async () => {
  const api = await elSistemaAndando();
  const { getModule: cual } = require('../../server/registry');
  const campo = cual('pastores').computed.find((c) => c.name === 'a_cargo_de');
  assert.match(campo.help, /no es lo mismo que «Iglesia»/i);
});

// ------------------------------------------------- el sistema andando ----

test('la ficha que pide el navegador trae de qué iglesia está a cargo', async () => {
  const api = await elSistemaAndando();
  const casa = iglesia('Filipos');
  const p = pastor('Epafrodito', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);

  const r = await api('GET', `/pastores/${p.id}`);
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.a_cargo_de.texto, nombreDe(casa));
  assert.equal(r.json.a_cargo_de.ir, `#/m/iglesias/ficha/${casa}`);
});

test('y la ficha de quien no encabeza ninguna no lo trae', async () => {
  const api = await elSistemaAndando();
  const p = pastor('Lucas');
  const r = await api('GET', `/pastores/${p.id}`);
  assert.equal(r.estado, 200, r.texto);
  assert.ok(!r.json.a_cargo_de, 'sin congregación a su cargo, el dato no viaja');
});

test('el listado lo trae en la fila de cada uno', async () => {
  const api = await elSistemaAndando();
  const casa = iglesia('Colosas');
  const p = pastor('Epafras', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);

  const r = await api('GET', `/pastores?buscar=${encodeURIComponent(p.apellidos)}`);
  assert.equal(r.estado, 200, r.texto);
  const suya = (r.json.rows || r.json.data || []).find((f) => f.id === p.id);
  assert.ok(suya, 'su fila tiene que estar');
  assert.equal(suya.a_cargo_de.texto, nombreDe(casa));
});

// ------------------------------------------ se mantiene solo, no se copia ----

test('al soltarle la congregación, la ficha deja de decir que está a cargo', async () => {
  const api = await elSistemaAndando();
  const casa = iglesia('Tesalónica');
  const p = pastor('Silas', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);
  assert.ok((await api('GET', `/pastores/${p.id}`)).json.a_cargo_de, 'primero lo dice');

  db.prepare('UPDATE iglesias SET pastor_id = NULL WHERE id = ?').run(casa);
  assert.ok(!(await api('GET', `/pastores/${p.id}`)).json.a_cargo_de, 'y deja de decirlo solo');
});

test('si la congregación cambia de nombre, la ficha dice el nuevo', async () => {
  const api = await elSistemaAndando();
  const casa = iglesia('Berea');
  const p = pastor('Jasón', { iglesiaId: casa });
  db.prepare('UPDATE iglesias SET pastor_id = ? WHERE id = ?').run(p.id, casa);

  const nuevo = `Berea Renombrada ACargo ${marca()}`;
  db.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?').run(nuevo, casa);
  assert.equal((await api('GET', `/pastores/${p.id}`)).json.a_cargo_de.texto, nuevo);
});

// ---------------------------------------- cómo lo pinta la cabecera ----

/*
 * Esto comprueba el CABLEADO, no el dibujo: que la cabecera de una ficha sepa
 * pintar un dato calculado que lleva a alguna parte, y que siga sin pintar los
 * que no llevan a ninguna. El dibujo se mira en el navegador de verdad.
 */
test('la cabecera de la ficha pinta como enlace el calculado que lleva a alguna parte', () => {
  const pantalla = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(pantalla, /f\.computed && v && v\.ir/, 'la rama tiene que estar');
  assert.match(pantalla, /insignias\.push\(`<a class="badge \$\{nivelClase\(v\.nivel\)\}" href="\$\{esc\(v\.ir\)\}"/);
  assert.match(pantalla, /\$\{esc\(f\.label\)\} · \$\{esc\(v\.texto\)\}/, 'va con su etiqueta delante');
});

test('y el calculado que no lleva a ninguna parte sigue sin salir en la cabecera', () => {
  /*
   * «Ficha de miembro» es de ésos: tiene su propio panel al pie de la pestaña
   * de Datos, y pintarlo además arriba diría lo mismo dos veces. La rama nueva
   * está condicionada a que el dato traiga adónde ir, y esto lo fija.
   */
  const ficha = PASTORES.computed.find((c) => c.name === 'ficha_miembro');
  const valor = ficha.calc({ id: pastor('Fortunato').id }, { db });
  assert.ok(valor && typeof valor === 'object');
  assert.ok(!valor.ir, 'no lleva a ninguna parte, así que no se pinta arriba');
});
