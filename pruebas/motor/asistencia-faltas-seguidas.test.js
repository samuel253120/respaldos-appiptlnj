/**
 * QUIEN LLEVA MUCHAS FALTAS SEGUIDAS.
 *
 * El sistema avisaba de credenciales por vencer, de cuotas atrasadas, de
 * solicitudes sin respuesta y de cumpleaños: siete tipos de aviso, ninguno de
 * asistencia. Y la asistencia es de lo poco que avisa A TIEMPO de que alguien
 * se está alejando, que es de lo que más le importa a un cuerpo. Cuando se
 * nota sin ayuda, ya pasaron meses.
 *
 * La cuenta va de la actividad más reciente hacia atrás:
 *
 *   Presente ..... corta la cuenta. Volvió.
 *   Ausente ...... suma una falta.
 *   Justificado .. suma una falta, y se anota que avisó.
 *   sin marcar ... ni suma ni corta. Nadie faltó a una lista que no se pasó.
 *   visita ....... no se mira. Una visita no tiene a qué faltar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const faltas = require('../../server/faltas-seguidas');
const vigia = require('../../server/avisos/vigia');
const avisos = require('../../server/avisos/avisos');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('De las faltas', 'IG-FS', 'Activa')")
  .run().lastInsertRowid;
const cuerpo = db
  .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Coro', 'Cuerpo', ?, 'Activo')")
  .run(iglesia).lastInsertRowid;

let n = 0;
function alguien(nombre) {
  n++;
  const m = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(nombre || `Fal${n}`, `Ta${n}`, iglesia).lastInsertRowid;
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
     VALUES (?, ?, ?, 'Activo', '2024-01-01')`
  ).run(cuerpo, m, iglesia);
  return m;
}

const rosa = alguien('Xiomara');    // falta a todas, sin avisar
const elena = alguien('Ondina');    // falta a todas, avisando a veces
const marta = alguien('Quena');     // faltó y volvió en la última
const julia = alguien('Herminia');  // siempre presente
const nadie = alguien('Teodolinda'); // nunca se le marcó nada

/** Actividades del cuerpo, de la más vieja a la más nueva. */
const FECHAS = ['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01'];
const actividades = FECHAS.map((f) => db
  .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (?, 'Culto', ?, ?)")
  .run(f, iglesia, JSON.stringify([cuerpo])).lastInsertRowid);

const marcar = (actividadId, miembroId, estado, extra = {}) => db.prepare(
  `INSERT INTO asistencia_detalle (asistencia_id, persona_tipo, miembro_id, estado, motivo, cuerpo_id, fecha, iglesia_id, visita)
   VALUES (?, 'Miembro', ?, ?, ?, ?, (SELECT fecha FROM asistencias WHERE id = ?), ?, ?)`
).run(actividadId, miembroId, estado, extra.motivo || null, cuerpo, actividadId, iglesia, extra.visita ? 1 : 0);

actividades.forEach((id, i) => {
  marcar(id, rosa, 'Ausente');
  marcar(id, elena, i < 3 ? 'Justificado' : 'Ausente', { motivo: i < 3 ? 'Enfermedad' : null });
  marcar(id, marta, i === actividades.length - 1 ? 'Presente' : 'Ausente');
  marcar(id, julia, 'Presente');
  // a «Nadie» no se le marca: la lista quedó a medio pasar
});

const nombresDe = (lista) => lista.map((p) => p.nombre.split(' ')[0]).sort();

// ------------------------------------------------------------- la cuenta ---

test('EL CASO: quien lleva la racha sale, con su cuenta', () => {
  const salen = faltas.delCuerpo(cuerpo, 4);
  assert.deepEqual(nombresDe(salen), ['Ondina', 'Xiomara']);
  assert.equal(salen.find((p) => p.nombre.startsWith('Xiomara')).faltas, 5);
  assert.equal(salen.find((p) => p.nombre.startsWith('Ondina')).faltas, 5);
});

test('y las justificadas se cuentan aparte: no es el mismo caso', () => {
  const salen = faltas.delCuerpo(cuerpo, 4);
  const r = salen.find((p) => p.nombre.startsWith('Xiomara'));
  const e = salen.find((p) => p.nombre.startsWith('Ondina'));
  assert.deepEqual({ f: r.faltas, j: r.justificadas, s: r.sin_avisar }, { f: 5, j: 0, s: 5 });
  assert.deepEqual({ f: e.faltas, j: e.justificadas, s: e.sin_avisar }, { f: 5, j: 3, s: 2 });
});

test('un «presente» corta la cuenta: quien volvió no lleva faltas seguidas', () => {
  assert.equal(faltas.delCuerpo(cuerpo, 4).some((p) => p.miembro_id === marta), false);
  assert.equal(faltas.delCuerpo(cuerpo, 1).some((p) => p.miembro_id === marta), false);
});

test('quien nunca faltó no sale', () => {
  assert.equal(faltas.delCuerpo(cuerpo, 1).some((p) => p.miembro_id === julia), false);
});

test('LO QUE MÁS IMPORTA: una lista sin pasar no cuenta como falta', () => {
  /*
   * Nadie faltó a una lista que no se pasó. Contarla llenaría de avisos falsos
   * justo al cuerpo que va atrasado con sus listas, que es el que menos ayuda
   * necesita en forma de ruido.
   */
  assert.equal(faltas.delCuerpo(cuerpo, 1).some((p) => p.miembro_id === nadie), false);
});

test('ni corta una racha: se salta, y la cuenta sigue por debajo', () => {
  // Una actividad nueva, sin lista pasada, encima de la racha de Rosa
  const enBlanco = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-02-08', 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  const r = faltas.delCuerpo(cuerpo, 4).find((p) => p.miembro_id === rosa);
  assert.ok(r, 'la lista sin pasar le cortó la racha a quien lleva cinco faltas');
  assert.equal(r.faltas, 5);
  db.prepare('DELETE FROM asistencias WHERE id = ?').run(enBlanco);
});

test('las marcas de cuando era VISITA no cuentan como faltas suyas', () => {
  /*
   * El caso: alguien pasó por el cuerpo como visita, se le anotó, y después
   * entró de integrante. Aquellas marcas eran de una persona que no tenía a
   * qué faltar; leerlas ahora le abriría una racha de faltas que nunca tuvo, y
   * el aviso saldría el mismo día en que se sumó al cuerpo.
   */
  const pasaba = db
    .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES ('Filomena', 'Que Pasaba', ?, 'Activo')")
    .run(iglesia).lastInsertRowid;
  for (const id of actividades) marcar(id, pasaba, 'Ausente', { visita: true });
  // y ahora entra al cuerpo
  db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, iglesia_id, estado, fecha_ingreso)
     VALUES (?, ?, ?, 'Activo', '2026-02-02')`
  ).run(cuerpo, pasaba, iglesia);

  assert.equal(faltas.delCuerpo(cuerpo, 1).some((p) => p.miembro_id === pasaba), false,
    'le contaron como faltas las marcas de cuando era visita');
  db.prepare('DELETE FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?').run(cuerpo, pasaba);
});

test('el umbral manda: con uno más alto no sale nadie', () => {
  assert.equal(faltas.delCuerpo(cuerpo, 6).length, 0);
  assert.equal(faltas.delCuerpo(cuerpo, 5).length, 2);
});

test('en 0 no se avisa de nada: es como apagarlo', () => {
  assert.deepEqual(faltas.delCuerpo(cuerpo, 0), []);
});

test('una actividad de mañana no cuenta como falta de hoy', () => {
  const futura = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES (date('now','localtime','+30 days'), 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  marcar(futura, julia, 'Ausente');
  assert.equal(faltas.delCuerpo(cuerpo, 1).some((p) => p.miembro_id === julia), false,
    'una actividad que todavía no ocurre le contó como falta');
  db.prepare('DELETE FROM asistencia_detalle WHERE asistencia_id = ?').run(futura);
  db.prepare('DELETE FROM asistencias WHERE id = ?').run(futura);
});

test('quien se retiró del cuerpo deja de mirarse', () => {
  db.prepare("UPDATE integrantes_cuerpo SET estado = 'Retirado' WHERE cuerpo_id = ? AND miembro_id = ?").run(cuerpo, rosa);
  assert.equal(faltas.delCuerpo(cuerpo, 4).some((p) => p.miembro_id === rosa), false);
  db.prepare("UPDATE integrantes_cuerpo SET estado = 'Activo' WHERE cuerpo_id = ? AND miembro_id = ?").run(cuerpo, rosa);
});

test('un cuerpo con menos actividades que el umbral no avisa de nadie', () => {
  const nuevo = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES ('Recién armado', 'Cuerpo', ?, 'Activo')")
    .run(iglesia).lastInsertRowid;
  assert.deepEqual(faltas.delCuerpo(nuevo, 4), []);
});

// -------------------------------------------------------------- el aviso ---

const usuario = db
  .prepare("INSERT INTO usuarios (rut, nombre, rol, iglesia_id, activo) VALUES ('23000001-9', 'Quien lleva el Coro', 'admin', ?, 1)")
  .run(iglesia).lastInsertRowid;
const QUIEN = { id: usuario, nombre: 'Quien lleva el Coro', rol: 'admin', activo: 1, iglesias: null, cuerpos: null, iglesia_id: iglesia };

const laRevision = () => vigia.REVISIONES.find((f) => f.name === 'faltasSeguidas');
const loQueDejaria = (quien) => {
  const salen = [];
  laRevision()(quien || QUIEN, (a) => salen.push(a));
  return salen;
};

test('la revisión está entre las que corren cada día', () => {
  assert.ok(laRevision(), 'el vigía no revisa la asistencia');
});

test('deja UN aviso por cuerpo, no uno por persona', () => {
  // El umbral sale de Configuración; el de fábrica es 4
  const dejados = loQueDejaria().filter((a) => a.titulo.includes('Coro'));
  assert.equal(dejados.length, 1, 'tres avisos idénticos la misma mañana se dejan de mirar');
});

test('y dice a cuántos les pasa, nombrando a los primeros', () => {
  const a = loQueDejaria().find((x) => x.titulo.includes('Coro'));
  assert.match(a.titulo, /2 personas llevan 4 faltas seguidas o más en Coro/);
  assert.match(a.cuerpo, /Ondina \w+ \(5\)/);
  assert.match(a.cuerpo, /Xiomara \w+ \(5\)/);
});

test('dice cuántas de ellas avisaron: es la mitad del asunto', () => {
  const a = loQueDejaria().find((x) => x.titulo.includes('Coro'));
  assert.match(a.cuerpo, /1 de ellas avisó al menos una vez/);
});

test('y lleva al informe de ese cuerpo, no a una pantalla cualquiera', () => {
  const a = loQueDejaria().find((x) => x.titulo.includes('Coro'));
  assert.equal(a.enlace, `#/asistencia/informes?tipo=cuerpo&cuerpo_id=${cuerpo}`);
});

test('la clave lleva la cuenta: no repite todos los días, pero sí cuando cambia', () => {
  const antes = loQueDejaria().find((x) => x.titulo.includes('Coro')).clave;
  const otra = db
    .prepare("INSERT INTO asistencias (fecha, tipo_reunion, iglesia_id, cuerpos) VALUES ('2026-02-15', 'Culto', ?, ?)")
    .run(iglesia, JSON.stringify([cuerpo])).lastInsertRowid;
  marcar(otra, rosa, 'Ausente');
  const despues = loQueDejaria().find((x) => x.titulo.includes('Coro')).clave;
  assert.notEqual(despues, antes, 'una falta más no vuelve a avisar');
});

test('sin permiso para ver asistencia no se le avisa', () => {
  // Con la lista vacía escrita a propósito: sin eso caería al permiso del rol
  const sinPermiso = { ...QUIEN, rol: 'consulta', permisos: JSON.stringify({ asistencias: [] }) };
  assert.deepEqual(loQueDejaria(sinPermiso).filter((a) => a.titulo.includes('Coro')), []);
});

test('el tipo de aviso está declarado, para poder apagarlo desde el perfil', () => {
  assert.ok(avisos.TIPOS.faltas_seguidas, 'el aviso no se puede apagar ni aparece en las preferencias');
  assert.equal(avisos.TIPOS.faltas_seguidas.urgente, false, 'no interrumpe: va en el resumen del día');
});

test('el umbral se configura, como los demás plazos', () => {
  const fs = require('fs');
  const path = require('path');
  const texto = fs.readFileSync(path.join(__dirname, '../../server/ajustes.js'), 'utf8');
  assert.match(texto, /clave: 'asistencia_faltas_seguidas'/);
  assert.match(texto, /tipo: 'number', defecto: '4'/);
});
