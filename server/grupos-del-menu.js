/**
 * En qué orden van los grupos del menú.
 *
 * ANTES NO ESTABA ESCRITO EN NINGUNA PARTE. El menú se armaba recorriendo los
 * módulos ya ordenados por su número, y los grupos aparecían en el orden en
 * que salía el primero de cada uno. Funcionaba, pero significaba que agregar
 * un módulo con un número bajo movía un grupo entero de lugar sin que nadie lo
 * hubiera pedido, y que para subir «Finanzas» había que renumerar sus cinco
 * módulos y esperar que ninguno chocara con otro.
 *
 * EL ORDEN NO ES TEMÁTICO, ES DE FRECUENCIA. Arriba lo que se usa todas las
 * semanas —pasar lista, las fichas de la gente, lo que la gente pide, la
 * plata— y abajo lo que se arma una vez y se corrige de tarde en tarde. Un
 * menú ordenado por temas se ve prolijo y obliga a bajar todos los domingos
 * hasta donde está lo único que se venía a hacer.
 *
 * Un grupo que no esté acá igual se muestra, al final: es preferible que un
 * módulo nuevo aparezca en un lugar poco feliz a que desaparezca del menú
 * porque alguien olvidó anotarlo.
 */
const GRUPOS_DEL_MENU = [
  'Reuniones',
  'Personas',
  'Atención y ayuda',
  'Finanzas',
  'Organización',
  'Documentación',
  'Sistema',
];

module.exports = { GRUPOS_DEL_MENU };
