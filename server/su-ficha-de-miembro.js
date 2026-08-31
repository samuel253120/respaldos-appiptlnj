/**
 * El enlace entre un pastor y su ficha de miembro, que es de uno a uno.
 *
 * El pastor y la pastora de una iglesia son TAMBIÉN miembros de ella: además
 * de su ficha acá, tienen la suya en Miembros, y el módulo las enlaza —el
 * sistema reconoce sola la que lleva su mismo RUT— y muestra en el listado si
 * están enlazadas o no. Es de lo mejor que tiene el módulo.
 *
 * Pero el enlace no era único. Medido:
 *
 *   crearle su ficha de miembro al pastor A .... 200, miembro 626
 *   enlazar al pastor C al MISMO miembro 626 ... 200, aceptado
 *   lo que dicen las dos fichas después ........ «Registrado», las dos
 *
 * Dos personas distintas del ministerio quedan declarando ser el mismo
 * miembro, y la columna que existe justamente para avisar de que algo no
 * cuadra dice que todo está bien en las dos. Del otro lado, la ficha de
 * miembro no sabe cuál de los dos es.
 *
 * Y SE VE. La lista «A cargo de la iglesia» arma el nombre de cada pastor a
 * partir de SU ficha de miembro, para poder darle su trato. Con dos apuntando
 * a la misma, la del segundo pasa a mostrar el nombre del primero: medido,
 * la fila de «Tomás Tres» se leía «Pastor Marcos Uno», y el nombre de Tomás no
 * aparecía por ninguna parte.
 *
 * ACÁ SE FRENA Y NO SE PREGUNTA. En los otros avisos del módulo hay un caso
 * legítimo detrás —un pastor que atiende dos congregaciones, una viudez, unas
 * segundas nupcias— y por eso se pregunta. Éste no tiene ninguno: una persona
 * no es dos pastores. Lo que hay que hacer es corregir el enlace equivocado, y
 * el aviso dice de quién es el que está ocupado.
 *
 * LO YA GUARDADO NO SE CORRIGE AL ARRANCAR, porque no hay manera de saber cuál
 * de los dos es el bueno. Se pone a la vista: la columna «Ficha de miembro»
 * del listado, que hasta ahora decía «Registrado» en las dos, pasa a decir
 * «La comparte con otro».
 */

/** Cómo se llama un pastor en un aviso. */
const comoSeLlama = (p) => `${p.nombres || ''} ${p.apellidos || ''}`.trim();

/** Los OTROS pastores enlazados a esta misma ficha de miembro. */
function quienesMasLaTienen(db, miembroId, exceptoPastorId) {
  if (!miembroId) return [];
  return db
    .prepare('SELECT id, nombres, apellidos FROM pastores WHERE miembro_id = ? AND id IS NOT ?')
    .all(miembroId, exceptoPastorId || 0);
}

/**
 * El aviso de que esa ficha de miembro ya es de otro pastor, o null.
 *
 * `porElRut` distingue las dos maneras de llegar acá: eligiéndola a mano, o
 * porque el sistema la reconoció por el RUT y la enlazó solo. En el segundo
 * caso quien guarda no eligió nada, así que el aviso tiene que decírselo o el
 * mensaje no se entiende.
 */
function avisoSiEsaFichaYaEsDeOtro(db, pastorId, miembroId, { porElRut = false } = {}) {
  const otros = quienesMasLaTienen(db, miembroId, pastorId);
  if (!otros.length) return null;

  /*
   * El aviso nombra al OTRO PASTOR y no a la persona de la ficha de miembro.
   * Nombrar a los dos sonaba a error —la ficha de miembro de un pastor lleva
   * su mismo nombre, así que el mensaje decía dos veces lo mismo: «la ficha de
   * Marcos Uno ya está enlazada a Marcos Uno»— y además quien está guardando
   * acaba de elegir esa ficha: sabe de quién es.
   */
  const deQuien = otros.map((o) => `«${comoSeLlama(o)}»`).join(' y ');
  const comoLlego = porElRut
    ? `El RUT de esta ficha es el de una persona cuya ficha de miembro ya está enlazada a ${deQuien}. `
    : `Esa ficha de miembro ya está enlazada a ${deQuien}. `;
  return (
    comoLlego
    + 'Cada ficha de miembro es de un solo pastor: una persona no es dos. Con las dos enlazadas, el '
    + 'listado diría «Registrado» en ambas y «A cargo de la iglesia» mostraría el nombre de una en '
    + 'la fila de la otra. Revise cuál de las dos fichas de Pastores / Guías corresponde a esa '
    + 'persona y quítele el enlace a la que no.'
  );
}

module.exports = { quienesMasLaTienen, avisoSiEsaFichaYaEsDeOtro };
