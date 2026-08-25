/**
 * Los datos que no son de todos.
 *
 * En una ficha hay datos que están ahí por una razón concreta y no para que
 * circulen. Son dos grupos, y cada uno tiene su llave en la tabla de permisos:
 *
 *   · la SALUD de cada persona —enfermedades, alergias, indicaciones médicas,
 *     la nota importante—. Está en la ficha porque en una actividad hay que
 *     saber si alguien es alérgico a la penicilina;
 *   · los DATOS DE CONTACTO —teléfono, correo, dirección— de los miembros y
 *     de los pastores. Están para poder llamar a la gente de la iglesia, no
 *     para que una nómina completa salga del sistema en una planilla.
 *
 * Hasta la 1.63 la marca `sensible` servía solo para que el historial no
 * copiara su contenido, y quién los leía no lo decidía nadie: los veía
 * cualquiera que pudiera abrir la ficha. Después la salud pasó a tener su
 * llave; ahora el mecanismo es uno solo y sirve para cualquier grupo que un
 * módulo quiera reservar, sin escribir código nuevo:
 *
 *     { name: 'telefono', label: 'Teléfono', type: 'tel', reservado: 'miembros_contacto' }
 *
 * `sensible: true` sigue valiendo y significa «reservado a la llave de salud»,
 * que es lo que ya decía.
 *
 * A quien no alcanza un grupo no se le muestra en ninguna parte: ni en la
 * ficha, ni en el listado, ni en la planilla que se baja, y tampoco puede dar
 * con alguien buscando por un dato que no ve. Y tampoco puede escribirlo: si
 * pudiera, bastaría con abrir la ficha y guardar para dejar en blanco un dato
 * que ni siquiera vio.
 *
 * Los datos de la propia persona son siempre suyos, alcance su llave o no.
 */
const { can, SALUD } = require('./permissions');

/** La llave de salud, como se la conocía antes de que hubiera más de una. */
const LLAVE = SALUD;

/** A qué grupo reservado pertenece un campo, o null si es de todos. */
function grupoDe(f) {
  if (f.reservado) return f.reservado;
  return f.sensible ? SALUD : null;
}

/** Los grupos reservados que tiene un módulo, con sus campos. */
function gruposDe(def) {
  const salida = new Map();
  for (const f of def.fields || []) {
    const grupo = grupoDe(f);
    if (!grupo) continue;
    if (!salida.has(grupo)) salida.set(grupo, []);
    salida.get(grupo).push(f.name);
  }
  return salida;
}


/**
 * ¿Es la ficha de la propia persona?
 *
 * Sus datos son suyos antes que de la iglesia: los ve siempre, tenga o no la
 * llave. Vale para su ficha de miembro y para el módulo de miembros; en los
 * demás no hay «uno mismo» que reconocer.
 */
function esSuPropiaFicha(def, fila, usuario) {
  if (!fila || !usuario) return false;
  if (def.name === 'miembros') return !!usuario.miembro_id && Number(fila.id) === Number(usuario.miembro_id);
  return !!usuario.miembro_id && Number(fila.miembro_id) === Number(usuario.miembro_id);
}

/**
 * ¿Esta persona alcanza este grupo reservado?
 *
 * Manda la tabla de permisos de siempre: la excepción de la persona, su perfil
 * y su rol, en ese orden. No hay una lista de roles aparte acá: la tuve al
 * principio y hacía que quitarle el permiso a un pastor no sirviera de nada,
 * porque el rol se lo devolvía por detrás. Quién lo tiene por su rol está
 * escrito donde corresponde, en la matriz de server/permissions.js.
 */
function alcanzaGrupo(usuario, grupo, def, fila) {
  if (!usuario) return false;
  if (def && esSuPropiaFicha(def, fila, usuario)) return true;
  return can(usuario, grupo, 'view');
}

/**
 * ¿Alcanza los datos de salud de esta ficha?
 *
 * `fila` es opcional: sin ella se responde por lo general —si los alcanza en
 * alguna ficha—, que es lo que hace falta para decidir si se le ofrece la
 * sección en pantalla.
 */
function alcanza(usuario, fila) {
  return alcanzaGrupo(usuario, SALUD, { name: 'miembros' }, fila);
}

/** Los grupos de este módulo que esta persona NO alcanza en esta ficha. */
function vedados(def, usuario, fila) {
  const grupos = gruposDe(def);
  if (!grupos.size) return [];
  return [...grupos.keys()].filter((g) => !alcanzaGrupo(usuario, g, def, fila));
}

/**
 * La fila sin los datos reservados que esta persona no alcanza.
 *
 * Se quitan del todo en vez de mandarlos vacíos: un campo vacío se confunde
 * con «esta persona no tiene ninguna alergia», y eso es peor que no decir
 * nada. La interfaz avisa que la sección existe y no se está mostrando.
 */
function limpiar(def, fila, usuario) {
  if (!fila) return fila;
  const fuera = vedados(def, usuario, fila);
  if (!fuera.length) return fila;
  const grupos = gruposDe(def);
  const salida = { ...fila };
  for (const grupo of fuera) for (const campo of grupos.get(grupo)) delete salida[campo];
  // Para que la pantalla lo diga en vez de callarlo
  salida.reservado_oculto = fuera;
  if (fuera.includes(SALUD)) salida.salud_oculta = true;
  return salida;
}

/** Lo mismo, para muchas filas. */
function limpiarVarias(def, filas, usuario) {
  if (!gruposDe(def).size) return filas;
  return filas.map((f) => limpiar(def, f, usuario));
}

/**
 * Quita de lo que llega a guardarse los campos que esa persona no alcanza.
 *
 * Sin esto, quien no los ve igual los borraría: abre la ficha, el formulario
 * manda los campos en blanco porque nunca los recibió, y el dato se pierde.
 */
function protegerAlGuardar(def, datos, usuario, fila) {
  const fuera = vedados(def, usuario, fila);
  if (!fuera.length) return datos;
  const grupos = gruposDe(def);
  for (const grupo of fuera) for (const campo of grupos.get(grupo)) delete datos[campo];
  return datos;
}

/**
 * Por qué campos puede buscar esta persona.
 *
 * Un teléfono que no se muestra tampoco se puede usar para encontrar a su
 * dueño: si se pudiera, bastaría con probar números en el buscador para
 * averiguar de quién es cada uno, y el dato quedaría igual de expuesto que si
 * se mostrara.
 */
function buscablesPara(def, usuario) {
  const campos = (def.searchFields || []).filter((n) => n !== 'password');
  const fuera = vedados(def, usuario, null);
  if (!fuera.length) return campos;
  const grupos = gruposDe(def);
  const prohibidos = new Set(fuera.flatMap((g) => grupos.get(g)));
  return campos.filter((n) => !prohibidos.has(n));
}

module.exports = {
  alcanza, alcanzaGrupo, limpiar, limpiarVarias, protegerAlGuardar,
  gruposDe, grupoDe, vedados, buscablesPara, LLAVE,
};
