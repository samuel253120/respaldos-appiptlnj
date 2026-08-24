/**
 * De dónde sale cada dato que se imprime en una credencial.
 *
 * La regla del punto 4 de la especificación es que los datos NO se escriben:
 * se toman de la ficha del titular y de la de su iglesia. Este archivo es el
 * único lugar donde se dice de qué campo sale cada cosa, para que la pantalla
 * de emisión, el código QR y la página de verificación no puedan discrepar.
 *
 * Y una vez emitida, se congelan: la credencial guarda su propia copia. Si
 * mañana la persona sube de grado o cambia de iglesia, el papel que anda en su
 * bolsillo sigue diciendo lo que decía. Para reflejar el cambio se emite una
 * credencial nueva, no se corrige la anterior.
 */
const { db } = require('../db');

/**
 * La categoría de la iglesia, como la nombra la credencial.
 *
 * La especificación las llama CENTRAL, SEDE, FILIAL y ANEXO (punto 4.7). El
 * módulo de Iglesias las llama «Iglesia Matriz», «Iglesia Sede», «Iglesia
 * Local» e «Iglesia Anexo» desde antes de esta especificación. Son las mismas
 * cuatro; acá se dice la correspondencia, en un solo lugar, para no renombrar
 * datos que ya están cargados ni dejar la credencial diciendo una palabra y la
 * ficha otra.
 */
const CATEGORIAS = {
  'Iglesia Matriz': 'CENTRAL',
  'Iglesia Sede': 'SEDE',
  'Iglesia Local': 'FILIAL',
  'Iglesia Anexo': 'ANEXO',
};
const categoriaDe = (tipo) => CATEGORIAS[tipo] || '';

/** Los grados del ministerio que puede llevar una credencial. */
const GRADOS = require('../tratamiento').CARGOS_MINISTERIO;

/**
 * Lo que hay que tener para poder emitir (punto 8.4).
 *
 * Sin cualquiera de estos datos el código QR no se genera y la credencial no
 * se puede marcar como emitida: una credencial a medio llenar que igual
 * llevara un QR parecería verificada, y es lo contrario de lo que hace el QR.
 */
const IMPRESCINDIBLES = [
  ['snap_nombres', 'los nombres'],
  ['snap_apellidos', 'los apellidos'],
  ['snap_grado', 'el grado ministerial'],
  ['snap_rut', 'el RUT'],
  ['snap_categoria', 'la categoría de la iglesia'],
  ['snap_iglesia', 'el nombre de la iglesia'],
  ['fecha_emision', 'la fecha de entrega'],
  ['fecha_vencimiento', 'la fecha de vencimiento'],
];

/**
 * Los datos de una persona y su iglesia, listos para poner en la credencial.
 *
 * Devuelve los campos tal como se guardarán en la copia congelada. Si la
 * persona no existe, devuelve null: quien llama decide qué decir.
 */
function delTitular(pastorId) {
  const p = db.prepare('SELECT * FROM pastores WHERE id = ?').get(pastorId);
  if (!p) return null;
  const iglesia = p.iglesia_id ? db.prepare('SELECT * FROM iglesias WHERE id = ?').get(p.iglesia_id) : null;

  return {
    pastor_id: p.id,
    iglesia_id: p.iglesia_id || null,
    snap_nombres: (p.nombres || '').trim(),
    snap_apellidos: (p.apellidos || '').trim(),
    snap_rut: (p.rut || '').trim(),
    snap_grado: (p.cargo || '').trim(),
    // El cargo o función es opcional: en blanco, su línea no se imprime y el
    // espacio se reparte entre los demás campos (punto 4.6)
    snap_funcion: (p.funcion || '').trim(),
    snap_categoria: iglesia ? categoriaDe(iglesia.tipo) : '',
    snap_iglesia: iglesia ? (iglesia.nombre || '').trim() : '',
    // La comuna de la iglesia. En el módulo de Iglesias ese dato se llama
    // «ciudad»: es el mismo, la localidad donde está la congregación.
    snap_comuna: iglesia ? (iglesia.ciudad || '').trim() : '',
    snap_foto: p.foto || null,
  };
}

/**
 * Qué le falta a una credencial para poder emitirse.
 *
 * Se devuelve la lista en castellano, para poder decirla tal cual en pantalla
 * y que quien la lee sepa a qué ficha ir.
 */
function loQueFalta(fila) {
  const faltan = [];
  for (const [campo, comoSeLlama] of IMPRESCINDIBLES) {
    if (!fila[campo] || !String(fila[campo]).trim()) faltan.push(comoSeLlama);
  }
  // El RUT tiene que parecer un RUT, no cualquier cosa escrita
  if (fila.snap_rut && String(fila.snap_rut).replace(/[^0-9kK]/g, '').length < 8) {
    faltan.push('un RUT completo');
  }
  return faltan;
}

/** ¿Está todo lo que hace falta? */
const sePuedeEmitir = (fila) => loQueFalta(fila).length === 0;

/**
 * Y qué recursos institucionales faltan por cargar (punto 5.4).
 *
 * Van aparte de los datos de la persona porque se arreglan en otro lugar —en
 * Configuración— y los carga otra persona.
 */
function recursosQueFaltan() {
  const ajustes = require('../ajustes');
  const faltan = [];
  if (!ajustes.obtener('iglesia_logo')) faltan.push('el logo');
  if (!ajustes.obtener('credencial_sello')) faltan.push('el sello');
  if (!ajustes.obtener('credencial_firma')) faltan.push('la firma');
  return faltan;
}

module.exports = {
  delTitular, loQueFalta, sePuedeEmitir, recursosQueFaltan,
  categoriaDe, CATEGORIAS, GRADOS, IMPRESCINDIBLES,
};
