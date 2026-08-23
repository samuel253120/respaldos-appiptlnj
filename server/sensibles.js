/**
 * Los datos que no son de todos: la salud de cada persona.
 *
 * En la ficha de un miembro hay campos marcados como `sensible` —las
 * enfermedades, las alergias, las indicaciones médicas, la nota importante—.
 * Están ahí porque en una actividad hay que saber si alguien es alérgico a la
 * penicilina, no para que circulen.
 *
 * Hasta ahora esa marca servía solo para que el historial no copiara su
 * contenido. Quién los leía no lo decidía nadie: los veía cualquiera que
 * pudiera abrir la ficha, y eso incluye a todo secretario y a quien solo
 * consulta. No era una decisión, era lo que pasaba.
 *
 * Ahora los ve:
 *
 *   · **la propia persona**, en su ficha y en Mi perfil, siempre —son suyos;
 *   · el **administrador** y el **pastor o guía**, que son quienes responden
 *     por la gente de la iglesia;
 *   · y quien tenga el permiso dado a mano, para el caso en que la iglesia
 *     quiera que también los vea alguien más —la encargada de la escuela
 *     dominical, por ejemplo— sin tener que cambiarle el rol.
 *
 * A quien no los alcanza, no se le muestran en ninguna parte: ni en la ficha,
 * ni en el listado, ni en la planilla que se baja. Y tampoco puede
 * escribirlos: si pudiera, bastaría con abrir la ficha y guardar para dejar
 * en blanco un dato que ni siquiera vio.
 */
const { can } = require('./permissions');

/**
 * La llave con que se da el permiso a mano.
 *
 * No es un módulo de verdad: es una entrada reservada dentro de la misma
 * tabla de permisos que ya usan los perfiles y las excepciones, para no
 * inventar un mecanismo aparte por un solo caso.
 */
const LLAVE = require('./permissions').SALUD;

/** Los campos marcados como sensibles de un módulo. */
function camposSensibles(def) {
  return def.fields.filter((f) => f.sensible).map((f) => f.name);
}

/**
 * ¿Esta persona alcanza los datos de salud de esta ficha?
 *
 * `fila` es opcional: sin ella se responde por lo general —si los alcanza en
 * alguna ficha—, que es lo que hace falta para decidir si se le ofrece la
 * sección en pantalla.
 */
function alcanza(usuario, fila) {
  if (!usuario) return false;

  // Los suyos, siempre: son de la persona antes que de la iglesia
  if (fila && usuario.miembro_id && Number(fila.id) === Number(usuario.miembro_id)) return true;

  // Y de ahí en adelante manda la tabla de permisos de siempre: la excepción
  // de la persona, su perfil y su rol, en ese orden. No hay una lista de roles
  // aparte acá: la tuve al principio y hacía que quitarle el permiso a un
  // pastor no sirviera de nada, porque el rol se lo devolvía por detrás.
  // Quién lo tiene por su rol está escrito donde corresponde, en la matriz
  // de server/permissions.js.
  return can(usuario, LLAVE, 'view');
}

/**
 * La fila sin los datos de salud, para quien no los alcanza.
 *
 * Se quitan del todo en vez de mandarlos vacíos: un campo vacío se confunde
 * con «esta persona no tiene ninguna alergia», y eso es peor que no decir
 * nada. La interfaz avisa que la sección existe y no se está mostrando.
 */
function limpiar(def, fila, usuario) {
  if (!fila) return fila;
  const campos = camposSensibles(def);
  if (!campos.length || alcanza(usuario, fila)) return fila;
  const salida = { ...fila };
  for (const campo of campos) delete salida[campo];
  salida.salud_oculta = true; // para que la pantalla lo diga en vez de callarlo
  return salida;
}

/** Lo mismo, para muchas filas. */
function limpiarVarias(def, filas, usuario) {
  const campos = camposSensibles(def);
  if (!campos.length) return filas;
  return filas.map((f) => limpiar(def, f, usuario));
}

/**
 * Quita de lo que llega a guardarse los campos que esa persona no alcanza.
 *
 * Sin esto, quien no los ve igual los borraría: abre la ficha, el formulario
 * manda los campos en blanco porque nunca los recibió, y el dato se pierde.
 */
function protegerAlGuardar(def, datos, usuario, fila) {
  const campos = camposSensibles(def);
  if (!campos.length || alcanza(usuario, fila)) return datos;
  for (const campo of campos) delete datos[campo];
  return datos;
}

module.exports = { alcanza, limpiar, limpiarVarias, protegerAlGuardar, camposSensibles, LLAVE };
