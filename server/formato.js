/** Formatos de texto compartidos por el servidor. */

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "2026-08-05" → "5 de agosto de 2026". Si no es una fecha, la devuelve tal cual. */
function fechaLarga(iso) {
  const partes = String(iso || '').slice(0, 10).split('-');
  if (partes.length !== 3) return String(iso || '');
  const [anio, mes, dia] = partes.map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return String(iso || '');
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

module.exports = { fechaLarga, MESES };
