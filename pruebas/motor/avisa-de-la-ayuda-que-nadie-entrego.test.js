/**
 * DE LO QUE SE PIDIÓ Y NADIE ENTREGÓ NO AVISABA NADIE.
 *
 * El sistema avisa de una credencial por vencer, de un documento por vencer, de
 * una solicitud sin respuesta, de cuotas al debe, del respaldo atrasado, de
 * quien lleva muchas faltas seguidas y de quien cumplió dieciocho. Medido antes
 * de esto:
 *
 *   ayudas en «Solicitada» ..................  2
 *   la más vieja ............................  de marzo, sigue esperando
 *   revisiones que hace el vigía cada día ...  9
 *   de esas, sobre ayudas ...................  0
 *
 * Y es lo único que este sistema entrega a una persona: una familia que pidió
 * una caja de mercadería en marzo podía seguir esperando sin que se notara.
 *
 * Lo que cuida este archivo:
 *   · que se avise de las pedidas y no entregadas, pasado el plazo
 *   · que el aviso diga para quién, de qué y hace cuánto
 *   · que sea UNO con todas, y no un campanazo por ayuda
 *   · que no vuelva a avisar de las mismas todos los días, pero sí cuando la
 *     lista cambia
 *   · que solo llegue a quien administra las ayudas, y solo de las suyas
 *   · y que lo entregado y lo rechazado no molesten a nadie
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const { db } = require('../../server/db');
const vigia = require('../../server/avisos/vigia');
const { TIPOS } = require('../../server/avisos/avisos');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del vigía','IG-VIG8','Activa')")
  .run().lastInsertRowid;
const OTRA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte del vigía','IG-VIG9','Activa')")
  .run().lastInsertRowid;

const ROSA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Rosa','Que Espera')")
  .run().lastInsertRowid;

const DEL_MOSTRADOR = { id: 9601, rol: 'secretario', iglesias: `[${IGLESIA}]`, iglesia_id: IGLESIA, cuerpos: '[]' };
const DE_LA_OTRA = { id: 9602, rol: 'secretario', iglesias: `[${OTRA}]`, iglesia_id: OTRA, cuerpos: '[]' };
const SOLO_MIRA = { id: 9603, rol: 'consulta', iglesias: `[${IGLESIA}]`, iglesia_id: IGLESIA, cuerpos: '[]' };

/** Hace N días, como fecha. */
const haceDias = (n) => db
  .prepare("SELECT date('now','localtime', ?) AS d").get(`-${n} days`).d;

let n = 0;
function pedida(mas = {}) {
  n++;
  const data = {
    fecha: haceDias(40), iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro', no_miembro_id: ROSA,
    beneficiario: 'Rosa Que Espera', tipo_ayuda: 'Alimentos', estado: 'Solicitada', ...mas,
  };
  const campos = Object.keys(data);
  return db
    .prepare(
      `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
}

/** Lo que la revisión le dejaría a esa persona, sin escribir nada. */
function loQueLeTocaria(usuario) {
  const salida = [];
  vigia.ayudasSinEntregar(usuario, (aviso) => salida.push(aviso));
  return salida;
}

/* ------------------------------- el aviso */

test('la revisión existe y está en la pasada del día', () => {
  assert.equal(typeof vigia.ayudasSinEntregar, 'function');
  assert.ok(vigia.REVISIONES.includes(vigia.ayudasSinEntregar), 'no sirve escribirla y no llamarla');
});

test('el tipo de aviso está declarado, y solo para quien administra las ayudas', () => {
  assert.ok(TIPOS.ayuda_sin_entregar, 'sin tipo declarado, `crear` lo tira a la basura en silencio');
  assert.equal(TIPOS.ayuda_sin_entregar.llave, 'ayudas_sociales');
});

test('avisa de la pedida hace tiempo, y dice para quién, de qué y hace cuánto', () => {
  pedida({ fecha: haceDias(173), tipo_ayuda: 'Alimentos' });
  const suyos = loQueLeTocaria(DEL_MOSTRADOR);
  assert.equal(suyos.length, 1);
  const aviso = suyos[0];
  assert.equal(aviso.tipo, 'ayuda_sin_entregar');
  assert.match(aviso.titulo, /Una ayuda pedida sigue sin entregarse/);
  assert.match(aviso.cuerpo, /Alimentos para Rosa Que Espera/);
  assert.match(aviso.cuerpo, /hace 173 día\(s\)/);
  assert.match(aviso.cuerpo, /«Solicitada»/);
});

test('con una sola, el enlace lleva a su ficha; con varias, al listado', () => {
  const unaSola = loQueLeTocaria(DEL_MOSTRADOR)[0];
  assert.match(unaSola.enlace, /^#\/m\/ayudas_sociales\/ficha\/\d+$/);

  pedida({ fecha: haceDias(30), tipo_ayuda: 'Ropa' });
  const conVarias = loQueLeTocaria(DEL_MOSTRADOR)[0];
  assert.equal(conVarias.enlace, '#/m/ayudas_sociales');
  assert.match(conVarias.titulo, /^2 ayudas pedidas siguen sin entregarse$/);
});

test('es UN solo aviso con todas, y no un campanazo por ayuda', () => {
  /*
   * Una solicitud tiene responsable y se le avisa a quien la tiene a cargo; una
   * ayuda no tiene dueño, así que quien administra las ayudas recibiría uno por
   * cada una. Lo que sirve en el mostrador es la lista.
   */
  pedida({ fecha: haceDias(25) });
  pedida({ fecha: haceDias(20) });
  const suyos = loQueLeTocaria(DEL_MOSTRADOR);
  assert.equal(suyos.length, 1);
  assert.match(suyos[0].titulo, /^4 ayudas pedidas siguen sin entregarse$/);
  assert.match(suyos[0].cuerpo, /y 1 más\.$/, 'nombra tres y dice cuántas faltan');
});

test('la clave cambia cuando la lista cambia, y no antes', () => {
  const antes = loQueLeTocaria(DEL_MOSTRADOR)[0].clave;
  assert.equal(loQueLeTocaria(DEL_MOSTRADOR)[0].clave, antes, 'lo mismo mañana no vuelve a sonar');
  const nueva = pedida({ fecha: haceDias(15) });
  assert.notEqual(loQueLeTocaria(DEL_MOSTRADOR)[0].clave, antes, 'una más sí');
  db.prepare("UPDATE ayudas_sociales SET estado = 'Entregada' WHERE id = ?").run(nueva);
  assert.equal(loQueLeTocaria(DEL_MOSTRADOR)[0].clave, antes, 'y entregada, vuelve a ser la de antes');
});

/* ------------------------------- lo que no molesta a nadie */

test('lo entregado y lo rechazado no avisan: eso ya se resolvió', () => {
  const cuantasAntes = loQueLeTocaria(DEL_MOSTRADOR)[0].titulo;
  pedida({ fecha: haceDias(300), estado: 'Entregada' });
  pedida({ fecha: haceDias(300), estado: 'Rechazada' });
  assert.equal(loQueLeTocaria(DEL_MOSTRADOR)[0].titulo, cuantasAntes);
});

test('la de anteayer tampoco: el plazo lo pone Configuración', () => {
  const cuantasAntes = loQueLeTocaria(DEL_MOSTRADOR)[0].titulo;
  pedida({ fecha: haceDias(2) });
  assert.equal(loQueLeTocaria(DEL_MOSTRADOR)[0].titulo, cuantasAntes, 'con el plazo de 7 días, no entra');

  ajustes.guardar('avisos_ayuda_dias', '1');
  try {
    assert.notEqual(loQueLeTocaria(DEL_MOSTRADOR)[0].titulo, cuantasAntes, 'con el de 1 día, sí');
  } finally {
    ajustes.guardar('avisos_ayuda_dias', '7');
  }
});

test('a la secretaria de otra iglesia no le llega ninguna', () => {
  assert.deepEqual(loQueLeTocaria(DE_LA_OTRA), []);
});

test('ni a quien solo consulta, que tiene el módulo cerrado', () => {
  /*
   * Desde la 1.203.0 la ayuda social está cerrada para el rol de consulta. Un
   * aviso sobre algo que después no puede abrir es peor que ninguno.
   */
  assert.deepEqual(loQueLeTocaria(SOLO_MIRA), []);
});

test('sin ninguna esperando, no deja nada', () => {
  db.prepare("UPDATE ayudas_sociales SET estado = 'Entregada' WHERE iglesia_id = ?").run(IGLESIA);
  assert.deepEqual(loQueLeTocaria(DEL_MOSTRADOR), []);
});
