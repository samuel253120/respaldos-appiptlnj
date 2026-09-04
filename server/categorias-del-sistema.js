/**
 * LAS CATEGORÍAS DE TESORERÍA QUE ESCRIBE EL PROPIO SISTEMA.
 *
 * La lista de categorías la mantiene la iglesia: puede crear «Pro-Templo Sede
 * Sur», dejar de usar «Viáticos» y renombrar lo que quiera. Pero hay siete que
 * NO las elige nadie al anotar un movimiento: las escribe el sistema solo,
 * cuando alguien registra un préstamo, un traspaso entre cajas, la ofrenda de
 * un culto o el pago de una cuota. Estaban escritas a mano en cinco archivos
 * distintos y nada las protegía.
 *
 * ── LO QUE SE MIDIÓ ──
 *
 * En una instalación recién sembrada, con una cuenta de administrador y contra
 * el sistema andando: las siete se borraron una tras otra, las siete con un 200
 * y sin una palabra. La regla del módulo frena el borrado solo si la categoría
 * YA TIENE movimientos, y en una iglesia nueva ninguna de las siete los tiene
 * todavía —no ha habido préstamos, ni traspasos, ni se ha cerrado el primer
 * culto—. Son, exactamente, las que alguien borra el primer mes al ordenar la
 * lista porque «no las usamos».
 *
 * A continuación se registró un préstamo del banco por tres millones de pesos
 * para arreglar el techo. El sistema lo anotó igual, con la categoría que él
 * tiene escrita:
 *
 *     Ingreso · «Préstamos recibidos» · $3.000.000
 *     ¿existe esa categoría en la lista? ............ NO
 *     ¿se ofrece al clasificar un ingreso? .......... NO
 *
 * Tres millones en el libro bajo una palabra que no está en ninguna lista, que
 * nadie puede volver a elegir y que la tesorera no puede corregir eligiendo la
 * buena, porque la buena ya no existe.
 *
 * ── LA REGLA ──
 *
 * Estas siete NO se borran y NO se renombran, tengan movimientos o no. Sí se
 * pueden DESACTIVAR, y eso es a propósito: una iglesia que nunca ha pedido un
 * préstamo tiene derecho a sacar las cuatro de deudas del desplegable para que
 * no le estorben. Desactivada, la categoría sigue existiendo —el nombre sigue
 * queriendo decir algo, los informes siguen cuadrando— y el día que de verdad
 * haya un préstamo, el movimiento cae en una categoría que existe.
 *
 * ── POR QUÉ ESTÁN ACÁ Y NO EN CADA ARCHIVO ──
 *
 * Porque una lista de nombres protegidos escrita aparte de los nombres que se
 * escriben es una copia, y una copia se desincroniza: el día que alguien
 * cambiara «Traspaso» por «Traspaso entre cajas» en traspasos.js, la guardia
 * seguiría cuidando el nombre viejo y no diría nada. Acá se declaran UNA vez y
 * los cinco archivos que las escriben las toman de acá.
 */

/**
 * Cada una con quién la escribe, dicho para que el rechazo pueda explicarse
 * solo. El texto sale en el mensaje que ve la persona, así que habla de lo que
 * ella conoce —«Deudas y Compromisos»— y no de archivos.
 */
const CATEGORIAS_DEL_SISTEMA = [
  { nombre: 'Préstamos recibidos',  quien: 'Deudas y Compromisos, al recibir un préstamo' },
  { nombre: 'Pago de deudas',       quien: 'Deudas y Compromisos, al pagar una cuota' },
  { nombre: 'Cobro de préstamos',   quien: 'Deudas y Compromisos, al cobrar lo que se prestó' },
  { nombre: 'Préstamos entregados', quien: 'Deudas y Compromisos, al prestarle a alguien' },
  { nombre: 'Traspaso',             quien: 'los traspasos entre cajas' },
  { nombre: 'Ofrendas',             quien: 'la ofrenda de cada culto' },
  { nombre: 'Aportes',              quien: 'el aporte que sube al fondo y las cuotas de los cuerpos' },
];

/** Los nombres, para escribirlos: `CATEGORIA.TRASPASO`, `CATEGORIA.OFRENDAS`… */
const CATEGORIA = {
  DESEMBOLSO: 'Préstamos recibidos',
  PAGO: 'Pago de deudas',
  COBRO: 'Cobro de préstamos',
  PRESTADO: 'Préstamos entregados',
  TRASPASO: 'Traspaso',
  OFRENDAS: 'Ofrendas',
  APORTES: 'Aportes',
};

/**
 * ¿Esta categoría la escribe el sistema? Devuelve quién, o null.
 *
 * Se compara SIN distinguir mayúsculas, igual que el aviso de nombre repetido
 * del motor: si no, bastaría con guardar «ofrendas» para tener dos categorías
 * que el sistema no sabría distinguir y una de ellas quedaría sin protección.
 */
function quienLaEscribe(nombre) {
  const buscado = String(nombre || '').trim().toLowerCase();
  const suya = CATEGORIAS_DEL_SISTEMA.find((c) => c.nombre.toLowerCase() === buscado);
  return suya ? suya.quien : null;
}

/** ¿Es una de las que escribe el sistema? */
const laEscribeElSistema = (nombre) => quienLaEscribe(nombre) !== null;

module.exports = { CATEGORIAS_DEL_SISTEMA, CATEGORIA, quienLaEscribe, laEscribeElSistema };
