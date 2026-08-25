/**
 * Las actividades que se pueden pasar lista.
 *
 * Está fuera del módulo de asistencias porque la pantalla de configuración
 * necesita la lista para ofrecer cuál viene elegida, y pedirle el módulo
 * entero a `ajustes.js` lo obligaría a arrastrar media aplicación —y sus
 * dependencias— solo para leer diez nombres.
 */
const TIPOS_DE_ACTIVIDAD = [
  'Servicio General',
  'Servicio Especial',
  'Servicio Vigilia',
  'Clase de Dorcas',
  'Estudio Bíblico',
  'Oración',
  'Ensayo',
  'Salida a Visitar',
  'Salida a Gira',
  'Reunión Administrativa',
  'Reunión Directivas',
  'Otros',
];

/**
 * Los tipos que se pueden elegir HOY.
 *
 * Desde que la lista se administra desde el sistema, la de acá arriba es solo
 * la semilla: lo que vale es lo que hay en la tabla. Se pregunta cada vez
 * —son diez filas— para que agregar un tipo se note en el acto y no al
 * reiniciar. Si la tabla todavía no existe —el primer arranque, antes de la
 * migración— se devuelve la semilla, que es lo correcto: nunca una lista vacía.
 */
function losQueSeUsan() {
  try {
    const { db } = require('./db');
    const filas = db.prepare('SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY nombre').all();
    if (filas.length) return filas.map((f) => f.nombre);
  } catch (e) {
    /* sin tabla todavía: vale la semilla */
  }
  return TIPOS_DE_ACTIVIDAD.slice();
}

module.exports = { TIPOS_DE_ACTIVIDAD, losQueSeUsan };
