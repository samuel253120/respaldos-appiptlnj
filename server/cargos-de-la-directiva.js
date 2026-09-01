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

/* ------------------------------------------ el oficial supervisor(a) ---- */

/**
 * El sexto cargo era el único que no se comprobaba en ninguna parte.
 *
 * Los cinco que salen del cuerpo se comprueban al guardar contra sus
 * integrantes, con un aviso que dice qué hacer. El oficial supervisor es la
 * excepción POR DISEÑO —viene del cuerpo de oficiales, porque supervisa desde
 * fuera— y esa excepción se había quedado a medias: el selector filtraba por el
 * cuerpo de oficiales y el servidor no comprobaba nada. Medido: poner de oficial
 * supervisor a un miembro cualquiera contestaba 200, y a uno de otra iglesia
 * también.
 *
 * QUÉ SE EXIGE, Y QUÉ NO. Lo que el sistema promete de este cargo está escrito
 * en Configuración → Organización, y es una sola cosa: es «el cuerpo cuyos
 * integrantes pueden ser designados oficial supervisor(a) de LOS DEMÁS
 * CUERPOS». O sea, ser integrante de ese cuerpo. La iglesia NO se exige, y no
 * es un olvido: los oficiales son un cuerpo de la organización que supervisa a
 * los demás desde fuera —el sistema busca uno solo, por su nombre, sin mirar de
 * qué iglesia es— así que exigirle la congregación del cuerpo supervisado sería
 * romper justamente lo que este cargo es. Es la diferencia con el líder de un
 * cuerpo (ver server/quien-dirige-el-cuerpo.js), que sí es de los suyos y a
 * quien la iglesia sí se le frena.
 *
 * SE PREGUNTA Y NO SE PROHÍBE, como el ser integrante del líder y por lo mismo:
 * hay un caso legítimo y corriente —a alguien se lo designa oficial y su ficha
 * de integrante del cuerpo de oficiales se anota después— y frenarlo obligaría
 * a hacer las cosas en un orden que la organización no siempre puede seguir.
 *
 * Y SOLO CUANDO ESE CUERPO EXISTE Y TIENE GENTE. Mientras no lo tenga, la propia
 * configuración dice que «se puede elegir a cualquier miembro»: preguntar ahí
 * sería preguntar por una regla que el sistema declara apagada. Que esté apagada
 * lo avisa el vigía, que es donde se avisa de una configuración que deja una
 * comprobación sin correr.
 */
function avisoSiNoEsOficial(db, { supervisorId, existing, confirmado }) {
  if (confirmado) return null;
  if (!supervisorId) return null;

  // ¿Este guardado es el que lo está poniendo? Corregirle una nota a una
  // directiva vieja no puede volver a preguntar por un cargo que no se tocó
  if (existing && String(existing.oficial_supervisor_id || '') === String(supervisorId)) return null;

  const oficiales = require('./oficiales');
  const armado = oficiales.comoEsta(db);
  if (!armado.armado) return null;               // sin cuerpo de oficiales, la regla está apagada
  const suyos = oficiales.idsDeOficiales(db);
  if (suyos.includes(Number(supervisorId))) return null;
  const cuerpo = armado.cuerpo;
  const suCuenta = armado.cuantos;

  const ficha = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(supervisorId);
  const nombre = ficha ? `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim() : 'Esa persona';
  return {
    error:
      `${nombre} no figura entre los integrantes de "${cuerpo.nombre}", que hoy tiene ${suCuenta}. `
      + 'El oficial supervisor(a) sale de ese cuerpo, porque supervisa a los demás desde fuera. '
      + 'Si se lo acaba de designar y todavía no se le anota su ficha de integrante ahí, confirme; '
      + `si no, agréguelo primero a "${cuerpo.nombre}".`,
    confirmar: 'supervisor_que_no_es_oficial',
  };
}

module.exports = {
  CARGOS, LOS_DEL_CUERPO, QUIEN_ENCABEZA,
  puesto, tieneQuienLaEncabece, cuantosPuestos, losQueFaltan, enLista, avisoSinQuienLaEncabece,
  avisoSiNoEsOficial,
};
