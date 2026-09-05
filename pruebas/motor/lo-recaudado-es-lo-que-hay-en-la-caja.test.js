/**
 * «RECAUDADO $ 20.000» CON $ 30.000 EN LA CAJA.
 *
 * La planilla de cuotas de un cuerpo dibuja una fila por integrante VIGENTE:
 * a quien se fue no se le cobra, así que su fila no tiene para qué estar. Pero
 * el «recaudado» de la cabecera sumaba solo las filas que alcanzaba a dibujar,
 * y las cuotas que esa persona pagó cuando sí estaba siguen en la caja del
 * cuerpo.
 *
 * MEDIDO en la v1.410.0, sobre un cuerpo con tres integrantes que pagaron dos
 * meses de $ 5.000 cada uno, y uno de ellos retirado DESPUÉS de pagarlos:
 *
 *   filas que dibuja la planilla ....   2   (de 3 personas que pagaron)
 *   «recaudado» decía ...............   $ 20.000
 *   la caja de cuotas tenía .........   $ 30.000
 *   las cuotas del año suman ........   $ 30.000
 *
 * Esa es la única pantalla donde se miran las cuotas de un cuerpo. Quien la
 * abriera veía un total que no era el de su caja y no tenía desde ahí ninguna
 * manera de averiguar de dónde salía la diferencia.
 *
 * Dos cosas hacían falta, y ninguna sola alcanza: que el total sea el total, y
 * que la pantalla pueda decir cuánto de él es de gente que ya no está. Con solo
 * lo primero el número cuadra con la caja y deja de cuadrar con la tabla que se
 * está mirando, que es cambiar una pregunta sin respuesta por otra.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central RE ${marca}`, `RE-${marca}`).lastInsertRowid;

function unCuerpo() {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, 5000)`
  ).run(`Damas ${++n} RE ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} RE ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga RE ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado, fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga RE ${marca}`, iglesia).lastInsertRowid;
}

const seRetira = (ficha) => db.prepare(
  "UPDATE integrantes_cuerpo SET estado = 'Retirado', fecha_retiro = '2026-08-01' WHERE id = ?"
).run(ficha);

const enLaCaja = (cuerpo) => db.prepare(
  "SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE cuerpo_id = ? AND tipo = 'Ingreso'"
).get(cuerpo).t;

/** Dos meses pagados por cada uno, con la persona todavía en el cuerpo. */
async function unCuerpoQuePago(api, cuantos) {
  const cuerpo = unCuerpo();
  const fichas = [];
  for (let i = 0; i < cuantos; i++) {
    const f = unaFicha(cuerpo);
    fichas.push(f);
    for (const mes of ['06', '07']) {
      const r = await api('POST', '/cuotas_cuerpo',
        { integrante_id: f, anio: 2026, mes, monto: 5000, fecha_pago: `2026-${mes}-05` });
      assert.equal(r.estado, 201, r.texto);
    }
  }
  return { cuerpo, fichas };
}

test('lo recaudado es lo que hay en la caja, aunque quien pagó ya no esté', async () => {
  const api = await elSistemaAndando();
  const { cuerpo, fichas } = await unCuerpoQuePago(api, 3);
  seRetira(fichas[2]);

  const r = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2026`);
  assert.equal(r.estado, 200, r.texto);

  assert.equal(r.json.filas.length, 2, 'a quien se fue no se le cobra: su fila no se dibuja');
  assert.equal(enLaCaja(cuerpo), 30000, 'la plata que entró de verdad');
  assert.equal(r.json.total_recaudado, 30000, 'antes de esto decía $ 20.000');

  const dibujado = r.json.filas.reduce((t, f) => t + f.total, 0);
  assert.equal(dibujado, 20000, 'la suma de lo que se ve sigue siendo menos, y por eso hay que explicarla');
});

test('y dice cuánto de eso es de gente que ya no está: la plata, las cuotas y las personas', async () => {
  const api = await elSistemaAndando();
  const { cuerpo, fichas } = await unCuerpoQuePago(api, 4);
  seRetira(fichas[2]);
  seRetira(fichas[3]);

  const r = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2026`);
  assert.deepEqual(r.json.de_los_que_ya_no_estan, { cuotas: 4, personas: 2, total: 20000 },
    'sin estos tres números el total cuadra con la caja y deja de cuadrar con la tabla');

  // Y los tres cierran con lo que se ve: lo dibujado más lo que falta es el total
  const dibujado = r.json.filas.reduce((t, f) => t + f.total, 0);
  assert.equal(dibujado + r.json.de_los_que_ya_no_estan.total, r.json.total_recaudado);
});

test('donde no se ha ido nadie, no se dice nada: van en cero', async () => {
  const api = await elSistemaAndando();
  const { cuerpo } = await unCuerpoQuePago(api, 2);
  const r = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2026`);
  assert.equal(r.json.total_recaudado, 20000);
  assert.deepEqual(r.json.de_los_que_ya_no_estan, { cuotas: 0, personas: 0, total: 0 },
    'en ceros la pantalla no dibuja la línea, que es lo normal');
});

test('el año que se pide es el año que se suma', async () => {
  /*
   * El total se arma ahora de TODAS las cuotas y no de las filas; hay que
   * comprobar que sigue siendo el del año pedido, porque una suma más ancha es
   * la forma más fácil de que se arrastre el año anterior sin que se note.
   */
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);
  for (const [anio, mes] of [[2025, '07'], [2026, '07']]) {
    const r = await api('POST', '/cuotas_cuerpo',
      { integrante_id: ficha, anio, mes, monto: 5000, fecha_pago: `${anio}-${mes}-05` });
    assert.equal(r.estado, 201, r.texto);
  }
  seRetira(ficha);

  const dosMil26 = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2026`);
  assert.equal(dosMil26.json.total_recaudado, 5000, 'no arrastra el 2025');
  assert.equal(dosMil26.json.de_los_que_ya_no_estan.cuotas, 1);
  const dosMil25 = await api('GET', `/cuerpos/${cuerpo}/cuotas?anio=2025`);
  assert.equal(dosMil25.json.total_recaudado, 5000);
});

test('la pantalla dibuja la línea que lo explica, y solo cuando hay algo que explicar', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('async function renderCuotasCuerpo');
  assert.ok(desde > 0, 'se encontró la pantalla de la planilla');
  const pantalla = app.slice(desde, desde + 6000);
  assert.match(pantalla, /de_los_que_ya_no_estan/, 'la pantalla usa el dato: viajar sin pintarse es no existir');
  assert.match(pantalla, /idos\.total \?/, 'y en cero no dibuja nada');
  assert.match(pantalla, /class="cuotas-idos"/);
  assert.match(pantalla, /fmtMoney\(idos\.total\)/, 'la plata, que es lo que se está tratando de cuadrar');
  assert.match(pantalla, /idos\.cuotas/);
  assert.match(pantalla, /idos\.personas/);
});

test('el estilo de esa línea existe: sin él sale pegada a la tabla', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const reglas = css.match(/\.cuotas-idos[^{]*\{/g) || [];
  assert.ok(reglas.length >= 1, `reglas encontradas: ${JSON.stringify(reglas)}`);
  assert.ok(reglas.some((r) => /^\.cuotas-idos\s*\{/.test(r.trim())),
    'la regla base, no solo la del <b> de adentro');
});
