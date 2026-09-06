/**
 * QUÉ PIDE CADA PIEZA DEL PANEL DE CONTROL.
 *
 * El panel es lo primero que ve todo el que entra, y es la única pantalla que
 * arma su resumen antes de saber quién está mirando. Seis de sus piezas
 * preguntaban por el permiso de su módulo antes de calcularse; tres no, y eran
 * justo las que llevan nombres de personas.
 *
 * MEDIDO en la v1.436.0, con una cuenta con Miembros, Solicitudes y
 * Certificados cerrados —las tres puertas contestaban 403—:
 *
 *   counts ................  miembros 3 · solicitudes_pendientes 1 · certificados 0
 *   solicitudesRecientes ..  «Ayuda por la enfermedad de su hijo» — Rosa Díaz Fuentes
 *   cumpleanos ............  Rosa Díaz Fuentes · 15/1 · cumple 42   (y los demás)
 *
 * Y con una cuenta que SÍ tiene Miembros pero no la llave del RUT y la fecha de
 * nacimiento: la ficha le llegaba sin `rut` y sin `fecha_nacimiento` —la llave
 * funcionaba— y el panel le entregaba el día, el mes y la edad de cada uno, que
 * es esa misma fecha dicha de otra manera (hallazgos PC-01, PC-02 y PC-03).
 *
 * ── POR QUÉ UNA TABLA Y NO UN `if` EN CADA PIEZA ──
 *
 * Los tres hallazgos son el mismo: la pieza se calculaba y era la PANTALLA la
 * que decidía si dibujarla. Escribir tres condiciones más dejaría el mismo
 * agujero abierto para la novena pieza que alguien agregue. Acá está la lista
 * entera, en un solo lugar, y hay una prueba que compara esta tabla con lo que
 * el panel de verdad devuelve: una pieza nueva que no se declare acá pone roja
 * esa prueba antes de llegar a publicarse.
 */
const { can } = require('./permissions');

/**
 * Cada pieza del panel y los permisos que pide, TODOS.
 *
 * `pide` son módulos o llaves del sistema —da igual, `can` contesta por los
 * dos— y hay que tenerlos todos: las finanzas piden ver Tesorería Y ver sus
 * montos, porque son dos permisos distintos y ya estaba resuelto así.
 *
 * `siempre: true` es para lo que no sale de ningún módulo y todos pueden ver.
 */
const LO_QUE_PIDE_CADA_PIEZA = {
  // Los contadores de arriba, uno por uno
  'counts.iglesias': { pide: ['iglesias'] },
  'counts.miembros': { pide: ['miembros'] },
  'counts.cuerpos': { pide: ['cuerpos'] },
  'counts.pastores': { pide: ['pastores'] },
  'counts.solicitudes_pendientes': { pide: ['solicitudes'] },
  'counts.solicitudes_vencidas': { pide: ['solicitudes'] },
  'counts.certificados': { pide: ['certificados'] },
  'counts.ayudas_mes': { pide: ['ayudas_sociales'] },
  'counts.ayudas_personas_mes': { pide: ['ayudas_sociales'] },
  'counts.ayudas_entregado_mes': { pide: ['ayudas_sociales'] },
  // Y las piezas grandes
  finanzas: { pide: ['tesoreria', 'tesoreria_montos'] },
  /*
   * Un cumpleaños ES la fecha de nacimiento dicha de otra manera: el día, el
   * mes y la edad son exactamente el dato que la llave reserva. Por eso pide
   * las dos cosas, y por eso no se recorta a medias: «en 3 días» y la fecha de
   * hoy dan el día exacto, y «cumple hoy» lo da directo. O se ve o no se ve.
   *
   * En una instalación nueva no cambia nada: esa llave viene abierta para
   * todos. Solo la pierde la cuenta a la que se la cerraron a propósito.
   */
  cumpleanos: { pide: ['miembros', 'miembros_identidad'] },
  solicitudesRecientes: { pide: ['solicitudes'] },
  credencialesPorVencer: { pide: ['credenciales'] },
  credencialesSinTitular: { pide: ['credenciales'] },
  cuerposSinDirectiva: { pide: ['cuerpos'] },
  documentosSinResponder: { pide: ['documentos'] },
};

/** ¿Esta persona puede ver esta pieza del panel? */
function puedeVerLaPieza(usuario, pieza) {
  const regla = LO_QUE_PIDE_CADA_PIEZA[pieza];
  // Una pieza que no está en la tabla NO se muestra. Es al revés de como suele
  // escribirse esto a propósito: olvidarse de declarar una pieza tiene que
  // dejarla fuera, no dejarla abierta.
  if (!regla) return false;
  if (regla.siempre) return true;
  return (regla.pide || []).every((llave) => can(usuario, llave, 'view'));
}

module.exports = { LO_QUE_PIDE_CADA_PIEZA, puedeVerLaPieza };
