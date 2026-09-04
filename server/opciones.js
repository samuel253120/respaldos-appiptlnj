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
 * tesorería, las cuentas activas, los tipos de actividad— no se comprueban con
 * la comprobación de más arriba: su lista vive en una tabla que la iglesia
 * mantiene y cambia sola, y compararla contra una copia escrita en el código
 * sería inventar una segunda verdad.
 *
 * ── LAS LISTAS QUE VIVEN EN UNA TABLA ──
 *
 * Pero de ahí no se sigue que no haya que comprobarlas: se sigue que hay que
 * comprobarlas CONTRA LA TABLA, que es la única verdad y no una copia de nada.
 * Sin eso, las listas que la iglesia mantiene con más cuidado eran justamente
 * las únicas que nadie hacía cumplir.
 *
 * MEDIDO en la v1.341.0, contra el sistema andando, en la categoría de un
 * movimiento de tesorería:
 *
 *   categoría «Categoría Que No Existe» ....  201, guardado así
 *   categoría en blanco ....................  201, guardado como «Ofrendas»
 *   sin mandar el campo ....................  201, guardado como «Ofrendas»
 *
 * Los dos últimos son el mismo caso: el campo es obligatorio, pero el valor de
 * fábrica se aplica ANTES de comprobar los obligatorios, así que un movimiento
 * sin categoría no se rechaza nunca —se le pone la de fábrica y se guarda—. En
 * la medición esa categoría estaba borrada, así que el movimiento quedó
 * clasificado bajo una palabra que no existía en ninguna lista.
 *
 * DE PASO SE NORMALIZA. Si el valor está en la tabla escrito con otras
 * mayúsculas, se guarda como está escrito ALLÁ. Eso cierra un hueco medido en
 * la misma revisión: se creó «Pro-Templo Sede Sur», se anotaron $500.000 con
 * «pro-templo sede sur» —que entraba, porque nada se comprobaba— y después la
 * categoría se borró sin problema, porque la cuenta de usos preguntaba por el
 * nombre exacto y no encontraba ninguno. Con una sola forma de escribirlo, las
 * dos mitades del módulo vuelven a hablar del mismo dato.
 *
 * SE DECLARA CAMPO POR CAMPO, con `opcionesDe: { modulo, columna }`, y hoy lo
 * declara uno solo: la categoría de un movimiento de tesorería. Los otros
 * dieciocho siguen como estaban, y se irán encendiendo cuando a cada módulo le
 * toque su revisión: encenderlos todos de una sería cambiarle el comportamiento
 * a dieciocho módulos que nadie ha mirado todavía.
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

/**
 * El reparo por un valor que no está en la tabla donde vive su lista.
 *
 * Devuelve el texto del reparo, o null. Cuando el valor SÍ está, deja `data`
 * con la forma exacta en que está escrito en la tabla: es la única manera de
 * que el resto del sistema —la cuenta de usos que decide si una categoría se
 * puede borrar, los informes que agrupan— vea siempre el mismo texto.
 *
 * La lista se pide con `LIMIT 1` sobre un `lower()`: no se traen las filas para
 * compararlas en memoria porque estas tablas las mantiene la iglesia y pueden
 * tener cientos. Cuando ese tiro no acierta —y solo entonces— se recorren los
 * nombres en memoria, porque el `lower()` de SQLite ES SOLO PARA LA A-Z: deja
 * las tildes como están, así que «SALIDA A LA CÁRCEL» no calzaba con «Salida a
 * la Cárcel» y el sistema contestaba que no estaba en la lista, estando. Se vio
 * probando esa fila exacta. En español eso no es un detalle: pasa con cualquier
 * nombre que lleve tilde o eñe.
 *
 * Y NO BASTA CON QUE EXISTA: si la tabla lleva la columna «activo» —la casilla
 * «En uso» de estos módulos—, tampoco se admite una que la iglesia haya
 * apagado (v1.352.0). Desmarcar «En uso» es lo que estos módulos ofrecen en
 * vez de borrar, justamente para no dejar huérfano lo ya anotado, y quedaba a
 * medias: dejaba de OFRECERSE en el desplegable y se seguía ACEPTANDO por la
 * API. Medido antes de esto: una actividad con un tipo desactivado entraba con
 * un 201.
 *
 * Alcanza solo lo que este guardado está CAMBIANDO, que es lo que `cambia()`
 * decide comparando contra lo que ya había. Así, una actividad de marzo cuyo
 * tipo se desactivó en agosto se sigue pudiendo abrir y corregirle la hora:
 * eso no la empeora. Lo que se frena es ponerle hoy, a propósito, un valor
 * que la iglesia sacó de circulación.
 */
function loQueNoEstaEnSuTabla(db, def, data, cambia) {
  for (const f of def.fields || []) {
    const suya = f.opcionesDe;
    if (!suya || !suya.modulo || !suya.columna) continue;
    if (!cambia(f.name)) continue;

    // Vacío no es un valor inventado, igual que más arriba: es no haber
    // contestado, y de eso se ocupa la comprobación de obligatorios.
    const val = data[f.name];
    if (val === null || val === undefined || String(val).trim() === '') continue;

    // PRAGMA no admite parámetros, y el nombre de la tabla sale del módulo.
    const tieneEnUso = db
      .prepare(`PRAGMA table_info("${suya.modulo}")`).all().some((c) => c.name === 'activo');

    const buscado = String(val).trim();
    let enLaLista = db
      .prepare(
        `SELECT "${suya.columna}" AS valor${tieneEnUso ? ', activo' : ''} FROM "${suya.modulo}" ` +
          `WHERE lower("${suya.columna}") = lower(?) LIMIT 1`
      )
      .get(buscado);

    if (!enLaLista) {
      const igualDando = (a, b) =>
        String(a).trim().toLocaleLowerCase('es') === String(b).trim().toLocaleLowerCase('es');
      enLaLista = db
        .prepare(`SELECT "${suya.columna}" AS valor${tieneEnUso ? ', activo' : ''} FROM "${suya.modulo}"`)
        .all()
        .find((fila) => igualDando(fila.valor, buscado));
    }

    const donde = suya.label || require('./registry').getModule(suya.modulo)?.label || suya.modulo;

    if (enLaLista && (!tieneEnUso || enLaLista.activo)) {
      data[f.name] = enLaLista.valor;   // una sola forma de escribirlo
      continue;
    }

    if (enLaLista) {
      return `«${enLaLista.valor}» ya no está en uso en ${donde}. `
        + `Elija otro de la lista, o vuelva a marcarlo «En uso» en ${donde}.`;
    }

    return `«${buscado}» no está en ${donde}. `
      + `Elija uno de la lista, o créelo primero en ${donde}.`;
  }
  return null;
}

module.exports = { loQueNoEstaEnLaLista, loQueNoEstaEnSuTabla, loQueOfrece, tieneListaPropia };
