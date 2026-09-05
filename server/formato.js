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

/**
 * Un monto, con el símbolo de moneda que la institución tenga configurado.
 *
 * El ajuste «Símbolo de moneda» existía desde hacía mucho y decía en su propia
 * ayuda que se usa «al mostrar montos en tesorería, ayudas sociales e
 * inventarios». No lo leía NADIE: el signo de peso estaba escrito a mano en
 * siete lugares del servidor y en el formateador de la pantalla. Cambiarlo a
 * «UF» lo guardaba, lo mostraba guardado, y no movía una sola cifra en todo el
 * sistema (hallazgo CO-04).
 *
 * Ahora sale de acá, que es una sola línea para todos.
 *
 * Al peso, sin centavos: en pesos no existen. Lo que se anotó antes de que el
 * sistema los redondeara al guardar los sigue teniendo, y «$ 765.432,1» en un
 * libro de caja se lee como un error de otra cosa.
 *
 * Con `pegado` el espacio es de los que NO SE CORTAN, para que el símbolo no
 * quede en otra línea separado de su cifra. Lo piden los sitios donde la cifra
 * va dentro de una tabla angosta —el Registro de Cambios— y la pantalla. Los
 * avisos que el sistema escribe en una frase llevan el espacio corriente, que
 * es como se venían escribiendo. Lo que NO cambia según quién pregunte es el
 * símbolo: ése es uno solo, y ése era el defecto.
 */
function enPlata(n, { pegado = false } = {}) {
  const simbolo = require('./ajustes').obtener('moneda_simbolo') || '$';
  const x = Math.round(Number(n) || 0);
  return `${simbolo}${pegado ? '\u00a0' : ' '}${x.toLocaleString('es-CL')}`;
}

module.exports = { fechaLarga, enLista, enPlata, MESES };
