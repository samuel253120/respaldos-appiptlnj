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

module.exports = { TIPOS_DE_ACTIVIDAD };
