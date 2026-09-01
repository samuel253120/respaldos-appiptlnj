/**
 * Quiénes componen una directiva, en una sola lista.
 *
 * Los seis cargos estaban escritos TRES VECES —en el módulo, para comprobar que
 * quien los ocupa sea integrante del cuerpo; en la bitácora, para anotarle a
 * cada persona el cargo que asume; y en el panel de la ficha, con las etiquetas
 * escritas distinto («Primer jefe/a» contra «Primer jefe / Primera jefa»)—. Tres
 * copias de la misma lista es el cargo que se agregue mañana quedando fuera de
 * dos de ellas, en silencio.
 *
 * TODOS LOS CARGOS ERAN OPCIONALES, y eso hacía algo peor que un hueco. Medido:
 * una directiva con el cuerpo, el período y la fecha de inicio, y NADIE adentro,
 * entraba con 201 y el cuerpo pasaba a cumplir su requisito de tener directiva.
 * Un cuerpo con una directiva en blanco se veía en el listado igual que uno con
 * su directiva completa y electa en asamblea.
 *
 * Que los cargos se puedan dejar en blanco tiene sentido y no se toca: el
 * consejero «no siempre se designa» —lo dice el propio módulo—, el oficial
 * supervisor lo nombra el cuerpo de oficiales desde fuera y puede tardar, y una
 * directiva se va completando a medida que llega el acta. Lo que no puede pasar
 * es que nadie lo mire. Así que se hacen dos cosas distintas:
 *
 *   · AL GUARDAR se pregunta cuando la directiva queda SIN QUIEN LA ENCABECE.
 *     Se pregunta y no se prohíbe, porque anotar el período antes que los
 *     nombres es corriente; pero una elección sin electos no es una elección, y
 *     la pregunta lo dice en el momento en que alguien la está guardando así.
 *
 *   · EL CUMPLIMIENTO DEL CUERPO lo cuenta como requisito aparte, para que un
 *     cuerpo con la directiva a medias no se vea igual que uno con la suya
 *     completa. «Tener directiva» y «tener quién la componga» son dos cosas y
 *     ahora se dicen por separado.
 */

/**
 * Los seis, en el orden en que se leen.
 *
 *   `delCuerpo`  sale de los integrantes del propio cuerpo, y el guardado lo
 *                comprueba. El oficial supervisor no: viene del cuerpo de
 *                oficiales, porque supervisa desde fuera.
 *   `cuenta`     cuenta para el requisito «Directiva con sus cargos». Quedan
 *                fuera el consejero —que no siempre se designa— y el oficial
 *                supervisor, que no lo elige el cuerpo: reprocharle a un cuerpo
 *                un nombramiento que no está en sus manos sería un reproche que
 *                no puede resolver.
 *   `encabeza`   el que define la directiva. Sin él no hay a quién dirigirse.
 */
const CARGOS = [
  { campo: 'oficial_supervisor_id', label: 'Oficial supervisor(a)', corto: 'oficial supervisor', delCuerpo: false, cuenta: false },
  { campo: 'primer_jefe_id', label: 'Primer jefe / Primera jefa', corto: 'primer jefe', delCuerpo: true, cuenta: true, encabeza: true },
  { campo: 'segundo_jefe_id', label: 'Segundo jefe / Segunda jefa', corto: 'segundo jefe', delCuerpo: true, cuenta: true },
  { campo: 'secretario_id', label: 'Secretario(a)', corto: 'secretario', delCuerpo: true, cuenta: true },
  { campo: 'tesorero_id', label: 'Tesorero(a)', corto: 'tesorero', delCuerpo: true, cuenta: true },
  { campo: 'consejero_id', label: 'Consejero(a)', corto: 'consejero', delCuerpo: true, cuenta: false },
];

/** Los que se eligen entre los integrantes del cuerpo. */
const LOS_DEL_CUERPO = CARGOS.filter((c) => c.delCuerpo);

/** El que encabeza: primer jefe / primera jefa. */
const QUIEN_ENCABEZA = CARGOS.find((c) => c.encabeza);

const puesto = (fila, campo) => {
  const v = fila && fila[campo];
  return v !== undefined && v !== null && v !== '' && Number(v) > 0;
};

/** ¿Hay alguien anotado como primer jefe / primera jefa? */
const tieneQuienLaEncabece = (fila) => puesto(fila, QUIEN_ENCABEZA.campo);

/** Cuántos de los seis cargos tienen a alguien. */
const cuantosPuestos = (fila) => CARGOS.filter((c) => puesto(fila, c.campo)).length;

/** Los cargos que cuentan y están vacíos, en palabras: «segundo jefe y tesorero». */
const losQueFaltan = (fila) =>
  CARGOS.filter((c) => c.cuenta && !puesto(fila, c.campo)).map((c) => c.corto);

/** «uno», «uno y otro», «uno, otro y el de más allá». */
function enLista(cosas) {
  if (!cosas.length) return '';
  if (cosas.length === 1) return cosas[0];
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`;
}

/**
 * El aviso de que la directiva queda sin quien la encabece.
 *
 * Dice también cuántos de los otros cargos están puestos, porque no es lo mismo
 * una directiva entera a la que le falta el jefe que una completamente vacía, y
 * quien contesta la pregunta necesita saber cuál de las dos está guardando.
 */
function avisoSinQuienLaEncabece(fila) {
  const otros = cuantosPuestos(fila);
  const cuantos = otros === 0
    ? 'no tiene ningún cargo anotado'
    : `tiene ${otros} de los otros cargos anotado${otros === 1 ? '' : 's'}`;
  return (
    `Esta directiva queda sin primer jefe / primera jefa: ${cuantos}. Es quien la encabeza, ` +
    'y sin esa persona no hay a quién dirigirse ni quién responda por el cuerpo. ' +
    'El estado de cumplimiento del cuerpo lo va a decir hasta que se complete.'
  );
}

module.exports = {
  CARGOS, LOS_DEL_CUERPO, QUIEN_ENCABEZA,
  puesto, tieneQuienLaEncabece, cuantosPuestos, losQueFaltan, enLista, avisoSinQuienLaEncabece,
};
