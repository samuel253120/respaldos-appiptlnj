/**
 * LA PUERTA QUE SE USA TODOS LOS DÍAS NO DEJABA RASTRO.
 *
 * Las cuotas están en la lista de módulos vigilados por el Registro de Cambios
 * desde hace versiones, y con razón: son dinero. Pero esa lista la mira el
 * motor, y la planilla del cuerpo escribe el pago derecho —un INSERT y su
 * movimiento de tesorería— sin pasar por él. O sea que el libro anotaba la
 * puerta que casi nadie usa y no la que se usa a diario: la planilla se cobra
 * con un clic por casilla, mes a mes, persona a persona.
 *
 * MEDIDO en la v1.408.0, contando las líneas nuevas de cada operación:
 *
 *   cobrar por la ficha ......  201 · 1 línea
 *   cobrar por la planilla ...  200 · 0 líneas
 *   borrar por la planilla ...  200 · 0 líneas
 *   borrar por la ficha ......  200 · 1 línea
 *
 * El libro que existe para poder preguntar «¿quién tocó esta plata?» no tenía
 * la respuesta justamente para el camino por el que la plata entra y sale.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let n = 0;

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Central PL ${marca}`, `PL-${marca}`).lastInsertRowid;

function unCuerpo() {
  const id = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Cuerpo', ?, 'Activo', 1, 5000)`
  ).run(`Damas ${++n} PL ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas ${n} PL ${marca}`, id, iglesia);
  return id;
}

function unaFicha(cuerpo) {
  const miembro = db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
    .run(`Quien${++n}`, `Paga PL ${marca}`, iglesia).lastInsertRowid;
  return db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'Miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(cuerpo, miembro, `Quien${n} Paga PL ${marca}`, iglesia).lastInsertRowid;
}

/** Las líneas de UNA cuota: la base la comparten los procesos. */
const lineasDe = (id) => db.prepare(
  "SELECT * FROM registro_cambios WHERE modulo = 'Cuotas de Cuerpos' AND registro_id = ? ORDER BY id"
).all(id);

test('cobrar por la planilla deja su línea, y dice que vino de ahí', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);

  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`, { integrante_id: ficha, anio: 2026, mes: '07' });
  assert.equal(r.estado, 200, r.texto);

  const lineas = lineasDe(r.json.id);
  assert.equal(lineas.length, 1, 'antes no dejaba ninguna');
  assert.equal(lineas[0].accion, 'Creación');
  assert.match(lineas[0].detalle, /^Por la planilla ·/,
    'la línea contesta sola de dónde salió, igual que las de la importación');
  assert.match(lineas[0].detalle, new RegExp(`Quien${n} Paga PL ${marca}`), 'de quién es');
  // Sin exigir el carácter exacto entre el signo y la cifra: eso lo decide el
  // formateador de dinero y no es lo que esta prueba cuida.
  assert.match(lineas[0].detalle, /Monto pagado:\s*\$\s*5\.000/, 'y cuánta plata movió');
});

test('borrar por la planilla también', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);

  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`, { integrante_id: ficha, anio: 2026, mes: '08' });
  assert.equal(r.estado, 200, r.texto);
  const b = await api('DELETE', `/cuerpos/${cuerpo}/cuotas/${r.json.id}`);
  assert.equal(b.estado, 200, b.texto);

  const lineas = lineasDe(r.json.id);
  assert.deepEqual(lineas.map((l) => l.accion), ['Creación', 'Eliminación'],
    `quedaron: ${JSON.stringify(lineas.map((l) => l.accion))}`);
  assert.match(lineas[1].detalle, /Monto pagado/, 'y el borrado dice qué plata se llevó');
});

test('la línea dice quién lo hizo', async () => {
  // Es la pregunta con la que se abre este libro: quién tocó esta plata.
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const ficha = unaFicha(cuerpo);
  const r = await api('POST', `/cuerpos/${cuerpo}/cuotas`, { integrante_id: ficha, anio: 2026, mes: '09' });
  const [linea] = lineasDe(r.json.id);
  assert.ok(linea.usuario && linea.usuario !== 'Sistema',
    `la línea dice «${linea.usuario}»: una cuota siempre la cobra alguien`);
  assert.ok(linea.created_by, 'y queda su número de cuenta');
});

test('las dos puertas dejan la misma clase de línea', async () => {
  const api = await elSistemaAndando();
  const cuerpo = unCuerpo();
  const porPlanilla = unaFicha(cuerpo);
  const porFicha = unaFicha(cuerpo);

  const p = await api('POST', `/cuerpos/${cuerpo}/cuotas`, { integrante_id: porPlanilla, anio: 2026, mes: '06' });
  const f = await api('POST', '/cuotas_cuerpo',
    { integrante_id: porFicha, anio: 2026, mes: '06', monto: 5000, fecha_pago: '2026-06-05' });
  assert.equal(f.estado, 201, f.texto);

  const [lp] = lineasDe(p.json.id);
  const [lf] = lineasDe(f.json.id);
  const forma = (l) => String(l.detalle).replace(/^Por la planilla · /, '')
    .replace(/Quien\d+ Paga PL \d+/, 'ALGUIEN').replace(/\d{2}-\d{2}-\d{4}/, 'FECHA');
  assert.equal(forma(lp), forma(lf),
    'se anota con las mismas funciones que usa el motor, no con una copia');
});

test('y dice de quién es, que era lo que le faltaba a la línea', async () => {
  /*
   * Destapado al escribir esta prueba: el INSERT de la planilla no escribía la
   * columna «persona», así que la línea del registro salía sin el nombre de
   * quien pagó. Y eso no se quedaba en el registro: el sistema ya tenía escrito
   * por qué importa, en el armado del movimiento de tesorería —«buscarlo por el
   * número de miembro dejaba el movimiento diciendo "un integrante" cuando quien
   * paga es alguien de un grupo que no está inscrito en la membresía: no tiene
   * ese número»—. El arreglo estaba hecho y esta puerta no lo alimentaba.
   */
  const api = await elSistemaAndando();
  const grupo = db.prepare(
    `INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado, cobra_cuota, cuota_mensual)
     VALUES (?, 'Grupo', ?, 'Activo', 1, 4000)`
  ).run(`Coro ${++n} PL ${marca}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, tipo, cuerpo_id, iglesia_id, estado, saldo_inicial)
     VALUES (?, 'Cuerpo / Grupo', 'Cuotas de integrantes', ?, ?, 'Activa', 0)`
  ).run(`Cuotas coro ${n} PL ${marca}`, grupo, iglesia);

  // Alguien que sirve en el grupo SIN estar inscrito en la membresía: no tiene
  // número de miembro, así que el nombre es lo único que lo identifica.
  const quien = db.prepare('INSERT INTO no_miembros (nombres, apellidos, iglesia_id) VALUES (?,?,?)')
    .run('Sin', `Inscribir PL ${marca}`, iglesia).lastInsertRowid;
  const ficha = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, no_miembro_id, persona_tipo, persona, estado,
                                     fecha_ingreso, iglesia_id)
     VALUES (?, ?, 'No miembro', ?, 'Activo', '2026-01-10', ?)`
  ).run(grupo, quien, `Sin Inscribir PL ${marca}`, iglesia).lastInsertRowid;

  const r = await api('POST', `/cuerpos/${grupo}/cuotas`, { integrante_id: ficha, anio: 2026, mes: '07' });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(r.json.persona, `Sin Inscribir PL ${marca}`, 'la cuota guarda el nombre');
  assert.equal(r.json.miembro_id, null, 'y no tiene número de miembro: por eso el nombre es lo único');

  const [linea] = lineasDe(r.json.id);
  assert.match(linea.detalle, new RegExp(`Sin Inscribir PL ${marca}`), 'la línea dice de quién es');

  const mov = db.prepare('SELECT concepto FROM tesoreria WHERE id = ?').get(r.json.movimiento_id);
  assert.match(mov.concepto, new RegExp(`Sin Inscribir PL ${marca}`),
    `el movimiento decía «un integrante»; ahora dice «${mov.concepto}»`);
  assert.ok(!/un integrante/.test(mov.concepto));
});

test('se anota con las funciones del motor, no con una copia', () => {
  /*
   * Copiar el armado de la línea en el importador o en la planilla es
   * garantizar que un día digan cosas distintas. Es la misma decisión que ya
   * está escrita en server/importar.js para las comprobaciones de alcance.
   */
  const fs = require('fs');
  const path = require('path');
  const texto = fs.readFileSync(path.join(__dirname, '../../server/cuotas.js'), 'utf8');
  assert.match(texto, /bitacora\.registrarGuardado\(def, \{/, 'la misma que llama server/crud.js');
  assert.match(texto, /bitacora\.registrarEliminado\(def, fila, usuario\)/);
  assert.match(texto, /origen: 'Por la planilla'/, 'y con su origen, como la importación');
  assert.ok(!/INSERT INTO registro_cambios/.test(texto),
    'no arma la línea a mano: eso es lo que se separa con el tiempo');
});
