/**
 * Cuándo un cuerpo o grupo todavía no ha sido nada, y por eso se puede borrar.
 *
 * Y, sobre todo, cuándo NO. Medido antes de esto, sobre un cuerpo con seis
 * integrantes desde 2019 y una directiva vigente, pidiendo borrarlo sin
 * confirmar nada:
 *
 *   se pregunta antes ................. no
 *   la respuesta ...................... 200, borrado
 *   sus 6 fichas de integrante ........ quedan 0
 *   su directiva vigente .............. queda 0
 *   sus 2 cuentas de tesorería ........ quedan 0
 *
 * Seis personas que llevaban siete años en ese cuerpo dejaban de haber estado
 * nunca en él, y nadie preguntó nada. La ficha de integrante no es un dato
 * administrativo: lleva DESDE CUÁNDO entró cada uno, su período de prueba, su
 * fecha de oficialización y, si se retiró, cuándo y por qué. Y lo mismo con un
 * cuerpo marcado INACTIVO: se borraba igual, con su gente adentro, cuando
 * marcarlo inactivo es justamente la salida que el sistema ofrece.
 *
 * Con PLATA en su caja o con un ACTA de reunión sí se frenaba, y eso estaba
 * bien y no se toca. El hueco era todo lo que quedaba en medio.
 *
 * ── LA MISMA DISTINCIÓN QUE LA 1.233.0 ──
 *
 * Aquella versión resolvió esto mismo para una iglesia (ver
 * server/iglesia-vacia.js): distinguir LO QUE EL REGISTRO TIENE de LO QUE EL
 * SISTEMA ESCRIBIÓ AL CREARLO. Acá vale igual, y por el mismo motivo: el
 * módulo le abre al cuerpo sus dos cuentas al crearlo —su tesorería y la de
 * las cuotas— así que, sin esta distinción, un cuerpo escrito con el nombre
 * mal tecleado no se podría borrar nunca por culpa de dos casilleros vacíos
 * que él mismo abrió.
 *
 * Entonces:
 *
 *   · si lo único que cuelga son esas dos cajas vacías, el borrado PREGUNTA,
 *     dice qué se va con él, y deja seguir;
 *   · si cuelga cualquier otra cosa —una persona, un peso, un acta, una
 *     directiva, un bien, una actividad— se FRENA, y el aviso dice cuánto hay
 *     y cuál es la salida: marcarlo inactivo, que desde la 1.249.0 significa
 *     algo.
 *
 * SE FRENA Y NO SE PREGUNTA cuando hay gente adentro, y ésa fue la decisión.
 * Preguntar habría sido lo cómodo —un botón más y listo— pero la pregunta se
 * contesta que sí, y lo que se pierde no se recupera: no hay papelera. Un
 * cuerpo que se cierra no necesita borrarse; necesita quedar marcado como
 * cerrado, con su gente y su historia dentro.
 */

/** Se va con el cuerpo. */
const SE_VA = 'arrastra';

/**
 * Lo que el sistema escribe solo al crear un cuerpo, y qué se hace con ello.
 *
 * Son sus dos cuentas: la tesorería general y la de las cuotas. Las abre
 * `crearLasQueFalten` en el gancho del módulo, sin que nadie las pida.
 *
 * Si CUALQUIERA de las dos tiene algo anotado, ninguna es rastro: ahí hay
 * plata, y la plata frena el borrado en todo el resto del sistema. Qué cuenta
 * como vacía lo contesta server/caja-vacia.js, que es el mismo lugar del que
 * lo lee la regla de la iglesia: dos definiciones de «caja vacía» se habrían
 * separado el día que apareciera una manera nueva de tener plata dentro —y ya
 * pasó una vez, con las deudas—.
 *
 * A diferencia de la iglesia, acá no hay ningún módulo que SE QUEDE soltando
 * el enlace: un cuerpo no tiene historial propio ni líneas de auditoría a su
 * nombre. Si algún día las tuviera, se agregan acá.
 */
const RASTRO = {
  'cuentas_tesoreria.cuerpo_id': (db, id) => (susCajasEstanVacias(db, id) ? SE_VA : null),
};

/** ¿Las dos cajas que el sistema le abrió siguen sin nada adentro? */
function susCajasEstanVacias(db, cuerpoId) {
  const cajas = db
    .prepare('SELECT id, saldo_inicial FROM cuentas_tesoreria WHERE cuerpo_id = ?')
    .all(cuerpoId);
  return cajas.every((c) => require('./caja-vacia').estaVacia(db, c));
}

/**
 * Qué cuelga de este cuerpo, en dos montones.
 *
 * `contenido` es lo que una persona puso ahí y frena el borrado; `rastro` es
 * lo que escribió el sistema al crearlo. Se reciben las referencias y el
 * contador desde fuera —los tiene server/dependencias.js— para no dar una
 * vuelta circular entre los dos archivos.
 */
function loQueCuelga(db, cuerpoId, referencias, cuantasApuntan) {
  const contenido = [];
  const rastro = [];
  for (const campo of referencias) {
    const n = cuantasApuntan(db, campo, cuerpoId);
    if (!n) continue;
    const comoRastro = RASTRO[campo.clave];
    const que = comoRastro ? comoRastro(db, cuerpoId, n) : null;
    if (que) rastro.push({ campo, que, n, label: campo.def.label });
    else contenido.push({ campo, n, label: campo.def.label });
  }
  return { contenido, rastro };
}

/** «6 en Integrantes de Cuerpos», «1 en Directivas»… en palabras. */
const enPalabras = (monton) => {
  const juntos = new Map();
  for (const c of monton) juntos.set(c.label, (juntos.get(c.label) || 0) + c.n);
  return [...juntos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n.toLocaleString('es-CL')} en ${label}`);
};

const cuantosSon = (monton) => monton.reduce((s, c) => s + c.n, 0);

/** Cómo se lo nombra: «El grupo "Aseo"», «El cuerpo "Damas"». */
const comoSeLlama = (fila) => `${fila.tipo === 'Grupo' ? 'el grupo' : 'el cuerpo'} «${fila.nombre}»`;

/**
 * El aviso de que este cuerpo no se borra, con el tamaño de lo que hay dentro.
 *
 * Se cuentan TODOS sus módulos y no solo el primero que aparezca: quien va a
 * borrar un cuerpo necesita ver el tamaño de lo que estaba por hacer, no
 * enterarse de a un módulo por vez. Es lo mismo que hace el aviso de la
 * iglesia, y por lo mismo.
 */
function avisoDeQueNoSeBorra(fila, contenido) {
  const orden = enPalabras(contenido);
  const primeros = orden.slice(0, 4).join(', ');
  const resto = orden.length > 4 ? `, y ${orden.length - 4} módulo(s) más` : '';

  /*
   * Cuando lo único que cuelga son cuentas de usuario, el motivo es otro y hay
   * que decirlo: soltarlas sin más las dejaría SIN NINGÚN cuerpo asignado, y
   * en este sistema una cuenta sin cuerpos asignados alcanza TODOS los de sus
   * iglesias (ver server/alcance.js). Borrar un cuerpo le abriría los demás a
   * quien solo administraba ése: un borrado que reparte permisos. Es la misma
   * trampa que ya está escrita para las iglesias.
   */
  const soloCuentas = contenido.every((c) => c.campo.def.name === 'usuarios');
  /*
   * Y si YA está inactivo, no se le dice que lo marque inactivo. Medido en la
   * primera versión de este aviso: un cuerpo cerrado con gente adentro se
   * frenaba —que está bien— con la instrucción de hacer lo que ya estaba
   * hecho. Ahí no falta ningún paso: la salida ya se tomó, y lo que hay que
   * decir es que lo suyo se queda donde está.
   */
  const yaCerrado = require('./cuerpo-inactivo').INACTIVO === fila.estado;
  const enCambio = soloCuentas
    ? 'Quíteselo primero a esas cuentas y elimínelo después: una cuenta que se quedara sin ningún '
      + 'cuerpo asignado pasaría a alcanzar todos los de sus iglesias.'
    : yaCerrado
      ? 'Ya está marcado como inactivo, que es la manera de retirarlo: no recibe nada nuevo y lo suyo '
        + 'queda donde está, para consultarlo e imprimirlo.'
      : 'Un cuerpo no se borra con su gente y su historia adentro: márquelo como inactivo y lo suyo '
        + 'queda donde está, sin recibir nada nuevo.';

  return (
    `No se puede eliminar ${comoSeLlama(fila)}: cuelgan de él `
    + `${cuantosSon(contenido).toLocaleString('es-CL')} registro(s) — ${primeros}${resto}. ${enCambio}`
  );
}

/**
 * La pregunta de antes de borrar uno que todavía no fue nada.
 *
 * Se pregunta aunque no cuelgue absolutamente nada, igual que con una iglesia:
 * borrar no se deshace, y el mismo botón apretado sobre el cuerpo de al lado
 * es irreparable.
 */
function preguntaDeBorrado(fila, rastro) {
  const seVa = rastro.filter((r) => r.que === SE_VA);
  const nombre = comoSeLlama(fila);
  const partes = [
    `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} no tiene nada anotado todavía: ni gente, `
    + 'ni plata, ni actas, ni directiva.',
  ];
  if (seVa.length) {
    partes.push(
      `Lo único que cuelga de él es el rastro de haberlo creado —${enPalabras(seVa).join(' y ')}—, `
      + 'que se va con él.'
    );
  }
  /*
   * La última frase no repite «esto no se puede deshacer», que es lo que ya
   * dijo la pregunta de siempre un segundo antes. Dice lo que esa no dice: que
   * hay otra salida, y cuál.
   */
  partes.push('Una vez borrado no se recupera; si lo que quiere es cerrarlo y conservar lo suyo, '
    + 'márquelo como inactivo en vez de eliminarlo.');
  return partes.join(' ');
}

module.exports = {
  SE_VA, RASTRO,
  susCajasEstanVacias, loQueCuelga, avisoDeQueNoSeBorra, preguntaDeBorrado, comoSeLlama,
};
