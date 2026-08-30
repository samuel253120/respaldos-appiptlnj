/**
 * UNA ENTREGA QUE NO DICE CUÁNTO VALÍA NO VALE CERO: NO SE SABE.
 *
 * Se mandó una ayuda con lo mínimo —para quién, de qué tipo, la fecha y el
 * estado «Entregada»— y sin nada más. Medido antes de esto:
 *
 *   guardarla así ......................  201
 *   quedó con valor estimado ...........  vacío
 *   con soporte / evidencia ............  vacío
 *   con «aprobada por» .................  vacío
 *
 * Y después el informe la cuenta. En «Por tipo de ayuda» salía «Otro ·
 * entregas 1 · valor estimado $ 0», y en «Mes a mes», «Agosto de 2026 · $ 0».
 * Quien lo lee entiende que se entregó algo que no valía nada. Lo que pasó es
 * que nadie anotó cuánto, y el informe no tenía manera de decirlo: no llevaba
 * la cuenta de cuántas iban sin monto.
 *
 * Son dos arreglos, y hacen falta los dos: preguntar cuando la cosa sale, y
 * decir la verdad cuando después se cuenta.
 *
 * SE PREGUNTA, NO SE BLOQUEA, que es lo que ya hace Tesorería con la boleta de
 * un egreso grande: hay entregas que se documentan después y el sistema no está
 * para discutírselo a quien está en el mostrador con la persona enfrente.
 *
 * Lo que cuida este archivo:
 *   · que al entregar se pregunte por lo que falta, y se pueda seguir
 *   · que la pregunta nombre lo que falta, y no todo siempre
 *   · que no se pregunte por lo que ya está, ni a una ficha vieja que se abre
 *     y se guarda igual
 *   · pero sí cuando se está borrando un dato que estaba
 *   · que el informe cuente las entregas sin monto en vez de sumarlas como $ 0
 *   · y que se pueda apagar en Configuración
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const { db } = require('../../server/db');
const AYUDAS = require('../../server/modules/ayudas_sociales');
const aQuien = require('../../server/a-quien-se-ayudo');
const puente = require('../../server/ayuda-tesoreria');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del monto','IG-MON1','Activa')")
  .run().lastInsertRowid;
const CARMEN = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Carmen','Del Valle Sin Monto')")
  .run().lastInsertRowid;

const ADMIN = { id: 9201, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };

/** Lo mínimo con que se podía marcar una entrega. Nada más. */
const LO_MINIMO = (mas = {}) => ({
  fecha: '2026-10-05', iglesia_id: IGLESIA, beneficiario_tipo: 'No miembro', no_miembro_id: CARMEN,
  tipo_ayuda: 'Otro', estado: 'Entregada', salida: puente.EN_ESPECIE, ...mas,
});

const preguntar = (data, existing, confirmado) =>
  AYUDAS.hooks.beforeSave({ ...data }, { user: ADMIN, isNew: !existing, existing, db, confirmado });

/** Una ayuda de verdad en la base, para las cuentas del informe. */
function anotada(mas = {}) {
  const data = LO_MINIMO(mas);
  const campos = Object.keys(data);
  return db
    .prepare(
      `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
       VALUES (${campos.map(() => '?').join(',')})`
    )
    .run(...campos.map((c) => data[c])).lastInsertRowid;
}

/* ------------------------------- la pregunta al entregar */

test('marcarla entregada sin nada anotado pregunta antes de guardar', () => {
  const r = preguntar(LO_MINIMO());
  assert.equal(r.confirmar, 'ayuda_entregada_sin_datos');
  assert.match(r.error, /cuánto valía/);
  assert.match(r.error, /el respaldo de la entrega/);
  assert.match(r.error, /quién la aprobó/);
  assert.match(r.error, /el informe la suma como \$ 0/, 'y dice por qué importa el monto');
  assert.match(r.error, /confirme/, 'se pregunta, no se bloquea');
});

test('y confirmando, se guarda igual', () => {
  assert.equal(preguntar(LO_MINIMO(), null, true), null);
});

test('la pregunta nombra solo lo que falta', () => {
  const soloElMonto = preguntar(LO_MINIMO({ aprobada_por: 'Pastora Ruiz', soporte: 'boleta.pdf' }));
  assert.match(soloElMonto.error, /no dice cuánto valía\./);
  assert.doesNotMatch(soloElMonto.error, /quién la aprobó/);

  const dos = preguntar(LO_MINIMO({ soporte: 'boleta.pdf' }));
  assert.match(dos.error, /cuánto valía ni quién la aprobó/, 'dos se unen con «ni», no con coma');
});

test('completa, no pregunta nada', () => {
  const r = preguntar(LO_MINIMO({ valor_estimado: 25000, aprobada_por: 'Pastora Ruiz', soporte: 'b.pdf' }));
  assert.equal(r, null);
});

test('un monto en cero es lo mismo que no anotarlo', () => {
  const r = preguntar(LO_MINIMO({ valor_estimado: 0, aprobada_por: 'Pastora Ruiz', soporte: 'b.pdf' }));
  assert.match(r.error, /cuánto valía/);
});

test('lo que todavía no se entrega no se pregunta: no ha salido nada', () => {
  for (const estado of ['Solicitada', 'Aprobada', 'Rechazada']) {
    assert.equal(preguntar(LO_MINIMO({ estado, salida: null })), null, estado);
  }
});

/* ------------------------------- una sola vez, cuando sale */

test('a una entregada de antes que se abre y se guarda igual, no se le vuelve a preguntar', () => {
  /*
   * Volver a preguntarlo cada vez que se le arregla una coma a una ficha vieja
   * es ruido, y el ruido enseña a confirmar sin leer, que es lo contrario de lo
   * que esto busca. Es la misma regla que usa Tesorería con el repetido.
   */
  const yaEstaba = {
    id: 1, estado: 'Entregada', salida: puente.EN_ESPECIE,
    valor_estimado: null, soporte: null, aprobada_por: null,
  };
  assert.equal(preguntar({ descripcion: 'se le arregla una coma' }, yaEstaba), null);
});

test('pero sí cuando recién pasa a entregada', () => {
  const enTramite = { id: 2, estado: 'Aprobada', valor_estimado: null, soporte: null, aprobada_por: null };
  const r = preguntar({ estado: 'Entregada', salida: puente.EN_ESPECIE }, enTramite);
  assert.equal(r.confirmar, 'ayuda_entregada_sin_datos');
});

test('y sí cuando se está borrando un dato que estaba', () => {
  /*
   * Abrir una ficha y guardar no puede dejar en blanco algo que alguien anotó.
   * Eso no es una coma: es perder el dato.
   */
  const completa = {
    id: 3, estado: 'Entregada', salida: puente.EN_ESPECIE,
    valor_estimado: 30000, soporte: 'b.pdf', aprobada_por: 'Pastora Ruiz',
  };
  const r = preguntar({ valor_estimado: null }, completa);
  assert.equal(r.confirmar, 'ayuda_entregada_sin_datos');
  assert.match(r.error, /cuánto valía/);

  // y borrarle uno no hace que pregunte por los otros dos, que siguen ahí
  assert.doesNotMatch(r.error, /quién la aprobó/);
});

test('a una entregada de antes de la pregunta, que no dice de dónde salió, se la deja guardar', () => {
  /*
   * Salió de escribir estas pruebas. Desde la 1.204.0 no se puede marcar una
   * ayuda como entregada sin decir de dónde salió, y ese reparo alcanzaba
   * también a las que YA estaban entregadas de antes: quien entraba a
   * arreglarle una coma a una ficha de hace dos años se topaba con una
   * pregunta que a lo mejor no sabe contestar, y no podía guardar nada.
   *
   * Se exige en el momento en que la cosa sale, que es cuando alguien lo sabe.
   * Las viejas quedan como estaban, el informe las cuenta aparte y lo dice en
   * pantalla.
   */
  const deAntes = { id: 4, estado: 'Entregada', salida: null, valor_estimado: 12000,
    soporte: 'b.pdf', aprobada_por: 'Pastora Ruiz' };
  assert.equal(preguntar({ descripcion: 'una coma' }, deAntes), null);

  // Pero al pasar a entregada, se sigue exigiendo: ahí sí se sabe
  const enTramite = { id: 5, estado: 'Aprobada', salida: null };
  assert.match(String(preguntar({ estado: 'Entregada' }, enTramite)), /de dónde salió/);
});

/* ------------------------------- el informe deja de decir $ 0 a secas */

test('el informe cuenta las entregas que no dicen cuánto valían', () => {
  const mias = `WHERE iglesia_id = ${IGLESIA} AND fecha = '2026-10-05'`;
  anotada({ valor_estimado: 40000 });
  anotada({ valor_estimado: 20000 });
  anotada();                       // la que nadie valorizó
  anotada({ valor_estimado: 0 });  // y la que dice cero, que es lo mismo

  const r = aQuien.cifrasDe(db, mias, []);
  assert.equal(r.entregas, 4);
  assert.equal(r.entregado, 60000, 'la suma es la de las que sí lo dicen');
  assert.equal(r.sin_monto, 2, 'y las otras dos se cuentan, en vez de sumarse como cero');
});

test('y cada fila del informe lo dice por su cuenta', () => {
  /*
   * La fila con la mitad sin anotar se veía igual que la que está completa: su
   * cifra parecía un total cuando era un piso.
   */
  const mias = `WHERE iglesia_id = ${IGLESIA} AND fecha = '2026-10-06'`;
  anotada({ fecha: '2026-10-06', tipo_ayuda: 'Ropa', valor_estimado: 15000 });
  anotada({ fecha: '2026-10-06', tipo_ayuda: 'Ropa' });
  anotada({ fecha: '2026-10-06', tipo_ayuda: 'Vivienda', valor_estimado: 90000 });

  const porTipo = aQuien.abiertoPor(db, 'tipo_ayuda', mias, []);
  const ropa = porTipo.find((f) => f.clave === 'Ropa');
  const vivienda = porTipo.find((f) => f.clave === 'Vivienda');
  assert.equal(ropa.entregado, 15000);
  assert.equal(ropa.sin_monto, 1);
  assert.equal(vivienda.sin_monto, 0, 'la que está completa no dice nada de más');
});

test('la ficha de una persona dice lo mismo que el informe', () => {
  /*
   * La insignia de su ficha suma lo entregado igual que el informe, así que
   * arreglar uno y no el otro deja las dos pantallas diciendo cosas distintas
   * sobre la misma señora.
   */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../server/modules/ayudas_sociales.js'), 'utf8');
  assert.match(src, /AS sin_monto,/);
  assert.match(src, /sin_monto: r\.sin_monto \|\| 0,/);
});

/* ------------------------------- se puede apagar */

test('apagada la pregunta en Configuración, no pregunta nada', () => {
  /*
   * Con otra fecha, y no la de las de arriba: ahí ya hay ayudas anotadas de
   * esta misma persona y este mismo tipo, y desde la 1.206.0 eso hace su propia
   * pregunta —la del repetido—, que no es la que se está apagando acá.
   */
  ajustes.guardar('ayuda_pregunta_al_entregar', '0');
  try {
    assert.equal(preguntar(LO_MINIMO({ fecha: '2026-10-09' })), null);
  } finally {
    ajustes.guardar('ayuda_pregunta_al_entregar', '1');
  }
  // Y las cuentas del informe siguen igual: eso no es una preferencia
  const r = aQuien.cifrasDe(db, `WHERE iglesia_id = ${IGLESIA} AND fecha = '2026-10-05'`, []);
  assert.equal(r.sin_monto, 2);
});
