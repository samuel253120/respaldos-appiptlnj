/**
 * Cómo se le dice a cada persona.
 *
 * En la iglesia a cada miembro se le trata con un prefijo:
 *
 *   Hermano / Hermana   a los miembros en general, según su género.
 *   Oficial             a los varones que pertenecen al cuerpo de oficiales.
 *   Guía de Obra        a quien tiene ese cargo en Pastores / Guías: al guía
 *                       de obra se le dice guía de obra, no hermano ni pastor.
 *   Pastor / Pastora    a quienes tienen un cargo pastoral —el de pastora y
 *                       los de pastor probando hacia arriba— y a su cónyuge:
 *                       el marido de la pastora es Pastor y la esposa del
 *                       pastor es Pastora, nunca Hermano ni Hermana.
 *
 * Se calcula al leer la ficha —no se guarda—, así que se mantiene al día solo
 * cuando alguien entra al cuerpo de oficiales, queda registrado en Pastores /
 * Guías o cambia de cargo. Cada miembro puede llevar además un trato fijado a
 * mano, que manda sobre todo lo anterior.
 */
const { esOficial } = require('./oficiales');

/**
 * El primer cargo del ministerio. No es un cargo pastoral: su trato es el
 * nombre mismo del cargo y su cónyuge no pasa a ser Pastor ni Pastora.
 */
const CARGO_GUIA = 'Guía de Obra';

/** El cargo pastoral que ya dice en su nombre cómo se trata a quien lo tiene. */
const CARGO_PASTORA = 'Pastora';

/**
 * Los cargos del ministerio. Se escriben como se escriben los cargos: con
 * mayúscula en cada palabra. El de Pastor Presidente lo ocupa una sola
 * persona en toda la organización; de los demás puede haber varios a la vez.
 *
 * Del guía de obra hacia arriba van en escala, de menor a mayor. El de
 * Pastora queda enseguida del primero: es un cargo pastoral, pero no una
 * grada de esa escala.
 *
 * Esta es la lista de verdad: el módulo de Pastores / Guías y las migraciones
 * la toman de acá, para que no haya dos versiones de lo mismo.
 */
const CARGOS_MINISTERIO = [
  CARGO_GUIA, CARGO_PASTORA, 'Pastor Probando', 'Pastor Diácono', 'Pastor Presbítero', 'Pastor Presidente',
];
const CARGO_UNICO = 'Pastor Presidente';

/** Los únicos tratos que se usan en la iglesia. */
const TRATAMIENTOS = ['Hermano', 'Hermana', 'Oficial', CARGO_GUIA, 'Pastor', CARGO_PASTORA];

const esMujer = (genero) => genero === 'Femenino';

/**
 * La ficha de Pastores / Guías de esta persona, si tiene.
 *
 * Quien está en ese módulo es también miembro de su iglesia: su ficha de
 * miembro queda enlazada. Se reconoce por ese enlace y, si aún no lo tiene,
 * por el RUT.
 */
function fichaPastoral(miembro, db) {
  if (!miembro) return null;
  if (miembro.id) {
    const ficha = db.prepare('SELECT * FROM pastores WHERE miembro_id = ?').get(miembro.id);
    if (ficha) return ficha;
  }
  if (miembro.rut) return db.prepare('SELECT * FROM pastores WHERE rut = ?').get(miembro.rut) || null;
  return null;
}

/**
 * El camino de vuelta: la ficha de miembro de quien está en Pastores / Guías.
 *
 * Se reconoce por el enlace y, si aún no lo tiene, por el RUT —igual que
 * `fichaPastoral` en el sentido contrario—. Vive acá y no en el módulo de
 * pastores para que haya una sola versión de «cuál es la ficha del otro».
 */
function fichaDeMiembro(pastor, db) {
  if (!pastor) return null;
  if (pastor.miembro_id) {
    const m = db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.miembro_id);
    if (m) return m;
  }
  if (pastor.rut) return db.prepare('SELECT * FROM miembros WHERE rut = ?').get(pastor.rut) || null;
  return null;
}

/** ¿Esta persona está registrada en Pastores / Guías? */
function estaEnPastores(miembro, db) {
  return !!fichaPastoral(miembro, db);
}

/**
 * El trato que impone un cargo del ministerio, sin mirar ninguna ficha.
 *
 * Los dos primeros lo dicen en su propio nombre: al guía de obra se le dice
 * guía de obra, y a quien tiene el cargo de Pastora se le dice Pastora. Del
 * de Pastor Probando hacia arriba, los cargos son las gradas de la escala y
 * se escriben en masculino porque así se llama la grada, no la persona: ahí
 * el trato lo decide el sexo de quien la ocupa, y una mujer presbítera es
 * Pastora. Sin sexo registrado se usa el masculino, que es como se lee el
 * nombre del cargo.
 *
 * Ese último caso vale también para los cargos de la lista anterior: la
 * migración de los cargos conserva como estaban las fichas que traían uno que
 * ya no existe —«Pastor», «Anciano»— y pide que alguien las abra y elija el
 * de la escala nueva. Hasta que eso pase siguen siendo fichas de pastor y se
 * les sigue diciendo Pastor o Pastora, que es lo que hacía el sistema antes.
 *
 * Devuelve '' solo si la ficha no dice ningún cargo.
 */
function tratoDelCargo(cargo, genero) {
  if (!cargo) return '';
  if (cargo === CARGO_GUIA) return CARGO_GUIA;
  if (cargo === CARGO_PASTORA) return CARGO_PASTORA;
  return esMujer(genero) ? CARGO_PASTORA : 'Pastor';
}

/**
 * El trato que le da su propia ficha ministerial. Devuelve '' si no tiene
 * ficha en Pastores / Guías.
 *
 * El sexo sale de la ficha de miembro —es la ficha de la persona— y, cuando
 * ésa no lo tiene anotado, de la ficha de pastor.
 */
function tratoDeLaFicha(miembro, db) {
  const ficha = fichaPastoral(miembro, db);
  if (!ficha) return '';
  return tratoDelCargo(ficha.cargo, miembro.genero || ficha.genero);
}

/** ¿Es guía de obra? */
function esGuiaDeObra(miembro, db) {
  return tratoDeLaFicha(miembro, db) === CARGO_GUIA;
}

/** ¿Tiene un cargo pastoral? El guía de obra todavía no lo tiene. */
function esPastorRegistrado(miembro, db) {
  return ['Pastor', CARGO_PASTORA].includes(tratoDeLaFicha(miembro, db));
}

/**
 * El trato que impone el ministerio: el de su propia ficha o, si es cónyuge
 * de un pastor o una pastora, el que le toca por ese matrimonio. Devuelve ''
 * cuando nada del ministerio lo obliga.
 */
function tratoMinisterial(miembro, db) {
  if (!miembro) return '';
  const propio = tratoDeLaFicha(miembro, db);
  if (propio) return propio;
  if (miembro.conyuge_id) {
    const conyuge = db.prepare('SELECT id, rut, genero FROM miembros WHERE id = ?').get(miembro.conyuge_id);
    if (conyuge && esPastorRegistrado(conyuge, db)) return esMujer(miembro.genero) ? CARGO_PASTORA : 'Pastor';
  }
  return '';
}

/** El trato que le corresponde a un miembro. Devuelve '' si no se puede saber. */
function tratamientoDe(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;

  // Su ficha ministerial y, si no la tiene, la de su cónyuge
  const ministerial = tratoMinisterial(miembro, db);
  if (ministerial) return ministerial;

  if (!esMujer(miembro.genero) && miembro.genero && esOficial(miembro.id, db)) return 'Oficial';

  if (!miembro.genero) return '';
  return esMujer(miembro.genero) ? 'Hermana' : 'Hermano';
}

/**
 * El trato que le corresponde **por sí misma**, sin contar a su cónyuge: por
 * tener ficha en Pastores / Guías o por tenerlo fijado a mano.
 *
 * Sirve para elegir cónyuge: la pastora es pastora por su propio registro, no
 * por estar casada; si no, la regla se mordería la cola.
 */
function tratamientoPropio(miembro, db) {
  if (!miembro) return '';
  if (miembro.tratamiento_personalizado) return miembro.tratamiento_personalizado;
  return tratoDeLaFicha(miembro, db);
}

/** ¿Es pastor o pastora por su propio registro? */
function esPastorPorSiMismo(miembro, db) {
  return ['Pastor', CARGO_PASTORA].includes(tratamientoPropio(miembro, db));
}

/**
 * ¿A esta persona le corresponde el trato de Pastor o Pastora? Lo es quien
 * tiene un cargo pastoral y también su cónyuge.
 */
function leCorrespondePastor(miembro, db) {
  return ['Pastor', CARGO_PASTORA].includes(tratoMinisterial(miembro, db));
}

/** "Hermano Juan Pérez" */
function conTratamiento(miembro, db) {
  const trato = tratamientoDe(miembro, db);
  const nombre = require('./nombres').paraMostrar(miembro.nombres, miembro.apellidos);
  return trato ? `${trato} ${nombre}` : nombre;
}

/**
 * "Pastora Rosa Soto" a partir de la ficha de Pastores / Guías, tenga o no
 * ficha de miembro.
 *
 * Con ficha de miembro el trato sale de allá, porque es la ficha de la
 * persona y puede llevar además un trato fijado a mano. Sin ella, del cargo:
 * el módulo mismo cuenta con que muchos no la tengan —tiene una columna que
 * marca a quién le falta— y hasta entonces el nombre salía pelado.
 */
function conTratamientoDePastor(pastor, db) {
  if (!pastor) return '';
  const suya = fichaDeMiembro(pastor, db);
  if (suya) return conTratamiento(suya, db);
  const nombre = require('./nombres').paraMostrar(pastor.nombres, pastor.apellidos);
  const trato = tratoDelCargo(pastor.cargo, pastor.genero);
  return trato ? `${trato} ${nombre}` : nombre;
}

module.exports = {
  CARGO_GUIA, CARGO_PASTORA, CARGOS_MINISTERIO, CARGO_UNICO,
  TRATAMIENTOS, tratamientoDe, conTratamiento, estaEnPastores, leCorrespondePastor,
  tratamientoPropio, esPastorPorSiMismo, fichaPastoral, tratoDeLaFicha, esGuiaDeObra,
  esPastorRegistrado, tratoMinisterial, tratoDelCargo, fichaDeMiembro, conTratamientoDePastor,
};
