/**
 * UN DESPLEGABLE QUE NO ADMITE LO QUE NO OFRECE.
 *
 * Ochenta y un campos del sistema son un desplegable: el estado de un miembro,
 * el tipo de una ayuda, el cargo de un pastor, el método de un pago. Setenta y
 * siete de ellos traen escrita su lista de opciones, y ninguno la comprobaba al
 * guardar. La pantalla ofrecía las cinco de siempre y por la API entraba
 * cualquier otra cosa:
 *
 *   tipo de ayuda «Vestuario» .............  201, guardado así
 *   tipo de ayuda «Lo que sea» ............  201, guardado así
 *   estado de una ayuda «Regalada» ........  201, guardado así
 *   ¿a quién se le ayuda? «Vecino» ........  201, y la ayuda quedó sin
 *                                            beneficiario, porque la regla que
 *                                            copia el nombre solo conoce dos
 *   estado de un miembro «Cualquier cosa» .  200
 *   estado de una cuenta «Congelada» ......  200
 *
 * No es solo un dato feo. Un valor que el desplegable no ofrece deja la ficha
 * imposible de corregir por la vía normal —hay que elegir otro para poder
 * guardar, y el que tenía se pierde—, rompe los informes que agrupan por ese
 * campo, y hace que las reglas escritas alrededor de esos valores dejen de
 * aplicarse en silencio: la que copia el nombre del beneficiario mira si dice
 * «Miembro» o «No miembro», y ante un «Vecino» no hace nada y no dice nada.
 *
 * El propio código lo había advertido, en server/tipos-de-ayuda.js: una ficha
 * que nace con un valor que su desplegable no ofrece es «imposible de corregir
 * sin borrarla y volver a empezar». Se escribió como un peligro teórico y se
 * podía provocar desde afuera con una línea.
 *
 * ── SOLO LO QUE ESTE GUARDADO ESTÁ PONIENDO ──
 *
 * Es la misma regla que ya usan las fechas en server/crud.js, y por la misma
 * razón. Medido sobre los datos de prueba antes de esto, cuatro campos tenían
 * valores fuera de su lista sin que nadie los hubiera inventado: dos pastores
 * con cargo «Pastor» —que la lista no ofrece, porque distingue «Pastora» de
 * «Pastor Presbítero»—, cuentas con ámbito abreviado, y once anotaciones del
 * Registro de Cambios con acciones que ese módulo escribe por su cuenta.
 *
 * Si la comprobación mirara la ficha entera, esas fichas quedarían imposibles
 * de guardar: entrar a corregirle el teléfono a un pastor daría un reparo por
 * un cargo que él no eligió. Así que se frena el guardado que EMPEORA las
 * cosas, no el que simplemente no arregla algo que ya estaba. Lo que ya está
 * se corrige cuando alguien toque ese campo, que es cuando puede hacer algo al
 * respecto —y la pantalla se lo ofrece: el formulario agrega el valor guardado
 * al desplegable, marcado «(valor anterior)»—.
 *
 * ── LO QUE APARECIÓ AL ENCENDERLA ──
 *
 * La batería completa la corrió entera y dos suites se pusieron rojas, las dos
 * por escribir valores que su módulo nunca ofreció:
 *
 *   · la de aislamiento creaba cuerpos de tipo «Dorcas» y «Juventud» —el
 *     módulo ofrece «Cuerpo» y «Grupo»—, cuentas de ámbito «Iglesia» y
 *     «Cuerpo» —son «Iglesia local» y «Cuerpo / Grupo»— y un pastor con cargo
 *     «Pastor»;
 *   · y la preparación de las credenciales, otro pastor con ese mismo cargo.
 *
 * Lo del cargo merece decirse, porque parece un error de la lista y no lo es:
 * «Pastor» es un TRATO, no una grada del ministerio, y la escala está escrita
 * a propósito en server/tratamiento.js sin él. Los datos de prueba llevaban
 * años guardando un cargo que el desplegable jamás ofreció, y nadie lo vio
 * porque nada lo miraba. Se corrigieron los datos de las pruebas, no la lista.
 *
 * ── Y SOLO LAS LISTAS ESCRITAS ──
 *
 * Los diecinueve campos cuya lista viene de una ruta —las categorías de
 * tesorería, las cuentas activas, los tipos de actividad— no se comprueban acá:
 * su lista vive en una tabla que la iglesia mantiene y cambia sola. Comprobarla
 * contra una copia sería inventar una segunda verdad.
 */

/** Los valores que un campo admite, venga su lista como texto o como objeto. */
function loQueOfrece(f) {
  return (f.options || []).map((o) => (o && typeof o === 'object' ? o.value : o)).map(String);
}

/** ¿Este campo tiene una lista escrita que se pueda comprobar? */
function tieneListaPropia(f) {
  return f.type === 'select' && !f.optionsRoute && Array.isArray(f.options) && f.options.length > 0;
}

/**
 * El reparo por un valor que el desplegable no ofrece, o null si no hay ninguno.
 *
 * `cambia(nombre)` es la misma función con que las fechas deciden qué mirar:
 * contesta si este guardado está poniendo algo distinto de lo que ya había.
 */
function loQueNoEstaEnLaLista(def, data, cambia) {
  for (const f of def.fields || []) {
    if (!tieneListaPropia(f)) continue;
    if (!cambia(f.name)) continue;

    const val = data[f.name];
    // Vacío no es un valor inventado: es no haber contestado. Si el campo es
    // obligatorio, de eso se ocupa la comprobación de obligatorios.
    if (val === null || val === undefined || String(val).trim() === '') continue;

    const ofrece = loQueOfrece(f);
    if (ofrece.includes(String(val))) continue;

    return `El campo "${f.label || f.name}" no admite "${val}". `
      + `Las opciones son: ${ofrece.join(', ')}.`;
  }
  return null;
}

module.exports = { loQueNoEstaEnLaLista, loQueOfrece, tieneListaPropia };
