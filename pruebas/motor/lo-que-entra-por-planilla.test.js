/**
 * Por la planilla entra lo mismo que por el formulario, y nada más.
 *
 * El motor comprueba, desde la 1.98.1, que un registro no apunte a lo que su
 * autor no alcanza: «no se puede referenciar lo que no se puede ver». Los
 * desplegables del formulario ya ofrecían solo lo alcanzable, así que esa
 * comprobación no cierra ningún camino legítimo; cierra el de escribir el
 * número a mano. La pantalla de Importar escribe números a mano por definición
 * —vienen de una planilla— y no la preguntaba.
 *
 * Medido sobre una tesorera acotada a la Iglesia Central, con plata de sobra en
 * la cuenta de origen para que ninguna otra comprobación tapara el resultado:
 *
 *   traspaso hacia una cuenta de la Iglesia Norte .. formulario 403 · planilla ENTRÓ
 *   traspaso hacia la cuenta de la corporación ..... formulario 403 · planilla ENTRÓ
 *
 * y $ 150.000 aparecieron en cada una de esas dos cuentas ajenas. Por el lado
 * del NIVEL, una tesorera de cuerpo sin la llave «Tesorería de la iglesia y la
 * corporación» le sacó $ 90.000 a la cuenta general de su iglesia por planilla
 * y después no veía el traspaso que acababa de anotar.
 *
 * Son DOS comprobaciones y cada una ve lo que la otra no:
 *
 *   · la de REFERENCIAS mira las fichas que la fila nombra —la cuenta, el
 *     cuerpo, la persona—, y como el alcance de una cuenta ya incluye su
 *     nivel, tapa de paso casi toda la tesorería;
 *   · la de NIVEL mira la fila entera, y atrapa lo que no se alcanza por
 *     ninguna referencia: una cuota de cuerpo lleva su cuerpo en una columna
 *     suelta, no en un campo de referencia, y su nivel es siempre «cuerpo».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const { getModule } = require('../../server/registry');
const { prepararFila } = require('../../server/importar');

const central = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central de la Planilla','IG-PLA-C','Activa')").run().lastInsertRowid;
const norte = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte de la Planilla','IG-PLA-N','Activa')").run().lastInsertRowid;

const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Damas de la Planilla','Cuerpo',?,'Activo')").run(central).lastInsertRowid;

const cuenta = (nombre, iglesiaId, cuerpoId) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial, fecha_apertura)
            VALUES (?, ?, 'Proyecto / Trabajo', ?, ?, 'Activa', 9000000, '2020-01-01')`)
  .run(nombre, cuerpoId ? 'Cuerpo / Grupo' : (iglesiaId ? 'Iglesia local' : 'Corporación'),
       iglesiaId, cuerpoId || null).lastInsertRowid;

const suya      = cuenta('Caja de la Central de la Planilla', central, null);
const otraSuya  = cuenta('Segunda caja de la Central de la Planilla', central, null);
const ajena     = cuenta('Caja de la Norte de la Planilla', norte, null);
const deLaCorp  = cuenta('Caja de la corporación de la Planilla', null, null);
const delCuerpo = cuenta('Caja de las Damas de la Planilla', central, cuerpo);

/** Como el motor los arma: `iglesias` acota a cuáles, `permisos` quita llaves. */
const deLaCentral = { id: 91, rol: 'tesorero', iglesias: [central], cuerpos: [] };
const sinNivelGeneral = { id: 92, rol: 'tesorero', iglesias: [central], cuerpos: [],
  permisos: JSON.stringify({ tesoreria_general: [] }) };
const sinNivelCuerpo = { id: 93, rol: 'tesorero', iglesias: [central], cuerpos: [],
  permisos: JSON.stringify({ tesoreria_cuerpo: [] }) };
const sinAcotar = { id: 94, rol: 'admin', iglesias: [], cuerpos: [] };

const TRASPASOS = getModule('traspasos');
/** Una fila de planilla, como la manda la pantalla de Importar. */
const traspaso = (origen, destino) => ({
  fecha: '2026-05-05', cuenta_origen_id: origen, cuenta_destino_id: destino,
  monto: 150000, forma: 'Transferencia', concepto: 'Aporte de la planilla',
});
const importar = (def, fila, quien) => prepararFila(def, fila, quien).errores;

// ------------------------------------------- lo que la fila nombra ----

test('por planilla no entra un traspaso hacia la cuenta de otra iglesia', () => {
  const errores = importar(TRASPASOS, traspaso(suya, ajena), deLaCentral);
  assert.ok(errores.length, 'antes esta fila entraba con un «1 correcta, 0 con error»');
  assert.ok(errores.some((e) => /Hacia la cuenta/.test(e) && /fuera de lo que tiene asignado/.test(e)),
    `y con el mismo aviso del formulario; dijo: ${JSON.stringify(errores)}`);
});

test('ni sacándola de una cuenta de otra iglesia', () => {
  const errores = importar(TRASPASOS, traspaso(ajena, suya), deLaCentral);
  assert.ok(errores.some((e) => /Desde la cuenta/.test(e)), JSON.stringify(errores));
});

test('ni hacia la cuenta de la corporación, que no es de ninguna iglesia', () => {
  /*
   * Que hoy se rechace es lo correcto para esta puerta —la planilla no puede
   * ser más permisiva que el formulario—, aunque el rechazo en sí sea un
   * problema aparte del módulo de Traspasos: es el caso que ese módulo se pone
   * de ejemplo. Lo que se fija acá es que las dos puertas contesten LO MISMO.
   */
  const porPlanilla = importar(TRASPASOS, traspaso(suya, deLaCorp), deLaCentral);
  assert.ok(porPlanilla.length, 'la planilla lo dejaba entrar y el formulario no');
});

test('lo suyo sigue entrando: la comprobación no cierra ningún camino legítimo', () => {
  assert.deepEqual(importar(TRASPASOS, traspaso(suya, otraSuya), deLaCentral), []);
});

test('y a quien no tiene iglesias acotadas no se le pregunta nada', () => {
  assert.deepEqual(importar(TRASPASOS, traspaso(suya, ajena), sinAcotar), []);
});

test('y por él la comprobación ni siquiera va a la base', () => {
  /*
   * Sin acotar es «todas», así que la respuesta se sabe de antemano: hay una
   * salida temprana en server/crud.js que se va antes de mirar nada.
   *
   * Esa salida es un ATAJO, no la regla: quitándola, la respuesta sigue siendo
   * la misma —`alcance.alcanza` contesta que sí por su cuenta—, así que ninguna
   * prueba de comportamiento la protege. Lo que protege es esto: sin ella, cada
   * fila de una planilla consulta la base una vez por cada campo de referencia
   * que traiga, y una planilla admite cinco mil filas. Se cuenta lo que consulta.
   */
  const { referenciasFueraDeAlcance } = require('../../server/crud');
  const original = db.prepare.bind(db);
  let consultas = 0;
  const contando = (quien) => {
    consultas = 0;
    db.prepare = (sql) => { consultas += 1; return original(sql); };
    try { referenciasFueraDeAlcance(TRASPASOS, traspaso(suya, ajena), quien); }
    finally { db.prepare = original; }
    return consultas;
  };
  // Se mide la comprobación sola y no la fila entera: una fila rechazada se
  // salta el gancho del módulo, que consulta por su cuenta, y ese ahorro no es
  // el que se quiere fijar acá.
  const libre = contando(sinAcotar);
  const acotado = contando(deLaCentral);
  assert.equal(libre, 0, 'sin acotar no hay nada que preguntar: el atajo se va antes de mirar');
  assert.ok(acotado > 0, `acotado sí consulta (${acotado} veces), que es lo que el atajo ahorra`);
});

// ------------------------------------------------- y de qué nivel es ----

test('sin la llave del nivel general, por planilla tampoco se saca de la caja de la iglesia', () => {
  const errores = importar(TRASPASOS, traspaso(suya, delCuerpo), sinNivelGeneral);
  assert.ok(errores.length, 'sacó $ 90.000 de la cuenta general y después no veía el traspaso');
});

test('la comprobación de NIVEL atrapa lo que ninguna referencia alcanza', () => {
  /*
   * Una cuota de cuerpo lleva su cuerpo en una columna suelta —no en un campo
   * de referencia— y su nivel es siempre «cuerpo». La comprobación de
   * referencias no la mira: sin la de nivel, esta fila entraría.
   */
  const CUOTAS = getModule('cuotas_cuerpo');
  const deCuerpo = CUOTAS.fields.find((f) => f.name === 'cuerpo_id');
  assert.notEqual(deCuerpo.type, 'ref', 'si algún día pasa a ser referencia, esta prueba deja de valer');
  assert.equal(require('../../server/tesorerias').LIBROS.cuotas_cuerpo.siempre, 'tesoreria_cuerpo');

  const ficha = db
    .prepare("INSERT INTO integrantes_cuerpo (cuerpo_id, persona, estado, iglesia_id, fecha_ingreso) VALUES (?, 'Una de la Planilla', 'Activo', ?, '2026-01-05')")
    .run(cuerpo, central).lastInsertRowid;
  const fila = { integrante_id: ficha, anio: 2026, mes: '07', monto: 12000, fecha_pago: '2026-07-05' };

  const errores = importar(CUOTAS, fila, sinNivelCuerpo);
  assert.ok(errores.some((e) => /tesorería de los cuerpos/i.test(e)),
    `el formulario contesta «No tiene permiso sobre la tesorería de los cuerpos»; la planilla dijo ${JSON.stringify(errores)}`);
  assert.deepEqual(importar(CUOTAS, fila, deLaCentral), [],
    'y con la llave puesta, la misma fila entra');
});

// --------------------------------------------- dónde está puesto ----

test('las dos comprobaciones son las del formulario, no una copia', () => {
  /*
   * Copiar la regla en el importador es garantizar que un día digan cosas
   * distintas. Se llaman las mismas funciones que llama server/crud.js.
   */
  const texto = fs.readFileSync(path.join(__dirname, '../../server/importar.js'), 'utf8');
  assert.match(texto, /referenciasFueraDeAlcance\(def, datos, user\)/);
  assert.match(texto, /require\('\.\/tesorerias'\)\.alGuardar\(def, datos, user, db\)/);
  const motor = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(motor, /referenciasFueraDeAlcance\(def, data, req\.user\)/,
    'si el motor deja de usarla, este arreglo se queda solo y hay que revisarlo');
});

test('el encabezado del importador nombra el alcance entre lo que comprueba', () => {
  /*
   * Ese encabezado es lo que lee quien vuelva a tocar este archivo, y ya se
   * equivocó una vez: enumeraba todo lo que la planilla comprueba y el alcance
   * no estaba, que es exactamente lo que faltaba.
   */
  const texto = fs.readFileSync(path.join(__dirname, '../../server/importar.js'), 'utf8');
  const cabecera = texto.slice(0, texto.indexOf("const express"));
  assert.match(cabecera, /ALCANCE/);
  assert.match(cabecera, /nivel de tesorería/);
});
