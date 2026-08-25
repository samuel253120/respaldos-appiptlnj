/**
 * Las zonas horarias que el sistema ofrece.
 *
 * Está separado de `zona-horaria.js` a propósito: aquel necesita leer los
 * ajustes para saber cuál está elegida, y `ajustes.js` necesita esta lista
 * para dibujar el desplegable. Si vivieran juntos, cada uno pediría al otro
 * antes de estar listo y el sistema no levantaría.
 */
const LAS_ZONAS = [
  { valor: 'America/Santiago', label: 'Chile continental (Santiago)' },
  { valor: 'America/Punta_Arenas', label: 'Magallanes y la Antártica' },
  { valor: 'Pacific/Easter', label: 'Isla de Pascua' },
  { valor: 'UTC', label: 'UTC (hora universal, sin desfase)' },
];

module.exports = { LAS_ZONAS };
