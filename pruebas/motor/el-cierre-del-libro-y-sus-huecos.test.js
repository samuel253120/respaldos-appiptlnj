/**
 * LA HOJA QUE SE FIRMA: QUE CUENTE LO QUE MUESTRA, Y QUE DIGA LO QUE FALTA.
 *
 * Son dos hallazgos y la misma línea: el cierre del libro de la oficina de
 * partes, que va debajo de la tabla y encima de las dos líneas de firma.
 *
 * MEDIDO en la v1.287.0, sobre un libro con REC-001, REC-002, REC-005,
 * EMI-001 y dos documentos de archivo:
 *
 *   pidiendo solo el archivo interno .... «En este libro constan 2
 *                                          documento(s): 0 recibido(s) y
 *                                          0 emitido(s)»
 *   pidiendo solo lo recibido ........... «3 recibido(s) y 0 emitido(s)»,
 *                                          con un «y 0» que nadie preguntó
 *   los huecos (falta el 003 y el 004) .. la hoja no los mencionaba
 *
 * Lo primero es una contradicción en la misma línea, en un papel hecho para
 * firmarse. Lo segundo es peor de fondo: un correlativo sirve para una sola
 * cosa —para que se note si falta algo—, y un libro que enumera 001, 002 y 005
 * y cierra diciendo «constan 3 documentos» está afirmando que están todos.
 *
 * LOS HUECOS NO SE IMPIDEN, y es una decisión: un libro que viene de papel
 * empieza legítimamente en el 47, y anular un número es una operación real de
 * oficina. Se DECLARAN, que es lo que hace que un hueco explicado deje de
 * parecerse a uno escondido.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { losHuecosDelLibro, armarElLibro } = require('../../server/modules/documentos');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia ${m}`, `HU${m}`.slice(0, 18)).lastInsertRowid;
}

/** El libro sembrado directo en la base, para poder poner huecos a mano. */
function unLibroCon(iglesia, filas) {
  for (const f of filas) {
    db.prepare(
      `INSERT INTO documentos (flujo, iglesia_id, numero, titulo, fecha_registro, folios, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'Ingresado')`
    ).run(f.flujo, iglesia, f.numero || null, f.titulo || 'x', f.fecha || '2026-01-05', f.folios || null);
  }
  return armarElLibro(db, { iglesiaId: iglesia });
}

/* ══════════ la pieza que las dos preguntas comparten ══════════════════ */

test('el formato del número se lee en un solo sitio, y sigue diciendo lo mismo', () => {
  /*
   * Contar huecos y proponer el número siguiente necesitan el mismo formato
   * —«PREFIJO123-2026»— con dos preguntas distintas: «¿de qué número y de qué
   * año es?» y «¿qué número es, si es del año que me importa?». Se escribió
   * una sola vez: `partirNumero` parte, y `leerNumero` se apoya en ella.
   *
   * Sin esto, romper la pieza compartida no ponía roja ninguna prueba de este
   * archivo —se comprobó— y quien la tocara solo se enteraría por las de la
   * numeración, que están en otra parte.
   */
  const { partirNumero, leerNumero } = require('../../server/numeracion');

  assert.deepEqual(partirNumero('REC-005-2026', 'REC-'), { n: 5, anio: '2026' });
  assert.equal(partirNumero('Oficio de marzo', 'REC-'), null);
  assert.equal(partirNumero('EMI-005-2026', 'REC-'), null, 'el prefijo tiene que calzar');

  // Y la de arriba sigue siendo la de siempre: el número solo si es del año
  assert.equal(leerNumero('REC-005-2026', 2026, 'REC-'), 5);
  assert.equal(leerNumero('REC-005-2026', 2025, 'REC-'), null);
  assert.equal(leerNumero('Oficio de marzo', 2026, 'REC-'), null);

  // Un prefijo con paréntesis no puede romper la expresión ni cambiarle el
  // sentido: se escapa antes de armarla.
  assert.deepEqual(partirNumero('ACTA (N.º)007-2026', 'ACTA (N.º)'), { n: 7, anio: '2026' });
});

/* ═══════════════════ OP-07 · los huecos del correlativo ═══════════════ */

test('un libro seguido no tiene huecos que declarar', () => {
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'REC-002-2026' },
    { flujo: 'Recibido', numero: 'REC-003-2026' },
  ]);
  assert.deepEqual(h.faltan, []);
  assert.equal(h.sinNumero, 0);
});

test('y uno con un salto lo dice, nombrando los que faltan', () => {
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'REC-002-2026' },
    { flujo: 'Recibido', numero: 'REC-005-2026' },
  ]);
  assert.equal(h.faltan.length, 1);
  assert.equal(h.faltan[0].cuantos, 2);
  assert.deepEqual(h.faltan[0].numeros, ['REC-003-2026', 'REC-004-2026']);
  assert.equal(h.faltan[0].desde, 'REC-001-2026');
  assert.equal(h.faltan[0].hasta, 'REC-005-2026');
});

test('empezar en el 47 no es un hueco: es dónde empieza el libro', () => {
  /*
   * Un libro que viene de papel empieza donde venía. Contar desde el 001 sería
   * declarar cuarenta y seis huecos que nunca existieron, y un aviso que
   * exagera es un aviso que se deja de leer.
   */
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-047-2026' },
    { flujo: 'Recibido', numero: 'REC-048-2026' },
  ]);
  assert.deepEqual(h.faltan, []);
});

test('los dos libros se cuentan por separado, y cada año también', () => {
  /*
   * Lo que entra y lo que sale llevan correlativos distintos, y el 001 vuelve a
   * empezar cada enero: mezclarlos inventaría huecos que no hay.
   */
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'REC-002-2026' },
    { flujo: 'Emitido', numero: 'EMI-001-2026' },
    { flujo: 'Emitido', numero: 'EMI-002-2026' },
    { flujo: 'Recibido', numero: 'REC-001-2025' },
    { flujo: 'Recibido', numero: 'REC-002-2025' },
  ]);
  assert.deepEqual(h.faltan, [], 'ninguno de los cuatro tramos tiene saltos');

  const conSalto = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'REC-003-2026' },
    { flujo: 'Emitido', numero: 'EMI-001-2026' },
    { flujo: 'Emitido', numero: 'EMI-004-2026' },
  ]);
  assert.equal(conSalto.faltan.length, 2, 'un tramo por serie');
  assert.deepEqual(conSalto.faltan.map((x) => x.flujo).sort(), ['Emitido', 'Recibido']);
});

test('lo interno no cuenta ni abre hueco: no lleva correlativo', () => {
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Interno o de archivo', numero: null },
    { flujo: 'Interno o de archivo', numero: null },
    { flujo: 'Recibido', numero: 'REC-002-2026' },
  ]);
  assert.deepEqual(h.faltan, []);
  assert.equal(h.sinNumero, 0, 'un interno sin número no es una anotación sin numerar');
});

test('un número escrito a su manera no cuenta ni estorba', () => {
  /*
   * Igual que en la propuesta del número siguiente: si alguien numeró «Oficio
   * de marzo», no se cuenta —no se sabe qué número es— pero tampoco se inventa
   * un hueco por él.
   */
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'Oficio de marzo' },
    { flujo: 'Recibido', numero: 'REC-002-2026' },
  ]);
  assert.deepEqual(h.faltan, []);
  assert.equal(h.sinNumero, 0);
});

test('las anotaciones sin número se cuentan aparte', () => {
  /*
   * Son las que entraron antes de que el número fuera obligatorio (v1.284.0).
   * El libro no puede callarlas: en la columna del correlativo salen con un
   * guion, y el cierre diría que están todas.
   */
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: null },
    { flujo: 'Emitido', numero: '' },
  ]);
  assert.equal(h.sinNumero, 2);
});

test('con muchos huecos se nombran los primeros y se dice cuántos son', () => {
  const h = losHuecosDelLibro([
    { flujo: 'Recibido', numero: 'REC-001-2026' },
    { flujo: 'Recibido', numero: 'REC-050-2026' },
  ]);
  assert.equal(h.faltan[0].cuantos, 48);
  assert.equal(h.faltan[0].numeros.length, 12, 'una lista de cuarenta y ocho números no se lee');
});

test('el libro de verdad trae sus huecos en el resumen', () => {
  const iglesia = unaIglesia();
  const libro = unLibroCon(iglesia, [
    { flujo: 'Recibido', numero: 'REC-001-2026', titulo: 'Uno' },
    { flujo: 'Recibido', numero: 'REC-002-2026', titulo: 'Dos' },
    { flujo: 'Recibido', numero: 'REC-005-2026', titulo: 'Cinco' },
  ]);
  assert.equal(libro.resumen.huecos.faltan.length, 1);
  assert.deepEqual(libro.resumen.huecos.faltan[0].numeros, ['REC-003-2026', 'REC-004-2026']);
});

/* ═══════════════════ OP-06 · el cierre que se contradecía ═════════════ */

test('el resumen cuenta los de archivo aparte, para poder decirlo', () => {
  const iglesia = unaIglesia();
  unLibroCon(iglesia, [
    { flujo: 'Interno o de archivo', titulo: 'Escritura' },
    { flujo: 'Interno o de archivo', titulo: 'Contrato' },
  ]);
  const solo = armarElLibro(db, { iglesiaId: iglesia, flujo: 'Interno o de archivo' });
  assert.equal(solo.resumen.total, 2);
  assert.equal(solo.resumen.internos, 2, 'sin esta cuenta, el cierre solo podía decir «0 y 0»');
  assert.equal(solo.resumen.recibidos, 0);
});

test('la hoja cuenta lo que muestra, y no lo que no le preguntaron', () => {
  /*
   * UNA FRASE POR CADA FILTRO, en vez de una sola escrita para el libro entero
   * —que es lo que la hacía contradecirse: pidiendo solo el archivo decía
   * «constan 2 documento(s): 0 recibido(s) y 0 emitido(s)»—.
   *
   * Hasta la v1.290.0 esto MIRABA EL CÓDIGO de la pantalla, porque la frase se
   * armaba en el navegador y no había dónde comprobarla. Desde la v1.291.0 el
   * libro se puede bajar también como PDF y las dos hojas tienen que decir lo
   * mismo, así que las palabras se escribieron una sola vez en el servidor
   * (server/libro-en-palabras.js) — y esta prueba pasó de leer código a
   * llamar a la pieza y mirar lo que contesta, que es mucho mejor prueba.
   */
  const { cierreDelLibro } = require('../../server/libro-en-palabras');
  const resumen = { total: 5, recibidos: 3, emitidos: 2, internos: 0, folios: 0 };
  const conFiltro = (flujo) => cierreDelLibro({ flujo, resumen });

  assert.match(conFiltro('Recibido'), /constan ⟦5⟧ documento\(s\) recibido\(s\)\./);
  assert.ok(!conFiltro('Recibido').includes('emitido'), 'y no nombra lo que no le preguntaron');
  assert.match(conFiltro('Emitido'), /constan ⟦5⟧ documento\(s\) emitido\(s\)\./);
  assert.ok(!conFiltro('Emitido').includes('recibido'));
  assert.match(conFiltro('Interno o de archivo'), /En este archivo constan ⟦5⟧ documento\(s\) de archivo interno\./,
    'el archivo tiene su propia frase, y ni siquiera es «este libro»');
  // Y la del libro entero, que es la única que nombra los dos
  assert.match(conFiltro(''), /constan ⟦5⟧ documento\(s\): ⟦3⟧ recibido\(s\) y ⟦2⟧ emitido\(s\)\./);
});

test('y lo que falta se dibuja con borde, no con fondo: tiene que salir en el papel', () => {
  /*
   * La trampa de siempre: los navegadores NO imprimen los fondos salvo que la
   * persona marque «gráficos de fondo», y esto es justamente la parte del
   * cierre que dice que el libro no está completo.
   */
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const regla = css.slice(css.indexOf('.libro-falta {'), css.indexOf('.libro-falta b'));
  assert.ok(regla, 'la regla existe');
  assert.match(regla, /border:\s*1\.5px solid/, 'lleva borde');
  assert.ok(!/background/.test(regla), 'y NO lleva fondo, que es lo que no se imprimiría');
  assert.match(regla, /color:/, 'con su color de letra, que sí se imprime');
});

test('la hoja llama a las dos, y dentro del cierre', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  // El corte se busca A PARTIR de la función: «const alCambiar» aparece antes
  // en el archivo, en otra pantalla, y buscándolo desde el principio el recorte
  // salía vacío — y un recorte vacío hace pasar cualquier cosa que no esté.
  const desde = app.indexOf('function viewLibroDePartes');
  const hoja = app.slice(desde, app.indexOf('const alCambiar', desde));
  assert.ok(hoja.length > 2000, `el recorte mide ${hoja.length}`);
  assert.match(hoja, /\$\{cierreDelLibro\(d\)\}/);
  assert.match(hoja, /\$\{loQueFaltaEnElLibro\(d\)\}/);
  // Antes de las firmas: lo que dice que el libro no está completo no puede ir
  // debajo de donde se firma.
  assert.ok(hoja.indexOf('loQueFaltaEnElLibro') < hoja.indexOf('libro-firmas'));
});
