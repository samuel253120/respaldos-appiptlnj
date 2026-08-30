/**
 * Una cuenta cerrada no recibe plata nueva. Por ninguna de las cinco puertas.
 *
 * «Cerrada» significa una cosa concreta: el proyecto terminó, el cuerpo dejó de
 * existir, la cuenta del banco se cerró. De ahí en adelante no entra ni sale
 * nada; lo que ya está anotado se queda y se puede corregir, porque es historia.
 *
 * La regla estaba escrita —bien escrita— en tres archivos y faltaba en los
 * otros dos. Cinco puertas escriben en la tabla `tesoreria`: el movimiento a
 * mano, el traspaso y la ayuda social la tenían; la ofrenda de un servicio y la
 * cuota de un integrante, no.
 *
 * Medido sobre la base de trabajo, con las dos cuentas de una iglesia cerradas:
 * el ingreso escrito a mano se rechazaba con su explicación (400), y un servicio
 * con $ 400.000 de ofrenda se guardaba normal (201) y les metía la plata igual.
 * La tesorería general cerrada pasó de $ 250.000 a $ 610.000; el fondo para la
 * corporación, cerrado y en cero, quedó con $ 40.000; y la cuenta de cuotas de
 * un cuerpo, cerrada con $ 1.000, quedó con $ 4.000. Sin decir una palabra.
 *
 * Una regla copiada en cinco archivos es una regla que va a faltar en el sexto.
 * Ahora vive una vez, en server/cuenta-cerrada.js, y las cinco preguntan.
 *
 * Las dos puertas automáticas avisan DONDE SE ESTÁ TRABAJANDO, no en Tesorería,
 * y de dos maneras distintas a propósito: el servicio PREGUNTA —el culto ocurrió
 * y la asistencia importa; lo que no puede es que la ofrenda se pierda en
 * silencio— y la cuota FRENA, porque una cuota es la plata y registrarla
 * sabiendo que no queda anotada no le sirve a nadie.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const cerrada = require('../../server/cuenta-cerrada');
const cuotas = require('../../server/cuotas');
const { sincronizarOfrenda, avisoSiLaCuentaEstaCerrada } = require('../../server/ofrenda-tesoreria');
const servicios = require('../../server/modules/servicios');
const tesoreriaMod = require('../../server/modules/tesoreria');
const traspasos = require('../../server/modules/traspasos');
const cuotasMod = require('../../server/modules/cuotas_cuerpo');

// ------------------------------------------------------------- la regla sola ----

test('una cuenta cerrada no admite plata nueva; una activa sí; una que no existe, tampoco', () => {
  assert.equal(cerrada.admitePlataNueva({ estado: 'Activa' }), true);
  assert.equal(cerrada.admitePlataNueva({ estado: 'Cerrada' }), false);
  assert.equal(cerrada.admitePlataNueva(null), false);
});

test('el aviso dice cuál es la cuenta y qué era lo que no se puede', () => {
  const caja = { nombre: 'Proyecto templo', estado: 'Cerrada' };
  assert.equal(cerrada.avisoSiEstaCerrada(caja), 'La cuenta "Proyecto templo" está cerrada: no admite nuevos movimientos');
  assert.equal(cerrada.avisoSiEstaCerrada(caja, 'sale'), 'La cuenta "Proyecto templo" está cerrada: no puede salir dinero de ella');
  assert.equal(cerrada.avisoSiEstaCerrada(caja, 'entra'), 'La cuenta "Proyecto templo" está cerrada: no puede entrar dinero en ella');
  assert.equal(cerrada.avisoSiEstaCerrada({ nombre: 'Otra', estado: 'Activa' }), null);
  assert.equal(cerrada.avisoSiEstaCerrada(null), null, 'una cuenta que no existe es otro problema y lo dice quien la fue a buscar');
});

test('un lado en cero no avisa nada: no iba a escribir', () => {
  const caja = { id: 7, nombre: 'Cerrada', estado: 'Cerrada' };
  assert.deepEqual(cerrada.lasCerradasDe([{ cuenta: caja, monto: 0 }]), []);
  assert.deepEqual(cerrada.lasCerradasDe([{ cuenta: caja, monto: 100 }]), [caja]);
  assert.equal(cerrada.lasCerradasDe([{ cuenta: caja, monto: 100 }, { cuenta: caja, monto: 50 }]).length, 1,
    'la misma cuenta dos veces se nombra una');
  assert.equal(cerrada.nombradas([{ nombre: 'A' }]), '«A»');
  assert.equal(cerrada.nombradas([{ nombre: 'A' }, { nombre: 'B' }]), '«A» y «B»');
});

// ------------------------------------------------------------------ el mundo ----

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De lo Cerrado','IG-CERR','Activa')").run().lastInsertRowid;
const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual) VALUES ('Damas de lo Cerrado','Cuerpo',?,'Activo',1,3000)").run(iglesia).lastInsertRowid;
const abrir = (nombre, ambito, tipo, iglesiaId, cuerpoId, saldo = 0) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, cuerpo_id, estado, saldo_inicial)
            VALUES (?,?,?,?,?,'Activa',?)`)
  .run(nombre, ambito, tipo, iglesiaId, cuerpoId, saldo).lastInsertRowid;

const general = abrir('General de lo Cerrado', 'Iglesia local', 'General', iglesia, null, 250000);
const fondo = abrir('Fondo de lo Cerrado', 'Iglesia local', 'Fondo para la corporación', iglesia, null);
const deCuotas = abrir('Cuotas de las Damas de lo Cerrado', 'Cuerpo / Grupo', 'Cuotas de integrantes', iglesia, cuerpo, 1000);
const otraViva = abrir('Proyecto vivo de lo Cerrado', 'Iglesia local', 'Proyecto / Trabajo', iglesia, null);

const integrante = db
  .prepare("INSERT INTO integrantes_cuerpo (cuerpo_id, persona, estado, iglesia_id) VALUES (?, 'Rosa de lo Cerrado', 'Activo', ?)")
  .run(cuerpo, iglesia).lastInsertRowid;

const cerrar = (id) => db.prepare("UPDATE cuentas_tesoreria SET estado = 'Cerrada' WHERE id = ?").run(id);
const reabrir = (id) => db.prepare("UPDATE cuentas_tesoreria SET estado = 'Activa' WHERE id = ?").run(id);
const saldoDe = (id) => {
  const c = db.prepare('SELECT saldo_inicial FROM cuentas_tesoreria WHERE id = ?').get(id);
  const m = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE -monto END),0) AS s
                          FROM tesoreria WHERE cuenta_id = ?`).get(id);
  return (Number(c.saldo_inicial) || 0) + Number(m.s);
};

const usuario = { id: 1, rol: 'admin' };

// ------------------------------------------------- las tres que ya la tenían ----

test('el movimiento escrito a mano en Tesorería se rechaza, y el suyo se corrige', () => {
  cerrar(general);
  const nuevo = tesoreriaMod.hooks.beforeSave(
    { cuenta_id: general, fecha: '2026-05-01', tipo: 'Ingreso', monto: 1000, concepto: 'A mano' },
    { isNew: true, existing: null, db, user: usuario, confirmado: true }
  );
  assert.match(String(nuevo), /está cerrada: no admite nuevos movimientos/);

  // El suyo, el que ya estaba anotado ahí, se sigue corrigiendo
  const suyo = tesoreriaMod.hooks.beforeSave(
    { monto: 2000 },
    { isNew: false, existing: { id: 5, cuenta_id: general, fecha: '2026-05-01', tipo: 'Ingreso', monto: 1000, concepto: 'A mano' },
      db, user: usuario, confirmado: true }
  );
  assert.equal(suyo, null, 'lo que ya está anotado es historia y se corrige');
  reabrir(general);
});

test('de un traspaso se dice por qué lado está cerrada la cuenta', () => {
  cerrar(general);
  const desde = traspasos.hooks.beforeSave(
    { cuenta_origen_id: general, cuenta_destino_id: otraViva, monto: 1000, fecha: '2026-05-01', concepto: 'X', forma: 'Transferencia' },
    { isNew: true, existing: null, db, user: usuario, confirmado: true }
  );
  assert.match(String(desde), /no puede salir dinero de ella/);
  const hacia = traspasos.hooks.beforeSave(
    { cuenta_origen_id: otraViva, cuenta_destino_id: general, monto: 1000, fecha: '2026-05-01', concepto: 'X', forma: 'Transferencia' },
    { isNew: true, existing: null, db, user: usuario, confirmado: true }
  );
  assert.match(String(hacia), /no puede entrar dinero en ella/);
  reabrir(general);
});

test('la ayuda social que sale de una cuenta cerrada tampoco', () => {
  cerrar(general);
  const puente = require('../../server/ayuda-tesoreria');
  const problema = puente.revisarDeDondeSalio(
    // Con su iglesia puesta: antes que el estado de la cuenta se comprueba que
    // sea de la iglesia de esta ayuda, y sin ese dato se caía en esa otra regla
    { salida: puente.DE_UNA_CUENTA, cuenta_id: general, iglesia_id: iglesia, valor_estimado: 5000, estado: 'Entregada' },
    { user: usuario, existing: null, db }
  );
  assert.match(String(problema), /está cerrada: no admite nuevos movimientos/);
  reabrir(general);
});

// --------------------------------------------------- la ofrenda de un servicio ----

/** Un servicio como lo guarda el módulo, ya con su aporte calculado. */
const unServicio = (extra = {}) => ({
  id: 900001, fecha: '2026-05-03', tipo: 'Servicio General', iglesia_id: iglesia,
  ofrenda_total: 400000, ofrenda_transferencia: 0, ofrenda_porcentaje: 10, ofrenda_fondo: 40000,
  ...extra,
});

test('con las dos cuentas cerradas, la ofrenda no entra en ninguna', () => {
  cerrar(general); cerrar(fondo);
  const antes = [saldoDe(general), saldoDe(fondo)];
  sincronizarOfrenda(unServicio(), db);
  assert.deepEqual([saldoDe(general), saldoDe(fondo)], antes, 'ni un peso');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE servicio_id = ?').get(900001).c, 0,
    'y no queda ningún movimiento colgando'
  );
  reabrir(general); reabrir(fondo);
});

test('y el servicio pregunta antes de guardarse, nombrando las dos cuentas', () => {
  cerrar(general); cerrar(fondo);
  const aviso = avisoSiLaCuentaEstaCerrada(unServicio({ id: undefined }), db, false);
  assert.ok(aviso, 'quien registra el culto no tiene por qué ir a mirar Tesorería para enterarse');
  assert.equal(aviso.confirmar, 'ofrenda_sin_cuenta');
  assert.match(aviso.error, /«General de lo Cerrado» y «Fondo de lo Cerrado»/);
  assert.match(aviso.error, /no va a quedar anotada en Tesorería/);
  assert.match(aviso.error, /el servicio se guarda igual/, 'se pregunta, no se bloquea');

  assert.equal(avisoSiLaCuentaEstaCerrada(unServicio({ id: undefined }), db, true), null,
    'confirmado, no se vuelve a preguntar');
  reabrir(general); reabrir(fondo);
  assert.equal(avisoSiLaCuentaEstaCerrada(unServicio({ id: undefined }), db, false), null,
    'con las cuentas abiertas no hay nada que preguntar');
});

test('un servicio cuyos movimientos YA existen no vuelve a preguntar', () => {
  /*
   * La cuenta se cerró después de que el servicio quedara anotado. Sus
   * movimientos existen y se van a corregir, no a crear: preguntarle a quien
   * solo le está cambiando la hora al culto que «la ofrenda no va a quedar
   * anotada» sería mentira, y la mentira que más molesta: la que sale cada vez
   * que se guarda.
   */
  cerrar(general); cerrar(fondo);
  const yaAnotados = unServicio({
    id: undefined,
    movimiento_iglesia_id: 555001, movimiento_transferencia_id: 555002,
    movimiento_aporte_id: 555003, movimiento_fondo_id: 555004,
  });
  assert.equal(avisoSiLaCuentaEstaCerrada(yaAnotados, db), null);
  // Y si le falta uno solo —el del fondo—, se pregunta por ese y nada más
  const leFaltaUno = unServicio({
    id: undefined,
    movimiento_iglesia_id: 555001, movimiento_transferencia_id: 555002,
    movimiento_aporte_id: 555003,
  });
  const aviso = avisoSiLaCuentaEstaCerrada(leFaltaUno, db);
  assert.ok(aviso);
  assert.match(aviso.error, /La cuenta «Fondo de lo Cerrado»/);
  assert.doesNotMatch(aviso.error, /General de lo Cerrado/, 'esa ya está anotada');
  reabrir(general); reabrir(fondo);
});

test('una ofrenda en cero no pregunta nada: no iba a escribir', () => {
  cerrar(general); cerrar(fondo);
  assert.equal(
    avisoSiLaCuentaEstaCerrada(unServicio({ id: undefined, ofrenda_total: 0, ofrenda_fondo: 0 }), db, false),
    null
  );
  reabrir(general); reabrir(fondo);
});

test('reabiertas, volver a guardar el servicio deja la plata donde corresponde', () => {
  const antesGeneral = saldoDe(general);
  const antesFondo = saldoDe(fondo);
  sincronizarOfrenda(unServicio(), db);
  assert.equal(saldoDe(general), antesGeneral + 400000 - 40000, 'entró la ofrenda y salió el aporte');
  assert.equal(saldoDe(fondo), antesFondo + 40000);
  db.prepare('DELETE FROM tesoreria WHERE servicio_id = ?').run(900001);
});

test('el módulo de Servicios hace la pregunta, y la hace temprano', () => {
  cerrar(general); cerrar(fondo);
  const r = servicios.hooks.beforeSave(
    { fecha: '2026-06-07', tipo: 'Servicio General', iglesia_id: iglesia,
      ofrenda_total: 400000, ofrenda_porcentaje: 10, ofrenda_fondo: 40000 },
    { existing: null, confirmado: false, db, id: null }
  );
  assert.equal(r && r.confirmar, 'ofrenda_sin_cuenta');
  reabrir(general); reabrir(fondo);
});

// ------------------------------------------------- la cuota de un integrante ----

test('la cuota se frena: una cuota ES la plata', () => {
  cerrar(deCuotas);
  const antes = saldoDe(deCuotas);
  const r = cuotas.registrarPago(db, { integranteId: integrante, anio: 2026, mes: '07' });
  assert.ok(r.error, 'registrarla sabiendo que no queda anotada no le sirve a nadie');
  assert.match(r.error, /está cerrada/);
  assert.match(r.error, /Reábrala para poder registrar cuotas/, 'y se dice qué hacer');
  assert.equal(saldoDe(deCuotas), antes, 'ni un peso');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM cuotas_cuerpo WHERE integrante_id = ?').get(integrante).c, 0,
    'y tampoco queda la cuota sin su movimiento');
  reabrir(deCuotas);
});

test('y también cuando se anota a mano desde el módulo de Cuotas', () => {
  cerrar(deCuotas);
  const r = cuotasMod.hooks.beforeSave(
    { integrante_id: integrante, anio: 2026, mes: '08', monto: 3000 },
    { existing: null, id: null, db }
  );
  assert.match(String(r), /está cerrada/);
  reabrir(deCuotas);
});

test('con la cuenta abierta la cuota entra, y su movimiento se corrige aunque después se cierre', () => {
  const antes = saldoDe(deCuotas);
  const r = cuotas.registrarPago(db, { integranteId: integrante, anio: 2026, mes: '09', monto: 3000 });
  assert.ok(r.cuota, r.error);
  assert.equal(saldoDe(deCuotas), antes + 3000);

  // Ahora se cierra: lo suyo se sigue corrigiendo
  cerrar(deCuotas);
  const fila = db.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(r.cuota.id);
  cuotas.sincronizarConLaTesoreria({ ...fila, monto: 5000 }, db);
  assert.equal(saldoDe(deCuotas), antes + 5000, 'lo que ya está anotado es historia y se corrige');
  reabrir(deCuotas);
  cuotas.borrarPago(db, r.cuota.id);
});

test('corregir una cuota vieja no le crea un movimiento en la cuenta ya cerrada', () => {
  /*
   * Las dos puertas de entrada frenan antes de llegar al puente, así que este
   * caso llega por el único camino que queda: EDITAR una cuota que ya estaba
   * anotada sin movimiento —porque el registro estaba apagado cuando se
   * registró— en una cuenta que después se cerró. El puente se llama igual, y
   * ahí tiene que frenar él.
   */
  const info = db
    .prepare(`INSERT INTO cuotas_cuerpo (integrante_id, anio, mes, monto, fecha_pago, metodo, cuerpo_id, iglesia_id)
              VALUES (?, 2026, '11', 3000, '2026-11-05', 'Efectivo', ?, ?)`)
    .run(integrante, cuerpo, iglesia);
  const fila = db.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(info.lastInsertRowid);
  assert.equal(fila.movimiento_id, null, 'quedó sin movimiento, como pasa con el registro apagado');

  cerrar(deCuotas);
  const antes = saldoDe(deCuotas);
  cuotas.sincronizarConLaTesoreria(fila, db);
  assert.equal(saldoDe(deCuotas), antes, 'el puente no le abre un movimiento a una cuenta cerrada');
  assert.equal(
    db.prepare('SELECT movimiento_id FROM cuotas_cuerpo WHERE id = ?').get(fila.id).movimiento_id, null
  );
  reabrir(deCuotas);
  db.prepare('DELETE FROM cuotas_cuerpo WHERE id = ?').run(fila.id);
});

test('el registro APAGADO en Configuración no es lo mismo que una cuenta cerrada', () => {
  /*
   * La opción se apaga y se devuelve dentro de esta misma prueba, sin nada
   * asíncrono en medio: las pruebas del motor comparten UNA base y corren en
   * paralelo, así que una opción global apagada un rato es un fallo que
   * aparece en otro archivo y en otra corrida. Ninguna otra prueba lee esta
   * opción hoy, y aun así se devuelve enseguida.
   */
  const ajustes = require('../../server/ajustes');
  cerrar(deCuotas);
  ajustes.guardar('cuota_registra_tesoreria', 0);
  const apagado = cuotas.avisoSiLaCuentaEstaCerrada(cuerpo, db);
  ajustes.guardar('cuota_registra_tesoreria', 1);
  const encendido = cuotas.avisoSiLaCuentaEstaCerrada(cuerpo, db);
  reabrir(deCuotas);

  assert.equal(apagado, null,
    'apagarlo es una decisión que alguien tomó; una cuenta cerrada es un accidente');
  assert.ok(encendido, 'encendido, la cuenta cerrada sí frena');
});

test('un cuerpo sin cuenta de cuotas tampoco avisa: eso es otro problema', () => {
  const suelto = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual) VALUES ('Sin caja de lo Cerrado','Grupo',?,'Activo',1,2000)")
    .run(iglesia).lastInsertRowid;
  db.prepare('DELETE FROM cuentas_tesoreria WHERE cuerpo_id = ?').run(suelto);
  assert.equal(cuotas.avisoSiLaCuentaEstaCerrada(suelto, db), null);
});

// --------------------------------------------------- y vive en un solo lugar ----

test('ninguna de las cinco puertas se escribe la regla por su cuenta', () => {
  const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const puertas = [
    'server/modules/tesoreria.js', 'server/modules/traspasos.js',
    'server/ayuda-tesoreria.js', 'server/ofrenda-tesoreria.js', 'server/cuotas.js',
  ];
  for (const cual of puertas) {
    const texto = sinComentarios(fs.readFileSync(path.join(__dirname, '../../', cual), 'utf8'));
    assert.doesNotMatch(texto, /estado === 'Cerrada'/,
      `${cual} vuelve a escribirse la regla: una regla copiada en cinco archivos falta en el sexto`);
    assert.match(texto, /cuenta-cerrada/, `${cual} tiene que preguntarle a server/cuenta-cerrada.js`);
  }
});
