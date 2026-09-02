/**
 * Un libro de partes es un correlativo, o no es un libro.
 *
 * La oficina de partes existe para poder decir, dos años después y ante quien
 * sea, que un documento entró tal día. Eso lo sostiene el número: sin él una
 * anotación no se puede citar —«el oficio 45 que enviamos»— ni se puede echar
 * de menos, que es lo único que un correlativo aporta.
 *
 * MEDIDO en la v1.283.0, sobre una oficina vacía:
 *
 *   crear un Recibido sin número .............. 201, número vacío
 *   crear un Emitido sin número ............... 201, número vacío
 *   el libro, con dos así ..................... los imprimía con un guion,
 *                                               bajo un cierre que decía
 *                                               «constan 2 documento(s)»
 *   y con cinco guardados, el sistema proponía  «REC-001-2026» otra vez
 *
 * Lo último es lo que convierte el descuido en daño: la propuesta cuenta solo
 * los números que siguen el formato —lo cual es correcto—, así que los que no
 * tienen ninguno no corren la serie y el 001 se ofrece indefinidamente.
 *
 * Los otros tres libros que este sistema numera lo exigían desde siempre. Este
 * es el que existe PARA ser un correlativo, y era el único que no.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

/** Una iglesia recién hecha, para que su libro empiece vacío. */
function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `OP${m}`.slice(0, 18)).lastInsertRowid;
}

// ------------------------------------------------ los dos que sí numeran ----

test('un documento recibido sin número no entra', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio sin número',
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /N\.º de la oficina de partes/);
  assert.match(r.json.error, /obligatorio/);
});

test('y uno emitido, tampoco', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: unaIglesia(), titulo: 'Carta sin número',
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /N\.º de la oficina de partes/);
});

test('con su número, entra', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con número',
    numero: `REC-001-${m}`,
  });
  assert.equal(r.estado, 201);
  assert.equal(r.json.numero, `REC-001-${m}`);
});

test('un número de puros espacios es un número vacío', async () => {
  /*
   * Lo comprueba el motor para todos los campos de texto obligatorios desde la
   * v1.230.0, y acá se deja fijado porque un correlativo hecho de espacios es
   * exactamente lo que este hallazgo quería impedir: una fila en el libro con
   * la columna del número en blanco.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con espacios', numero: '   ',
  });
  assert.equal(r.estado, 400);
});

// ------------------------------------------- y el que no lleva correlativo ----

test('lo interno o de archivo entra sin número, porque no lleva', async () => {
  /*
   * La otra mitad del hallazgo, y la que hace que el arreglo no sea «poner
   * obligatorio y ya». Una escritura no entró por la ventanilla: ponerle un
   * número de oficina de partes afirmaría que sí. Su casilla ni se muestra.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Interno o de archivo', iglesia_id: unaIglesia(),
    titulo: 'Escritura del templo', tipo: 'Escritura / Propiedad',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.json.numero, null);
});

test('y pasar a archivo uno que sí tenía número tampoco lo exige de vuelta', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const iglesia = unaIglesia();
  const creado = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: iglesia, titulo: 'Contrato que se archiva',
    numero: `REC-007-${m}`,
  });
  assert.equal(creado.estado, 201);

  const guardado = await api('PUT', `/documentos/${creado.json.id}`, {
    flujo: 'Interno o de archivo',
  });
  assert.equal(guardado.estado, 200, 'el flujo que no numera no puede quedar bloqueado por el número');
  assert.equal(guardado.json.numero, null);
});

// ------------------------------------------------ lo que ya está guardado ----

test('un documento viejo sin número no se puede volver a guardar sin ponérselo', async () => {
  /*
   * Es la consecuencia buscada: los que ya entraron sin número se corrigen al
   * pasar por ellos. Se escribe directo en la base porque por la API ya no hay
   * manera de crear uno así — que es justamente lo que se acaba de arreglar.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const id = db.prepare(
    "INSERT INTO documentos (flujo, iglesia_id, titulo, estado) VALUES ('Recibido', ?, ?, 'Ingresado')"
  ).run(iglesia, `Viejo sin número ${marca()}`).lastInsertRowid;

  const soloElEstado = await api('PUT', `/documentos/${id}`, { estado: 'En trámite' });
  assert.equal(soloElEstado.estado, 400, 'no se deja pasar de largo');
  assert.match(soloElEstado.json.error, /N\.º de la oficina de partes/);

  const conNumero = await api('PUT', `/documentos/${id}`, {
    estado: 'En trámite', numero: `REC-090-${marca()}`,
  });
  assert.equal(conNumero.estado, 200, 'y poniéndoselo, se guarda');
});

// --------------------------------------------- la propuesta vuelve a correr ----

test('con el número obligatorio, la propuesta ya no se queda pegada en el 001', async () => {
  /*
   * El daño de fondo. La propuesta cuenta solo los números con formato, así
   * que los documentos sin número no corrían la serie: con cinco guardados
   * seguía ofreciendo «REC-001-2026», y quien lo aceptara chocaría con el
   * primero que sí lo tuviera.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const anio = new Date().getFullYear();

  for (let n = 1; n <= 3; n++) {
    const r = await api('POST', '/documentos', {
      flujo: 'Recibido', iglesia_id: iglesia, titulo: `Oficio ${n}`,
      numero: `REC-${String(n).padStart(3, '0')}-${anio}`,
      fecha_registro: `${anio}-03-0${n}`,
    });
    assert.equal(r.estado, 201);
  }

  const propuesta = await api('GET', `/documentos/proximo-numero?iglesia_id=${iglesia}&flujo=Recibido`);
  assert.equal(propuesta.estado, 200);
  assert.equal(propuesta.json.numero, `REC-004-${anio}`, 'la serie corre');
});

// ------------------------------------------------ los cuatro libros, iguales ----

test('los cuatro libros que el sistema numera exigen su número', () => {
  /*
   * Lo que hacía raro a este hallazgo no era la regla, era la excepción: tres
   * módulos la tenían y el cuarto no. Esta prueba se pone roja si alguno la
   * pierde, en cualquiera de los cuatro.
   */
  const { getModule } = require('../../server/registry');
  const cuales = [
    ['actas_reuniones', 'numero_acta'],
    ['actas_asambleas', 'numero_acta'],
    ['certificados', 'numero'],
    ['documentos', 'numero'],
  ];
  for (const [modulo, campo] of cuales) {
    const f = getModule(modulo).fields.find((x) => x.name === campo);
    assert.ok(f, `${modulo} tiene el campo ${campo}`);
    assert.equal(f.required, true, `${modulo}.${campo} es obligatorio`);
  }
});

test('y el de la oficina de partes lo exige solo donde hay correlativo', () => {
  const { getModule } = require('../../server/registry');
  const f = getModule('documentos').fields.find((x) => x.name === 'numero');
  assert.deepEqual(f.showIf, { field: 'flujo', in: ['Recibido', 'Emitido'] });
});

// ------------------------------------------------- lo que la pantalla hace ----

test('al editar, la pantalla propone el número que falta', () => {
  /*
   * ESTA PRUEBA MIRA EL CÓDIGO, NO LO QUE PASA. Se deja escrito para que se
   * sepa: no comprueba que la casilla se llene, comprueba que no vuelva a
   * ponerse la línea que impedía llenarla.
   *
   * El motivo es que no hay dónde comprobarlo de verdad. La casilla se llena
   * en el navegador, y el caso solo existe sobre un documento GUARDADO SIN
   * NÚMERO, que después de este arreglo ya no se puede crear por ninguna vía:
   * la suite de humo —que es la que maneja un navegador— habla por HTTP contra
   * un sistema andando y no es dueña de la base, así que no puede fabricar uno;
   * y el motor, que sí es dueño de su base, no tiene navegador.
   *
   * Lo que sí queda vigilado de verdad es la clase entera del defecto: humo
   * revisa, en el formulario de EDICIÓN de todos los módulos, que ningún campo
   * obligatorio a la vista esté vacío. El día que exista un registro así, lo
   * dice. Lo que no puede es inventarse uno.
   *
   * Hasta la v1.283.0 la línea era `if (!isNew) return;` —«lo ya guardado
   * conserva el número que tenga»—, que es cierto cuando tiene alguno y falso
   * cuando no: con el número recién hecho obligatorio, ese documento se abría
   * con una casilla obligatoria vacía y sin nada que ofrecer.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const trozo = app.slice(app.indexOf('function proponerElNumeroDeActa'));
  const cuerpo = trozo.slice(0, trozo.indexOf('\n}\n') + 3);

  assert.ok(cuerpo.length > 400 && cuerpo.length < 4000, `el recorte mide ${cuerpo.length}`);
  assert.ok(!/if \(!isNew\) return;/.test(cuerpo),
    'volvió la salida temprana que dejaba sin propuesta a lo ya guardado');
  assert.match(cuerpo, /if \(!isNew && campo\.value\.trim\(\)\) return;/,
    'se propone al editar solo cuando la casilla está vacía');
});
