/**
 * Lo que queda por hacer después de responder, y las hojas que se cuentan.
 *
 * Dos hallazgos de la oficina de partes, los dos de la misma familia: el
 * sistema sabía algo y no lo decía.
 *
 *   OP-10  Registrar la respuesta a un oficio no ofrecía cerrarlo.
 *          MEDIDO en la v1.289.0: la respuesta se guardaba enlazada con un
 *          201 y el oficio contestado seguía diciendo «Ingresado». De los seis
 *          estados, «Respondido» existe para este momento exacto y no lo ponía
 *          nadie.
 *
 *   OP-11  Los folios se descartaban o se redondeaban en silencio.
 *          MEDIDO en la v1.289.0, mandando cada valor por la API:
 *
 *            −8 ....... 201, y el campo quedaba vacío
 *            «2,7» .... 201, y el campo quedaba vacío
 *            2.7 ...... 201, y quedaba 3
 *            0 ........ 201, y el campo quedaba vacío
 *            «ocho» ... 201, y el campo quedaba vacío
 *
 *          El cierre del libro suma esta columna: un descarte callado deja la
 *          suma corta sin que nadie se entere.
 *
 * Lo de los folios destapó algo que no es de este módulo y está probado acá
 * abajo: el motor convertía los campos numéricos antes de revisarlos, así que
 * su propio aviso —«tiene que ser un número»— era inalcanzable para los 39
 * módulos. La otra puerta del sistema, la importación por planilla, ya lo
 * rechazaba bien desde la 1.96.2.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Oficina ${m}`, `OP${m}`.slice(0, 18)).lastInsertRowid;
}

async function unDocumento(api, campos) {
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', titulo: `Oficio ${marca()}`, numero: `REC-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

// ══════════════════════════ OP-10 · el hilo, y el paso que queda ══

test('el hilo dice a qué contesta este documento, y que el otro sigue abierto', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const oficio = await unDocumento(api, { iglesia: undefined, iglesia_id: iglesia, estado: 'Ingresado' });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: iglesia, titulo: 'La respuesta',
    numero: `EMI-${marca()}`, responde_a: oficio.id,
  });
  assert.equal(respuesta.estado, 201);

  const hilo = await api('GET', `/documentos/${respuesta.json.id}/el-hilo`);
  assert.equal(hilo.estado, 200);
  assert.equal(Number(hilo.json.contesta.id), Number(oficio.id));
  assert.equal(hilo.json.contesta.estado, 'Ingresado');
  assert.equal(hilo.json.contesta.abierto, true, 'el trámite del otro sigue abierto');
  assert.equal(hilo.json.seMarcaComo, 'Respondido', 'y dice qué estado se ofrece');
  assert.deepEqual(hilo.json.loContestan, [], 'a una respuesta no la contesta nadie');
});

test('y desde el otro lado, quién lo contestó', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const oficio = await unDocumento(api, { iglesia_id: iglesia, titulo: 'Oficio contestado' });
  const respuesta = await api('POST', '/documentos', {
    flujo: 'Emitido', iglesia_id: iglesia, titulo: 'La respuesta',
    numero: `EMI-${marca()}`, responde_a: oficio.id, fecha_registro: '2026-03-12',
  });
  assert.equal(respuesta.estado, 201);

  const hilo = await api('GET', `/documentos/${oficio.id}/el-hilo`);
  assert.equal(hilo.estado, 200);
  assert.equal(hilo.json.loContestan.length, 1);
  assert.equal(hilo.json.loContestan[0].numero, respuesta.json.numero);
  assert.equal(hilo.json.loContestan[0].fecha_registro, '2026-03-12', 'con cuándo se despachó');
  assert.equal(hilo.json.abierto, true, 'y que este documento sigue abierto');
  assert.equal(hilo.json.contesta, null);
});

test('un documento sin hilo no ofrece nada', async () => {
  /*
   * El contrapeso: la tarjeta no puede salir en todas las fichas. Un documento
   * suelto no contesta nada ni lo contesta nadie, y la ficha se ve como antes.
   */
  const api = await elSistemaAndando();
  const solo = await unDocumento(api, { iglesia_id: unaIglesia() });
  const hilo = await api('GET', `/documentos/${solo.id}/el-hilo`);
  assert.equal(hilo.estado, 200);
  assert.equal(hilo.json.contesta, null);
  assert.deepEqual(hilo.json.loContestan, []);
});

test('marcarlo como Respondido es un guardado corriente, y queda anotado', async () => {
  /*
   * El botón de la ficha no tiene una ruta propia: hace el mismo PUT que
   * haría una persona editando la ficha. Así pasa por los permisos, por el
   * alcance y por el Registro de Cambios, sin una puerta de servicio que
   * mañana haya que volver a revisar.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const oficio = await unDocumento(api, { iglesia_id: iglesia, estado: 'Ingresado' });

  const r = await api('PUT', `/documentos/${oficio.id}`, { estado: 'Respondido' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.estado, 'Respondido');

  const hilo = await api('GET', `/documentos/${oficio.id}/el-hilo`);
  assert.equal(hilo.json.abierto, false, 'ya no está abierto');
});

test('los tres estados abiertos son los tres primeros, y «Respondido» es el que se ofrece', () => {
  /*
   * La pantalla no inventa el estado: se lo pregunta al servidor. Esta prueba
   * fija de dónde sale, para que renombrar un estado en la lista no deje el
   * botón ofreciendo uno que ya no existe.
   */
  const def = require('../../server/modules/documentos');
  const estados = def.fields.find((f) => f.name === 'estado').options;
  assert.deepEqual(estados.slice(0, 4),
    ['Ingresado', 'Derivado', 'En trámite', 'Respondido']);
});

test('el hilo de un documento ajeno no se lee', async () => {
  const api = await elSistemaAndando();
  const suya = unaIglesia();
  const ajena = unaIglesia();
  const ajeno = await unDocumento(api, { iglesia_id: ajena });

  const { comoOtroUsuario } = require('./andando');
  const { digitoVerificador } = require('../../server/rut');
  const numero = `${60000000 + (process.pid % 9000000)}`;
  const usuario = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, iglesia_id, iglesias) VALUES (?, ?, 'admin', 1, ?, ?)"
  ).run(`Secretaria ${marca()}`, `${numero}-${digitoVerificador(numero)}`, suya,
    JSON.stringify([suya])).lastInsertRowid;

  const r = await comoOtroUsuario(usuario)('GET', `/documentos/${ajeno.id}/el-hilo`);
  assert.equal(r.estado, 403);
});

// ══════════════════════════════════════ OP-11 · los folios ══

test('un folio negativo se rechaza, y ya no se borra en silencio', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con folios raros',
    numero: `REC-${marca()}`, folios: -8,
  });
  assert.equal(r.estado, 400, 'antes contestaba 201 con el campo vacío');
  assert.match(r.json.error, /Folios/);
  assert.match(r.json.error, /mayor que cero/);
});

test('y cero tampoco: un documento de cero hojas no es un documento', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio de cero hojas',
    numero: `REC-${marca()}`, folios: 0,
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /mayor que cero/);
});

test('media hoja no es una hoja: 2,7 folios se rechaza en vez de redondearse', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con decimales',
    numero: `REC-${marca()}`, folios: 2.7,
  });
  assert.equal(r.estado, 400, 'antes se guardaba como 3, sin decirlo');
  assert.match(r.json.error, /entero/);
});

test('lo que no es un número se rechaza, y esto vale para los 39 módulos', async () => {
  /*
   * ACÁ NO SE PRUEBA LA OFICINA DE PARTES, se prueba el motor.
   *
   * `coerce` convierte los campos numéricos con `Number(...)` y deja en nulo lo
   * que no lo sea. La revisión de límites miraba el valor YA CONVERTIDO, así
   * que su propio aviso —«tiene que ser un número»— no lo podía alcanzar nunca
   * para un campo de tipo número: el dato se borraba con un 200 y sin una
   * palabra. Se comprueba con los folios porque es donde se encontró.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con letras',
    numero: `REC-${marca()}`, folios: 'ocho',
  });
  assert.equal(r.estado, 400, 'antes contestaba 201 y el campo quedaba vacío');
  assert.match(r.json.error, /tiene que ser un número/);
});

test('y una coma decimal escrita a mano no se traga el dato', async () => {
  // «2,7» no es un número para `Number(...)`: se perdía entero, no se redondeaba.
  const api = await elSistemaAndando();
  const r = await api('POST', '/documentos', {
    flujo: 'Recibido', iglesia_id: unaIglesia(), titulo: 'Oficio con coma',
    numero: `REC-${marca()}`, folios: '2,7',
  });
  assert.equal(r.estado, 400);
  assert.match(r.json.error, /tiene que ser un número/);
});

test('un número de folios de verdad entra igual que siempre', async () => {
  const api = await elSistemaAndando();
  const doc = await unDocumento(api, { iglesia_id: unaIglesia(), folios: 40 });
  assert.equal(doc.folios, 40);
});

test('y dejar los folios en blanco sigue siendo dejarlos en blanco', async () => {
  /*
   * El contrapeso, y es el que decide si el arreglo sirve: vaciar a propósito
   * es una operación legítima —el campo no es obligatorio— y no puede
   * confundirse con mandar basura. Se prueban las tres maneras de decir
   * «nada»: la cadena vacía, el nulo, y no mandar el campo.
   */
  const api = await elSistemaAndando();
  const doc = await unDocumento(api, { iglesia_id: unaIglesia(), folios: 12 });

  const vacio = await api('PUT', `/documentos/${doc.id}`, { folios: '' });
  assert.equal(vacio.estado, 200, JSON.stringify(vacio.json));
  assert.equal(vacio.json.folios, null);

  const conNumero = await api('PUT', `/documentos/${doc.id}`, { folios: 5 });
  assert.equal(conNumero.json.folios, 5);
  const nulo = await api('PUT', `/documentos/${doc.id}`, { folios: null });
  assert.equal(nulo.estado, 200);
  assert.equal(nulo.json.folios, null);

  const sinMandarlo = await api('PUT', `/documentos/${doc.id}`, { observaciones: 'sin tocar los folios' });
  assert.equal(sinMandarlo.estado, 200);
});

test('una casilla numérica con puros espacios es una casilla vacía', async () => {
  /*
   * El otro lado de la revisión, y hace falta decirlo: lo que se revisa es lo
   * que LLEGÓ, sin convertir, así que hay que distinguir «mandaron algo que no
   * es un número» de «mandaron nada». Unos espacios son nada —es la misma
   * regla que el motor aplica a los campos de texto obligatorios desde la
   * v1.230.0—, y tratarlos como un valor daría «tiene que ser mayor que cero»,
   * que para una casilla que se ve vacía no quiere decir nada.
   */
  const api = await elSistemaAndando();
  const doc = await unDocumento(api, { iglesia_id: unaIglesia(), folios: 9 });

  const r = await api('PUT', `/documentos/${doc.id}`, { folios: '   ' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.folios, null, 'se vacía, que es lo que se pidió');
});

test('el campo declara la regla, y no la esconde en un gancho', () => {
  /*
   * Estaba escrita dentro del gancho de guardado del módulo —«si no es mayor
   * que cero, nulo; si no, redondear»—, que es lo que la hacía invisible: ni
   * la pantalla ni la planilla podían saber que existía. Declarada en el
   * campo, la respetan los tres caminos.
   */
  const def = require('../../server/modules/documentos');
  const f = def.fields.find((x) => x.name === 'folios');
  assert.equal(f.min, 1);
  assert.equal(f.entero, true);
});

test('la planilla exige lo mismo que el formulario', async () => {
  /*
   * La otra puerta. La importación ya rechazaba «ocho» desde la 1.96.2 —era el
   * formulario el que callaba—, y ahora que los folios declaran su mínimo,
   * también lo aplica: las dos puertas piden lo mismo, que es la regla que
   * este sistema viene sosteniendo desde la v1.284.0.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/importar/documentos', {
    prueba: true,
    filas: [
      { flujo: 'Recibido', titulo: 'Por planilla, con letras', numero: `REC-${marca()}`,
        iglesia_id: unaIglesia(), folios: 'ocho' },
      { flujo: 'Recibido', titulo: 'Por planilla, en cero', numero: `REC-${marca()}`,
        iglesia_id: unaIglesia(), folios: 0 },
    ],
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  const problemas = JSON.stringify(r.json);
  assert.match(problemas, /no es un número válido/, 'las letras, desde siempre');
  assert.match(problemas, /mayor que cero/, 'y el mínimo, ahora que el campo lo declara');
});

// ═══════════════════════════ y la cara que le pone la pantalla ══

test('la ficha de un documento pide su hilo y ofrece el botón', () => {
  /*
   * ESTA PRUEBA MIRA EL CÓDIGO, NO LO QUE PASA, y se deja escrito.
   *
   * La tarjeta se pinta en el navegador y el motor no tiene uno. Lo que sí
   * puede vigilar es que la ficha siga pidiendo el hilo y que el botón siga
   * haciendo el guardado corriente —no una ruta propia—: si un día alguien
   * quita la línea, la ruta del servidor seguiría contestando perfecto y en la
   * pantalla no habría nada, que es la manera más silenciosa de perder esto.
   *
   * Que se vea de verdad se comprobó en el navegador, con la ficha abierta.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  assert.match(app, /if \(name === 'documentos'\) renderElHiloDelDocumento\(id, row,/,
    'la ficha de un documento tiene que pedir su hilo');

  const desde = app.indexOf('async function renderElHiloDelDocumento');
  assert.ok(desde > 0, 'la función existe');
  const cuerpo = app.slice(desde, app.indexOf('\nasync function', desde + 10));
  assert.match(cuerpo, /\/documentos\/\$\{id\}\/el-hilo/, 'le pregunta al servidor');
  assert.match(cuerpo, /api\('PUT', `\/documentos\/\$\{boton\.dataset\.cerrar\}`/,
    'y el botón guarda como guardaría una persona, sin puerta de servicio');
  assert.match(cuerpo, /perms\.edit/, 'y solo se ofrece a quien puede editar');
});

test('y la regla llega hasta la pantalla, que si no no la puede aplicar', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito por lo que costó encontrarlo: la
   * descripción del sistema (/api/meta) no manda los campos enteros, manda una
   * lista escogida de sus propiedades. `entero` no estaba en esa lista, así que
   * el navegador recibía el campo SIN la regla: el teclado del teléfono seguía
   * saliendo con coma y el aviso no aparecía nunca. Se vio abriendo la ficha en
   * el navegador, no en las pruebas — que es justamente por qué se abre.
   */
  const fs = require('fs');
  const path = require('path');
  const index = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
  const desde = index.indexOf('.map(({ name, label, type, required, options');
  assert.ok(desde > 0, 'se encontró la descripción de los campos');
  const trozo = index.slice(desde, desde + 3000);
  assert.match(trozo, /min, max, entero,/, 'el motor tiene que sacar `entero` del campo');
  assert.match(trozo, /entero: !!entero,/, 'y mandarlo en la descripción');
});

test('la pantalla avisa del entero mientras se escribe, con las mismas palabras', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito. El aviso del navegador es un atajo, no
   * la regla —el servidor lo revisa igual—, pero si dijera otra cosa que el
   * servidor, quien lo lea aprendería a desconfiar de los dos.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function avisarSiNoCabe');
  const cuerpo = app.slice(desde, app.indexOf('\n}', desde));
  assert.ok(cuerpo.length > 300, `el recorte mide ${cuerpo.length}`);
  /*
   * ANCLADA A LA LÍNEA ENTERA, y esto se aprendió rompiéndola: escrita como
   * `/f\.entero && !Number\.isInteger\(n\)/` la afirmación seguía siendo
   * cierta con la rama apagada —«false && f.entero && …» la contiene—, así que
   * la prueba pasaba con el aviso desactivado.
   */
  assert.match(cuerpo, /\} else if \(f\.entero && !Number\.isInteger\(n\)\) \{/);
  assert.match(cuerpo, /entero, sin decimales/);
});
