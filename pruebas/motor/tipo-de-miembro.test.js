/**
 * EL TIPO DE MIEMBRO NO DECÍA NADA, Y PODÍA CONTRADECIR LA EDAD.
 *
 * «Tipo de miembro» es una de las nueve columnas del listado y uno de sus tres
 * filtros. En la base cargada estaba en blanco en las 603 fichas: la columna
 * salía vacía y el filtro no separaba nada.
 *
 * Y no es un campo decorativo: de él sale quién entra SOLO a la directiva de
 * su iglesia (ver server/directiva.js). Un campo del que cuelga una regla
 * automática y que nadie llena es una regla que no se está aplicando, sin que
 * nadie lo note.
 *
 * Tampoco lo revisaba nadie: se podía dejar «Miembro Menor de Edad» en alguien
 * de 45 años y —lo que pasa de verdad— el menor que cumple 18 se queda con el
 * tipo de menor para siempre, porque nadie vuelve a abrir su ficha.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const miembros = require('../../server/modules/miembros');
const pendientes = require('../../server/pendientes');
const vigia = require('../../server/avisos/vigia');
const avisos = require('../../server/avisos/avisos');

const MENOR = 'Miembro Menor de Edad';
const NUEVO = 'Miembro Nuevo';

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los tipos', 'IG-TIPO', 'Activa')")
  .run().lastInsertRowid;

/** Una fecha que hoy da exactamente esta edad, con un día de margen. */
const naceHace = (anios) => db.prepare("SELECT date('now','localtime',?,'-1 day') d").get(`-${anios} years`).d;

let n = 0;
function alguien(anios, tipo, extra = {}) {
  n++;
  return db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado, fecha_nacimiento, tipo_miembro) VALUES (?, ?, ?, ?, ?, ?)")
    .run(extra.nombres || `Tipo${n}`, extra.apellidos || `Delmiembro${n}`, iglesia,
      extra.estado || 'Activo', anios === null ? null : naceHace(anios), tipo || null)
    .lastInsertRowid;
}
const fila = (id) => db.prepare('SELECT * FROM miembros WHERE id = ?').get(id);
const guardar = (datos, opciones = {}) => miembros.hooks.beforeSave(datos, {
  id: opciones.id || null,
  existing: opciones.id ? fila(opciones.id) : null,
  db,
  confirmado: !!opciones.confirmado,
});

// ------------------------ con qué tipo nace una ficha ----------------------

test('el formulario ofrece un tipo de fábrica, en vez de dejarlo en blanco', () => {
  const campo = miembros.fields.find((f) => f.name === 'tipo_miembro');
  assert.equal(campo.default, NUEVO,
    'estaba en blanco en 603 de 603 fichas, y de él cuelga quién entra a la directiva');
  assert.ok(campo.options.includes(NUEVO), 'y tiene que ser uno de los de la lista');
});

test('al crear, a un menor se le pone el tipo que le corresponde', () => {
  const datos = { nombres: 'Nuevo', apellidos: 'Chico', iglesia_id: iglesia, fecha_nacimiento: naceHace(9) };
  assert.equal(guardar(datos), null);
  assert.equal(datos.tipo_miembro, MENOR);
});

test('aunque el formulario mandara otro', () => {
  const datos = { nombres: 'Nuevo', apellidos: 'Chico', iglesia_id: iglesia,
    fecha_nacimiento: naceHace(9), tipo_miembro: 'Miembro Líder' };
  assert.equal(guardar(datos), null);
  assert.equal(datos.tipo_miembro, MENOR, 'la minoría de edad no la decide quien llena el formulario');
});

test('pero a un adulto no se le impone ninguno: eso lo decide la iglesia', () => {
  const datos = { nombres: 'Nueva', apellidos: 'Grande', iglesia_id: iglesia,
    fecha_nacimiento: naceHace(35), tipo_miembro: 'Miembro Oyente' };
  assert.equal(guardar(datos), null);
  assert.equal(datos.tipo_miembro, 'Miembro Oyente', 'de los 18 para arriba la edad no decide nada');
});

test('y sin fecha de nacimiento tampoco se inventa uno', () => {
  const datos = { nombres: 'Nueva', apellidos: 'Sinfecha', iglesia_id: iglesia, tipo_miembro: 'Miembro Activo' };
  assert.equal(guardar(datos), null);
  assert.equal(datos.tipo_miembro, 'Miembro Activo');
  assert.equal(miembros.tipoQueLeCorresponde(null), null);
});

// --------------------- cuando el tipo y la edad se pelean ------------------

test('poner «Menor de Edad» en alguien de 35 pregunta antes de guardar', () => {
  const quien = alguien(35, 'Miembro Activo');
  const problema = guardar({ tipo_miembro: MENOR }, { id: quien });

  assert.ok(problema, 'se podía dejar puesto en alguien de 45 años y nada lo revisaba');
  assert.equal(problema.confirmar, 'tipo_miembro_no_calza_con_la_edad',
    'tiene que ser una PREGUNTA: la iglesia puede tener sus razones');
  assert.match(problema.error, /35 años/, 'dice la edad que tiene, no solo que algo no calza');
  assert.match(problema.error, /directiva/, 'y por qué importa');
});

test('y al revés: dejar a un menor con un tipo de adulto', () => {
  const chico = alguien(9, MENOR);
  const problema = guardar({ tipo_miembro: 'Miembro Activo' }, { id: chico });
  assert.equal(problema.confirmar, 'tipo_miembro_no_calza_con_la_edad');
  assert.match(problema.error, /Todavía no cumple 18/);
});

test('cambiar la FECHA también dispara la pregunta, no solo el tipo', () => {
  /*
   * Es el caso de la ficha mal cargada que alguien viene a corregir: el tipo
   * dice menor y la fecha nueva dice que tiene cuarenta.
   */
  const quien = alguien(9, MENOR);
  assert.ok(guardar({ fecha_nacimiento: naceHace(40) }, { id: quien }));
});

test('confirmando, entra igual', () => {
  const quien = alguien(35, 'Miembro Activo');
  assert.equal(guardar({ tipo_miembro: MENOR }, { id: quien, confirmado: true }), null);
});

test('corregir un teléfono NO vuelve a preguntar', () => {
  /*
   * La ficha puede quedar contradictoria —se confirmó— y quien viene después a
   * cambiar otra cosa no tiene por qué responder de nuevo por algo que no
   * hizo. Es el mismo error que este módulo ya cometió con el trato pastoral.
   */
  const contradictoria = alguien(35, MENOR);
  assert.equal(guardar({ telefono: '+56911112222' }, { id: contradictoria }), null);
  assert.equal(guardar({ notas: 'algo' }, { id: contradictoria }), null);
});

test('ni pregunta cuando el tipo está en blanco', () => {
  const sinTipo = alguien(35, null);
  assert.equal(guardar({ telefono: '+56911112222' }, { id: sinTipo }), null);
});

// --------------------------- el panel lo pone a la vista -------------------

test('el panel cuenta las fichas que no tienen tipo, para poder llenarlas', () => {
  /*
   * Se cuenta acotado a la iglesia de este archivo, no el total del sistema.
   *
   * Estas pruebas comparten la base y corren en paralelo: contar «todas las
   * fichas sin tipo», agregar una y esperar exactamente una más falla en
   * cuanto otro archivo crea un miembro en esa misma rendija. Pasó: al
   * agregarse las pruebas de la evaluación —que crean doce— esto empezó a
   * caerse una de cada tres corridas. La cifra se mira por el alcance de un
   * usuario de esta iglesia, que es además como la mira una secretaria de
   * verdad.
   */
  // El alcance se acota con la LISTA de iglesias del usuario; con `iglesia_id`
  // solo, o con la lista escrita como texto, no acota nada y se cuenta todo.
  const suya = { rol: 'secretario', iglesia_id: iglesia, iglesias: [iglesia] };
  const antes = pendientes.resumen(suya);
  const linea = antes.faltas.find((f) => f.campo === 'tipo_miembro');
  assert.ok(linea, 'sin esto, 603 fichas en blanco no se ven en ninguna parte');
  assert.match(linea.para, /directiva/, 'cada línea dice para qué sirve el dato');

  const cuantas = linea.cuantos;
  alguien(35, null);
  assert.equal(pendientes.resumen(suya).faltas.find((f) => f.campo === 'tipo_miembro').cuantos,
    cuantas + 1);

  // Y que el acotado esté de verdad acotando: el administrador ve MUCHAS más.
  // Sin esta comprobación, un usuario mal armado devuelve el total del sistema
  // y la prueba vuelve a depender de lo que hagan los otros archivos —pasó, con
  // la lista de iglesias escrita como texto en vez de como lista—.
  const suyas = pendientes.resumen(suya).total;
  const todas = pendientes.resumen({ rol: 'admin' }).total;
  assert.ok(todas > suyas, `el alcance no está acotando: acotado ${suyas}, de todas ${todas}`);
});

// ------------------- el que cumple 18 y nadie vuelve a mirar ---------------

test('avisa de quien ya cumplió 18 y sigue como menor de edad', () => {
  /*
   * Es la única contradicción que llega SOLA: nadie toca esas fichas, así que
   * la comprobación al guardar no la alcanza nunca porque no hay guardado.
   */
  const grande = alguien(19, MENOR, { nombres: 'Aniceta', apellidos: 'Cumplioaños' });
  const dejados = [];
  vigia.cumplieronLaMayoria({ id: 1, rol: 'admin', nombre: 'Quien sea' }, (a) => dejados.push(a));

  assert.equal(dejados.length, 1);
  assert.equal(dejados[0].tipo, 'cumplio_la_mayoria');
  /*
   * `cuerpo` y `enlace`, no «detalle» y «ruta».
   *
   * Esta prueba decía «detalle» y «ruta» porque así estaba escrito el aviso, y
   * pasaba. Pero `avisos.crear` toma solo las claves que conoce, y esas dos no
   * están entre ellas: el aviso llegaba con el título pelado, sin texto y sin
   * adónde ir, y la prueba no lo veía porque miraba el objeto que arma el
   * vigía y no el que guarda el sistema. Se corrigieron las dos cosas en la
   * 1.200.0, y abajo se comprueba lo que de verdad importa: que el texto y el
   * enlace lleguen a la campanita.
   */
  assert.match(dejados[0].cuerpo, /Aniceta Cumplioaños/);
  assert.match(dejados[0].cuerpo, /directiva/, 'dice por qué importa, no solo que pasó');
  assert.match(dejados[0].enlace, /f_tipo_miembro=/, 'y lleva a quiénes son');
  assert.match(dejados[0].enlace, /edad_desde=18/);

  const avisos = require('../../server/avisos/avisos');
  const usuario = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo, password) VALUES ('20777888-8','Quien recibe el aviso','admin',1,'x')"
  ).run().lastInsertRowid;
  const guardado = avisos.crear({ ...dejados[0], usuario_id: usuario });
  assert.ok(guardado, 'el aviso no llegó a guardarse');
  assert.match(guardado.cuerpo || '', /Aniceta Cumplioaños/, 'el texto tiene que llegar a la campanita');
  assert.match(guardado.enlace || '', /f_tipo_miembro=/, 'y el enlace también');
  assert.equal(grande, Number(grande));
});

test('no avisa de los que todavía son menores', () => {
  db.prepare('DELETE FROM miembros WHERE iglesia_id = ?').run(iglesia);
  alguien(9, MENOR);
  alguien(17, MENOR);
  const dejados = [];
  vigia.cumplieronLaMayoria({ id: 1, rol: 'admin' }, (a) => dejados.push(a));
  assert.equal(dejados.length, 0);
});

test('ni de quien ya no está en la iglesia', () => {
  db.prepare('DELETE FROM miembros WHERE iglesia_id = ?').run(iglesia);
  alguien(19, MENOR, { estado: 'Fallecido' });
  alguien(19, MENOR, { estado: 'Trasladado' });
  const dejados = [];
  vigia.cumplieronLaMayoria({ id: 1, rol: 'admin' }, (a) => dejados.push(a));
  assert.equal(dejados.length, 0, 'a quien ya no está no hay que corregirle nada');
});

test('el aviso NO corrige el tipo por su cuenta', () => {
  db.prepare('DELETE FROM miembros WHERE iglesia_id = ?').run(iglesia);
  const grande = alguien(19, MENOR);
  vigia.cumplieronLaMayoria({ id: 1, rol: 'admin' }, () => {});
  assert.equal(fila(grande).tipo_miembro, MENOR,
    '¿queda como nuevo, oyente o activo? esa respuesta el sistema no la tiene: la decide la iglesia');
});

test('mientras sean los mismos no repite el aviso todos los días', () => {
  db.prepare('DELETE FROM miembros WHERE iglesia_id = ?').run(iglesia);
  alguien(19, MENOR);
  const claves = [];
  for (let i = 0; i < 2; i++) vigia.cumplieronLaMayoria({ id: 1, rol: 'admin' }, (a) => claves.push(a.clave));
  assert.equal(claves[0], claves[1], 'la clave es la misma, así que el aviso no se duplica');

  alguien(20, MENOR);
  vigia.cumplieronLaMayoria({ id: 1, rol: 'admin' }, (a) => claves.push(a.clave));
  assert.notEqual(claves[2], claves[0], 'y en cuanto cumple otro, vuelve a salir');
});

test('el tipo de aviso está registrado, o no se puede ni preferir ni apagar', () => {
  assert.ok(avisos.TIPOS.cumplio_la_mayoria, 'un aviso sin tipo no aparece en las preferencias de nadie');
  assert.equal(avisos.TIPOS.cumplio_la_mayoria.urgente, false);
});

// -------------------------- lo que la pantalla sabe ------------------------

test('la pantalla sabe qué cara ponerle a la pregunta', () => {
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /tipo_miembro_no_calza_con_la_edad: \{/);
  assert.match(app, /Así corresponde, guardar/);
});

test('y el listado lee de la dirección el rango de edad y los filtros del módulo', () => {
  /*
   * Sin esto, el aviso de «ya cumplieron 18» llevaba a un listado sin filtrar:
   * decía «son estas tres» y abría las seiscientas.
   */
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /if \(rango\.edad_desde !== undefined \|\| st\.edadDesde\)/);
  assert.match(app, /for \(const f of m\.filtrosPropios \|\| \[\]\)/);
});

test('«sin=» acepta varios campos, que es lo que el servidor entiende', () => {
  /*
   * «sin=responsable_nombre,responsable_id» son los menores que no tienen
   * ninguno de los dos. Leyendo un solo nombre, esa dirección no calzaba con
   * ningún campo y el filtro se caía entero: el enlace del panel abría el
   * listado completo, como si no faltara nada.
   */
  const app = require('fs').readFileSync(
    require('path').join(__dirname, '../../public/app.js'), 'utf8'
  );
  assert.match(app, /\.split\(','\)\.map\(\(c\) => c\.trim\(\)\)\.filter\(\(c\) => fieldsBy\[c\]\)\.join\(','\)/);
});
