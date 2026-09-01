/**
 * Quien se va del cuerpo y sigue siendo su tesorero.
 *
 * Medido antes de esto, sobre un cuerpo con su directiva en ejercicio completa:
 *
 *   se retira del cuerpo a la tesorera ......... 200, sin decir nada
 *   la directiva sigue diciendo ................ «Tesorero(a): Elena Díaz Díaz»
 *   volver a guardar la directiva .............. 200, tampoco
 *   en el cumplimiento del cuerpo .............. no figura
 *
 * El sistema LO SABE —las dos tablas están ahí— y no lo decía en ninguna parte.
 * Una directiva en ejercicio con un cargo ocupado por alguien que ya no
 * pertenece al cuerpo es exactamente lo que un requisito formal tendría que
 * atrapar.
 *
 * Se cuidan tres cosas: que se pregunte al sacar a esa persona —por las DOS
 * puertas, el retiro y el borrado de la ficha—, que el cumplimiento lo diga
 * mientras el cargo no se releve, y que una directiva VIEJA no reproche nada:
 * su gente se fue después, y esa directiva es el registro de quiénes eran
 * entonces.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const cargos = require('../../server/cargos-de-la-directiva');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 30300000 + (process.pid % 100000) * 2;
const otroRut = () => { const c = String(++rut); return `${c}-${digitoVerificador(c)}`; };

const HOY = require('../../server/fechas').hoy();
const anios = (cuantos) => {
  const d = new Date(`${HOY}T12:00:00`);
  d.setFullYear(d.getFullYear() + cuantos);
  return d.toISOString().slice(0, 10);
};

/** Un cuerpo con su directiva en ejercicio completa, y las fichas a mano. */
function unCuerpoConSuDirectiva() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia vacante ${m}`, `VACA${m}`).lastInsertRowid;
  const cuerpo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo vacante ${m}`, iglesia).lastInsertRowid;

  const gente = [];
  const fichas = {};
  for (let i = 0; i < 6; i++) {
    const quien = db
      .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, 'Activo')")
      .run(`Cargo${i}`, `Devacante ${m}`, otroRut(), iglesia).lastInsertRowid;
    /*
     * Con `fecha_ingreso`, que es obligatoria: sin ella, cualquier guardado
     * posterior de la ficha se rechaza por eso y no por lo que se está
     * probando. Una ficha escrita a mano tiene que quedar como las de verdad.
     */
    fichas[quien] = db
      .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado,
                                                fecha_ingreso, iglesia_id)
                VALUES (?, 'Miembro', ?, 'Quien sea', 'Activo', ?, ?)`)
      .run(cuerpo, quien, anios(-3), iglesia).lastInsertRowid;
    gente.push(quien);
  }

  const directiva = db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado,
                                      primer_jefe_id, segundo_jefe_id, secretario_id, tesorero_id)
              VALUES (?, ?, ?, ?, ?, 'Vigente', ?, ?, ?, ?)`)
    .run(cuerpo, iglesia, `p ${m}`, anios(-1), anios(1), gente[0], gente[1], gente[2], gente[3])
    .lastInsertRowid;

  return { m, iglesia, cuerpo, gente, fichas, directiva };
}

const requisito = async (api, cuerpoId) =>
  (await api('GET', `/cuerpos/${cuerpoId}/cumplimiento`)).json.items
    .find((i) => i.texto === 'Directiva con sus cargos');

const retirar = (api, ficha, extra = {}) => api('PUT', `/integrantes_cuerpo/${ficha}`, {
  estado: 'Retirado', fecha_retiro: HOY, motivo_retiro: 'Se fue', ...extra,
});

// ---------------------------------------------------- se pregunta al salir ----

test('retirar del cuerpo a quien ocupa un cargo se pregunta', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await retirar(api, c.fichas[c.gente[3]]);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'deja_un_cargo_vacante');
  assert.match(r.json.error, /es tesorero de la directiva que dirige hoy/,
    'tiene que decir QUÉ cargo queda vacante, no solo que algo pasa');
  assert.match(r.json.error, /Designe a otra persona|releve/, 'y ofrecer el paso siguiente');
  assert.equal(db.prepare('SELECT estado FROM integrantes_cuerpo WHERE id = ?')
    .get(c.fichas[c.gente[3]]).estado, 'Activo', 'y no se guardó nada mientras tanto');
});

test('y borrar la ficha también: son dos puertas al mismo lugar', async () => {
  /*
   * Cerrar una sola de las dos es lo mismo que no cerrar ninguna. Es la lección
   * que dejó la planilla de cuotas en la 1.249.0.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();

  const r = await api('DELETE', `/integrantes_cuerpo/${c.fichas[c.gente[0]]}`);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'deja_un_cargo_vacante');
  assert.match(r.json.error, /es primer jefe/);
  assert.ok(db.prepare('SELECT id FROM integrantes_cuerpo WHERE id = ?').get(c.fichas[c.gente[0]]),
    'la ficha sigue ahí');
});

test('contestada la pregunta se retira, porque la persona se va igual', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const r = await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });
  assert.equal(r.estado, 200);
  assert.equal(db.prepare('SELECT estado FROM integrantes_cuerpo WHERE id = ?')
    .get(c.fichas[c.gente[3]]).estado, 'Retirado');
});

test('retirar a quien no ocupa ningún cargo no pregunta nada', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const r = await retirar(api, c.fichas[c.gente[5]]);
  assert.equal(r.estado, 200, 'la mayoría de los retiros son de gente sin cargo');
});

test('y volver a guardar una ficha que YA estaba retirada tampoco', async () => {
  /*
   * Se pregunta cuando ESTE guardado la saca, no cada vez que se toca una ficha
   * que ya estaba fuera: un aviso que sale siempre enseña a apretar «Está bien»
   * sin leer.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });

  const r = await api('PUT', `/integrantes_cuerpo/${c.fichas[c.gente[3]]}`,
    { observaciones: 'una corrección cualquiera' });
  assert.equal(r.estado, 200);
});

test('el aviso mira la directiva que dirige HOY, no las de antes', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  // la de hoy se cierra, y queda solo una vieja donde esta persona era jefe
  db.prepare('UPDATE directivas SET fecha_termino = ? WHERE id = ?').run(anios(-1), c.directiva);

  const r = await retirar(api, c.fichas[c.gente[0]]);
  assert.equal(r.estado, 200,
    'en una directiva que ya terminó, que su gente se haya ido después no es un problema');
});

// ------------------------------ y el cumplimiento lo dice mientras dure ----

test('el cuerpo deja de cumplir mientras el cargo no se releve', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  assert.equal((await requisito(api, c.cuerpo)).ok, true, 'antes de nada, cumple');

  await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });
  const r = await requisito(api, c.cuerpo);
  assert.equal(r.ok, false);
  assert.match(r.detalle, /figura de tesorero y ya no pertenece al cuerpo/);
  assert.match(r.detalle, /Cargo3/, 'y se dice quién, para saber a quién relevar');
});

test('y vuelve a cumplir en cuanto se designa a otra persona', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });

  const r = await api('PUT', `/directivas/${c.directiva}`, { tesorero_id: c.gente[4] });
  assert.equal(r.estado, 200);
  const luego = await requisito(api, c.cuerpo);
  assert.equal(luego.ok, true);
  assert.match(luego.detalle, /y en cuatro personas/);
});

test('un cargo vacante se dice ANTES que un cargo repetido', async () => {
  /*
   * Ahí falta una persona y acá sobra un sombrero: lo primero pesa más.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  db.prepare('UPDATE directivas SET secretario_id = ? WHERE id = ?').run(c.gente[1], c.directiva);
  await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });

  const r = await requisito(api, c.cuerpo);
  assert.match(r.detalle, /ya no pertenece al cuerpo/);
  assert.doesNotMatch(r.detalle, /ocupa 2 cargos/);
});

test('pero los cargos que faltan se dicen antes que todo', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  db.prepare('UPDATE directivas SET secretario_id = NULL WHERE id = ?').run(c.directiva);
  await retirar(api, c.fichas[c.gente[3]], { igual_asi: true });

  assert.match((await requisito(api, c.cuerpo)).detalle, /Falta: secretario/,
    'rellenar un cargo vacío sigue siendo lo primero');
});

test('el oficial supervisor no cuenta: no pertenece al cuerpo por definición', async () => {
  /*
   * Viene del cuerpo de oficiales y supervisa desde fuera, así que no ser
   * integrante del cuerpo supervisado es su situación normal. Contarlo dejaría a
   * TODO cuerpo con supervisor incumpliendo para siempre.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConSuDirectiva();
  const deAfuera = db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES ('Ofi', ?, ?, ?, 'Activo')")
    .run(`Deafuera ${c.m}`, otroRut(), c.iglesia).lastInsertRowid;
  db.prepare('UPDATE directivas SET oficial_supervisor_id = ? WHERE id = ?').run(deAfuera, c.directiva);

  assert.equal((await requisito(api, c.cuerpo)).ok, true);
  const fila = db.prepare('SELECT * FROM directivas WHERE id = ?').get(c.directiva);
  assert.deepEqual(cargos.losQueYaNoPertenecen(db, fila), []);
});

// ---------------------------------------------------- la cuenta en sí ----

test('quién ocupa qué cargo se pregunta a la directiva en ejercicio', () => {
  const c = unCuerpoConSuDirectiva();
  assert.deepEqual(cargos.losCargosQueOcupa(db, c.cuerpo, c.gente[2]).map((x) => x.corto),
    ['secretario']);
  assert.deepEqual(cargos.losCargosQueOcupa(db, c.cuerpo, c.gente[5]), [],
    'quien no tiene cargo no ocupa ninguno');
  assert.deepEqual(cargos.losCargosQueOcupa(db, c.cuerpo, null), []);
});

test('quien está EN PRUEBA pertenece: no se le reprocha el cargo', () => {
  /*
   * «Pertenecer hoy» es la misma definición que usa todo el resto del sistema
   * —activos y en prueba— y no una lista escrita otra vez acá.
   */
  const c = unCuerpoConSuDirectiva();
  db.prepare("UPDATE integrantes_cuerpo SET estado = 'En prueba' WHERE id = ?").run(c.fichas[c.gente[2]]);
  const fila = db.prepare('SELECT * FROM directivas WHERE id = ?').get(c.directiva);
  assert.deepEqual(cargos.losQueYaNoPertenecen(db, fila), []);
});
