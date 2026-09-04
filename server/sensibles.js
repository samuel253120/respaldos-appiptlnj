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

/**
 * Los grupos reservados que tiene un módulo, con sus campos.
 *
 * Los CALCULADOS cuentan igual que los guardados. No es un detalle: el saldo de
 * una cuenta no es una columna —se suma al leer—, y por eso se le escapaba a
 * todo esto. La llave «Montos del dinero» tapaba el monto de cada movimiento y
 * dejaba pasar el saldo de la cuenta entera, $ 58.420.654, en el listado y en
 * la ficha. Un dato calculado se lee igual que uno guardado; se reserva igual.
 */
function gruposDe(def) {
  const salida = new Map();
  for (const f of [...(def.fields || []), ...(def.computed || [])]) {
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

/** Los campos concretos de este módulo que esta persona no alcanza. */
function camposVedados(def, usuario) {
  const fuera = vedados(def, usuario, null);
  if (!fuera.length) return [];
  const grupos = gruposDe(def);
  return fuera.flatMap((g) => grupos.get(g));
}

/**
 * Los grupos de un módulo que PUEDEN VIAJAR COPIADOS en un texto.
 *
 * No son todos los que reserva. Los datos de SALUD no viajan nunca: quien
 * escribe una copia —la bitácora, el Registro de Cambios— deja constancia de
 * que el dato cambió y no de cuál era, «Enfermedades: actualizada», y eso se
 * decidió mucho antes que todo esto (ver server/bitacora.js). Contarlos acá
 * les cerraría la búsqueda del historial a medio sistema por un dato que no
 * está escrito ahí: la llave de salud la tienen de fábrica el administrador y
 * el pastor, y el historial de un miembro es de lo que más se busca.
 *
 * Se reconocen por la marca `sensible`, que significa justamente eso desde la
 * 1.63: que el historial no copie su contenido.
 */
function gruposQueViajan(def) {
  const salida = new Set();
  for (const f of [...(def.fields || []), ...(def.computed || [])]) {
    if (f.sensible) continue;
    const grupo = grupoDe(f);
    if (grupo) salida.add(grupo);
  }
  return salida;
}

/**
 * Los grupos que pueden viajar copiados desde CUALQUIER módulo del sistema.
 *
 * Se leen de los propios módulos y no de una lista escrita a mano: el día que
 * alguien reserve un grupo nuevo, lo que dependa de esto se entera solo. Se
 * pregunta al registro, que es quien ya tiene los módulos montados.
 */
let losGrupos = null;
function todosLosGrupos() {
  if (losGrupos) return losGrupos;
  const { allModules } = require('./registry');
  const salida = new Set();
  for (const def of allModules()) for (const grupo of gruposQueViajan(def)) salida.add(grupo);
  losGrupos = [...salida];
  return losGrupos;
}

/**
 * Un campo que COPIA lo que decía la ficha de OTRO MÓDULO.
 *
 * No guarda un dato suyo: guarda una frase armada con los campos de otra
 * ficha —«Monto: $ 445.000 → $ 990.000», «RUT: 16777777-5 · Teléfono: +56 9
 * 8877 6655»—. Son tres y se leen más que las fichas mismas: el detalle del
 * Registro de Cambios, la bitácora de un miembro y el historial de un pastor.
 * Por ahí salían enteras las cifras que su propio módulo reserva, sin que
 * ninguno de sus campos estuviera marcado: el recorte de siempre mira campo
 * por campo y para él eso es texto y nada más.
 *
 *     { name: 'descripcion', ..., copiaDe: 'miembros' }
 *     { name: 'detalle',     ..., copiaDe: '*' }
 *
 * Se declara DE QUIÉN copia y no qué grupos puede traer, que sería lo mismo
 * dicho dos veces y quedaría viejo: el día que Miembros reserve un dato más,
 * la bitácora lo tapa sin que nadie se acuerde de venir a agregarlo acá.
 *
 * `'*'` es «de cualquiera», y es la verdad del Registro de Cambios: ahí queda
 * anotado el borrado de cualquier ficha del sistema, así que puede traer
 * cualquier grupo. Cuál es en cada línea lo sabe la línea, y por eso ese
 * recorte lo hace el módulo al leer (ver server/bitacora.js).
 */
function elOrigenDe(campo) {
  if (!campo || !campo.copiaDe || campo.copiaDe === '*') return null;
  return require('./registry').getModule(campo.copiaDe);
}

function gruposQuePuedeContener(campo) {
  if (!campo || !campo.copiaDe) return [];
  if (campo.copiaDe === '*') return todosLosGrupos();
  const origen = elOrigenDe(campo);
  // Si nombra a un módulo que no existe se toma lo más estricto y no lo menos:
  // el registro lo rechaza al arrancar, pero mientras tanto no se abre nada.
  return origen ? [...gruposQueViajan(origen)] : todosLosGrupos();
}

/**
 * ¿Alcanza esta persona lo que este campo puede llegar a mostrarle?
 *
 * Vale para las dos cosas que se hacen con un campo sin verlo: buscarlo y
 * filtrar por él. Un campo reservado no lo alcanza quien no tiene su llave, y
 * uno que copia de otras fichas tampoco, mientras le falte una sola de las
 * llaves de lo que puede traer: si le faltara una y aun así pudiera buscar,
 * bastaría con probar cifras hasta que una devolviera una fila.
 */
function alcanzaElCampo(def, campo, usuario) {
  if (!campo) return true;
  if (camposVedados(def, usuario).includes(campo.name)) return false;
  return gruposQuePuedeContener(campo).every((grupo) => alcanzaGrupo(usuario, grupo));
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
  const suyos = new Map((def.fields || []).map((f) => [f.name, f]));
  return campos.filter((n) => !suyos.has(n) || alcanzaElCampo(def, suyos.get(n), usuario));
}

/**
 * Un texto ARMADO CON LOS CAMPOS DE UNA FICHA, sin lo que esta persona no
 * alcanza.
 *
 * `limpiar` recorta una fila, donde cada campo viene por separado y se sabe
 * cuál es cuál. Acá el dato ya no es una fila: es una frase que alguien armó
 * pegando etiqueta y valor —«Fecha: 01-08-2026 · Monto: $ 445.000 →
 * $ 990.000»— y guardó en una columna de texto de OTRO módulo. El recorte de
 * siempre no la mira, porque para el módulo que la guarda es texto y nada más.
 *
 * Se corta por donde la frase se armó: en cada trozo que empieza por la
 * etiqueta de un campo del módulo de origen. Los trozos de un campo reservado
 * que esta persona no alcanza se quedan con su etiqueta y pierden el valor;
 * los demás no se tocan, letra por letra. Se deja la etiqueta a propósito:
 * «Monto: (reservado)» dice que hubo un cambio de monto y que no le toca
 * verlo, que es justo lo que la llave promete; borrar el trozo entero
 * escondería que el monto se tocó.
 *
 * Se corta por la ETIQUETA y no por el separador a secas —« · »— porque un
 * valor puede llevar un punto medio adentro: una dirección escrita «Los Aromos
 * 45 · depto 2» se partiría en dos y la segunda mitad se salvaría del recorte.
 * Exigiendo que después del separador venga la etiqueta de un campo, el trozo
 * termina donde de verdad terminó al escribirse.
 */
const SEPARADOR = ' · ';
const ASI_QUEDA = '(reservado)';

function sinLoReservado(def, texto, usuario) {
  const frase = texto == null ? '' : String(texto);
  if (!def || !frase) return texto;
  const campos = [...(def.fields || []), ...(def.computed || [])].filter((f) => f.label);
  const fuera = new Set(vedados(def, usuario, null));
  if (!fuera.size) return texto;
  // Los de salud no se tapan porque no están: el que escribió la frase anotó
  // que el dato cambió y no cuál era (ver `gruposQueViajan`).
  const tapadas = new Set(campos.filter((f) => !f.sensible && fuera.has(grupoDe(f))).map((f) => f.label));
  if (!tapadas.size) return texto;

  const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const etiquetas = [...new Set(campos.map((f) => f.label))].map(escapar).join('|');
  const corte = new RegExp(`${escapar(SEPARADOR)}(?=(?:${etiquetas}): )`);
  return frase
    .split(corte)
    .map((trozo) => {
      const dosPuntos = trozo.indexOf(': ');
      if (dosPuntos < 0) return trozo;
      const etiqueta = trozo.slice(0, dosPuntos);
      return tapadas.has(etiqueta) ? `${etiqueta}: ${ASI_QUEDA}` : trozo;
    })
    .join(SEPARADOR);
}

/**
 * Qué trozos de `buscaTambien` puede usar esta persona.
 *
 * Lo mismo que `buscablesPara` pero para las expresiones: un trozo que declara
 * pertenecer a un grupo reservado se le da solo a quien alcanza ese grupo. Sin
 * esto, buscar «250000» encontraría el movimiento de doscientos cincuenta mil
 * aunque su monto esté tapado en pantalla, y probando números se averiguaría
 * uno por uno: el dato quedaría igual de expuesto que si se mostrara.
 */
function buscaTambienPara(def, usuario) {
  const fuera = new Set(vedados(def, usuario, null));
  return (def.buscaTambien || [])
    .filter((t) => !t.reservado || !fuera.has(t.reservado))
    .map((t) => t.sql);
}

/**
 * Una respuesta armada a mano, sin las cifras que esta persona no alcanza.
 *
 * `limpiar` sirve para las filas de un módulo, donde cada campo declara su
 * grupo y el motor las recorta solas. Las rutas que arman su propia respuesta
 * no pasan por ahí: el estado de una cuenta, su cartola, el balance del
 * período. Ahí la cifra la escribe la ruta, con el nombre que quiere, y el
 * recorte del motor no la alcanza.
 *
 * Eso dejaba la llave anulada por la puerta de al lado: quien no podía ver el
 * monto de un movimiento en el listado de Tesorería abría la cartola de esa
 * misma cuenta y recibía los ciento cincuenta movimientos del mes, uno por
 * uno, con su monto.
 *
 * Se nombran las claves que llevan plata y se van. Se quitan del todo, no se
 * mandan en cero: un cero es una cifra, y la peor de todas, porque se lee como
 * «esta cuenta está vacía». Queda `cifras_ocultas` para que la pantalla lo
 * diga en vez de mostrar una hoja en blanco.
 */
function sinLasCifras(usuario, llave, dato, claves) {
  if (!dato || alcanzaGrupo(usuario, llave)) return dato;
  const quitar = (d) => {
    if (Array.isArray(d)) return d.map(quitar);
    const salida = { ...d };
    for (const clave of claves) {
      // Una lista de filas no se borra entera: se le quitan las cifras a cada
      // una, y quedan la fecha, el concepto y la categoría, que es justo lo
      // que la llave promete dejar a la vista.
      if (Array.isArray(salida[clave])) salida[clave] = quitar(salida[clave]);
      else delete salida[clave];
    }
    return salida;
  };
  const salida = quitar(dato);
  // El aviso va una vez, arriba: repetirlo fila por fila no dice nada más
  if (!Array.isArray(salida)) salida.cifras_ocultas = true;
  return salida;
}

module.exports = {
  alcanza, alcanzaGrupo, limpiar, limpiarVarias, protegerAlGuardar, sinLasCifras,
  gruposDe, grupoDe, vedados, buscablesPara, buscaTambienPara, LLAVE,
  camposVedados, alcanzaElCampo, gruposQuePuedeContener, elOrigenDe, todosLosGrupos, gruposQueViajan,
  sinLoReservado,
  ASI_QUEDA,
};
