/**
 * Lo que significa que un pastor ya no ejerza.
 *
 * Hasta acá, nada. El campo «Estado» de su ficha ofrece cinco valores —Activo,
 * Inactivo, Jubilado, Trasladado, Fallecido—, se guarda y se pinta como
 * etiqueta en la ficha y en el listado, y NINGUNA regla del sistema lo
 * consultaba. Medido sobre un pastor creado directamente como fallecido:
 *
 *   designarlo pastor principal de una iglesia ..... 200
 *   marcar fallecido al que YA está a cargo ........ 200, sin decir nada
 *   ¿la iglesia lo sigue nombrando después? ........ sí
 *   ¿lo ofrece el desplegable de pastores? ......... sí, 9 de 9
 *   ¿y al jubilado? ................................ también
 *
 * No es un rótulo cualquiera. Del campo «Pastor principal» sale «A cargo de la
 * iglesia», que nombra al pastor Y A SU CÓNYUGE, y es lo que la organización
 * lee para saber quién responde por esa congregación. Un estado que no hace
 * cumplir nada es peor que no tenerlo: promete una protección que no existe.
 *
 * LO QUE SE FRENA ES DESIGNARLO DE NUEVO, NO LO QUE YA ESTÁ ESCRITO. Un pastor
 * jubilado o fallecido fue el pastor de esa iglesia hasta el día que dejó de
 * serlo, y su historial, sus documentos y las credenciales que tuvo son el
 * registro de eso: se leen, se consultan, se corrigen y se imprimen. Lo que no
 * se hace es seguir nombrándolo para cosas nuevas.
 *
 * SE FRENA Y NO SE PREGUNTA al designarlo, como con una iglesia inactiva (ver
 * server/iglesia-inactiva.js): la salida está escrita en el propio aviso
 * —cambiarle el estado— y es una decisión que se toma en la ficha del pastor,
 * no de pasada al guardar otra cosa.
 *
 * PERO SÍ SE PREGUNTA al revés: cuando alguien lo jubila o lo marca fallecido y
 * queda algo suyo colgando. Ahí no hay nada que corregir —la persona dejó de
 * ejercer y eso es un hecho— y lo que hay que decidir es qué pasa con lo que
 * dependía de él. Es la misma puerta que la 1.237.0 cerró para el traslado.
 *
 * Y ESA PREGUNTA ES UNA SOLA, aunque las consecuencias sean dos. El motor deja
 * pasar una pregunta por guardado, así que preguntar «¿y su iglesia?» y
 * después «¿y su credencial?» significaría que la primera se guarda y la
 * segunda aparece recién al guardar de nuevo. Se nombran juntas las dos cosas
 * que van a pasar, que además es como uno lo diría en voz alta.
 *
 * LA CREDENCIAL SE REVOCA, NO SE BORRA. Una credencial emitida es un documento
 * y su QR lleva a una página pública que dice si vale. Medido antes de esto:
 * marcada FALLECIDA la titular de la credencial 0012026, esa página seguía
 * contestando «VIGENTE · Credencial vigente y emitida por la institución».
 * Revocarla la deja sin valor conservándola, con su motivo y su fecha, que es
 * lo que hay que poder mostrar después.
 */

const suIglesia = require('./pastor-de-la-iglesia');

/**
 * Los estados en que ya no ejerce. Todo lo que no sea «Activo».
 *
 * Se listan los que cierran la puerta y no los que la dejan abierta a
 * propósito: si algún día se agrega un estado nuevo a la ficha, lo prudente es
 * que por omisión NO frene nada hasta que alguien decida que sí.
 */
const YA_NO_EJERCEN = ['Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'];

/**
 * Los módulos que SÍ pueden seguir nombrando a un pastor que no ejerce.
 *
 * Son los que existen para contar lo que le pasó —su historial ministerial y
 * su carpeta—, y dejar de ejercer es justamente lo que hay que poder anotar
 * ahí. Y los certificados, porque un certificado registra un hecho con SU
 * fecha: el matrimonio de 1998 lo ofició quien lo ofició, aunque hoy ya no
 * esté. `registro_cambios` va por lo mismo que en la iglesia inactiva: lo
 * escribe el sistema, no una persona.
 */
const PUEDEN_NOMBRARLO = [
  'historial_pastores', 'documentos_pastores', 'certificados', 'registro_cambios',
];

/** La condición SQL de los que sí ejercen. Un estado en blanco ejerce. */
const condicionDeQuienesEjercen = (alias = '') => {
  const c = alias ? `${alias}.estado` : 'estado';
  return `(${c} IS NULL OR ${c} NOT IN (${YA_NO_EJERCEN.map((e) => `'${e}'`).join(', ')}))`;
};

/** ¿Este pastor dejó de ejercer? Devuelve su fila, o null. */
function elQueNoEjerce(db, pastorId) {
  const id = Number(pastorId) || 0;
  if (!id) return null;
  let fila = null;
  try {
    fila = db.prepare('SELECT id, nombres, apellidos, estado FROM pastores WHERE id = ?').get(id);
  } catch (e) {
    return null; // la tabla se crea al arrancar; si aún no está, no hay regla que correr
  }
  return fila && YA_NO_EJERCEN.includes(fila.estado) ? fila : null;
}

/** Cómo se llama un pastor en un aviso. */
const comoSeLlama = (p) => `${p.nombres} ${p.apellidos}`.trim();

/**
 * El aviso de que no se puede nombrar a un pastor que ya no ejerce, o null.
 *
 * Mira TODOS los campos que apuntan a Pastores / Guías —el pastor principal de
 * una iglesia, el titular de una credencial— en vez de escribirse módulo por
 * módulo: la regla es una y así no se olvida en el que venga después.
 *
 * Solo cuando ESTE guardado lo nombra por primera vez o lo cambia. Corregirle
 * el teléfono a una iglesia cuyo pastor falleció no se frena: eso es
 * exactamente lo que hay que poder seguir haciendo.
 */
function avisoSiElPastorYaNoEjerce(db, def, { data, existing, isNew }) {
  if (PUEDEN_NOMBRARLO.includes(def.name)) return null;

  for (const campo of (def.fields || [])) {
    if (campo.type !== 'ref' || campo.ref !== 'pastores') continue;
    const ahora = data[campo.name];
    if (!ahora) continue;
    const antes = existing ? existing[campo.name] : null;
    if (!isNew && String(antes || '') === String(ahora)) continue;

    const pastor = elQueNoEjerce(db, ahora);
    if (!pastor) continue;
    return (
      `${comoSeLlama(pastor)} figura como «${pastor.estado}» en Pastores / Guías, así que ya no `
      + `ejerce y no se le puede designar de nuevo en «${campo.label || campo.name}». Lo que ya `
      + 'estaba escrito con su nombre se conserva y se sigue consultando; esto es una designación '
      + 'nueva. Si volvió a ejercer, cámbiele el estado en su ficha y vuelva a intentarlo; si no, '
      + 'elija a otra persona.'
    );
  }
  return null;
}

/** ¿Este guardado le está poniendo un estado en que ya no ejerce? */
function estaDejandoDeEjercer({ data, existing }) {
  if (!existing) return false;                       // una ficha nueva no deja nada atrás
  if (data.estado === undefined) return false;
  if (!YA_NO_EJERCEN.includes(data.estado)) return false;
  return String(existing.estado || '') !== String(data.estado || '');
}

/**
 * Lo que queda colgando si deja de ejercer: las iglesias que lo nombran como
 * su pastor principal y las credenciales suyas que hoy siguen valiendo.
 *
 * Sale de acá y no de cada lugar que lo necesita porque lo usan DOS: la
 * pregunta, para decir qué va a pasar, y el gancho de después, para hacerlo.
 * Escrito dos veces, un día la pregunta anunciaría una cosa y pasaría otra.
 */
function loQueQuedaColgando(db, pastorId) {
  return {
    iglesias: suIglesia.lasQueLoSiguenNombrando(db, pastorId, null),
    credenciales: require('./modules/credenciales').lasVigentesDe(pastorId),
  };
}

/**
 * Al guardar un PASTOR al que se le está poniendo un estado en que ya no
 * ejerce: el aviso de lo que va a pasar con lo suyo, o null.
 *
 * Dice lo que va a pasar si confirma, porque va a pasar: la designación se
 * suelta y las credenciales se revocan. Es la misma forma del aviso del
 * traslado (1.237.0) y por el mismo motivo: dejarlas como están sería que la
 * ficha de esa iglesia dijera que su pastor es alguien que ya no ejerce, y que
 * su credencial siguiera diciéndole «vigente» a quien la verifica; hacerlo sin
 * avisar sería peor.
 */
function avisoSiDejaDeEjercer(db, pastorId, { data, existing, confirmado }) {
  if (confirmado) return null;
  if (!pastorId || !estaDejandoDeEjercer({ data, existing })) return null;

  const { iglesias, credenciales } = loQueQuedaColgando(db, pastorId);
  if (!iglesias.length && !credenciales.length) return null;

  const partes = [];
  if (iglesias.length) {
    const cuales = iglesias.map((i) => `«${i.nombre}»`).join(' y ');
    partes.push(
      `${iglesias.length > 1 ? 'esas iglesias quedan' : `${cuales} queda`} sin pastor principal `
      + 'anotado y hay que designarle otro: de ese campo sale «A cargo de la iglesia», que es lo que '
      + 'se lee para saber quién responde por esa congregación'
    );
  }
  if (credenciales.length) {
    const serie = require('./credenciales/serie');
    const numeros = credenciales.map((c) => `N.º ${serie.conDigito(c.serie, c.serie_dv)}`).join(' y ');
    partes.push(
      `${credenciales.length > 1 ? `sus ${credenciales.length} credenciales vigentes` : `su credencial ${numeros}`} `
      + `${credenciales.length > 1 ? `(${numeros}) quedan revocadas` : 'queda revocada'}: hoy su código QR `
      + 'lleva a una página pública que contesta «vigente» a quien la verifica. No se borra —una '
      + 'credencial emitida es un documento— y queda con el motivo anotado'
    );
  }

  const donde = iglesias.length
    ? `figura como pastor(a) principal de ${iglesias.map((i) => `«${i.nombre}»`).join(' y ')}`
    : 'tiene credenciales vigentes';
  return {
    error:
      `${comoSeLlama(existing)} ${donde}, y lo está marcando como «${data.estado}». `
      + `Si confirma, ${partes.join('; y ')}.`,
    confirmar: 'deja_de_ejercer_y_esta_a_cargo',
  };
}

/**
 * Y, ya confirmado, se hace: es lo que la pregunta dijo que iba a pasar.
 * Devuelve lo que se soltó y lo que se revocó, para poder anotarlo.
 */
function soltarLoSuyo(db, pastor, usuario) {
  const credenciales = require('./modules/credenciales');
  const sueltas = suIglesia.soltarLasQueLoNombraban(db, pastor.id, null);
  /*
   * El motivo va NEUTRO a propósito. Se muestra en la página pública que abre
   * cualquiera con un teléfono, y ahí lo que hace falta saber es que quien
   * tiene esa tarjeta ya no representa a la institución; que la persona
   * falleció, se jubiló o se trasladó es asunto de adentro. El estado exacto
   * queda en el historial del pastor, que en ese mismo momento estrena su
   * línea «Estado: Activo → Fallecido» al lado de ésta.
   */
  const revocadas = credenciales.lasVigentesDe(pastor.id).map((c) =>
    credenciales.revocarLa(c, {
      motivo: 'El titular ya no ejerce en el ministerio.',
      usuario,
    })
  );
  return { sueltas, revocadas };
}

module.exports = {
  YA_NO_EJERCEN,
  PUEDEN_NOMBRARLO,
  condicionDeQuienesEjercen,
  elQueNoEjerce,
  avisoSiElPastorYaNoEjerce,
  estaDejandoDeEjercer,
  loQueQuedaColgando,
  avisoSiDejaDeEjercer,
  soltarLoSuyo,
};
