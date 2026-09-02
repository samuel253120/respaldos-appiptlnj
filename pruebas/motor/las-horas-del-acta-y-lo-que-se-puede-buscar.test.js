/**
 * Dos descuidos chicos del libro de actas, del mismo tamaño: algo que entra sin
 * que nadie lo mire, y algo que se guarda y después no se encuentra.
 *
 * ── LAS HORAS ──
 *
 * Los dos campos de hora entraban sin comprobación. Medido en la v1.274.0:
 *
 *   empieza 21:00 y termina 19:00 ........... 201
 *   empieza y termina a las 19:00 ........... 201
 *
 * Y así salía impresa: «Hora: 21:00 a 19:00». Es el mismo par que en las
 * directivas se comprueba desde hace tiempo, pero ahí son fechas.
 *
 * Se PREGUNTA y no se rechaza, y no por costumbre: una reunión que empieza a
 * las 23:00 y termina a las 00:30 del día siguiente es perfectamente normal, y
 * una regla escrita como «término > inicio» la rechazaría siendo correcta. No
 * se puede distinguir el error del caso legítimo mirando los datos; una persona
 * sí puede.
 *
 * ── EL BUSCADOR ──
 *
 *   buscar una palabra de la agenda ......... la encuentra
 *   buscar una palabra de los acuerdos ...... la encuentra
 *   buscar una palabra del desarrollo ....... 0 resultados
 *
 * El desarrollo es el campo más largo del acta y el que llena el botón
 * «Transcribir». O sea: se transcribía un acta escaneada entera, quedaba
 * adentro del sistema, y ninguna de sus palabras la encontraba. La función que
 * hace valioso al módulo era la que producía contenido invisible.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let n = 0;
const marca = () => `${++n}-${process.pid}`;

function unCuerpo() {
  const m = marca();
  const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `HOR${m}`).lastInsertRowid;
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

// ------------------------------------------------------- las horas ----

test('una reunión que termina antes de empezar se pregunta', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '21:00', hora_fin: '19:00' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'horas_del_acta');
  assert.match(r.json.error, /21:00/);
  assert.match(r.json.error, /19:00/, 'el aviso dice las dos horas, como el de las fechas');
});

test('y el aviso nombra el caso en que sí es correcto', async () => {
  /*
   * Sin esa frase, quien tiene un acta de vigilia legítima no sabe si confirmar
   * o si acaba de escribir algo mal.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '23:00', hora_fin: '00:30' });
  assert.match(r.json.error, /pasada la medianoche/i);
});

test('confirmando, la reunión de medianoche entra', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '23:00', hora_fin: '00:30', igual_asi: true });
  assert.equal(r.estado, 201, 'una vigilia es una reunión como cualquier otra');
});

test('empezar y terminar a la misma hora también se pregunta, y dice por qué', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '19:00', hora_fin: '19:00' });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /no duró nada/i);
});

test('lo normal no molesta a nadie', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  assert.equal((await unActa(api, e, { hora_inicio: '19:00', hora_fin: '21:00' })).estado, 201);
});

test('un acta con una sola hora anotada entra sin preguntar', async () => {
  /*
   * Muchas actas dicen a qué hora empezó la reunión y no a qué hora terminó, y
   * está bien que así sea: no hay nada que comparar. Sin el guardia, la hora
   * que falta vale cero minutos y toda acta que solo diga a qué hora empezó
   * parecería terminar a medianoche.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  assert.equal((await unActa(api, e, { hora_inicio: '19:00' })).estado, 201);
  assert.equal((await unActa(api, e, { hora_fin: '21:00' })).estado, 201);
  assert.equal((await unActa(api, e, {})).estado, 201);
});

test('y una reunión que empieza a medianoche no se confunde con una sin hora', async () => {
  /*
   * Las 00:00 son cero minutos, que en JavaScript se parece mucho a «no hay
   * dato». Comprobando con `!inicio` en vez de contra nulo, una reunión de las
   * 00:00 a las 02:00 se colaría sin mirar, y una de las 00:00 a las 22:00
   * —que sí está al revés— también.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  assert.equal((await unActa(api, e, { hora_inicio: '00:00', hora_fin: '02:00' })).estado, 201,
    'de medianoche a las dos es una vigilia normal');
  const r = await unActa(api, e, { hora_inicio: '02:00', hora_fin: '00:00' });
  assert.equal(r.estado, 400, 'y al revés sí se pregunta');
  assert.match(r.json.error, /00:00/);
});

test('las horas sin el cero delante se comparan igual', async () => {
  /*
   * La pantalla las manda siempre como «09:30»; la API, no siempre. Comparadas
   * como texto sin normalizar, «9:30» sale mayor que «21:00» y una reunión de
   * las 21:00 a las 9:30 entraría sin que nadie la mirara.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const r = await unActa(api, e, { hora_inicio: '21:00', hora_fin: '9:30' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'horas_del_acta');
});

test('editar un acta firmada y torcerle las horas pregunta las DOS cosas', async () => {
  /*
   * La marca de «guardar igual» es UNA por guardado. Preguntando primero por el
   * acta firmada y después por las horas, quien confirma la primera pasaría la
   * segunda sin haberla leído nunca. Así que cuando las dos aplican van en el
   * mismo aviso, con la más grave adelante.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const a = await unActa(api, e, { estado: 'Firmada', hora_inicio: '19:00', hora_fin: '21:00' });
  const r = await comoElFormulario(api, a.json.id, { hora_inicio: '21:00', hora_fin: '19:00' });

  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'acta_firmada', 'manda la más grave');
  assert.match(r.json.error, /está firmada/i);
  assert.match(r.json.error, /terminó a las 19:00/, 'y la otra va en el mismo aviso, no se pierde');
});

// ------------------------------------------------------ el buscador ----

test('se encuentra un acta por una palabra de su desarrollo', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const clave = `CAMIONETA${e.m.replace(/\W/g, '')}`;
  await unActa(api, e, { desarrollo: `<p>Se trató largamente el asunto de la ${clave} del cuerpo.</p>` });

  const r = await api('GET', `/actas_reuniones?q=${clave}&limit=5`);
  assert.equal(r.estado, 200);
  assert.equal(r.json.total, 1, 'es donde cae el acta transcrita del documento adjunto');
});

test('y también desde el buscador general de la barra de arriba', async () => {
  /*
   * Se llama al buscador directamente y no por la API porque `/api/buscar`
   * cuelga del servidor y no del router de módulos, que es lo que levantan
   * estas pruebas. Lo que importa es que sale de la MISMA lista de campos: sin
   * el desarrollo ahí, un acta transcrita tampoco aparecía escribiendo en la
   * barra de arriba.
   */
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const clave = `TOLDO${e.m.replace(/\W/g, '')}`;
  await unActa(api, e, { desarrollo: `<p>Se acordó arrendar el ${clave}.</p>` });

  const admin = db.prepare("SELECT * FROM usuarios WHERE rol = 'admin' ORDER BY id DESC LIMIT 1").get();
  const r = require('../../server/buscador').buscar(clave, admin);
  assert.ok(r.total >= 1, 'no aparecía escribiendo en la barra de arriba');
  assert.ok((r.grupos || []).some((g) => g.modulo === 'actas_reuniones'),
    'y aparece en el grupo que corresponde');
});

test('lo que ya se encontraba se sigue encontrando', async () => {
  const api = await elSistemaAndando();
  const e = unCuerpo();
  const clave = `SILLAS${e.m.replace(/\W/g, '')}`;
  await unActa(api, e, {
    agenda: `Punto sobre las ${clave}`,
    acuerdos: `<p>Se aprueban las ${clave}.</p>`,
    presidida_por: `Quien ${clave}`,
  });
  assert.equal((await api('GET', `/actas_reuniones?q=${clave}&limit=5`)).json.total, 1);
});

test('los dos libros de actas buscan en los mismos campos', () => {
  /*
   * El módulo hermano tenía el mismo hueco. Dos módulos que hacen lo mismo con
   * distinta lista de campos es la clase de diferencia que nadie nota hasta que
   * alguien no encuentra su acta.
   */
  const reuniones = getModule('actas_reuniones').searchFields;
  const asambleas = getModule('actas_asambleas').searchFields;
  assert.ok(reuniones.includes('desarrollo'), 'las de reunión');
  assert.ok(asambleas.includes('desarrollo'), 'y las de asamblea');
  assert.deepEqual([...reuniones].sort(), [...asambleas].sort());
});
