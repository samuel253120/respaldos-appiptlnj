/**
 * Una columna declarada después no deja las fichas viejas a medias.
 *
 * POR QUÉ IMPORTA. El sistema crece: a un módulo que ya está en uso se le
 * agrega un campo, y la base le suma la columna al arrancar. `ADD COLUMN` deja
 * a las fichas que ya existían en NULO, y ahí empieza el problema, porque el
 * nulo y el valor por omisión NO se ven igual:
 *
 *   · El formulario muestra el valor por omisión SOLO en las fichas nuevas.
 *     En una ficha vieja, una casilla que nace marcada aparece DESMARCADA.
 *   · El código que la lee suele preguntar «¿está apagada?» —`=== 0`—, y el
 *     nulo no es cero, así que se comporta como encendida.
 *
 * Resultado: alguien abre una ficha vieja, no toca esa casilla, guarda, y le
 * apaga un ajuste que en pantalla figuraba apagado pero que en realidad estaba
 * encendido. Nada lo avisa. Se descubrió al hacer la vista previa de un
 * formato de certificado: la línea de la fecha desaparecía sin que nadie la
 * hubiera tocado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');

/* Se reproduce lo que hace el arranque: una tabla con fichas, y después una
   columna nueva que declara su valor por omisión. */
db.exec('DROP TABLE IF EXISTS prueba_columna');
db.exec('CREATE TABLE prueba_columna (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT)');
for (const n of ['una', 'otra', 'tercera']) {
  db.prepare('INSERT INTO prueba_columna (nombre) VALUES (?)').run(n);
}

/** El mismo trozo que corre en server/db.js al agregar una columna. */
function agregarColumna(tabla, campo, tipoSql) {
  const existentes = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
  if (existentes.has(campo.name)) return;
  db.exec(`ALTER TABLE "${tabla}" ADD COLUMN "${campo.name}" ${tipoSql}`);
  if (campo.default !== undefined && campo.default !== null && existentes.size) {
    const valor = campo.type === 'boolean' ? (campo.default ? 1 : 0) : campo.default;
    db.prepare(`UPDATE "${tabla}" SET "${campo.name}" = ? WHERE "${campo.name}" IS NULL`).run(valor);
  }
}

agregarColumna('prueba_columna', { name: 'muestra_algo', type: 'boolean', default: 1 }, 'INTEGER');
agregarColumna('prueba_columna', { name: 'apagada', type: 'boolean', default: 0 }, 'INTEGER');
agregarColumna('prueba_columna', { name: 'estado', type: 'select', default: 'Activo' }, 'TEXT');
agregarColumna('prueba_columna', { name: 'sin_omision', type: 'text' }, 'TEXT');

const filas = () => db.prepare('SELECT * FROM prueba_columna ORDER BY id').all();

test('EL CASO: una casilla que nace marcada queda marcada en las fichas viejas', () => {
  // Si quedara en nulo, la pantalla la mostraría desmarcada y el primer
  // guardado la apagaría de verdad, sin que nadie lo pidiera.
  for (const f of filas()) assert.equal(f.muestra_algo, 1, `la ficha «${f.nombre}» quedó en ${f.muestra_algo}`);
});

test('y una que nace desmarcada queda en cero, no en nulo', () => {
  // Cero y nulo se ven igual en la pantalla, pero no en las consultas: un
  // `WHERE apagada = 0` no encuentra las nulas.
  for (const f of filas()) assert.equal(f.apagada, 0);
});

test('lo mismo con un valor por omisión que no es una casilla', () => {
  for (const f of filas()) assert.equal(f.estado, 'Activo');
});

test('un campo sin valor por omisión sí queda en nulo', () => {
  // No hay nada que poner, y ponerle algo sería inventar un dato.
  for (const f of filas()) assert.equal(f.sin_omision, null);
});

test('no se toca lo que ya tenía valor', () => {
  // Corre una sola vez, cuando la columna se crea; pero si por lo que sea se
  // repitiera, no puede pisar lo que alguien haya elegido después.
  db.prepare("UPDATE prueba_columna SET muestra_algo = 0 WHERE nombre = 'otra'").run();
  agregarColumna('prueba_columna', { name: 'muestra_algo', type: 'boolean', default: 1 }, 'INTEGER');
  assert.equal(filas().find((f) => f.nombre === 'otra').muestra_algo, 0);
});

test('a una tabla recién creada no le hace falta', () => {
  // Ahí la columna va en el CREATE TABLE con su valor por omisión, y no hay
  // ninguna ficha anterior a la que ponerle nada.
  db.exec('DROP TABLE IF EXISTS prueba_vacia');
  db.exec('CREATE TABLE prueba_vacia (id INTEGER PRIMARY KEY AUTOINCREMENT)');
  agregarColumna('prueba_vacia', { name: 'algo', type: 'boolean', default: 1 }, 'INTEGER');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM prueba_vacia').get().c, 0);
});
