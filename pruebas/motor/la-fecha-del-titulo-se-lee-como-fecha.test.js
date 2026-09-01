/**
 * En el título de una ficha, una fecha se lee como fecha.
 *
 * Cada módulo dice con una plantilla cómo se nombra uno de sus registros
 * —Traspasos usa `{fecha} — {concepto}`—, y la plantilla pegaba el valor tal
 * como está guardado. Las fechas se guardan al modo del computador, así que el
 * título de la ficha decía:
 *
 *   2026-06-10 — Aporte de junio
 *
 * y dos centímetros más abajo, en la misma pantalla, el campo «Fecha del
 * traspaso» decía «10-06-2026». El mismo dato al derecho y al revés; acá el día
 * va primero.
 *
 * No era de Traspasos: son SEIS los módulos que pegan una fecha en su título
 * —traspasos, servicios, asistencias, las dos clases de acta y las evaluaciones
 * de integrantes—, así que se arregla donde se arma el texto y no seis veces.
 *
 * El mismo texto se arma en dos partes: el servidor (`displayOf`) para las
 * etiquetas de las referencias, y el navegador (`nombreDelRegistro`) para el
 * título de la ficha. Las dos tienen que estar de acuerdo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { displayOf, getModule, allModules } = require('../../server/registry');

// ------------------------------------------------------------ el servidor ----

test('el título de un traspaso dice la fecha como se lee acá', () => {
  const def = getModule('traspasos');
  assert.equal(def.display, '{fecha} — {concepto}', 'si cambia la plantilla, esta prueba ya no mide');
  assert.equal(
    displayOf(def, { id: 7, fecha: '2026-06-10', concepto: 'Aporte de junio' }),
    '10-06-2026 — Aporte de junio'
  );
});

test('y lo mismo los otros cinco módulos que ponen una fecha en su título', () => {
  /*
   * Se buscan solos: si mañana un módulo nuevo pega una fecha en su plantilla,
   * entra a esta prueba sin que nadie la toque.
   */
  const conFecha = allModules().filter((m) =>
    [...String(m.display).matchAll(/\{(\w+)(?::\w+)?\}/g)]
      .some(([, campo]) => (m.fields || []).some((f) => f.name === campo && f.type === 'date')));

  assert.ok(conFecha.length >= 6, `esperaba al menos seis, encontré ${conFecha.length}`);
  for (const m of conFecha) {
    const campo = (m.fields || []).find((f) => f.type === 'date'
      && String(m.display).includes(`{${f.name}}`));
    const texto = displayOf(m, { id: 1, [campo.name]: '2026-06-10' });
    assert.match(texto, /10-06-2026/, `${m.name} todavía muestra la fecha al revés`);
    assert.doesNotMatch(texto, /2026-06-10/, `${m.name} muestra las dos`);
  }
});

test('lo que no es un campo de fecha se pega tal cual, como siempre', () => {
  const def = getModule('documentos');
  assert.equal(def.display, '{numero} — {titulo}');
  assert.equal(
    displayOf(def, { id: 3, numero: '2026-06-10', titulo: 'Un número raro' }),
    '2026-06-10 — Un número raro',
    'un número que se parece a una fecha no es una fecha: manda el tipo del campo'
  );
});

test('y un campo de fecha vacío o a medio escribir no se inventa nada', () => {
  /*
   * Dar vuelta lo que no es una fecha entera es peor que dejarlo como está:
   * «2026-06» dado vuelta queda «06-2026», que se lee como un día y un mes que
   * nadie escribió. Por eso se exige la forma completa antes de tocar nada, y
   * se mide con un valor a medio escribir —los vacíos no distinguen, porque
   * dar vuelta la nada da la nada—.
   */
  const def = getModule('traspasos');
  /*
   * Sin fecha queda «Sin fecha» y no «— Sin fecha». Hasta la 1.265.0 el
   * separador de la plantilla quedaba colgando adelante, y esta prueba lo daba
   * por bueno porque medía otra cosa: lo suyo es que una fecha a medio escribir
   * no se dé vuelta. Desde la 1.266.0 el nombre se limpia de guiones y espacios
   * sueltos en las puntas —un separador solo parece un dato perdido, y ahora
   * ese nombre encabeza la hoja impresa—. Cambio a propósito, no un accidente.
   */
  assert.equal(displayOf(def, { id: 7, fecha: null, concepto: 'Sin fecha' }), 'Sin fecha');
  assert.equal(displayOf(def, { id: 7, fecha: '2026-06', concepto: 'A medias' }), '2026-06 — A medias');
  assert.equal(displayOf(def, { id: 7, fecha: '2026', concepto: 'Un año' }), '2026 — Un año');
});

test('y una fecha con hora se lee igual, sin la hora', () => {
  const def = getModule('traspasos');
  assert.equal(
    displayOf(def, { id: 7, fecha: '2026-06-10 14:30:00', concepto: 'Con hora' }),
    '10-06-2026 — Con hora'
  );
});

test('el recorte de un nombre sigue funcionando', () => {
  const def = getModule('miembros');
  assert.equal(def.display, '{nombres:primero} {apellidos}');
  assert.equal(displayOf(def, { id: 1, nombres: 'Juan Carlos', apellidos: 'Pérez Soto' }),
    'Juan Pérez Soto');
});

// ------------------------------------------------------------ el navegador ----

test('el navegador arma el título con la misma regla', () => {
  /*
   * `nombreDelRegistro` corre en el navegador y no se puede llamar desde acá;
   * lo que sí se puede es exigir que la regla esté escrita. Sin esto, el
   * servidor arreglado y el navegador sin arreglar dan dos títulos distintos
   * para la misma ficha.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function nombreDelRegistro(');
  assert.ok(desde > 0, 'no está la función nombreDelRegistro');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));

  assert.match(trozo, /tipoDe\[campo\] === 'date'/, 'tiene que mirar el tipo del campo');
  assert.match(trozo, /fechaCorta\(valor\)/, 'y leerla con el mismo formateador que el resto');
});
