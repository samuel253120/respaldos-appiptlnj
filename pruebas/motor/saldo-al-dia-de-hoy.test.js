/**
 * Un saldo es lo que hay hoy en la cuenta, no lo que va a haber.
 *
 * Un servicio sí se puede agendar —está pensado así— y su ofrenda entra a
 * Tesorería con la fecha del servicio, sin pasar por la regla que sí rechaza un
 * movimiento a mano con fecha futura. Medido en una cuenta recién creada: un
 * servicio agendado para junio de 2028 con una ofrenda de $450.000 dejaba el
 * saldo de HOY en $405.000, y con eso el aviso de «esto deja la cuenta en rojo»
 * dejaba pasar sin preguntar un egreso de $300.000 sobre una cuenta vacía.
 *
 * Lo que se vigila acá: el corte en el día de hoy, que sea el MISMO para las
 * cuatro consultas que dicen «saldo», que lo agendado se diga aparte en vez de
 * desaparecer, y que el aviso de rojo mire los dos momentos que importan —el día
 * del movimiento y hoy—, porque con uno solo quedaba un hueco por cada lado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
require('../../server/registry');
const saldos = require('../../server/saldos');
const cuentasMod = require('../../server/modules/cuentas_tesoreria');
const tesoreriaMod = require('../../server/modules/tesoreria');
const { sincronizarOfrenda } = require('../../server/ofrenda-tesoreria');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

const HOY = db.prepare("SELECT date('now','localtime') AS d").get().d;
const corrida = (dias) =>
  db.prepare("SELECT date('now','localtime', ?) AS d").get(`${dias} days`).d;
const MANIANA = corrida(2);
const AYER = corrida(-2);

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Del Mañana YY','TES-MAN','Activa')")
  .run().lastInsertRowid;
const cuenta = (nombre, tipo, saldoInicial = 0) => db
  .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, iglesia_id, estado, saldo_inicial)
            VALUES (?, 'Iglesia local', ?, ?, 'Activa', ?)`)
  .run(nombre, tipo, iglesia, saldoInicial).lastInsertRowid;

const general = cuenta('General del Mañana YY', 'General');
const vacia = cuenta('Vacía del Mañana YY', 'Proyecto / Trabajo');

const anotar = (cuentaId, fecha, tipo, monto, concepto = 'Movimiento YY') =>
  db.prepare(
    `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id)
     VALUES (?, ?, 'Ofrendas', ?, ?, ?, ?)`
  ).run(fecha, tipo, concepto, monto, cuentaId, iglesia).lastInsertRowid;

/* El caso medido: nada en la caja, y una ofrenda agendada para más adelante */
anotar(general, MANIANA, 'Ingreso', 450000, 'Ofrenda de un servicio agendado YY');

/** El saldo tal como lo calcula la ficha de la cuenta (y la columna del listado). */
const saldoDeLaFicha = (cuentaId) => {
  const fila = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  const calc = cuentasMod.computed.find((c) => c.name === 'saldo').calc;
  return calc(fila, { db });
};

/* --------------------------------------------------- el saldo se corta hoy */

test('lo anotado para más adelante no es saldo', () => {
  assert.equal(saldoDeLaFicha(general), 0, 'la caja está vacía: los $450.000 son de 2028');
});

test('y el día que llega, entra solo', () => {
  const id = anotar(general, HOY, 'Ingreso', 7000, 'Lo de hoy YY');
  assert.equal(saldoDeLaFicha(general), 7000);
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id);
});

test('lo de ayer sí cuenta: el corte es hacia adelante, no una ventana', () => {
  const id = anotar(general, AYER, 'Ingreso', 3000, 'Lo de ayer YY');
  assert.equal(saldoDeLaFicha(general), 3000);
  db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id);
});

test('lo agendado se dice aparte, no desaparece', () => {
  const a = saldos.loAgendadoDe(general, db);
  assert.equal(a.neto, 450000);
  assert.equal(a.movimientos, 1);
  assert.equal(a.primera, MANIANA, 'y desde cuándo, para poder decirlo en pantalla');
});

test('una cuenta sin nada agendado dice cero, no nulo', () => {
  const a = saldos.loAgendadoDe(vacia, db);
  assert.equal(a.neto, 0);
  assert.equal(a.movimientos, 0);
});

test('preguntar un saldo sin decir a qué día es preguntarlo a hoy', () => {
  /*
   * `saldoResultante` acepta la fecha del corte, y el aviso de rojo siempre se
   * la pasa. Sin ella el corte tiene que ser hoy igual: si esa rama contara lo
   * de más adelante, un saldo pedido «a secas» diría una cifra distinta de la
   * que muestra la ficha de la misma cuenta.
   */
  const aSecas = saldos.saldoResultante(general, { tipo: 'Egreso', monto: 0 });
  assert.equal(aSecas, saldoDeLaFicha(general), 'la ficha y el helper tienen que decir lo mismo');
  assert.equal(aSecas, 0, 'y ese mismo es cero: los $450.000 son de más adelante');
});

/* ------------------------------------------- el aviso de que queda en rojo */

test('un egreso de hoy no se paga con una ofrenda de 2028', () => {
  const aviso = saldos.avisoSiQuedaEnRojo(general, { tipo: 'Egreso', monto: 300000, fecha: HOY });
  assert.ok(aviso, 'antes se aceptaba sin preguntar: el saldo contaba los $450.000 de más adelante');
  assert.equal(aviso.confirmar, 'saldo_negativo');
  assert.match(aviso.error, /-?\$ ?-?300\.000|300\.000/);
});

test('un egreso fechado más adelante se mira en SU día, no en el de hoy', () => {
  // Ese día ya habrán entrado los $450.000: sacar $100.000 no deja nada en rojo
  const cabe = saldos.avisoSiQuedaEnRojo(general, { tipo: 'Egreso', monto: 100000, fecha: MANIANA });
  assert.equal(cabe, null, 'para esa fecha la plata ya entró');
  // Pero sacar más de lo que habrá, sí
  const noCabe = saldos.avisoSiQuedaEnRojo(general, { tipo: 'Egreso', monto: 900000, fecha: MANIANA });
  assert.ok(noCabe, 'mirando solo el día de hoy este egreso nunca se avisaría');
  assert.match(noCabe.error, /al \d{2}-\d{2}-\d{4}/, 'y se dice de qué día se está hablando');
});

test('un egreso fechado ayer que cabía entonces pero hoy deja la cuenta en rojo, se avisa', () => {
  /*
   * Ayer entraron $500.000 y hoy salieron $480.000: quedan $20.000. Un egreso
   * de $300.000 con fecha de ayer cabía perfectamente ayer —había medio millón—
   * pero deja la cuenta de hoy en rojo. Mirando solo su propia fecha, este caso
   * se escapaba.
   */
  const suyos = [
    anotar(vacia, AYER, 'Ingreso', 500000, 'Lo de ayer YY'),
    anotar(vacia, HOY, 'Egreso', 480000, 'Lo de hoy YY'),
  ];
  const enSuDia = saldos.saldoResultante(vacia, { tipo: 'Egreso', monto: 300000, fecha: AYER, alDia: AYER });
  assert.equal(enSuDia, 200000, 'ese día sobraba');

  const aviso = saldos.avisoSiQuedaEnRojo(vacia, { tipo: 'Egreso', monto: 300000, fecha: AYER });
  assert.ok(aviso, 'cabía ayer, pero hoy la cuenta queda en rojo');
  assert.doesNotMatch(aviso.error, / al \d/, 'el problema es hoy, así que no se nombra otro día');

  suyos.forEach((id) => db.prepare('DELETE FROM tesoreria WHERE id = ?').run(id));
});

test('un ingreso nunca deja nada en rojo', () => {
  assert.equal(saldos.avisoSiQuedaEnRojo(general, { tipo: 'Ingreso', monto: 9000000, fecha: HOY }), null);
});

/* --------------------------------- las cuatro consultas dicen lo mismo */

test('el resumen por cuenta usa el mismo corte, y dice lo agendado en su columna', () => {
  const ruta = rutaDelResumen();
  const r = ruta({ user: { rol: 'Administrador' }, query: {} });
  const suya = r.porCuenta.find((c) => c.id === general);
  assert.equal(suya.saldo, 0, 'el mismo cero que dice la ficha');
  assert.equal(suya.agendado, 450000);
});

test('una cuenta sin ningún movimiento aparece igual, con su saldo inicial', () => {
  const conPlata = cuenta('Con saldo inicial YY', 'Proyecto / Trabajo', 25000);
  const r = rutaDelResumen()({ user: { rol: 'Administrador' }, query: {} });
  const suya = r.porCuenta.find((c) => c.id === conPlata);
  assert.ok(suya, 'una cuenta sin movimientos no puede caerse del listado');
  assert.equal(suya.saldo, 25000);
  assert.equal(suya.agendado, 0, 'sin movimientos, agendado es cero y no nulo');
});

/** Corre la ruta /tesoreria/resumen sin levantar el servidor. */
function rutaDelResumen() {
  let handler = null;
  const router = {
    get(ruta, ...resto) {
      if (ruta === '/tesoreria/resumen') handler = resto[resto.length - 1];
    },
  };
  tesoreriaMod.extraRoutes(router, {
    db,
    requirePerm: () => (req, res, next) => next(),
    scopeClause: () => null,
  });
  assert.ok(handler, 'la ruta del resumen tiene que existir');
  return (req) => {
    let cuerpo = null;
    handler(req, { json: (d) => { cuerpo = d; }, status: () => ({ json: (d) => { cuerpo = d; } }) });
    return cuerpo;
  };
}

/* ------------------------------------------------------------ la pantalla */

test('la pantalla dice lo agendado, y solo cuando lo hay', () => {
  assert.match(app, /Number\(e\.agendado\) \?/);
  assert.match(app, /Number\(c\.agendado\) \?/);
  assert.match(app, /badge agendado/);
  assert.match(app, /lo que hay hoy, no depende del período filtrado/);
});
