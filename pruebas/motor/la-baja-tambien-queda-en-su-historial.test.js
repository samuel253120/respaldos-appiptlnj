/**
 * BORRAR ALGO NO PUEDE DEJAR EL HISTORIAL AFIRMANDO QUE SIGUE AHÍ.
 *
 * Cuando se registra una ayuda a un miembro, su historial recibe una línea:
 * «Ayuda social: Vestuario — Entregada.». Al borrar la ayuda, esa línea se
 * quedaba. Medido antes de esto:
 *
 *   su historial antes de borrar ...  3 líneas
 *   después de borrar ..............  3 líneas
 *   la línea de la entrega .........  sigue ahí
 *   en el Registro de Cambios ......  sí queda
 *
 * Es el mismo hueco que tenía la carpeta de documentos y que se cerró en la
 * 1.198.0: adjuntar dejaba línea y quitar no dejaba ninguna. Acá es más
 * delicado, porque la línea que queda AFIRMA que a una persona se le entregó
 * algo, y esa afirmación sobrevivía al registro que la sostenía.
 *
 * Y no era solo de las ayudas: cuatro módulos le dejan una línea a un miembro
 * al crearse, y hasta ahora solo la carpeta dejaba la de la baja. Los otros
 * tres —la solicitud, la ayuda y el certificado— tenían el mismo hueco a un
 * nombre de distancia, así que se cierran los tres.
 *
 * Lo que cuida este archivo:
 *   · que borrar una ayuda deje su línea de baja, con de cuándo era y cuánto
 *   · que lo mismo valga para una solicitud y para un certificado
 *   · que la fecha de la línea sea la de hoy, no la del hecho
 *   · que la carpeta siga dejando UNA sola línea y no dos
 *   · y que no se escriba nada en el historial de quien ya no existe
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

require('../../server/ajustes');
const { db } = require('../../server/db');
const bitacora = require('../../server/bitacora');
const { getModule } = require('../../server/registry');

const IGLESIA = db
  /*
   * El código va con su propio nombre, y no con uno que suene bien: estas
   * pruebas comparten la base con las demás y el código de una iglesia es
   * único. «IG-BAJ1» ya lo usaba cuando-se-quita-un-papel, así que este
   * archivo se caía o no según el orden en que corrieran.
   */
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del historial','IG-HIST7','Activa')")
  .run().lastInsertRowid;

const unMiembro = (nombres) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,'De La Baja',?,'Activo')")
  .run(nombres, IGLESIA).lastInsertRowid;

const USER = { id: 9501, nombre: 'Quien Borra' };

const suHistorial = (id) => db
  .prepare('SELECT * FROM bitacora WHERE miembro_id = ? ORDER BY id')
  .all(id);

const hoy = () => db.prepare("SELECT date('now','localtime') AS d").get().d;

/* ------------------------------- la ayuda */

test('borrar una ayuda deja la línea de la baja, con de cuándo era y cuánto', () => {
  const quien = unMiembro('Rosa');
  const ayuda = {
    id: 1, miembro_id: quien, iglesia_id: IGLESIA, fecha: '2026-07-14',
    tipo_ayuda: 'Alimentos', estado: 'Entregada', valor_estimado: 45000,
  };
  bitacora.registrarEliminado(getModule('ayudas_sociales'), ayuda, USER);

  const lineas = suHistorial(quien);
  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].tipo, 'Ayuda social');
  assert.match(lineas[0].descripcion, /Se eliminó el registro de la ayuda social: Alimentos — Entregada/);
  assert.match(lineas[0].descripcion, /del 14-07-2026/, 'de cuándo era la ayuda');
  assert.match(lineas[0].descripcion, /\$ 45\.000/, 'y cuánto decía valer');
});

test('la fecha de la línea es la de hoy, no la del hecho', () => {
  /*
   * La ayuda era del 14 de julio, pero se eliminó el día que alguien la
   * eliminó. Es la misma regla con que se anota quitar un papel de una carpeta.
   */
  const quien = unMiembro('Elba');
  bitacora.registrarEliminado(getModule('ayudas_sociales'), {
    id: 2, miembro_id: quien, iglesia_id: IGLESIA, fecha: '2026-07-14',
    tipo_ayuda: 'Ropa', estado: 'Entregada', valor_estimado: 1000,
  }, USER);
  assert.equal(suHistorial(quien)[0].fecha, hoy());
});

test('una ayuda sin monto no inventa un paréntesis vacío', () => {
  const quien = unMiembro('Nora');
  bitacora.registrarEliminado(getModule('ayudas_sociales'), {
    id: 3, miembro_id: quien, iglesia_id: IGLESIA, fecha: '2026-07-14',
    tipo_ayuda: 'Ropa', estado: 'Entregada', valor_estimado: null,
  }, USER);
  const linea = suHistorial(quien)[0].descripcion;
  assert.doesNotMatch(linea, /\(\)|\(\$ 0\)/);
  assert.match(linea, /del 14-07-2026\.$/);
});

test('y una sin fecha tampoco', () => {
  const quien = unMiembro('Sara');
  bitacora.registrarEliminado(getModule('ayudas_sociales'), {
    id: 4, miembro_id: quien, iglesia_id: IGLESIA, fecha: null,
    tipo_ayuda: 'Ropa', estado: 'Solicitada', valor_estimado: null,
  }, USER);
  assert.match(suHistorial(quien)[0].descripcion, /Ropa — Solicitada\.$/);
});

/* ------------------------------- los otros dos, que tenían el mismo hueco */

test('borrar una solicitud también deja su línea', () => {
  const quien = unMiembro('Julia');
  bitacora.registrarEliminado(getModule('solicitudes'), {
    id: 5, miembro_id: quien, iglesia_id: IGLESIA, asunto: 'Ayuda con el arriendo',
    estado: 'Cerrada', fecha: '2026-06-01',
  }, USER);
  const linea = suHistorial(quien)[0];
  assert.equal(linea.tipo, 'Solicitud');
  assert.match(linea.descripcion, /Se eliminó la solicitud "Ayuda con el arriendo" \(Cerrada\)/);
});

test('y borrar un certificado, la suya', () => {
  const quien = unMiembro('Marta');
  bitacora.registrarEliminado(getModule('certificados'), {
    id: 6, miembro_id: quien, iglesia_id: IGLESIA, tipo: 'Bautismo', numero: 'C-12',
    fecha_emision: '2026-03-02',
  }, USER);
  const linea = suHistorial(quien)[0];
  assert.equal(linea.tipo, 'Certificado');
  assert.match(linea.descripcion, /Se eliminó el certificado de Bautismo N\.º C-12/);
});

/* ------------------------------- ni de más, ni a quien ya no está */

test('la carpeta de documentos sigue dejando UNA sola línea, la suya', () => {
  /*
   * La de un documento vive en LAS_CARPETAS, que sabe además escribirla en la
   * iglesia, el pastor o la solicitud de la que cuelgue. Si además estuviera en
   * esta tabla, un solo hecho dejaría dos líneas.
   */
  const quien = unMiembro('Berta');
  bitacora.registrarEliminado(getModule('documentos_miembros'), {
    id: 7, miembro_id: quien, iglesia_id: IGLESIA, nombre: 'Carnet', tipo: 'Identificación',
    fecha: '2026-01-05',
  }, USER);
  const lineas = suHistorial(quien);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0].descripcion, /Se quitó "Carnet" \(Identificación, del 05-01-2026\) de su carpeta\./);
});

test('no se le escribe nada al historial de quien ya no existe', () => {
  /*
   * Cuando se borra la ficha entera, sus ayudas se van con ella y acá llegan
   * filas que apuntan a un miembro que ya no está. Anotarlas dejaría líneas
   * colgando de nadie.
   */
  const fantasma = 998877;
  bitacora.registrarEliminado(getModule('ayudas_sociales'), {
    id: 8, miembro_id: fantasma, iglesia_id: IGLESIA, fecha: '2026-07-14',
    tipo_ayuda: 'Alimentos', estado: 'Entregada', valor_estimado: 1000,
  }, USER);
  assert.equal(suHistorial(fantasma).length, 0);
});

test('una ayuda de un no miembro no le escribe a nadie', () => {
  /*
   * Una persona no inscrita no tiene bitácora en ninguna parte —lo suyo se ve
   * en la pestaña «Ayudas» de su ficha, que muestra los registros vivos—. Acá
   * lo que se cuida es que no se invente un destinatario: sin `miembro_id` no
   * se anota nada, que es la misma regla que el resto del sistema aplica a
   * quien no está en la membresía.
   */
  const antes = db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n;
  bitacora.registrarEliminado(getModule('ayudas_sociales'), {
    id: 9, miembro_id: null, no_miembro_id: 4321, iglesia_id: IGLESIA,
    fecha: '2026-07-14', tipo_ayuda: 'Alimentos', estado: 'Entregada', valor_estimado: 1000,
  }, USER);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n, antes);
});

/* ------------------------------- y el alta sigue igual */

test('el alta no cambió: crear una ayuda sigue dejando su línea, con la fecha del hecho', () => {
  const quien = unMiembro('Ana');
  const nueva = {
    id: 10, miembro_id: quien, iglesia_id: IGLESIA, fecha: '2026-07-14',
    tipo_ayuda: 'Alimentos', estado: 'Entregada',
  };
  bitacora.registrarGuardado(getModule('ayudas_sociales'), {
    isNew: true, antes: null, despues: nueva, datos: nueva, user: USER,
  });
  const linea = suHistorial(quien)[0];
  assert.match(linea.descripcion, /^Ayuda social: Alimentos — Entregada\.$/);
  assert.equal(linea.fecha, '2026-07-14', 'la del hecho, no la de hoy');
});
