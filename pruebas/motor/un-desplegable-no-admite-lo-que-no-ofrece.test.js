/**
 * UN DESPLEGABLE QUE ADMITÍA CUALQUIER COSA.
 *
 * Ochenta y un campos del sistema son un desplegable y setenta y siete traen
 * escrita su lista. Ninguno la comprobaba al guardar: la pantalla ofrecía las
 * opciones de siempre y por la API entraba lo que fuera. Medido contra el
 * sistema andando, antes de esto:
 *
 *   tipo de ayuda «Vestuario» ..........  201, guardado así
 *   tipo de ayuda «Lo que sea» .........  201, guardado así
 *   estado de una ayuda «Regalada» .....  201, guardado así
 *   ¿a quién se le ayuda? «Vecino» .....  201, y la ayuda quedó SIN
 *                                         beneficiario, porque la regla que
 *                                         copia el nombre solo conoce dos
 *   estado de un miembro «Cualquier cosa» 200
 *   estado de una cuenta «Congelada» ...  200
 *
 * Se encontró revisando Ayudas Sociales y no es de ese módulo: es del motor, y
 * arreglarlo una vez los arregla en los treinta y nueve.
 *
 * Lo que cuida este archivo:
 *   · que un valor que la lista no ofrece se rechace, y el reparo diga cuáles
 *     son las opciones
 *   · que vacío no cuente como valor inventado
 *   · que las listas que vienen de una ruta no se comprueben contra una copia
 *   · que ésas se comprueben CONTRA SU TABLA, que es la otra mitad de la regla
 *     y llegó en la v1.344.0
 *   · y —lo que hace que esto se pueda publicar— que una ficha que YA trae un
 *     valor fuera de su lista se siga pudiendo guardar
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const opciones = require('../../server/opciones');
const { allModules, getModule } = require('../../server/registry');

/** El `cambia` de crud.js, que es con lo que se llama de verdad. */
const comoEnCrud = (data, existing) => (nombre) => {
  const val = data[nombre];
  if (val === undefined) return false;
  if (!existing) return true;
  const antes = existing[nombre];
  return String(antes == null ? '' : antes) !== String(val == null ? '' : val);
};

const revisar = (def, data, existing) =>
  opciones.loQueNoEstaEnLaLista(def, data, comoEnCrud(data, existing));

const AYUDAS = getModule('ayudas_sociales');
const MIEMBROS = getModule('miembros');
const PASTORES = getModule('pastores');

/* ------------------------------- lo que se rechaza */

test('un valor que la lista no ofrece no se guarda', () => {
  const r = revisar(AYUDAS, { tipo_ayuda: 'Lo que sea' });
  assert.match(r, /"Tipo de ayuda" no admite "Lo que sea"/);
});

test('y el reparo dice cuáles son las opciones, para poder contestarlo', () => {
  const r = revisar(AYUDAS, { tipo_ayuda: 'Vestuario' });
  assert.match(r, /Las opciones son: Alimentos, Económica/);
  assert.match(r, /Otro\.$/, 'la lista entera, no las tres primeras');
});

test('vale para cualquier módulo, no solo para las ayudas', () => {
  assert.match(revisar(MIEMBROS, { estado: 'Cualquier cosa' }), /"Estado" no admite/);
  assert.match(revisar(AYUDAS, { beneficiario_tipo: 'Vecino' }), /no admite "Vecino"/);
});

test('lo que la lista sí ofrece pasa', () => {
  assert.equal(revisar(AYUDAS, { tipo_ayuda: 'Ropa', estado: 'Aprobada' }), null);
});

test('una lista escrita como objeto se compara por su valor, no por su etiqueta', () => {
  /*
   * Dos campos del sistema declaran sus opciones como {valor, etiqueta}: el mes
   * de una cuota y el rol de un usuario. Lo que se guarda es el valor —«01»,
   * «admin»—, así que es lo que hay que comparar; comparando la etiqueta,
   * «Enero» pasaría y «01» no, que es exactamente al revés.
   */
  const USUARIOS = getModule('usuarios');
  assert.equal(revisar(USUARIOS, { rol: 'admin' }), null);
  assert.match(revisar(USUARIOS, { rol: 'Administrador' }), /no admite "Administrador"/);
  assert.match(revisar(USUARIOS, { rol: 'jefe' }), /no admite "jefe"/);
});

/* ------------------------------- lo que no se toca */

test('vacío no es un valor inventado: es no haber contestado', () => {
  for (const v of [null, '', '   ', undefined]) {
    assert.equal(revisar(AYUDAS, { tipo_ayuda: v }), null, JSON.stringify(v));
  }
});

test('las listas que vienen de una ruta no se comprueban contra una copia', () => {
  /*
   * Diecinueve campos sacan sus opciones de una tabla que la iglesia mantiene
   * —las categorías de tesorería, los tipos de actividad— y esa lista cambia
   * sola. Comprobarla ACÁ contra una copia sería inventar una segunda verdad.
   *
   * Lo que sí se hace, desde la v1.344.0, es comprobarlas contra su tabla, que
   * es una función aparte y está probada más abajo.
   */
  const TESORERIA = getModule('tesoreria');
  const categoria = TESORERIA.fields.find((f) => f.name === 'categoria');
  assert.ok(categoria.optionsRoute, 'la categoría saca su lista de una ruta');
  assert.equal(opciones.tieneListaPropia(categoria), false);
  assert.equal(revisar(TESORERIA, { categoria: 'Una categoría que la iglesia acaba de crear' }), null);

  /*
   * Y el caso que hoy no existe pero que la regla promete: un campo que declare
   * las dos cosas, una lista escrita Y una ruta. Manda la ruta.
   *
   * Se prueba con un módulo inventado y no buscándolo entre los de verdad,
   * porque hoy no hay ninguno así —los diecinueve con ruta no traen lista— y
   * una prueba que lo buscara pasaría sin comprobar nada. Se vio al romper a
   * propósito esa condición y ver que no se caía nada.
   */
  const inventado = {
    name: 'de_mentira',
    fields: [{
      name: 'categoria', label: 'Categoría', type: 'select',
      options: ['Una', 'Otra'], optionsRoute: '/lo_que_sea/opciones',
    }],
  };
  assert.equal(opciones.tieneListaPropia(inventado.fields[0]), false, 'manda la ruta, no la lista');
  assert.equal(revisar(inventado, { categoria: 'La que la iglesia acaba de crear' }), null);
});

test('y hoy ningún campo de verdad declara las dos cosas', () => {
  /*
   * Para que la nota de arriba siga siendo cierta: el día que alguien le ponga
   * una lista a un campo que ya saca sus opciones de una ruta, esta prueba lo
   * dice y quien la lea encuentra escrito cuál de las dos manda.
   */
  const dobles = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (f.optionsRoute && Array.isArray(f.options) && f.options.length) dobles.push(`${m.name}.${f.name}`);
    }
  }
  assert.deepEqual(dobles, []);
});

/* ------------------------------- lo que ya estaba */

test('una ficha que ya trae un valor fuera de su lista se sigue pudiendo guardar', () => {
  /*
   * Esto es lo que hace que la comprobación se pueda publicar. Medido sobre los
   * datos de prueba ANTES de escribirla, cuatro campos traían valores fuera de
   * su lista sin que nadie los hubiera inventado: dos pastores con cargo
   * «Pastor» —que la lista no ofrece, porque distingue «Pastora» de «Pastor
   * Presbítero»—, cuentas con el ámbito abreviado, y once anotaciones del
   * Registro de Cambios con acciones que ese módulo escribe por su cuenta.
   *
   * Si se mirara la ficha entera, entrar a corregirle el teléfono a ese pastor
   * daría un reparo por un cargo que él no eligió, y la ficha quedaría
   * imposible de guardar. Se frena el guardado que EMPEORA las cosas, no el que
   * simplemente no arregla algo que ya estaba: la misma regla de las fechas.
   */
  const deAntes = { id: 1, cargo: 'Pastor' };
  assert.equal(revisar(PASTORES, { telefono: '+56 9 1111 2222' }, deAntes), null);

  // Y reenviar el mismo valor tampoco lo frena: es lo que hace la pantalla, que
  // agrega el valor guardado al desplegable marcado «(valor anterior)»
  assert.equal(revisar(PASTORES, { cargo: 'Pastor' }, deAntes), null);

  // Pero corregirlo a otro inventado, sí
  assert.match(revisar(PASTORES, { cargo: 'Obispo' }, deAntes), /no admite "Obispo"/);

  // Y una vez corregido al de la lista, ya no se puede volver atrás
  const corregido = { id: 1, cargo: 'Pastor Presbítero' };
  assert.equal(revisar(PASTORES, { cargo: 'Pastor Presbítero' }, corregido), null);
  assert.match(revisar(PASTORES, { cargo: 'Pastor' }, corregido), /no admite "Pastor"/);
});

/* ------------------------------- que el motor la use, y que las listas se sostengan */

test('el guardado del motor la llama, con el mismo `cambia` de las fechas', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(src, /opciones\.loQueNoEstaEnLaLista\(def, data, cambia\)/);
  assert.match(src, /if \(fueraDeLista\) return res\.status\(400\)/);
});

test('el valor por omisión de cada desplegable está en su propia lista', () => {
  /*
   * Si no lo estuviera, crear una ficha sin tocar ese campo se frenaría sola:
   * el motor pone el valor por omisión y esta misma comprobación lo rechazaría.
   * Se revisa acá para que nadie lo descubra al publicar.
   */
  const malos = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (!opciones.tieneListaPropia(f)) continue;
      if (f.default === undefined || f.default === null || f.default === '') continue;
      if (!opciones.loQueOfrece(f).includes(String(f.default))) malos.push(`${m.name}.${f.name} → ${f.default}`);
    }
  }
  assert.deepEqual(malos, []);
});

test('ningún desplegable declara una lista vacía o con huecos', () => {
  const malos = [];
  for (const m of allModules()) {
    for (const f of m.fields || []) {
      if (f.type !== 'select' || f.optionsRoute) continue;
      const lista = opciones.loQueOfrece(f);
      if (!lista.length) malos.push(`${m.name}.${f.name} sin opciones`);
      if (lista.some((v) => !v.trim())) malos.push(`${m.name}.${f.name} con una opción vacía`);
    }
  }
  assert.deepEqual(malos, []);
});

/* ------------------------------- la otra mitad: las listas que viven en una tabla */

/*
 * De «no se comprueban contra una copia» no se sigue que no haya que
 * comprobarlas: se sigue que hay que comprobarlas CONTRA LA TABLA, que es la
 * única verdad y no una copia de nada. Sin eso, las listas que la iglesia
 * mantiene con más cuidado eran las únicas que nadie hacía cumplir.
 *
 * MEDIDO en la v1.341.0, contra el sistema andando, en la categoría de un
 * movimiento de tesorería:
 *
 *   categoría «Categoría Que No Existe» ....  201, guardado así
 *   categoría en blanco ....................  201, guardado como «Ofrendas»
 *   sin mandar el campo ....................  201, guardado como «Ofrendas»
 */
const { db } = require('../../server/db');

const enSuTabla = (def, data, existing) => {
  const r = opciones.loQueNoEstaEnSuTabla(db, def, data, comoEnCrud(data, existing));
  return { reparo: r, data };
};

const MARCA_T = `t${process.pid}`;
const unaCategoriaLlamada = (nombre) => {
  const ya = db.prepare('SELECT id FROM categorias_tesoreria WHERE lower(nombre) = lower(?)').get(nombre);
  if (ya) return ya.id;
  return db.prepare("INSERT INTO categorias_tesoreria (nombre, tipo, activo) VALUES (?, 'Ambos', 1)")
    .run(nombre).lastInsertRowid;
};

test('la categoría de un movimiento declara contra qué tabla se comprueba', () => {
  const categoria = getModule('tesoreria').fields.find((f) => f.name === 'categoria');
  assert.deepEqual(categoria.opcionesDe,
    { modulo: 'categorias_tesoreria', columna: 'nombre', label: 'Categorías de Tesorería' });
});

test('una categoría que no está en la tabla se rechaza', () => {
  const { reparo } = enSuTabla(getModule('tesoreria'), { categoria: `No existe ${MARCA_T}` });
  assert.match(reparo, /no está en Categorías de Tesorería/);
  assert.match(reparo, /créelo primero/, 'y dice qué hacer');
});

test('una que sí está, pasa', () => {
  const nombre = `Pro-Templo Sede Sur ${MARCA_T}`;
  unaCategoriaLlamada(nombre);
  assert.equal(enSuTabla(getModule('tesoreria'), { categoria: nombre }).reparo, null);
});

test('y se guarda como está escrita en la lista, no como la escribió quien anotó', () => {
  /*
   * Cierra un hueco medido en la misma revisión: se creó «Pro-Templo Sede Sur»,
   * se anotaron $500.000 con «pro-templo sede sur» —que entraba, porque nada se
   * comprobaba— y después la categoría se borró sin problema, porque la cuenta
   * de usos preguntaba por el nombre exacto y no encontraba ninguno.
   */
  const nombre = `Ofrenda de aniversario ${MARCA_T}`;
  unaCategoriaLlamada(nombre);
  const { reparo, data } = enSuTabla(getModule('tesoreria'), { categoria: nombre.toLowerCase() });
  assert.equal(reparo, null, 'se acepta escrita de cualquier forma');
  assert.equal(data.categoria, nombre, 'y se guarda con la forma de la lista');
});

test('vacío no cuenta como valor inventado: de eso se ocupa lo obligatorio', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.equal(enSuTabla(getModule('tesoreria'), { categoria: v }).reparo, null, JSON.stringify(v));
  }
});

test('una desactivada tampoco se admite: existe, pero la iglesia la sacó de circulación', () => {
  /*
   * CAMBIÓ EN LA v1.352.0. Antes bastaba con que existiera en la tabla: una
   * desactivada dejaba de OFRECERSE en el desplegable y se seguía ACEPTANDO
   * por la API, así que desmarcar «En uso» quedaba a medias. Medido en el
   * módulo de Tipos de Actividad: una actividad con un tipo desactivado
   * entraba con un 201.
   *
   * Lo que la desactivación protege —que lo ya anotado no quede huérfano—
   * sigue igual, y lo cuida la prueba de abajo: la comprobación mira solo lo
   * que este guardado está CAMBIANDO.
   */
  const nombre = `Actividades de verano ${MARCA_T}`;
  const id = unaCategoriaLlamada(nombre);
  db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?').run(id);

  const { reparo } = enSuTabla(getModule('tesoreria'), { categoria: nombre });
  assert.match(reparo || '', /ya no está en uso/);
  assert.match(reparo || '', /vuelva a marcarlo «En uso»/, 'y dice cómo deshacerlo');
});

test('pero un movimiento viejo con una categoría ya apagada se sigue pudiendo corregir', () => {
  /*
   * Es el contrapeso de la de arriba, y la razón por la que la comprobación
   * mira solo lo que cambia: un movimiento de marzo clasificado con una
   * categoría que la iglesia apagó en agosto no puede quedar imposible de
   * guardar por algo que quien le corrige el monto no eligió.
   */
  const nombre = `Pro-Templo del verano ${MARCA_T}`;
  const id = unaCategoriaLlamada(nombre);
  db.prepare('UPDATE categorias_tesoreria SET activo = 0 WHERE id = ?').run(id);

  const { reparo } = enSuTabla(
    getModule('tesoreria'),
    { categoria: nombre, monto: 5000 },
    { categoria: nombre, monto: 1000 }
  );
  assert.equal(reparo, null, 'no la está cambiando: le está corrigiendo el monto');
});

test('una tilde no la deja fuera de su propia lista', () => {
  /*
   * El `lower()` de SQLite es solo para la A-Z: deja las tildes como están. Así
   * que «PRO-TEMPLO DEL AÑO» no calzaba con «Pro-Templo del Año» y el sistema
   * contestaba que no estaba en la lista, estando. En español eso no es un
   * detalle: pasa con cualquier nombre con tilde o eñe.
   */
  const nombre = `Reparación del Año ${MARCA_T}`;
  unaCategoriaLlamada(nombre);

  const datos = { categoria: nombre.toUpperCase() };
  assert.equal(enSuTabla(getModule('tesoreria'), datos).reparo, null);
  assert.equal(datos.categoria, nombre, 'y queda escrita como está en la lista');
});

test('lo que este guardado NO está cambiando no se mira', () => {
  /*
   * Un movimiento que ya trae una categoría que no está en la lista se tiene
   * que poder seguir guardando: si no, corregirle el monto sería imposible por
   * algo que quien lo corrige no eligió.
   */
  const vieja = `La que ya no está ${MARCA_T}`;
  const { reparo } = enSuTabla(
    getModule('tesoreria'),
    { categoria: vieja, monto: 5000 },
    { categoria: vieja, monto: 1000 }
  );
  assert.equal(reparo, null);
});

test('un campo sin «opcionesDe» no se mira, y hoy lo declaran dos', () => {
  assert.equal(enSuTabla(AYUDAS, { tipo_ayuda: 'Alimentos' }).reparo, null);

  const cuantos = allModules()
    .flatMap((m) => (m.fields || []).filter((f) => f.opcionesDe).map((f) => `${m.name}.${f.name}`))
    .sort();
  assert.deepEqual(cuantos, ['asistencias.tipo_reunion', 'tesoreria.categoria'],
    'los otros diecisiete se encenderán cuando a cada módulo le toque su revisión');
});

/* ------------------------------- y guardando de verdad, por el motor */

/*
 * Las pruebas de arriba llaman a la comprobación. Ésta pasa por el MOTOR, que
 * es lo único que la persona toca. Se escribió al romper a propósito la llamada
 * en crud.js y ver que no se caía ninguna: la regla estaba escrita, comprobada
 * y sin conectar, que es exactamente el motivo por el que existe `andando.js`.
 */
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

test('guardando de verdad: una categoría que no está en la lista se rechaza', async () => {
  const api = await elSistemaAndando();

  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Central de la categoría ${MARCA_T}`, `IGCAT${String(process.pid).slice(-4)}`).lastInsertRowid;
  const caja = db
    .prepare("INSERT INTO cuentas_tesoreria (nombre, tipo, estado, iglesia_id) VALUES (?, 'Corriente', 'Activa', ?)")
    .run(`Caja de la categoría ${MARCA_T}`, iglesia).lastInsertRowid;

  const unMovimiento = (categoria) => api('POST', '/tesoreria', {
    fecha: db.prepare("SELECT date('now','localtime') d").get().d,
    tipo: 'Ingreso', categoria, concepto: 'La ofrenda del domingo',
    monto: 90000, cuenta_id: caja, metodo: 'Efectivo', iglesia_id: iglesia,
  });

  const inventada = await unMovimiento(`Categoría Que No Existe ${MARCA_T}`);
  assert.equal(inventada.estado, 400, 'antes de esto contestaba 201 y lo guardaba así');
  assert.match(inventada.json.error, /no está en Categorías de Tesorería/);

  const buena = `Ofrenda del domingo ${MARCA_T}`;
  unaCategoriaLlamada(buena);
  const derecho = await unMovimiento(buena);
  assert.equal(derecho.estado, 201, `una que sí está tiene que entrar: ${JSON.stringify(derecho.json)}`);
  assert.equal(derecho.json.categoria, buena);
});

test('guardando de verdad: se guarda como está escrita en la lista', async () => {
  const api = await elSistemaAndando();
  const caja = db.prepare("SELECT id, iglesia_id FROM cuentas_tesoreria WHERE nombre = ?")
    .get(`Caja de la categoría ${MARCA_T}`);
  const buena = `Pro-Templo del norte ${MARCA_T}`;
  unaCategoriaLlamada(buena);

  const r = await api('POST', '/tesoreria', {
    fecha: db.prepare("SELECT date('now','localtime') d").get().d,
    tipo: 'Ingreso', categoria: buena.toLowerCase(), concepto: 'Aporte para el templo',
    monto: 500000, cuenta_id: caja.id, metodo: 'Efectivo', iglesia_id: caja.iglesia_id,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.categoria, buena,
    'con una sola forma de escribirlo, la cuenta de usos que cuida el borrado vuelve a verlo');
});
