/**
 * DEL ÚNICO PLAZO QUE NO PONE LA INSTITUCIÓN NO AVISABA NADIE.
 *
 * Todos los plazos de este sistema los fija la corporación en Configuración
 * —cuántos días puede llevar abierta una solicitud, con cuánta anticipación
 * avisar de una credencial— y se pueden discutir. Uno no: el que trae escrito
 * un oficio de una municipalidad, del Servicio de Impuestos Internos o de un
 * tribunal. Pasarlo tiene consecuencias afuera.
 *
 * MEDIDO en la v1.284.0, con tres documentos recibidos en la base —uno con el
 * plazo pasado hacía siete meses y el trámite sin empezar—:
 *
 *   bloques del panel que lo nombraran ......... 0, de 9
 *   revisiones del vigía que lo miraran ........ 0, de 12
 *
 * Y el sistema ya sabía hacerlo para el módulo de al lado: el panel trae
 * «solicitudes pasadas de plazo» en su propia tarjeta y el vigía avisa de una
 * solicitud sin respuesta. Una solicitud de un hermano de la congregación tenía
 * vigilancia de plazos; un oficio del Estado, no.
 *
 * Lo que cuida este archivo:
 *   · que se avise de lo vencido y de lo que está por vencer, y de nada más
 *   · que el texto diga CUÁNTO, no solo que sí
 *   · que lo respondido, lo despachado y lo archivado no molesten a nadie
 *   · que lo emitido y lo interno queden fuera, porque no tienen plazo
 *   · que un documento sin plazo escrito no invente uno
 *   · que sea UN aviso con todos, y solo a quien lleva la oficina de partes
 *   · y que la anticipación salga de Configuración y no de un número escrito
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const { db } = require('../../server/db');
const vigia = require('../../server/avisos/vigia');
const { TIPOS } = require('../../server/avisos/avisos');
const plazos = require('../../server/documento-sin-responder');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del plazo','IG-PLZ1','Activa')")
  .run().lastInsertRowid;
const OTRA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte del plazo','IG-PLZ2','Activa')")
  .run().lastInsertRowid;

const DE_PARTES = { id: 9701, rol: 'secretario', iglesias: `[${IGLESIA}]`, iglesia_id: IGLESIA, cuerpos: '[]' };
const DE_LA_OTRA = { id: 9702, rol: 'secretario', iglesias: `[${OTRA}]`, iglesia_id: OTRA, cuerpos: '[]' };

/** En N días, como fecha. En negativo, hace N días. */
const enDias = (n) => db.prepare("SELECT date('now','localtime', ?) AS d")
  .get(`${n >= 0 ? '+' : ''}${n} days`).d;

let n = 0;
function recibido(mas = {}) {
  n++;
  const data = {
    flujo: 'Recibido', iglesia_id: IGLESIA, numero: `REC-${900 + n}-2026`,
    titulo: `Oficio ${n}`, remitente: 'Municipalidad', estado: 'Ingresado',
    fecha_registro: enDias(-40), ...mas,
  };
  const campos = Object.keys(data);
  return db
    .prepare(
      `INSERT INTO documentos (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
}

/** Lo que la revisión le dejaría a esa persona, sin escribir nada. */
function loQueLeTocaria(usuario) {
  const salida = [];
  vigia.documentosPorResponder(usuario, (aviso) => salida.push(aviso));
  return salida;
}

const delPanel = (usuario) => plazos.losQueEsperanRespuesta(db, usuario);

/* ---------------------------------------------- que exista de verdad ---- */

test('la revisión existe y está en la pasada del día', () => {
  assert.equal(typeof vigia.documentosPorResponder, 'function');
  assert.ok(vigia.REVISIONES.includes(vigia.documentosPorResponder),
    'no sirve escribirla y no llamarla');
});

test('el tipo de aviso está declarado, y solo para quien lleva la oficina de partes', () => {
  assert.ok(TIPOS.documento_por_responder,
    'sin tipo declarado, `crear` lo tira a la basura en silencio');
  assert.equal(TIPOS.documento_por_responder.llave, 'documentos');
});

test('y no se confunde con el aviso del carnet, que se llama casi igual', () => {
  /*
   * `documentosPorVencer` mira los documentos de la carpeta de un miembro. Son
   * dos revisiones distintas y las dos tienen que estar.
   */
  assert.ok(vigia.REVISIONES.some((f) => f.name === 'documentosPorVencer'));
  assert.ok(vigia.REVISIONES.some((f) => f.name === 'documentosPorResponder'));
  assert.ok(TIPOS.documento_por_vencer && TIPOS.documento_por_responder);
});

/* ------------------------------------------------- a cuáles les mira ---- */

test('avisa del plazo pasado, y dice hace cuánto', () => {
  recibido({ plazo: enDias(-210), estado: 'Ingresado', titulo: 'Denuncia de la Superintendencia' });
  const lista = delPanel(DE_PARTES);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nivel, 'vencido');
  assert.match(lista[0].situacion, /hace 7 meses/);
  assert.match(lista[0].situacion, /sigue «Ingresado»/);
});

test('y del que está por cumplirse, diciendo en cuánto', () => {
  recibido({ plazo: enDias(1), estado: 'En trámite' });
  const porVencer = delPanel(DE_PARTES).filter((d) => d.nivel === 'porVencer');
  assert.equal(porVencer.length, 1);
  assert.match(porVencer[0].situacion, /se cumple mañana/);
});

test('el que todavía queda lejos no molesta a nadie', () => {
  const anticipacion = plazos.diasDeAviso();
  recibido({ plazo: enDias(anticipacion + 30) });
  const lejano = delPanel(DE_PARTES).filter((d) => d.plazo === enDias(anticipacion + 30));
  assert.equal(lejano.length, 0);
});

test('lo respondido, lo despachado y lo archivado no aparecen', () => {
  const cuantosAntes = delPanel(DE_PARTES).length;
  recibido({ plazo: enDias(-90), estado: 'Respondido' });
  recibido({ plazo: enDias(-90), estado: 'Despachado' });
  recibido({ plazo: enDias(-90), estado: 'Archivado' });
  assert.equal(delPanel(DE_PARTES).length, cuantosAntes,
    'esas tres son las maneras que tiene el módulo de decir que el asunto terminó');
});

test('un documento sin plazo escrito no inventa uno', () => {
  const cuantosAntes = delPanel(DE_PARTES).length;
  recibido({ plazo: null, estado: 'Ingresado', fecha_registro: enDias(-400) });
  assert.equal(delPanel(DE_PARTES).length, cuantosAntes,
    'que el oficio no traiga fecha tope es corriente, y no se le pone una');

  /*
   * Y también preguntándole DIRECTO a la función, sin pasar por la consulta.
   * La consulta ya descarta los que no tienen plazo, así que por ese camino la
   * función nunca ve uno: sin esta parte, romper a propósito lo que decide
   * dentro no ponía roja ninguna prueba. Se comprobó.
   */
  for (const vacio of [null, undefined, '', '   ']) {
    assert.equal(plazos.comoVaDePlazo({ plazo: vacio, estado: 'Ingresado' }), null,
      `con el plazo en ${JSON.stringify(vacio)} no hay nada que decir`);
  }
  assert.equal(plazos.comoVaDePlazo({ plazo: 'cuando se pueda', estado: 'Ingresado' }), null,
    'y una fecha que no es una fecha tampoco inventa nada');
});

test('lo emitido y lo interno quedan fuera: no tienen plazo', () => {
  const cuantosAntes = delPanel(DE_PARTES).length;
  recibido({ flujo: 'Emitido', plazo: enDias(-90), destinatario: 'Municipalidad', remitente: null });
  recibido({ flujo: 'Interno o de archivo', plazo: enDias(-90), numero: null, remitente: null });
  assert.equal(delPanel(DE_PARTES).length, cuantosAntes);
});

/* ----------------------------------------------------- cómo se avisa ---- */

test('es UN solo aviso con todos, y no un campanazo por documento', () => {
  /*
   * Como el de las ayudas y por el mismo motivo: un documento se puede derivar
   * a alguien, pero ese alguien es un MIEMBRO y no una cuenta del sistema, así
   * que no hay a quién mandarle el suyo. Lo que sirve en la oficina es la lista.
   */
  const suyos = loQueLeTocaria(DE_PARTES);
  assert.equal(suyos.length, 1);
  assert.equal(suyos[0].tipo, 'documento_por_responder');
  assert.match(suyos[0].titulo, /pasó su plazo|pasaron su plazo/);
  assert.match(suyos[0].cuerpo, /Denuncia de la Superintendencia/);
  assert.match(suyos[0].cuerpo, /Municipalidad/);
  assert.equal(suyos[0].enlace, '#/m/documentos');
});

test('el título habla de lo vencido cuando lo hay, y del plazo cercano cuando no', () => {
  const conVencidos = loQueLeTocaria(DE_PARTES)[0];
  assert.match(conVencidos.titulo, /pasó su plazo de respuesta|pasaron su plazo de respuesta/);

  // Una iglesia donde solo hay uno por vencer, sin ninguno pasado
  const soloCerca = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Sur del plazo','IG-PLZ3','Activa')")
    .run().lastInsertRowid;
  recibido({ iglesia_id: soloCerca, plazo: enDias(2), estado: 'Derivado' });
  const deAlla = { id: 9703, rol: 'secretario', iglesias: `[${soloCerca}]`, iglesia_id: soloCerca, cuerpos: '[]' };
  const suyo = loQueLeTocaria(deAlla)[0];
  assert.match(suyo.titulo, /está por cumplir su plazo/);
});

test('la clave cambia cuando la lista cambia, y no antes', () => {
  const antes = loQueLeTocaria(DE_PARTES)[0].clave;
  assert.equal(loQueLeTocaria(DE_PARTES)[0].clave, antes, 'lo mismo mañana no vuelve a sonar');
  recibido({ plazo: enDias(-15) });
  assert.notEqual(loQueLeTocaria(DE_PARTES)[0].clave, antes, 'pero uno nuevo sí');
});

test('cada quien ve los de su iglesia, y solo esos', () => {
  const suyos = loQueLeTocaria(DE_PARTES);
  assert.equal(suyos.length, 1);
  assert.equal(loQueLeTocaria(DE_LA_OTRA).length, 0, 'la otra iglesia no tiene ninguno');

  recibido({ iglesia_id: OTRA, plazo: enDias(-30), titulo: 'Oficio de la Norte' });
  const deLaOtra = loQueLeTocaria(DE_LA_OTRA);
  assert.equal(deLaOtra.length, 1);
  assert.match(deLaOtra[0].cuerpo, /Oficio de la Norte/);
  assert.ok(!/Denuncia de la Superintendencia/.test(deLaOtra[0].cuerpo),
    'y no ve los de la otra congregación');
});

/* -------------------------------------------- de dónde sale el corte ---- */

test('la anticipación sale de Configuración y no de un número escrito acá', () => {
  const suyo = { id: 9704, rol: 'secretario', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };
  const cerca = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Este del plazo','IG-PLZ4','Activa')")
    .run().lastInsertRowid;
  recibido({ iglesia_id: cerca, plazo: enDias(20), estado: 'Ingresado' });

  const fila = { plazo: enDias(20), estado: 'Ingresado' };
  assert.equal(plazos.comoVaDePlazo(fila, undefined, 7), null, 'con 7 días de aviso, todavía no');
  assert.ok(plazos.comoVaDePlazo(fila, undefined, 30), 'con 30, sí');

  const antes = ajustes.obtener('avisos_plazo_documento_dias');
  try {
    ajustes.guardar('avisos_plazo_documento_dias', '30');
    assert.equal(plazos.diasDeAviso(), 30, 'se lee cada vez, no al arrancar');
    assert.ok(plazos.comoVaDePlazo({ plazo: enDias(20), estado: 'Ingresado' }),
      'y con eso puesto, el de veinte días sí avisa');
  } finally {
    ajustes.guardar('avisos_plazo_documento_dias', String(antes));
  }
  assert.equal(plazos.diasDeAviso(), Number(antes), 'y vuelve a como estaba');
});

test('el ajuste está declarado en Configuración, con sus límites y su ayuda', () => {
  /*
   * Un ajuste que el código lee pero que la pantalla no ofrece es un número que
   * nadie puede cambiar y que nadie sabe que existe. Se mira la declaración de
   * verdad —la que arma la pantalla— y no el archivo como texto.
   */
  const decl = ajustes.POR_CLAVE['avisos_plazo_documento_dias'];
  assert.ok(decl, 'sin declarar, guardar() lo descarta en silencio y la pantalla no lo ofrece');
  assert.equal(decl.tipo, 'number');
  assert.equal(decl.defecto, '7');
  assert.ok(decl.min >= 1 && decl.max <= 365);
  assert.match(decl.ayuda, /no pone la institución/, 'la ayuda dice qué lo hace distinto');
  assert.match(decl.ayuda, /carnet/, 'y lo separa del otro, que se llama casi igual');

  // Y que de verdad se pueda guardar por la vía normal: `guardar` descarta en
  // silencio cualquier clave que no esté declarada, así que esto lo comprueba.
  const antes = ajustes.obtener('avisos_plazo_documento_dias');
  ajustes.guardar('avisos_plazo_documento_dias', '15');
  assert.equal(ajustes.obtener('avisos_plazo_documento_dias'), '15');
  ajustes.guardar('avisos_plazo_documento_dias', String(antes));
});
