/**
 * Cuándo una iglesia todavía no ha sido nada, y por eso se puede borrar.
 *
 * Que una iglesia con gente adentro no se borre está bien y se queda como
 * está. El problema era la otra: la que se creó hace un minuto con el nombre
 * mal escrito. Medido sobre una recién creada, sin tocarla:
 *
 *   borrarla al segundo de crearla ....... 400 · «cuelgan de ella 3 registros»
 *   cuáles son esos tres ................. 2 cuentas de tesorería + 1 historial
 *   quién los creó ....................... el propio sistema, al crearla
 *   después de editarla una vez .......... 400 · ahora son 4
 *
 * Los tres los escribe el sistema solo: el módulo de Iglesias le abre sus dos
 * cuentas al crearla —está así a propósito y es correcto— y la bitácora le
 * anota la línea de apertura. Así que el sistema creaba por su cuenta los
 * motivos por los que después se negaba a borrarla, y cada vez que alguien la
 * tocaba sumaba uno más. Una iglesia escrita con un error quedaba para siempre
 * en el listado, en los desplegables y en el selector de arriba.
 *
 * LA DISTINCIÓN ES ENTRE LO QUE LA IGLESIA TIENE Y LO QUE EL SISTEMA ESCRIBIÓ
 * SOBRE ELLA. Sus dos cuentas recién abiertas y sin un peso adentro, sus
 * anotaciones automáticas de historial y sus líneas de auditoría no son «su
 * gente y su historia»: son el rastro de haberla creado. Si lo único que
 * cuelga es eso, el borrado pregunta, dice qué se va, y deja seguir. Si cuelga
 * cualquier otra cosa —un miembro, un peso, un acta, un papel— se frena como
 * siempre.
 *
 * Es la misma distinción que la 1.225.0 hizo con un traspaso de una cuenta
 * cerrada: se congela lo que mueve plata y lo demás se sigue pudiendo
 * corregir.
 *
 * SE PREGUNTA Y NO SE PROHÍBE, porque borrar una iglesia no se deshace y
 * porque quien la creó hace un minuto sabe perfectamente lo que está haciendo;
 * pero también porque el mismo botón, apretado sobre la iglesia equivocada, es
 * irreparable. Los dos botones son la respuesta correcta a eso.
 */

/** Se va con la iglesia. */
const SE_VA = 'arrastra';
/** Se queda, pero deja de apuntarle. */
const SE_QUEDA = 'suelta';

/**
 * Una cuenta que nunca tuvo un peso adentro.
 *
 * No se pregunta si la abrió el sistema, se pregunta si tiene algo: sin
 * movimientos, sin traspasos por ninguno de sus dos lados y sin saldo con que
 * empezar, la cuenta es un casillero vacío. Si UNA sola de las cuentas de la
 * iglesia tiene algo, ninguna es rastro: ahí hay plata anotada, y la plata
 * frena el borrado como en cualquier otra parte del sistema.
 */
function lasCuentasEstanVacias(db, iglesiaId) {
  const cuentas = db
    .prepare('SELECT id, cuerpo_id, saldo_inicial FROM cuentas_tesoreria WHERE iglesia_id = ?')
    .all(iglesiaId);
  return cuentas.every((c) => {
    if (c.cuerpo_id) return false;               // la de un cuerpo es del cuerpo, no de la iglesia
    if (Number(c.saldo_inicial || 0) !== 0) return false;
    const movimientos = db.prepare('SELECT COUNT(*) AS n FROM tesoreria WHERE cuenta_id = ?').get(c.id).n;
    if (movimientos) return false;
    const traspasos = db
      .prepare('SELECT COUNT(*) AS n FROM traspasos WHERE cuenta_origen_id = ? OR cuenta_destino_id = ?')
      .get(c.id, c.id).n;
    return !traspasos;
  });
}

/**
 * Un historial escrito entero por el sistema.
 *
 * La columna `origen` lo dice: la bitácora automática escribe «Automático» y
 * lo que teclea una persona queda «Manual» (ver server/bitacora.js). Una sola
 * línea escrita a mano es alguien contando algo de esa congregación, y eso ya
 * es su historia.
 */
function elHistorialEsAutomatico(db, iglesiaId) {
  const aMano = db
    .prepare("SELECT COUNT(*) AS n FROM historial_iglesias WHERE iglesia_id = ? AND IFNULL(origen,'') <> 'Automático'")
    .get(iglesiaId).n;
  return !aMano;
}

/**
 * Lo que el sistema escribe solo, y qué se hace con cada cosa.
 *
 * El Registro de Cambios no se va con la iglesia: **se queda**. Es la
 * auditoría, y su propio módulo se niega a que se borre una línea —«el
 * registro de cambios no se borra: para eso está»—. Lo que se suelta es el
 * enlace: la línea deja de apuntar a una iglesia que ya no existe y sigue
 * diciendo qué pasó, quién lo hizo y cuándo.
 */
const RASTRO = {
  'cuentas_tesoreria.iglesia_id': (db, id) => (lasCuentasEstanVacias(db, id) ? SE_VA : null),
  'historial_iglesias.iglesia_id': (db, id) => (elHistorialEsAutomatico(db, id) ? SE_VA : null),
  'registro_cambios.iglesia_id': () => SE_QUEDA,
};

/**
 * Qué cuelga de esta iglesia, en dos montones.
 *
 * `contenido` es lo que una persona puso ahí y frena el borrado; `rastro` es
 * lo que escribió el sistema. Se reciben las referencias y el contador desde
 * fuera —los tiene server/dependencias.js— para no dar una vuelta circular
 * entre los dos archivos.
 */
function loQueCuelga(db, iglesiaId, referencias, cuantasApuntan) {
  const contenido = [];
  const rastro = [];
  for (const campo of referencias) {
    const n = cuantasApuntan(db, campo, iglesiaId);
    if (!n) continue;
    const comoRastro = RASTRO[campo.clave];
    const que = comoRastro ? comoRastro(db, iglesiaId, n) : null;
    if (que) rastro.push({ campo, que, n, label: campo.def.label });
    else contenido.push({ campo, n, label: campo.def.label });
  }
  return { contenido, rastro };
}

/** «2 cuentas de tesorería», «1 anotación de historial»… en palabras. */
const enPalabras = (montón) => {
  const juntos = new Map();
  for (const c of montón) juntos.set(c.label, (juntos.get(c.label) || 0) + c.n);
  return [...juntos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n.toLocaleString('es-CL')} en ${label}`);
};

const cuantosSon = (montón) => montón.reduce((s, c) => s + c.n, 0);

/**
 * El aviso de que esta iglesia no se borra, con el tamaño de lo que hay dentro.
 *
 * Se cuentan TODOS sus módulos y no solo el primero que aparezca: quien va a
 * borrar una iglesia necesita ver el tamaño de lo que estaba por hacer, no
 * enterarse de a un módulo por vez.
 */
function avisoDeQueNoSeBorra(nombre, contenido) {
  const orden = enPalabras(contenido);
  const primeros = orden.slice(0, 4).join(', ');
  const resto = orden.length > 4 ? `, y ${orden.length - 4} módulo(s) más` : '';

  /*
   * Cuando lo único que cuelga son cuentas de usuario, el motivo es otro y hay
   * que decirlo: soltarlas sin más las dejaría SIN NINGUNA iglesia asignada, y
   * en este sistema una cuenta sin iglesias asignadas las alcanza TODAS (ver
   * server/alcance.js). Borrar una iglesia le abriría el sistema entero a
   * quien solo administraba esa: un borrado que reparte permisos.
   */
  const soloCuentas = contenido.every((c) => c.campo.def.name === 'usuarios');
  const enCambio = soloCuentas
    ? 'Quítesela primero a esas cuentas y elimínela después: una cuenta que se quedara sin ninguna '
      + 'iglesia asignada pasaría a alcanzarlas todas.'
    : 'Una iglesia no se borra con su gente y su historia adentro: márquela como inactiva.';

  return (
    `No se puede eliminar ${nombre}: cuelgan de ella ${cuantosSon(contenido).toLocaleString('es-CL')} `
    + `registro(s) — ${primeros}${resto}. ${enCambio}`
  );
}

/** La pregunta de antes de borrar una que todavía no fue nada. */
function preguntaDeBorrado(nombre, rastro) {
  const seVa = rastro.filter((r) => r.que === SE_VA);
  const seQueda = rastro.filter((r) => r.que === SE_QUEDA);

  const partes = [
    `${nombre} no tiene nada anotado todavía: ni gente, ni cuerpos, ni plata, ni papeles.`,
  ];
  if (seVa.length) {
    partes.push(
      `Lo único que cuelga de ella es el rastro de haberla creado —${enPalabras(seVa).join(' y ')}—, `
      + 'que se va con ella.'
    );
  }
  if (seQueda.length) {
    partes.push(
      `Lo anotado en ${seQueda.map((r) => r.label).join(' y ')} se conserva: deja de apuntarle y `
      + 'sigue diciendo qué pasó.'
    );
  }
  /*
   * La última frase no repite «esto no se puede deshacer», que es lo que ya dijo
   * la pregunta de siempre un segundo antes —la pantalla las muestra una tras
   * otra y dos avisos que terminan igual se leen como un tartamudeo—. Dice lo
   * que esa no dice: que hay otra salida, y cuál. Desde la 1.232.0 marcarla
   * inactiva de verdad la retira, así que ofrecerla ya no es mandar a nadie a
   * una puerta pintada en la pared.
   */
  partes.push('Una vez borrada no se recupera; si lo que quiere es retirarla y conservar lo suyo, '
    + 'márquela como inactiva en vez de eliminarla.');
  return partes.join(' ');
}

module.exports = {
  SE_VA, SE_QUEDA, RASTRO,
  lasCuentasEstanVacias, elHistorialEsAutomatico,
  loQueCuelga, avisoDeQueNoSeBorra, preguntaDeBorrado,
};
