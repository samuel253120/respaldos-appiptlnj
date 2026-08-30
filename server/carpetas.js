/**
 * LO QUE LAS CUATRO CARPETAS TIENEN EN COMÚN.
 *
 * Un miembro, una iglesia, un pastor y una solicitud tienen cada uno su
 * carpeta de documentos, y son cuatro módulos distintos porque cuelgan de
 * fichas distintas. Pero «el mismo papel guardado dos veces» es exactamente el
 * mismo problema en las cuatro, y en la 1.197.0 se resolvió solo para la de
 * los miembros. Acá vive esa pregunta una sola vez: escrita cuatro, un día una
 * de las cuatro se olvidaría de comparar sin tildes y esa carpeta empezaría a
 * llenarse de repetidos sin que nadie lo note.
 *
 * ── Qué hace que dos sean «el mismo» ──
 *
 * El mismo dueño, el mismo TIPO y el mismo NOMBRE, comparados sin tildes, sin
 * mayúsculas y sin espacios de más, porque quien sube dos veces el mismo papel
 * no lo escribe dos veces igual.
 *
 * La FECHA no entra, aunque parezca lo natural. Los dos casos que se quieren
 * atrapar —dos personas escaneando el mismo papel, o alguien volviéndolo a
 * subir— son casi siempre en días distintos y con la fecha tecleada distinto o
 * en blanco; exigir que coincida dejaría pasar justo lo que se busca. Y al
 * revés, un papel de verdad nuevo del mismo tipo casi siempre se guarda con
 * otro nombre. Cuando no, se pregunta y quien sabe contesta: por eso el aviso
 * dice la fecha del que ya está, que es con lo que se distingue uno del otro.
 *
 * ── Y no bloquea: pregunta ──
 *
 * Es el mismo mecanismo de Tesorería, de Traspasos y de las fichas repetidas de
 * Miembros: se devuelve un objeto con `confirmar` y el motor lo convierte en
 * dos botones. Dos papeles iguales de verdad existen, y el sistema no está para
 * discutírselo a quien tiene la carpeta en la mano.
 */
const { comoSeCompara, seguiIgual } = require('./repetido');

/**
 * El papel que ya estaba en esa carpeta, o undefined si no hay ninguno.
 *
 * El `id IS NOT ?` es por si acaso, y hoy no se alcanza: para llegar hasta acá
 * el guardado tiene que haber cambiado el dueño, el tipo o el nombre, y en ese
 * caso el registro que se está corrigiendo ya no calza consigo mismo. Se deja
 * escrito igual —es la forma que usan las otras preguntas del sistema— porque
 * es lo que sostiene la regla si algún día cambian los campos que hacen «el
 * mismo»: sin él, un documento se avisaría a sí mismo como repetido. Romperlo
 * no pone roja ninguna prueba, y queda dicho acá para que nadie lo lea como
 * código vivo que alguien olvidó probar.
 */
function elQueYaEstaba(db, tabla, campoDueno, { dueno, tipo, nombre }, id) {
  if (!dueno || !tipo || !String(nombre || '').trim()) return undefined;
  return db
    .prepare(`SELECT id, tipo, nombre, fecha, archivo, created_at FROM "${tabla}"`
      + ` WHERE "${campoDueno}" = ? AND id IS NOT ?`)
    .all(dueno, id || 0)
    .find((otro) => comoSeCompara(otro.tipo) === comoSeCompara(tipo)
      && comoSeCompara(otro.nombre) === comoSeCompara(nombre));
}

/** El aviso, con lo que hace falta para contestarlo sin salir de la pantalla. */
function avisoDeDocumentoRepetido(otro, deQuien) {
  const { comoSeLee } = require('./fechas');
  const senas = [
    otro.fecha ? `del ${comoSeLee(String(otro.fecha).slice(0, 10))}` : 'sin fecha',
    otro.created_at ? `guardado el ${comoSeLee(String(otro.created_at).slice(0, 10))}` : null,
    otro.archivo ? null : 'anotado sin archivo',
  ].filter(Boolean).join(', ');

  return {
    error:
      `Ya hay un "${otro.nombre}" (${otro.tipo}) en la carpeta de ${deQuien} (${senas}). `
      + 'Si es este mismo, ábralo en vez de subirlo de nuevo: con dos copias del mismo papel, '
      + 'después nadie sabe cuál es el que vale. Si de verdad son dos, confirme.',
    confirmar: 'documento_ya_en_la_carpeta',
  };
}

/**
 * La pregunta completa, tal como la llama el `beforeSave` de cada carpeta.
 *
 * Al CORREGIR uno guardado solo se pregunta si este guardado cambia algo de lo
 * que lo hace «el mismo». Si no, el repetido ya estaba antes de abrir la ficha
 * y alguien ya dijo que eran dos: volver a preguntarlo cada vez que se le
 * arregla una observación es ruido, y el ruido enseña a confirmar sin leer.
 */
function preguntaSiSeRepite({ db, tabla, campoDueno, deQuien, data, id, existing, confirmado }) {
  if (confirmado) return null;
  const dueno = data[campoDueno] !== undefined ? data[campoDueno] : existing ? existing[campoDueno] : null;
  const tipo = data.tipo !== undefined ? data.tipo : existing ? existing.tipo : null;
  const nombre = data.nombre !== undefined ? data.nombre : existing ? existing.nombre : null;

  const sinCambios = seguiIgual(existing, { [campoDueno]: dueno, tipo, nombre }, [
    [campoDueno, 'igual'], ['tipo', 'texto'], ['nombre', 'texto'],
  ]);
  if (sinCambios) return null;

  const otro = elQueYaEstaba(db, tabla, campoDueno, { dueno, tipo, nombre }, id);
  return otro ? avisoDeDocumentoRepetido(otro, deQuien) : null;
}

module.exports = { preguntaSiSeRepite, elQueYaEstaba, avisoDeDocumentoRepetido };
