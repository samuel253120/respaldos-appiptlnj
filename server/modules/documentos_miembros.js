/**
 * Módulo: Documentos de Miembros.
 *
 * Cada miembro puede tener todos los documentos que hagan falta: su carnet de
 * identidad, la ficha de registro, la ficha de actualización, certificados y
 * cualquier otro. Cada uno guarda el archivo y su nombre, para poder
 * distinguirlos sin abrirlos.
 *
 * Se ven y se agregan desde la propia ficha del miembro, al pie.
 */
/* =====================================================================
 * EL MISMO PAPEL, GUARDADO DOS VECES
 *
 * Pasa solo: dos personas escanean el mismo carnet, o alguien vuelve a subirlo
 * porque no encontró el primero. Medido antes de esto, sobre una carpeta
 * vacía: el mismo tipo, el mismo nombre y la misma fecha, tres veces seguidas,
 * y las tres veces 201. La carpeta quedaba con tres carnets iguales —uno de
 * ellos escrito «CARNET DE IDENTIDAD » con mayúsculas y un espacio de más, que
 * a la vista es el mismo— y nadie decía nada.
 *
 * Una carpeta con el mismo papel repetido no pierde datos, pero deja de
 * contestar la pregunta para la que existe: cuál es el carnet bueno, cuál es
 * la carta de traslado que vale. Y crece: lo que se repite una vez se repite
 * siempre.
 *
 * ── Qué hace que dos sean «el mismo» ──
 *
 * El mismo dueño, el mismo TIPO y el mismo NOMBRE, comparados sin tildes, sin
 * mayúsculas y sin espacios de más, porque quien sube dos veces el mismo papel
 * no lo escribe dos veces igual.
 *
 * La FECHA no entra en la comparación, aunque parezca lo natural. Los dos casos
 * que se quieren atrapar —dos personas escaneando el mismo carnet, o alguien
 * volviendo a subirlo— son casi siempre en días distintos y con la fecha del
 * documento tecleada distinto o en blanco; exigir que coincida dejaría pasar
 * justo lo que se busca. Y al revés, un papel de verdad nuevo del mismo tipo
 * —un carnet renovado— casi siempre se guarda con otro nombre. Cuando no, se
 * pregunta y quien sabe contesta: por eso el aviso dice la fecha del que ya
 * está, que es con lo que se distingue uno del otro.
 *
 * ── Y no bloquea: pregunta ──
 *
 * Es el mismo mecanismo de Tesorería, de Traspasos y de las fichas repetidas de
 * Miembros: se devuelve un objeto con `confirmar` y el motor lo convierte en
 * dos botones. Dos papeles iguales de verdad existen, y el sistema no está para
 * discutírselo a quien tiene la carpeta en la mano.
 *
 * Las carpetas de iglesias, de pastores y de solicitudes tienen el mismo hueco
 * y el mismo arreglo a un nombre de distancia; se dejan para cuando les toque.
 * ===================================================================== */
const { comoSeCompara, seguiIgual } = require('../repetido');
const { comoSeLee } = require('../fechas');

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
function elQueYaEstaba(db, { miembro_id: miembroId, tipo, nombre }, id) {
  if (!miembroId || !tipo || !String(nombre || '').trim()) return undefined;
  return db
    .prepare('SELECT id, tipo, nombre, fecha, archivo, created_at FROM documentos_miembros'
      + ' WHERE miembro_id = ? AND id IS NOT ?')
    .all(miembroId, id || 0)
    .find((otro) => comoSeCompara(otro.tipo) === comoSeCompara(tipo)
      && comoSeCompara(otro.nombre) === comoSeCompara(nombre));
}

/** El aviso, con lo que hace falta para contestarlo sin salir de la pantalla. */
function avisoDeDocumentoRepetido(otro) {
  const senas = [
    otro.fecha ? `del ${comoSeLee(String(otro.fecha).slice(0, 10))}` : 'sin fecha',
    otro.created_at ? `guardado el ${comoSeLee(String(otro.created_at).slice(0, 10))}` : null,
    otro.archivo ? null : 'anotado sin archivo',
  ].filter(Boolean).join(', ');

  return {
    error:
      `Ya hay un "${otro.nombre}" (${otro.tipo}) en la carpeta de esta persona (${senas}). `
      + 'Si es este mismo, ábralo en vez de subirlo de nuevo: con dos copias del mismo papel, '
      + 'después nadie sabe cuál es el que vale. Si de verdad son dos, confirme.',
    confirmar: 'documento_ya_en_la_carpeta',
  };
}

module.exports = {
  name: 'documentos_miembros',
  label: 'Documentos de Miembros',
  labelSingular: 'Documento del miembro',
  icon: '🗂️',
  group: 'Personas',
  order: 23,
  display: '{nombre}',
  dateField: 'fecha',
  /*
   * La carpeta de una persona se ve donde se ve la persona.
   *
   * Cada documento guarda a qué iglesia pertenece, y era esa columna la que
   * decidía quién podía abrirlo. Pero esa columna se rellena con la del miembro
   * EL DÍA EN QUE SE SUBE el papel, y no se vuelve a mirar: dice dónde se
   * subió, no de quién es hoy la ficha.
   *
   * Medido sobre una miembro con tres documentos, trasladada de la Central a la
   * Norte, con dos secretarias de verdad acotadas cada una a la suya:
   *
   *                                    su ficha   su carpeta   abrir el archivo
   *   la secretaria de la que YA NO       403       3 de 3           200
   *   la secretaria de la que SÍ          200       0 de 3           403
   *
   * Léase la primera fila entera: el sistema le cierra la ficha de la persona
   * —correcto— y en la misma respiración le entrega su carnet de identidad. Y
   * la segunda es el reverso: quien de verdad trabaja con ella no ve ni uno de
   * sus papeles. Con documentos de identidad de por medio, esto no es una
   * incomodidad.
   *
   * Ahora la carpeta se alcanza como su miembro, y la columna de iglesia se
   * queda como lo que siempre fue: el dato de dónde se subió, con el que se
   * filtra. Vale para las dos puertas, porque las dos preguntan por acá: la
   * consulta del listado (`condiciones`) y la que decide si se entrega el
   * archivo (`alcanza`, desde server/archivos.js).
   */
  alcance: { comoSuPadre: { modulo: 'miembros', campo: 'miembro_id' } },
  /*
   * También por el tipo, que es la columna de al lado.
   *
   * El listado muestra «Tipo de documento» y el buscador no lo miraba: escribir
   * «Carnet» encontraba 4 —porque esa palabra está en el nombre que alguien le
   * puso al documento— y escribir «Carnet de identidad», que es el tipo tal
   * como se lee en su propia columna, encontraba 0. Hay un filtro por tipo en
   * la barra, pero quien teclea el tipo en el buscador —que es lo natural—
   * recibía un cero.
   */
  searchFields: ['nombre', 'observaciones', 'tipo'],
  /*
   * Y por el nombre de la persona, que no es una columna de acá.
   *
   * El listado muestra «Rosa Elena Del Traslado» en su columna «Miembro»
   * —resuelta de la otra tabla al leer—, así que ninguna fila contiene ese
   * texto y buscarlo daba CERO. Medido: «Rosa Elena» → 0, sus apellidos → 0, el
   * nombre completo → 0, mientras que «Carnet» —que sí está en el nombre del
   * documento— daba 4.
   *
   * Cero resultados no se lee como «busque de otra forma»: se lee como «esta
   * persona no tiene papeles en carpeta», que es lo contrario de lo que pasa. Y
   * la pantalla acababa de mostrar ese nombre.
   *
   * Se arma en la propia consulta, igual que en la bitácora de miembros
   * (1.184.0). Va el nombre COMPLETO y no el que se muestra: la etiqueta usa
   * solo el primer nombre, y con el completo sirven las dos formas, porque lo
   * tecleado se parte en palabras y todas tienen que estar.
   *
   * El RUT no entra, a propósito: es un campo reservado de la ficha de miembro
   * y quien no lo alcanza tampoco puede dar con alguien buscándolo. El nombre
   * no lo es, y además es lo que esta misma pantalla ya muestra.
   */
  buscaTambien: [
    "(SELECT coalesce(m.nombres,'') || ' ' || coalesce(m.apellidos,'')"
    + ' FROM miembros m WHERE m.id = documentos_miembros.miembro_id)',
  ],
  listFields: ['miembro_id', 'tipo', 'nombre', 'fecha', 'archivo'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'miembro_id', label: 'Miembro', type: 'ref', ref: 'miembros', required: true },
    {
      name: 'tipo', label: 'Tipo de documento', type: 'select', required: true, default: 'Carnet de identidad',
      options: [
        'Carnet de identidad',
        'Ficha de registro de miembro',
        'Ficha de actualización de registro',
        'Certificado de bautismo',
        'Certificado de matrimonio',
        'Certificado de nacimiento',
        'Carta de traslado',
        'Otro',
      ],
    },
    {
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Carnet vigente hasta 2030»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    {
      /*
       * La iglesia NO se escribe a mano: sale del miembro.
       *
       * El campo estaba abierto y lo que se escribiera se guardaba. Medido: el
       * documento de una miembro de la Central, guardado con la Norte, quedaba
       * con la Norte (201); y corregirlo después a una tercera, también (200).
       * Hasta la 1.191.0 eso decidía además quién podía abrir el archivo, así
       * que una equivocación al llenar el formulario mandaba el carnet de
       * alguien a otra iglesia. Hoy el alcance va por la ficha de la persona
       * (`alcance.comoSuPadre`, arriba) y esto es solo un dato descuadrado,
       * pero un dato que nadie elige a mano no tiene por qué ser editable.
       *
       * Se muestra igual, en gris: dice en qué iglesia se archivó el papel, que
       * no es siempre la de hoy —cuando alguien se traslada, su carpeta se va
       * con ella y esta columna se queda diciendo dónde se armó—.
       */
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'La iglesia en que se archivó el documento. La pone el sistema con la del miembro.',
    },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea' },
  ],
  hooks: {
    beforeSave(data, { isNew, id, existing, db, confirmado }) {
      /*
       * La iglesia sale del miembro, y solo cuando corresponde ponerla.
       *
       * Al CREAR, siempre. Al corregir un documento guardado, no: la columna
       * dice en qué iglesia se archivó el papel y esa es la del día en que se
       * archivó. Si se recalculara en cada guardado, arreglarle una coma a la
       * observación de una miembro trasladada le movería la iglesia al papel y
       * se perdería el dato. Las dos excepciones son cuando el documento cambia
       * de dueño —entonces se archiva en la carpeta del nuevo— y cuando el
       * papel viene sin iglesia, de una importación o de antes: ahí se aprovecha
       * el guardado para dejarlo completo.
       */
      const miembroId = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      const cambiaDeDueno = !existing
        || (data.miembro_id !== undefined && Number(data.miembro_id) !== Number(existing.miembro_id));
      if (miembroId && (cambiaDeDueno || !existing.iglesia_id)) {
        const miembro = db.prepare('SELECT iglesia_id FROM miembros WHERE id = ?').get(miembroId);
        if (miembro && miembro.iglesia_id) data.iglesia_id = miembro.iglesia_id;
      }
      if (isNew && !data.fecha) data.fecha = new Date().toISOString().slice(0, 10);

      /*
       * ¿No será el mismo papel que ya está en la carpeta? Ver arriba, en
       * `elQueYaEstaba`, qué hace que dos sean el mismo y por qué pregunta en
       * vez de bloquear.
       *
       * Al CORREGIR uno guardado solo se pregunta si este guardado cambia algo
       * de lo que lo hace «el mismo». Si no, el repetido ya estaba antes de
       * abrir la ficha y alguien ya dijo que eran dos: volver a preguntarlo
       * cada vez que se le arregla una observación es ruido, y el ruido enseña
       * a confirmar sin leer.
       */
      if (!confirmado) {
        const tipo = data.tipo !== undefined ? data.tipo : existing ? existing.tipo : null;
        const nombre = data.nombre !== undefined ? data.nombre : existing ? existing.nombre : null;
        const sinCambios = seguiIgual(existing, { miembro_id: miembroId, tipo, nombre }, [
          ['miembro_id', 'igual'], ['tipo', 'texto'], ['nombre', 'texto'],
        ]);
        const otro = sinCambios ? null
          : elQueYaEstaba(db, { miembro_id: miembroId, tipo, nombre }, id);
        if (otro) return avisoDeDocumentoRepetido(otro);
      }
      return null;
    },
  },
};
