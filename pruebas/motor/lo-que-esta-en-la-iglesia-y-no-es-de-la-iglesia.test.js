/**
 * Lo que está en la iglesia y no es de la iglesia.
 *
 * En el templo hay cosas que no son de la organización y que igual tienen que
 * estar inventariadas: lo que un hermano PRESTA —y hay que devolverle— y lo que
 * DEJA EN DEPÓSITO, guardado bajo su propia responsabilidad, sin que la iglesia
 * responda por daño, deterioro ni pérdida.
 *
 * Antes de esto no había dónde anotarlo. Medido sobre el módulo: doce campos, y
 * ninguno decía de quién es la cosa. Se sembraron cinco artículos escribiendo
 * la explicación en «Notas», que es como habría que hacerlo, y en el listado
 * los cinco se veían iguales: el amplificador prestado y la batería en depósito
 * tenían la misma cara que las bancas compradas por la iglesia. Y buscar
 * tampoco resolvía: se buscó «prestado» y salieron CERO resultados, porque en
 * la nota decía «lo prestó».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry');
const inventarios = require('../../server/modules/inventarios');
const ajenos = require('../../server/bienes-ajenos');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De los Bienes','IG-BIE','Activa')")
  .run().lastInsertRowid;

const admin = { id: 1, rol: 'admin', iglesias: [], cuerpos: [] };
/** Corre el gancho como lo corre el motor, y devuelve [aviso, datos]. */
const guardar = (datos, { existing = null, confirmado = false } = {}) => {
  const data = { ...datos };
  const aviso = inventarios.hooks.beforeSave(data,
    { user: admin, existing, db, isNew: !existing, id: null, confirmado });
  return [aviso, data];
};
/** Lo mínimo de un artículo, para no repetirlo en cada prueba. */
let n = 0;
const bien = (cambios = {}) => ({
  articulo: `Artículo ${++n} de los Bienes`, ambito: 'Iglesia local', iglesia_id: iglesia,
  cantidad: 1, regimen: 'Propio', ...cambios,
});

// ------------------------------------------------- los tres regímenes ----

test('lo propio se anota como siempre, sin pedir nada más', () => {
  const [aviso] = guardar(bien());
  assert.equal(aviso, null, 'quien inventaría lo corriente no tiene que notar ningún cambio');
});

test('y es el valor de fábrica: el régimen no se elige para lo de siempre', () => {
  const campo = inventarios.fields.find((f) => f.name === 'regimen');
  assert.equal(campo.default, 'Propio');
  assert.deepEqual(campo.options, ['Propio', 'Prestado', 'En depósito']);
  assert.equal(campo.required, true);
});

test('un bien prestado necesita decir de quién es', () => {
  const [sinDueno] = guardar(bien({ regimen: 'Prestado' }));
  assert.match(String(sinDueno), /de quién es/i);
  assert.match(String(sinDueno), /devolvérselo/i, 'y por qué hace falta saberlo');

  const [conDueno] = guardar(bien({ regimen: 'Prestado', dueno: 'Juan Pérez' }));
  assert.equal(conDueno, null);
});

test('un bien en depósito también', () => {
  const [aviso] = guardar(bien({ regimen: 'En depósito', deslinde_aceptado: 1 }));
  assert.match(String(aviso), /de quién es/i);
});

test('un régimen que no es ninguno de los tres no se guarda', () => {
  for (const raro of ['Arrendado', '', null, 'propio']) {
    const [aviso] = guardar(bien({ regimen: raro }));
    assert.match(String(aviso), /régimen del bien/i, `«${raro}» no debería pasar`);
  }
});

// ------------------------------------ el deslinde: se pregunta, no se prohíbe ----

test('un depósito sin la firma del dueño PREGUNTA, y dice qué falta', () => {
  const [aviso] = guardar(bien({ regimen: 'En depósito', dueno: 'Carlos Soto' }));
  assert.equal(aviso && aviso.confirmar, 'deposito_sin_deslinde');
  assert.match(aviso.error, /Carlos Soto/, 'nombra al dueño');
  assert.match(aviso.error, /no tiene nada por escrito/i, 'y dice qué se está perdiendo');
  assert.match(aviso.error, /firmar/i, 'y cuál es la salida');
});

test('contestada la pregunta, el depósito se guarda', () => {
  const [aviso] = guardar(bien({ regimen: 'En depósito', dueno: 'Carlos Soto' }), { confirmado: true });
  assert.equal(aviso, null,
    'la cosa ya está en el templo: prohibir anotarla obliga a mentir en el régimen o a no anotarla');
});

test('y con la firma marcada no pregunta nada', () => {
  const [aviso] = guardar(bien({ regimen: 'En depósito', dueno: 'Carlos Soto', deslinde_aceptado: 1 }));
  assert.equal(aviso, null);
});

test('un préstamo NO lleva deslinde: ahí la iglesia sí responde', () => {
  const [aviso, data] = guardar(bien({ regimen: 'Prestado', dueno: 'Juan Pérez', deslinde_aceptado: 1, deslinde_fecha: '2026-01-01' }));
  assert.equal(aviso, null, 'no se pregunta por una cláusula que no le corresponde');
  assert.equal(data.deslinde_aceptado, 0, 'y no se queda escrita, porque no se firmó ninguna');
  assert.equal(data.deslinde_fecha, null);
});

// ------------------------------------------------------ las fechas ----

/*
 * Las fechas NO las comprueba el módulo: las comprueba el motor, con lo que
 * los campos declaran. Acá estuvieron escritas a mano un rato y era una regla
 * copiada en dos archivos. Se prueba la declaración y la regla del motor, que
 * es lo que de verdad corre.
 */
const fechas = require('../../server/fechas');
const def = () => require('../../server/registry').getModule('inventarios');
const campo = (n2) => def().fields.find((f) => f.name === n2);

test('la devolución comprometida es futura, y el motor tiene que admitirlo', () => {
  /*
   * Se descubrió probando en el sistema andando: anotar un préstamo a devolver
   * el 15-09-2026 contestaba «dice 15-09-2026, que todavía no llega. Revise el
   * año: acá se anota lo que ya ocurrió». Un plazo de devolución que no puede
   * estar en el futuro no es un plazo.
   */
  assert.equal(campo('fecha_devolucion').futuro, true);
  const dentroDeUnAnio = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  assert.equal(fechas.revisar(campo('fecha_devolucion'), dentroDeUnAnio), null);
});

test('pero la fecha en que se devolvió no: eso ya pasó', () => {
  assert.ok(!campo('fecha_devuelto').futuro);
  const manana = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  assert.match(String(fechas.revisar(campo('fecha_devuelto'), manana)), /todavía no llega/);
});

test('ninguna de las dos puede caer antes de que el artículo llegara', () => {
  assert.equal(campo('fecha_devolucion').noAntesDe, 'fecha_recepcion');
  assert.equal(campo('fecha_devuelto').noAntesDe, 'fecha_recepcion');

  const alReves = fechas.revisarCoherencia(def(),
    { fecha_recepcion: '2026-03-10', fecha_devolucion: '2026-03-01' }, null);
  assert.match(String(alReves), /01-03-2026/, 'dice las dos fechas como se leen acá');
  assert.match(String(alReves), /10-03-2026/);

  const devueltoAntes = fechas.revisarCoherencia(def(),
    { fecha_recepcion: '2026-03-10', fecha_devuelto: '2026-02-01' }, null);
  assert.match(String(devueltoAntes), /01-02-2026/);
});

test('y las mismas fechas en orden pasan', () => {
  assert.equal(fechas.revisarCoherencia(def(),
    { fecha_recepcion: '2026-03-01', fecha_devolucion: '2026-03-10', fecha_devuelto: '2026-03-09' }, null), null);
  const [aviso] = guardar(bien({
    regimen: 'Prestado', dueno: 'Juan Pérez',
    fecha_recepcion: '2026-03-01', fecha_devolucion: '2026-03-10', fecha_devuelto: '2026-03-09',
  }));
  assert.equal(aviso, null);
});

test('un préstamo sin plazo es legítimo y no se frena', () => {
  const [aviso] = guardar(bien({ regimen: 'Prestado', dueno: 'Juan Pérez', fecha_recepcion: '2026-03-01' }));
  assert.equal(aviso, null, '«hasta que lo pida» es un préstamo de verdad');
});

// ------------------------------ volver a lo propio limpia lo del dueño ----

test('lo que pasa a ser de la iglesia suelta al dueño y sus fechas', () => {
  /*
   * El hermano terminó donándolo. Si el nombre del dueño y la fecha de
   * devolución se quedan pegados, el registro dice dos cosas a la vez, y la que
   * sale en el papel es la vieja.
   */
  const existing = {
    articulo: 'Amplificador', ambito: 'Iglesia local', iglesia_id: iglesia, cantidad: 1,
    regimen: 'Prestado', dueno: 'Juan Pérez', dueno_id: 7, dueno_contacto: '+56 9 1234 5678',
    fecha_recepcion: '2026-03-01', fecha_devolucion: '2026-06-01',
    deslinde_aceptado: 1, deslinde_fecha: '2026-03-01',
    documento_tenencia: 'prestamo.pdf', fecha_devuelto: null,
  };
  const [aviso, data] = guardar({ regimen: 'Propio' }, { existing });
  assert.equal(aviso, null);
  for (const campo of ajenos.LO_DEL_DUENO) {
    assert.equal(data[campo], null, `«${campo}» tendría que quedar en blanco`);
  }
});

test('y corregirle el nombre a un bien prestado no le toca nada del dueño', () => {
  const existing = {
    articulo: 'Amplificador', ambito: 'Iglesia local', iglesia_id: iglesia, cantidad: 1,
    regimen: 'Prestado', dueno: 'Juan Pérez', fecha_recepcion: '2026-03-01',
  };
  const [aviso, data] = guardar({ articulo: 'Amplificador Marshall' }, { existing });
  assert.equal(aviso, null);
  assert.equal(data.dueno, undefined, 'no se reescribe lo que el guardado no trae');
});

// --------------------------------------------- lo que se ve sin abrir ----

test('el régimen se ve en el listado y se filtra por él', () => {
  const { getModule } = require('../../server/registry');
  const def = getModule('inventarios');
  assert.ok(def.listFields.includes('regimen'),
    'los cinco artículos de la medición se veían iguales justamente por esto');
  assert.ok(def.filterFields.includes('regimen'), '«muéstrame todo lo prestado»');
  assert.ok(def.searchFields.includes('dueno'), 'y se encuentra por el nombre de su dueño');
});

test('el dueño se pide donde hace falta y en ninguna otra parte', () => {
  const { getModule } = require('../../server/registry');
  const campo = (n2) => getModule('inventarios').fields.find((f) => f.name === n2);
  const ajeno = { field: 'regimen', in: ['Prestado', 'En depósito'] };

  assert.deepEqual(campo('dueno').showIf, ajeno);
  assert.deepEqual(campo('dueno_contacto').showIf, ajeno);
  assert.deepEqual(campo('fecha_recepcion').showIf, ajeno);
  assert.deepEqual(campo('documento_tenencia').showIf, ajeno);
  assert.deepEqual(campo('fecha_devuelto').showIf, ajeno);
  // El plazo es del préstamo; el deslinde, del depósito
  assert.deepEqual(campo('fecha_devolucion').showIf, { field: 'regimen', equals: 'Prestado' });
  assert.deepEqual(campo('deslinde_aceptado').showIf, { field: 'regimen', equals: 'En depósito' });
});

test('el dueño puede ser alguien que no está en la membresía', () => {
  const campo = inventarios.fields.find((f) => f.name === 'dueno');
  assert.equal(campo.type, 'persona',
    'un campo de persona enlaza a la ficha cuando existe y admite un nombre escrito cuando no');
});

test('y el artículo se puede imprimir, que es de lo que se trata', () => {
  const { getModule } = require('../../server/registry');
  assert.equal(getModule('inventarios').printable, true);
});

// ------------------------------------ la cláusula la escribe la corporación ----

test('la cláusula del depósito vive en Configuración, no en el código', () => {
  const ajustes = require('../../server/ajustes');
  const item = ajustes.POR_CLAVE['inventario_clausula_deposito'];
  assert.ok(item, 'no está la opción');
  assert.equal(item.tipo, 'textarea');
  assert.match(item.defecto, /NO ASUME RESPONSABILIDAD/,
    'el texto de fábrica tiene que decir lo que se pidió que dijera');
  assert.match(item.defecto, /daño, deterioro, destrucción, robo o pérdida/);
});

test('y no se aplica a lo prestado, donde la iglesia sí responde', () => {
  const ajustes = require('../../server/ajustes');
  assert.match(ajustes.POR_CLAVE['inventario_clausula_deposito'].ayuda, /No se aplica a lo PRESTADO/);
});
