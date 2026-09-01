/**
 * Dos cuerpos que se llaman igual.
 *
 * Medido antes de esto, creando dos «Damas» en la misma Iglesia Central, una
 * detrás de la otra:
 *
 *   la primera .......................... 201
 *   la segunda, MISMA iglesia ........... 201, sin una palabra
 *   otra igual en OTRA iglesia .......... 201
 *   lo que ofrece el desplegable ........ «Damas» · «Damas» · «Damas»
 *   y la lista de los filtros ........... lo mismo
 *
 * Ese desplegable es por el que se elige a qué cuerpo se le anota una
 * actividad, un movimiento de tesorería, un acta o un bien del inventario.
 * Elegir el equivocado no se nota después: la plata queda en la caja de otro
 * cuerpo y la asistencia, en la lista de otro.
 *
 * Es el mismo defecto que la 1.238.0 le corrigió a las Iglesias, y se arregla
 * igual, en dos mitades que van juntas:
 *
 *   · SE PREGUNTA, NO SE PROHÍBE, y solo cuando el otro está en LA MISMA
 *     IGLESIA. Que cada congregación tenga sus «Damas» y sus «Jóvenes» es lo
 *     normal —son cuerpos distintos de iglesias distintas— y avisar de eso
 *     sería un aviso en casi cada cuerpo nuevo. Dos con el mismo nombre en la
 *     misma iglesia, en cambio, casi siempre son un error de tecleo; pero
 *     «casi siempre» no es «siempre», así que se pregunta.
 *
 *   · Y LOS DESPLEGABLES DEJAN DE MOSTRARLOS IDÉNTICOS. Sin esto, la pregunta
 *     avisaría de un problema que después nadie puede resolver al elegir.
 *
 * A una iglesia repetida se le pone el CÓDIGO al lado, que es el dato que la
 * distingue. Un cuerpo no tiene código, así que se le pone lo que de verdad lo
 * separe del otro: su iglesia cuando son de iglesias distintas, y su tipo
 * cuando uno es Cuerpo y el otro Grupo. Y si no los separa nada —los dos en la
 * misma iglesia y del mismo tipo, que es el caso del que la pregunta avisó— no
 * se les inventa una diferencia: se dejan como están, porque no la hay.
 */
const { comoSeCompara, cuantasVecesCadaUno } = require('./mismo-nombre');

/**
 * Los otros cuerpos de LA MISMA IGLESIA que se llaman igual que éste.
 *
 * Se traen los de esa iglesia y se comparan acá porque SQLite no sabe ignorar
 * las tildes, que es justo lo que hay que ignorar (ver server/mismo-nombre.js).
 */
function losQueSeLlamanIgual(db, nombre, iglesiaId, id) {
  const buscado = comoSeCompara(nombre);
  if (!buscado || !iglesiaId) return [];
  return db
    .prepare('SELECT id, nombre, tipo, estado FROM cuerpos WHERE iglesia_id = ? AND id IS NOT ?')
    .all(iglesiaId, id || 0)
    .filter((otro) => comoSeCompara(otro.nombre) === buscado);
}

/** Cómo se nombra al otro en el aviso: «el grupo "Aseo", inactivo». */
const comoSeDistingue = (fila) =>
  `${fila.tipo === 'Grupo' ? 'un grupo' : 'un cuerpo'}${fila.estado === 'Inactivo' ? ', inactivo' : ''}`;

/**
 * El aviso de que ya hay otro con ese nombre en esa iglesia, o null.
 *
 * Se pregunta solo cuando ESTE guardado pone o cambia el nombre o la iglesia.
 * Corregirle el teléfono a un cuerpo que se llama igual que otro desde hace
 * años no vuelve a preguntar: volver a preguntarlo cada vez no cuida el dato,
 * enseña a apretar «Está bien» sin leer.
 */
function avisoDeCuerpoRepetido(db, data, { existing, confirmado }) {
  if (confirmado) return null;

  const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
  const nombre = dato('nombre');
  const iglesiaId = dato('iglesia_id');
  if (!nombre || !iglesiaId) return null;

  // ¿Este guardado toca el nombre o la iglesia? Si no, no está creando ningún
  // parecido que no existiera ya.
  if (existing) {
    const mismoNombre = comoSeCompara(nombre) === comoSeCompara(existing.nombre);
    const mismaIglesia = String(iglesiaId) === String(existing.iglesia_id || '');
    if (mismoNombre && mismaIglesia) return null;
  }

  const iguales = losQueSeLlamanIgual(db, nombre, iglesiaId, existing ? existing.id : null);
  if (!iguales.length) return null;

  const iglesia = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(iglesiaId);
  const donde = iglesia ? `«${iglesia.nombre}»` : 'esa iglesia';
  const listados = iguales.slice(0, 3).map((o) => `${o.nombre} (${comoSeDistingue(o)})`).join('; ');
  const yMas = iguales.length > 3 ? `, y ${iguales.length - 3} más` : '';

  return {
    error:
      (iguales.length === 1
        ? `${donde} ya tiene otro que se llama así (${comoSeDistingue(iguales[0])}). `
        : `${donde} ya tiene ${iguales.length} que se llaman así: ${listados}${yMas}. `)
      + 'El nombre es lo único que muestran los desplegables donde se elige a qué cuerpo va una '
      + 'actividad, un movimiento de tesorería, un acta o un bien, así que dos con el mismo nombre en '
      + 'la misma iglesia no se distinguen ahí, y elegir el equivocado no se nota después. Si de '
      + 'verdad son dos, confirme; si es el mismo escrito dos veces, cámbiele el nombre a uno.',
    confirmar: 'cuerpo_con_el_mismo_nombre',
  };
}

/**
 * Lo que hace falta para distinguir a los que se llaman igual, buscado en la
 * base solo para los que se repiten.
 *
 * Se devuelve `{ id: { iglesia, tipo } }`. Se consulta una vez y solo cuando
 * hay repetidos: en una lista sin duplicados esto no toca la base.
 */
function loSuyoDeLosRepetidos(db, ids) {
  if (!ids.length) return new Map();
  const marcas = ids.map(() => '?').join(',');
  const filas = db
    .prepare(
      `SELECT id, tipo,
              (SELECT i.nombre FROM iglesias i WHERE i.id = cuerpos.iglesia_id) AS iglesia
         FROM cuerpos WHERE id IN (${marcas})`
    )
    .all(...ids);
  return new Map(filas.map((f) => [String(f.id), f]));
}

/**
 * Le agrega a cada opción repetida lo que la separa de la otra.
 *
 * Lo usan los DOS caminos por los que se pide una lista de cuerpos —la ruta
 * propia del módulo, que es la que piden los formularios, y la genérica del
 * motor, que es la que piden los filtros—, para que las dos muestren lo mismo.
 * Escrito dos veces, un día una mostraría la iglesia y la otra no.
 *
 * Y se agrega SOLO lo que de verdad los separa: si los dos son de la misma
 * iglesia, poner la iglesia no ayudaría a nadie y alargaría las dos opciones
 * para dejarlas igual de indistinguibles.
 */
function conLoQueLosDistingue(opciones, db) {
  const cuantas = cuantasVecesCadaUno(opciones.map((o) => o.label));
  const repetidas = opciones.filter((o) => cuantas.get(comoSeCompara(o.label)) > 1);
  if (!repetidas.length) return opciones;

  const suyo = loSuyoDeLosRepetidos(db, repetidas.map((o) => o.id));

  // Por cada nombre repetido, qué cambia entre los que lo comparten
  const cambia = new Map();
  for (const o of repetidas) {
    const clave = comoSeCompara(o.label);
    const f = suyo.get(String(o.id)) || {};
    const visto = cambia.get(clave) || { iglesias: new Set(), tipos: new Set() };
    visto.iglesias.add(f.iglesia || '');
    visto.tipos.add(f.tipo || '');
    cambia.set(clave, visto);
  }

  return opciones.map((o) => {
    const visto = cambia.get(comoSeCompara(o.label));
    if (!visto) return o;
    const f = suyo.get(String(o.id)) || {};
    const partes = [];
    if (visto.iglesias.size > 1 && f.iglesia) partes.push(f.iglesia);
    if (visto.tipos.size > 1 && f.tipo) partes.push(f.tipo);
    /*
     * El separador es un punto medio, igual que en las iglesias: la pantalla
     * acorta el nombre de una iglesia partiéndolo por «/», «—» o «–», y con
     * cualquiera de esos lo agregado se perdería por el camino.
     */
    return partes.length ? { ...o, label: `${o.label} · ${partes.join(' · ')}` } : o;
  });
}

module.exports = {
  losQueSeLlamanIgual, avisoDeCuerpoRepetido, conLoQueLosDistingue, comoSeDistingue,
};
