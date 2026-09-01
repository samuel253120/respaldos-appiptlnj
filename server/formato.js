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

/**
 * «uno», «uno y otro», «uno, otro y el de más allá».
 *
 * Vivía en server/cargos-de-la-directiva.js, que es de donde ya la pedían
 * prestada los cuerpos y las directivas. Con las actas serían cuatro módulos
 * pidiéndole un formateador de texto al módulo de los cargos de una directiva,
 * que no tiene nada que ver: se muda acá, que es su lugar.
 */
function enLista(cosas) {
  if (!cosas.length) return '';
  if (cosas.length === 1) return cosas[0];
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`;
}

module.exports = { fechaLarga, enLista, MESES };
