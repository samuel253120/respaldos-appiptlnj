/**
 * CE-02 · Renombrar un tipo de certificado dejaba sin texto a los ya emitidos.
 *
 * Un certificado no guarda de qué formato salió: guarda su NOMBRE, en «tipo»,
 * y con ese nombre se va a buscar el formato cada vez que la hoja se imprime.
 * Eso es a propósito —un certificado viejo se sigue imprimiendo con el formato
 * que le corresponde aunque entremedio se hayan creado otros—, pero deja el
 * hilo colgando de una cadena de texto que se puede editar.
 *
 * MEDIDO en la v1.292.0: renombrar «Bautismo» a «Bautismo en las aguas»
 * contestaba 200 sin preguntar nada. El certificado ya emitido quedaba con
 * tipo «Bautismo», `/formatos_certificado/para?tipo=Bautismo` devolvía nulo, y
 * la hoja salía con su orla, su número, el nombre del titular y las dos rayas
 * de firma, y un hueco en el medio: no certificaba nada. Firmada y entregada,
 * parecía un certificado.
 *
 * Llama la atención porque el mismo módulo YA cuidaba el otro lado: borrar un
 * formato en uso estaba bloqueado, con un aviso que dice cuántos son y qué
 * hacer en vez. Renombrarlo hace exactamente el mismo daño y no preguntaba.
 *
 * SE ARREGLA DE LAS DOS MANERAS, que no se estorban:
 *
 *   · El servidor PREGUNTA al renombrar un formato en uso, diciendo a cuántos
 *     certificados afecta, y al contestar que sí se los lleva con él.
 *   · Y la hoja DICE cuando le falta el texto, en vez de imprimir el hueco.
 *     Es la red de abajo: quedan otras maneras de llegar ahí —sin permiso para
 *     traer el formato, sin señal, un formato al que le borraron el texto—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/formatos_certificado');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

/*
 * PRIMERO SE SIEMBRA, Y RECIÉN DESPUÉS SE CREAN FORMATOS.
 *
 * Todos los archivos del motor comparten UNA base, y la siembra de los ocho
 * formatos que trae el sistema solo siembra si la tabla está VACÍA —así tiene
 * que ser: una iglesia que ya venía usando el sistema no puede recibir ocho
 * formatos encima—. Este archivo crea formatos por su cuenta, y creándolos
 * antes dejaba la tabla «no vacía»: la siembra se marcaba como hecha sin haber
 * puesto nada, y los otros dos archivos de certificados se quedaban sin sus
 * ocho formatos. Corriendo la siembra acá arriba, primero está lo de siempre y
 * después lo de esta prueba, pase quien pase primero.
 */
require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Formatos ${m}`, `FC${m}`.slice(0, 18)).lastInsertRowid;
}

/** Un formato con su nombre propio, para que dos pruebas en paralelo no se pisen. */
async function unFormato(api, campos = {}) {
  const r = await api('POST', '/formatos_certificado', {
    nombre: `Bautismo ${marca()}`, activo: 1,
    texto: 'Certificamos que {titular} fue bautizado.', ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

async function unCertificadoDe(api, tipo) {
  const r = await api('POST', '/certificados', {
    tipo, iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

// ═════════════════════════════════════════ renombrar pregunta ══

test('renombrar un formato con certificados emitidos PREGUNTA en vez de guardar', async () => {
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  await unCertificadoDe(api, formato.nombre);

  const r = await api('PUT', `/formatos_certificado/${formato.id}`, { nombre: `${formato.nombre} en las aguas` });
  assert.equal(r.estado, 400, 'antes contestaba 200 y renombraba en silencio');
  assert.equal(r.json.confirmar, 'formato_que_se_renombra',
    'y es una PREGUNTA, no un rechazo: la pantalla la convierte en dos botones');

  const sigue = await api('GET', `/formatos_certificado/${formato.id}`);
  assert.equal(sigue.json.nombre, formato.nombre, 'mientras no contesten, el formato no se movió');
});

test('el aviso dice CUÁNTOS son, qué les pasa, y qué otra cosa se puede hacer', async () => {
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  for (let i = 0; i < 3; i += 1) await unCertificadoDe(api, formato.nombre);

  const r = await api('PUT', `/formatos_certificado/${formato.id}`, { nombre: `${formato.nombre} II` });
  const aviso = String(r.json.error);
  assert.match(aviso, /\b3 certificado/, 'el número: sin él, se contesta que sí sin saber si son dos o doscientos');
  assert.match(aviso, /se siguen imprimiendo con este formato/, 'qué les pasa si sigue');
  assert.match(aviso, /En uso/, 'y la salida que el módulo ya recomendaba, que no toca los emitidos');
});

test('contestando que sí, los certificados emitidos se van con el formato', async () => {
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  const cert = await unCertificadoDe(api, formato.nombre);
  const nuevo = `${formato.nombre} en las aguas`;

  const r = await api('PUT', `/formatos_certificado/${formato.id}`, { nombre: nuevo, igual_asi: true });
  assert.equal(r.estado, 200);
  assert.equal(r.json.nombre, nuevo);

  const despues = await api('GET', `/certificados/${cert.id}`);
  assert.equal(despues.json.tipo, nuevo, 'el certificado dejó de apuntar a un nombre que ya no existe');

  const suFormato = await api('GET', `/formatos_certificado/para?tipo=${encodeURIComponent(nuevo)}`);
  assert.ok(suFormato.json, 'y vuelve a encontrar su formato al imprimir');
  assert.equal(suFormato.json.id, formato.id, 'que es el mismo de siempre');
});

test('y arrastra a TODOS los suyos, sin tocar los de otros tipos', async () => {
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  const otro = await unFormato(api);
  const mios = [await unCertificadoDe(api, formato.nombre), await unCertificadoDe(api, formato.nombre)];
  const ajeno = await unCertificadoDe(api, otro.nombre);
  const nuevo = `${formato.nombre} corregido`;

  await api('PUT', `/formatos_certificado/${formato.id}`, { nombre: nuevo, igual_asi: true });

  for (const c of mios) {
    assert.equal((await api('GET', `/certificados/${c.id}`)).json.tipo, nuevo);
  }
  assert.equal((await api('GET', `/certificados/${ajeno.id}`)).json.tipo, otro.nombre,
    'el certificado de otro formato se quedó donde estaba');
});

test('un formato que nadie usó se renombra sin preguntar nada', async () => {
  // La pregunta es por los certificados emitidos. Sin ninguno no hay nada que
  // cuidar, y preguntar igual sería ruido que se aprende a contestar que sí.
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  const r = await api('PUT', `/formatos_certificado/${formato.id}`, { nombre: `${formato.nombre} sin uso` });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
});

test('y guardar cualquier otra cosa del formato tampoco pregunta', async () => {
  /*
   * Cambiar el texto, los colores o el marco de un formato en uso SÍ cambia
   * cómo se imprimen los certificados ya emitidos, y eso el módulo lo dice de
   * frente en su ayuda: la hoja se arma al imprimir. Lo que se pregunta acá es
   * otra cosa —cortar el hilo entre el certificado y su formato—, y solo el
   * nombre lo corta.
   */
  const api = await elSistemaAndando();
  const formato = await unFormato(api);
  await unCertificadoDe(api, formato.nombre);
  const r = await api('PUT', `/formatos_certificado/${formato.id}`, { texto: 'Otro texto, {titular}.' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.texto, 'Otro texto, {titular}.');
});

test('un renombre que el sistema rechaza no mueve ningún certificado', async () => {
  /*
   * Lo que se prueba es esto y no más: que el arrastre no ocurra por su cuenta,
   * antes de que el guardado esté aceptado. Si ocurriera —y en el motor hay
   * lugares donde ocurriría, como el gancho que corre ANTES de la transacción—,
   * un rechazo posterior dejaría el formato con su nombre viejo y los
   * certificados apuntando a uno que nunca existió: el mismo daño que esto
   * viene a arreglar, causado por el arreglo.
   *
   * Que las dos escrituras vayan juntas o no vayan es cosa de dónde vive el
   * arrastre: en `afterSave`, dentro de la transacción del motor. Acá se
   * comprueba lo que se ve desde afuera, que es lo que importa.
   *
   * El rechazo que se usa es el nombre repetido —dos formatos no se pueden
   * llamar igual—, que el motor revisa antes de llegar al gancho del módulo.
   */
  const api = await elSistemaAndando();
  const primero = await unFormato(api);
  const segundo = await unFormato(api);
  const cert = await unCertificadoDe(api, segundo.nombre);

  const r = await api('PUT', `/formatos_certificado/${segundo.id}`, { nombre: primero.nombre, igual_asi: true });
  assert.equal(r.estado, 400, 'dos formatos no pueden llamarse igual');

  assert.equal((await api('GET', `/certificados/${cert.id}`)).json.tipo, segundo.nombre,
    'y el certificado no se movió a un nombre que el formato nunca llegó a tomar');
});

test('la pantalla sabe qué preguntar con esa clave', () => {
  /*
   * El servidor manda `confirmar: 'formato_que_se_renombra'` y la pantalla le
   * pone el encabezado y los botones. Sin la entrada, la pregunta sale con el
   * texto genérico —«Revise esto antes de guardar», «Está bien, guardar así»—,
   * que no dice qué se está por hacer.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'));
  const entrada = tabla.slice(tabla.indexOf('formato_que_se_renombra: {'));
  assert.ok(entrada.startsWith('formato_que_se_renombra: {'), 'la entrada existe');
  const bloque = entrada.slice(0, entrada.indexOf('},'));
  assert.match(bloque, /titulo:/);
  assert.match(bloque, /volver: 'Volver y dejarle el nombre'/);
  assert.match(bloque, /seguir: 'Cambiarlo y llevármelos'/, 'el botón dice qué va a pasar con los emitidos');
});

// ══════════════════════ y la hoja dice cuando le falta el texto ══

test('la hoja sin formato ya no imprime un hueco: lo dice', () => {
  /*
   * MIRA EL CÓDIGO, como el sello de anulado y por lo mismo: que el aviso SE
   * VEA se comprueba en el navegador. Acá se vigila que las TRES disposiciones
   * lo pinten —son tres trozos de código distintos, y arreglar uno y olvidar
   * los otros dos ya pasó con el número de la hoja de presentación—.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function printCertificado(');
  const cuerpo = app.slice(desde, app.indexOf('\nfunction certDeEjemplo', desde));

  assert.equal((cuerpo.match(/: faltaElTexto\}/g) || []).length, 3,
    'las tres hojas dicen que les falta el texto: la clásica, la de niños y la de matrimonio');
  assert.match(cuerpo, /FALTA EL TEXTO DE ESTE CERTIFICADO/);
  assert.match(cuerpo, /Revíselo en Formatos de Certificado antes de entregar esta hoja/,
    'y dice qué hacer, no solo que algo falta');
  assert.match(cuerpo, /No se encontró el formato/, 'cuando no hay formato');
  assert.match(cuerpo, /no tiene texto escrito/, 'y cuando lo hay pero está en blanco');
});

test('el aviso de la hoja se dibuja con borde y no con fondo, o no saldría impreso', () => {
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const regla = css.slice(css.indexOf('.cert-falta {'), css.indexOf('.cert-falta b'));
  assert.ok(regla, 'la regla existe');
  assert.match(regla, /border:\s*2px dashed #b45309/, 'lleva borde');
  assert.ok(!/background/.test(regla), 'y NO lleva fondo, que es lo que no se imprimiría');
  assert.ok(!/var\(--cert-/.test(regla),
    'ni toma los colores del formato: es lo que dice que a la hoja le falta algo');
});

test('una hoja con su texto no lleva ningún aviso', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const faltaElTexto = ');
  const linea = app.slice(desde, app.indexOf('`;', desde));
  assert.match(linea, /cuerpo \? '' :/, 'con cuerpo, el aviso es una cadena vacía');
});

// ══════════════════════════════════ el aviso, por su cuenta ══

test('el aviso nombra los dos nombres, el viejo y el nuevo', () => {
  // Quien contesta tiene que ver de qué a qué, no solo que «algo cambia»
  const aviso = def.avisoDelFormatoQueSeRenombra('Bautismo', 'Bautismo en las aguas', 12);
  assert.match(aviso, /«Bautismo»/);
  assert.match(aviso, /«Bautismo en las aguas»/);
  assert.match(aviso, /\b12 certificado/);
});

test('borrar un formato en uso sigue bloqueado, que es el otro lado de lo mismo', () => {
  // La cuenta la comparten los dos ganchos; si un día se desarma, se desarman
  // las dos protecciones a la vez y esta prueba lo dice
  const iglesia = unaIglesia();
  const tipo = `Bautismo borrar ${marca()}`;
  db.prepare(
    `INSERT INTO certificados (numero, tipo, iglesia_id, nombre_titular, fecha_emision, estado)
     VALUES (?, ?, ?, 'Alguien', '2026-01-01', 'Emitido')`
  ).run(`CB-${marca()}`, tipo, iglesia);
  assert.match(String(def.hooks.beforeDelete({ nombre: tipo }, { db })), /certificado\(s\) ya emitido/);
});
