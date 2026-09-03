/**
 * De dónde sale cada dato de la credencial, y qué pasa cuando falta.
 *
 * La regla del punto 4 es que los datos NO se escriben: se toman de la ficha
 * del titular y de la de su iglesia. Suena a comodidad y no lo es: es lo que
 * garantiza que la credencial y el registro digan lo mismo. Estas pruebas
 * fijan de qué campo sale cada cosa, la correspondencia entre cómo llama el
 * sistema a las categorías de iglesia y cómo las llama la credencial, y que
 * una credencial a medio llenar no se pueda emitir (punto 8.4).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const datos = require('../../server/credenciales/datos');

/** Una iglesia y un pastor con todo lo que la credencial necesita. */
function sembrar() {
  const iglesia = db.prepare(
    `INSERT INTO iglesias (nombre, codigo, tipo, ciudad, estado)
     VALUES ('La Nueva Jerusalén', 'IG-CRED', 'Iglesia Sede', 'Quilpué', 'Activa')`
  ).run().lastInsertRowid;
  const pastor = db.prepare(
    `INSERT INTO pastores (nombres, apellidos, rut, cargo, funcion, iglesia_id, estado, foto)
     VALUES ('Juan Carlos', 'Soto Martínez', '12345678-5', 'Pastor Presbítero', 'Pastor Titular', ?, 'Activo', 'foto.jpg')`
  ).run(iglesia).lastInsertRowid;
  return { iglesia, pastor };
}
const { iglesia, pastor } = sembrar();

// ------------------------------------------------ de dónde sale cada dato ----

test('los datos salen de la ficha del titular y de la de su iglesia', () => {
  const d = datos.delTitular(pastor);
  assert.equal(d.snap_nombres, 'Juan Carlos');
  assert.equal(d.snap_apellidos, 'Soto Martínez');
  assert.equal(d.snap_rut, '12345678-5');
  assert.equal(d.snap_grado, 'Pastor Presbítero', 'el grado es el cargo de la escala del ministerio');
  assert.equal(d.snap_funcion, 'Pastor Titular', 'la función es el puesto que ejerce, distinto del grado');
  assert.equal(d.snap_iglesia, 'La Nueva Jerusalén');
  assert.equal(d.snap_comuna, 'Quilpué');
  assert.equal(d.snap_foto, 'foto.jpg', 'la fotografía es la de su ficha, no una que se suba aparte');
  assert.equal(d.iglesia_id, iglesia);
});

test('una persona que no está devuelve nada, no datos a medias', () => {
  assert.equal(datos.delTitular(99999), null);
  assert.equal(datos.delTitular(null), null);
});

// --------------------------------- cómo se llaman las categorías de iglesia ----

test('la categoría de la iglesia se dice como la dice la credencial', () => {
  // El módulo de Iglesias las llama de una manera desde antes de esta
  // especificación, y la credencial de otra. Son las mismas cuatro: acá está
  // la correspondencia, en un solo lugar.
  assert.equal(datos.categoriaDe('Iglesia Matriz'), 'MATRIZ');
  assert.equal(datos.categoriaDe('Iglesia Sede'), 'SEDE');
  assert.equal(datos.categoriaDe('Iglesia Local'), 'FILIAL');
  assert.equal(datos.categoriaDe('Iglesia Anexo'), 'ANEXO');
});

test('y las cuatro son las que exige la especificación, ni una más', () => {
  const salen = Object.values(datos.CATEGORIAS).sort();
  assert.deepEqual(salen, ['ANEXO', 'FILIAL', 'MATRIZ', 'SEDE']);
});

test('una iglesia sin categoría cargada no inventa ninguna', () => {
  // Pasa con las que vienen del sistema anterior: el valor por defecto solo se
  // aplica al crearlas desde el formulario. Mejor vacío y que se note, que una
  // categoría inventada impresa en un documento.
  assert.equal(datos.categoriaDe(null), '');
  assert.equal(datos.categoriaDe('Otra cosa'), '');
});

// -------------------------------------------------- lo que falta, si falta ----

test('con todo cargado no falta nada', () => {
  const d = { ...datos.delTitular(pastor), snap_categoria: 'SEDE', fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01' };
  assert.deepEqual(datos.loQueFalta(d), []);
  assert.equal(datos.sePuedeEmitir(d), true);
});

test('y lo que falta se dice en castellano, uno por uno (punto 8.4)', () => {
  const completa = {
    snap_nombres: 'Ana', snap_apellidos: 'Díaz', snap_grado: 'Pastora', snap_rut: '12345678-5',
    snap_categoria: 'SEDE', snap_iglesia: 'La Nueva Jerusalén',
    fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  };
  const casos = [
    ['snap_nombres', 'los nombres'],
    ['snap_apellidos', 'los apellidos'],
    ['snap_grado', 'el grado ministerial'],
    ['snap_categoria', 'la categoría de la iglesia'],
    ['snap_iglesia', 'el nombre de la iglesia'],
    ['fecha_emision', 'la fecha de entrega'],
    ['fecha_vencimiento', 'la fecha de vencimiento'],
  ];
  for (const [campo, comoSeLlama] of casos) {
    const falta = datos.loQueFalta({ ...completa, [campo]: '' });
    assert.deepEqual(falta, [comoSeLlama], `al faltar ${campo} tendría que decir «${comoSeLlama}»`);
    assert.equal(datos.sePuedeEmitir({ ...completa, [campo]: '' }), false);
  }
});

test('un RUT a medio escribir tampoco sirve', () => {
  const completa = {
    snap_nombres: 'Ana', snap_apellidos: 'Díaz', snap_grado: 'Pastora',
    snap_categoria: 'SEDE', snap_iglesia: 'La Nueva Jerusalén',
    fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  };
  assert.ok(datos.loQueFalta({ ...completa, snap_rut: '123' }).includes('un RUT completo'));
  assert.deepEqual(datos.loQueFalta({ ...completa, snap_rut: '12.345.678-5' }), [], 'con puntos y guion sí');
});

test('la función es opcional: su falta no impide emitir (punto 4.6)', () => {
  const d = {
    snap_nombres: 'Ana', snap_apellidos: 'Díaz', snap_grado: 'Pastora', snap_rut: '12345678-5',
    snap_categoria: 'SEDE', snap_iglesia: 'La Nueva Jerusalén', snap_funcion: '',
    fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  };
  assert.deepEqual(datos.loQueFalta(d), [], 'sin función se emite igual; su línea no se imprime');
});

// ----------------------------------------- los recursos institucionales ----

test('sin logo, sello o firma se dice cuál falta (punto 5.4)', () => {
  const ajustes = require('../../server/ajustes');
  ajustes.guardar('iglesia_logo', '', null);
  ajustes.guardar('credencial_sello', '', null);
  ajustes.guardar('credencial_firma', '', null);
  assert.deepEqual(datos.recursosQueFaltan(), ['el logo', 'el sello', 'la firma']);

  ajustes.guardar('credencial_sello', 'sello.png', null);
  assert.deepEqual(datos.recursosQueFaltan(), ['el logo', 'la firma']);

  ajustes.guardar('iglesia_logo', 'logo.png', null);
  ajustes.guardar('credencial_firma', 'firma.png', null);
  assert.deepEqual(datos.recursosQueFaltan(), []);
});

// ----------------------------------------------- los grados del ministerio ----

test('los grados son los de la escala del ministerio del sistema', () => {
  // La especificación lista cinco (punto 4.5) y el sistema ya tenía esa escala
  // en server/tratamiento.js, con «Pastora» además como cargo pastoral. No se
  // hicieron dos listas: se usa la que ya existe.
  for (const grado of ['Guía de Obra', 'Pastor Probando', 'Pastor Diácono', 'Pastor Presbítero', 'Pastor Presidente']) {
    assert.ok(datos.GRADOS.includes(grado), `falta el grado ${grado}`);
  }
});
