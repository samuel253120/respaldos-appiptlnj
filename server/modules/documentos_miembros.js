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
/*
 * El mismo papel guardado dos veces: la pregunta vive en `server/carpetas.js`,
 * porque es la misma en las cuatro carpetas del sistema —la de un miembro, la
 * de una iglesia, la de un pastor y la de una solicitud—. Allá está escrito
 * qué hace que dos sean «el mismo», por qué la fecha no entra en esa cuenta y
 * por qué pregunta en vez de bloquear.
 */
const carpetas = require('../carpetas');

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
  listFields: ['miembro_id', 'tipo', 'nombre', 'fecha', 'vence', 'archivo'],
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
      /*
       * La ayuda decía «ej: "Carnet vigente hasta 2030"», o sea: el sistema
       * pedía que la vigencia se escribiera DENTRO del nombre, donde ningún
       * aviso la puede leer. Ahora hay una columna para eso, unas líneas más
       * abajo, y el ejemplo deja de empujar hacia el lado equivocado.
       */
      name: 'nombre', label: 'Nombre del documento', type: 'text', required: true,
      help: 'Con qué nombre se reconoce este documento (ej: «Carnet de Rosa», «Carta de traslado a la Norte»).',
    },
    {
      name: 'archivo', label: 'Documento', type: 'file', required: true,
      help: 'Foto o archivo. Si es una foto, se ajusta sola de tamaño al subirla.',
    },
    { name: 'fecha', label: 'Fecha del documento', type: 'date' },
    {
      /*
       * Hasta cuándo vale el papel, para poder avisar antes de que haga falta.
       *
       * Es opcional a propósito: una carta de traslado o un certificado de
       * bautismo no vencen nunca, y obligar a poner una fecha llevaría a
       * inventarla. Los que sí vencen —el carnet, sobre todo— son justo los que
       * se descubren vencidos el día del trámite.
       */
      name: 'vence', label: 'Vence el', type: 'date', futuro: true, noAntesDe: 'fecha',
      help: 'Solo si el documento tiene vigencia. El sistema avisa antes de que se venza.',
    },
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
      const repetido = carpetas.preguntaSiSeRepite({
        db, tabla: 'documentos_miembros', campoDueno: 'miembro_id', deQuien: 'esta persona',
        data, id, existing, confirmado,
      });
      if (repetido) return repetido;
      return null;
    },
  },

  porVencer,
};

/* =====================================================================
 * LOS PAPELES QUE HAY QUE RENOVAR
 *
 * Nada avisaba de un carnet vencido, y la ayuda del propio campo empujaba a
 * escribir la vigencia dentro del nombre —«Carnet vigente hasta 2030»—, donde
 * ningún aviso la puede leer. Medido antes: ningún campo de vencimiento en el
 * módulo y ningún aviso del panel sobre documentos, mientras el sistema sí
 * sabía avisar de una credencial por vencer, de cuotas al debe, del respaldo
 * atrasado, de faltas seguidas y de quien cumplió la mayoría.
 *
 * La maquinaria estaba hecha: esto es la misma forma de `credenciales.porVencer`
 * —sale de acá y no de la ruta, para que la pantalla y el aviso del panel no
 * puedan discrepar— y el aviso es una línea más en el vigía.
 *
 * Se cuenta desde HOY: lo que ya venció entra con días negativos, porque un
 * carnet vencido hace un mes es más urgente que uno que vence en veinte días y
 * los dos tienen que salir en la misma lista.
 *
 * A los que NO vencen no hace falta dejarlos fuera a mano. `date()` devuelve
 * nulo con lo que no sea una fecha —nulo, vacío, espacios, texto— y comparar
 * contra nulo no es cierto, así que no entran solos. Comprobado. Acá estaban
 * escritas las dos comprobaciones «por si acaso» y no cuidaban nada: romperlas
 * no ponía roja ninguna prueba. Es la misma advertencia que ya estaba escrita
 * en el filtro de edad del motor (server/crud.js), y se cayó igual en ella.
 *
 * El alcance se pide a `alcance.condiciones`, que devuelve los nombres de
 * columna SIN calificar —«miembro_id IN (…)»— y esta consulta tiene dos tablas.
 * En vez de reescribirle el SQL a mano para ponerle el alias, se usa tal cual
 * dentro de un `IN (SELECT id FROM documentos_miembros WHERE …)`: ahí no hay
 * ambigüedad posible y, sobre todo, no hay que adivinar qué columnas nombra la
 * condición, que es lo que se rompería el día que el alcance cambie.
 * ===================================================================== */
function porVencer(usuario, dentroDe) {
  const { db } = require('../db');
  const alcance = require('../alcance');
  const dias = dentroDe === undefined
    ? require('../ajustes').numero('avisos_documento_dias', 1, 365)
    : dentroDe;

  const params = [];
  const donde = alcance.condiciones(module.exports, usuario, params);
  return db
    .prepare(
      `SELECT d.id, d.miembro_id, d.tipo, d.nombre, d.vence,
              CAST(julianday(d.vence) - julianday(date('now','localtime')) AS INTEGER) AS dias,
              trim(coalesce(m.nombres,'') || ' ' || coalesce(m.apellidos,'')) AS titular
         FROM documentos_miembros d
         LEFT JOIN miembros m ON m.id = d.miembro_id
        WHERE date(d.vence) <= date('now','localtime', '+' || ? || ' days')
          ${donde ? `AND d.id IN (SELECT id FROM documentos_miembros WHERE ${donde})` : ''}
        ORDER BY d.vence LIMIT 200`
    )
    .all(dias, ...params);
}
