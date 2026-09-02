/**
 * Un acta sin una palabra escrita y sin nada adjunto.
 *
 * Lo obligatorio de un acta es su número, su fecha, su iglesia y su cuerpo:
 * todo lo que el acta DICE es opcional. Está bien pensado a medias, y a
 * propósito —el módulo permite que un acta vaya solo adjunta, y también que se
 * escriba acá sin adjuntar nada—. Lo que faltaba es la esquina que queda:
 * ninguna de las dos. Medido en la v1.275.0:
 *
 *   sin agenda, sin desarrollo, sin acuerdos, sin adjunto ... 201
 *   y su PDF ............................................... 200
 *   vaciarle a una que ya decía algo ....................... 200
 *
 * No es un acta a medio llenar: es una ficha que no contiene nada, y se imprime
 * con el membrete de la institución y dos líneas de firma al pie.
 *
 * Se pregunta y no se rechaza porque hay un caso legítimo y corriente: crear la
 * ficha ahora para adjuntarle el escaneo al rato.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unCuerpo() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `VAC${m}`).lastInsertRowid;
  const cuerpo = db.prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo ${m}`, iglesia).lastInsertRowid;
  return { m, iglesia, cuerpo };
}

const unActa = (api, e, cambios) => api('POST', '/actas_reuniones', {
  numero_acta: `${e.m}-${Math.random().toString(36).slice(2, 7)}`,
  fecha: '2026-03-15', cuerpo_id: e.cuerpo, ...cambios,
});

async function comoElFormulario(api, id, cambios) {
  const ficha = (await api('GET', `/actas_reuniones/${id}`)).json;
  const cuerpo = { ...ficha, ...cambios };
  delete cuerpo.id;
  return api('PUT', `/actas_reuniones/${id}`, cuerpo);
}

// ---------------------------------------------------- la ficha en blanco ----

test('un acta sin nada adentro se pregunta', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e);
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_sin_nada');
  assert.match(r.json.error, /no dice nada/i);
  assert.match(r.json.error, /dos líneas de firma/i,
    'la consecuencia es que se imprime pareciendo un documento');
});

test('y el aviso ofrece el caso legítimo, que es el corriente', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e);
  assert.match(r.json.error, /adjuntarle el escaneo más tarde/i,
    'crear la ficha para adjuntar el papel al rato es exactamente lo que se hace');
});

test('confirmando, entra', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { igual_asi: true });
  assert.equal(r.estado, 201, 'pregunta, no impide');
});

test('con cualquiera de las tres cosas escritas no molesta a nadie', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  for (const [campo, valor] of [
    ['agenda', '1. Presupuesto anual'],
    ['desarrollo', '<p>Se discutió largamente.</p>'],
    ['acuerdos', '<p>Se aprueba comprar sillas.</p>'],
  ]) {
    const r = await unActa(api, e, { [campo]: valor });
    assert.equal(r.estado, 201, `con ${campo} escrito`);
  }
});

test('y con el documento adjunto tampoco', async () => {
  /*
   * Es la mitad que el módulo permite a propósito: «Se puede dejar en blanco si
   * el acta va adjunta». El adjunto se pone por detrás porque el motor exige
   * que el archivo esté de verdad en el disco, y lo que se prueba es la regla.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { igual_asi: true });
  db.prepare("UPDATE actas_reuniones SET documento = 'acta-firmada.pdf' WHERE id = ?").run(a.json.id);
  const r = await comoElFormulario(api, a.json.id, { lugar: 'Salón parroquial' });
  assert.equal(r.estado, 200, 'un acta que va adjunta está completa');
});

test('el texto rico vacío no cuenta como escrito', async () => {
  /*
   * Un editor de texto con formato deja «<p></p>» o «<p><br></p>» cuando se
   * borra todo. Mirando el campo a secas parece que dice algo.
   *
   * Quien lo vacía es server/textorico.js, antes del guardado y por las dos
   * puertas —la pantalla y la importación—, así que el módulo no lo mira dos
   * veces. La prueba se queda igual: lo que importa es que un acta vacía se
   * note, no en qué capa se note. Rompiendo ese limpiador, esta se pone roja.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { desarrollo: '<p><br></p>', acuerdos: '<p></p>' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_sin_nada');
});

test('vaciar un acta que decía algo se avisa distinto', async () => {
  /*
   * No es lo mismo una ficha que nace en blanco —un trámite pendiente— que un
   * acta que decía algo y se queda sin nada, que es una pérdida.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { agenda: '1. Presupuesto', acuerdos: '<p>Se acordó comprar sillas.</p>' });
  const r = await comoElFormulario(api, a.json.id, { agenda: '', acuerdos: '' });

  assert.equal(r.estado, 400);
  assert.match(r.json.error, /decía algo y va a quedar sin nada/i);
  assert.match(r.json.error, /Registro de Cambios/, 'y dice dónde quedó lo que decía');
});

// ------------------------------- varias advertencias en un solo aviso ----

test('cuando hay dos cosas que revisar, se dicen las dos y se numeran', async () => {
  /*
   * La marca de «guardar igual» es UNA por guardado: preguntando de a una, quien
   * confirma la primera pasaría las demás sin haberlas leído nunca. Y numerarlas
   * no es adorno: quien contesta necesita saber a cuántas cosas le está diciendo
   * que sí.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '21:00', hora_fin: '19:00' });

  assert.equal(r.estado, 400);
  assert.match(r.json.error, /Hay dos cosas que revisar/);
  assert.match(r.json.error, /\(1\)/);
  assert.match(r.json.error, /\(2\)/);
  assert.match(r.json.error, /no dice nada/i);
  assert.match(r.json.error, /21:00/);
});

test('y manda la clave de la más grave', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada', agenda: '1. Presupuesto' });
  const r = await comoElFormulario(api, a.json.id, { agenda: '', hora_inicio: '21:00', hora_fin: '19:00' });

  assert.equal(r.json.confirmar, 'acta_firmada', 'tocar un documento firmado manda sobre lo demás');
  assert.match(r.json.error, /Hay 3 cosas que revisar/);
  assert.match(r.json.error, /está firmada/i);
  assert.match(r.json.error, /quedar sin nada/i);
  assert.match(r.json.error, /19:00/);
});

test('la pantalla sabe ponerle título a cada una de estas preguntas', () => {
  /*
   * Sin su entrada, el aviso sale con el encabezado genérico «Revise esto antes
   * de guardar» y los botones «Volver y corregirlo» / «Está bien, guardar así»,
   * que no dicen a qué se está diciendo que sí.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  for (const clave of ['acta_firmada', 'acta_sin_nada', 'horas_del_acta', 'acta_que_se_borra']) {
    assert.match(app, new RegExp(`${clave}:\\s*\\{`), `falta el título de «${clave}»`);
  }
});
