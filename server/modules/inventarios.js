/**
 * Módulo: Inventarios (los bienes de la organización).
 *
 * Qué hay, cuánto, en qué estado, dónde está y quién lo tiene a cargo. La
 * organización tiene TRES niveles y los bienes también: hay cosas de la
 * corporación entera —lo que se usa en las asambleas, un vehículo—, cosas de
 * una iglesia local y cosas de un cuerpo o grupo, compradas con su propia
 * tesorería.
 *
 * EL NIVEL SE ELIGE, NO SE DEDUCE. Antes no había campo de nivel: se sacaba de
 * si «Cuerpo / Grupo» venía vacío o lleno, y el propio rótulo del campo tenía
 * que explicarlo —«Cuerpo / Grupo (vacío = inventario general de la
 * iglesia)»—. Eso alcanzaba para dos niveles y dejaba fuera el tercero, porque
 * «Iglesia» era obligatorio: medido, guardar un artículo de la corporación
 * contestaba 400 «El campo "Iglesia" es obligatorio». Un bien de la
 * organización había que colgárselo a alguna congregación, y ahí quedaba
 * contado como suyo.
 *
 * Es el mismo campo «Nivel» de una cuenta de tesorería, con las mismas tres
 * opciones y el mismo mecanismo de mostrar solo lo que ese nivel necesita (ver
 * server/modules/cuentas_tesoreria.js). Dos maneras distintas de decir lo
 * mismo en dos pantallas vecinas no le sirven a nadie.
 *
 * Y NO TODO LO QUE ESTÁ EN LA IGLESIA ES DE LA IGLESIA. Un hermano presta algo
 * para el aniversario y hay que devolvérselo; otro deja su batería guardada
 * porque no tiene dónde, bajo su propia responsabilidad. Las dos cosas están
 * en el templo y tienen que estar inventariadas, y la diferencia entre ellas
 * —y con lo propio— es el campo «Régimen del bien». La regla entera, con lo
 * que se midió antes de tenerla, está en server/bienes-ajenos.js.
 *
 * Y LA IGLESIA DE UN BIEN DE CUERPO LA PONE EL CUERPO. Nadie comprobaba que el
 * cuerpo elegido fuera de la iglesia elegida: medido, un artículo con «Iglesia
 * Central» y un cuerpo de la Iglesia Norte entró con un 201, y quedaba contado
 * en las dos partes de la organización a la vez —quien administra ese cuerpo
 * lo veía en su lista mientras la ficha decía que era de la otra—. Se copia,
 * como se copia en las cuentas: no hay nada que elegir, la iglesia de un
 * cuerpo es la de su cuerpo.
 */

const ajenos = require('../bienes-ajenos');

/** Los tres niveles, en el orden en que se piensan. */
const NIVELES = ['Corporación', 'Iglesia local', 'Cuerpo / Grupo'];

/**
 * Deja el nivel y sus columnas de acuerdo, o devuelve el aviso de lo que falta.
 *
 * Cada nivel llena exactamente sus columnas y limpia las de los otros: un bien
 * de la corporación no es de ninguna iglesia, y uno de una iglesia no es de
 * ningún cuerpo. Sin esta limpieza, cambiarle el nivel a un artículo ya
 * anotado le dejaba pegada la iglesia o el cuerpo de antes, y el registro
 * decía dos cosas a la vez.
 */
function acomodarElNivel(db, data, dato) {
  const ambito = dato('ambito');
  if (!NIVELES.includes(ambito)) {
    return `El nivel del artículo tiene que ser uno de estos tres: ${NIVELES.join(', ')}`;
  }

  if (ambito === 'Corporación') {
    data.iglesia_id = null;
    data.cuerpo_id = null;
    return null;
  }

  if (ambito === 'Cuerpo / Grupo') {
    const cuerpoId = dato('cuerpo_id');
    if (!cuerpoId) return 'Indique de qué cuerpo o grupo es el artículo';
    const cuerpo = db.prepare('SELECT id, nombre, iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
    if (!cuerpo) return 'El cuerpo o grupo indicado no existe';
    // La iglesia se copia del cuerpo: es la suya y no hay otra que elegir
    data.iglesia_id = cuerpo.iglesia_id || null;
    return null;
  }

  // Iglesia local
  data.cuerpo_id = null;
  if (!dato('iglesia_id')) return 'Indique de qué iglesia es el artículo';
  return null;
}

module.exports = {
  name: 'inventarios',
  label: 'Inventarios',
  labelSingular: 'Artículo de inventario',
  icon: '📦',
  group: 'Finanzas',
  order: 43,
  display: '{articulo}',
  searchFields: ['articulo', 'categoria', 'ubicacion', 'notas', 'dueno'],
  listFields: ['articulo', 'regimen', 'categoria', 'cantidad', 'estado', 'ambito', 'iglesia_id', 'cuerpo_id'],
  filterFields: ['regimen', 'ambito', 'cuerpo_id', 'categoria', 'estado'],
  printable: true,
  defaultSort: { field: 'articulo', dir: 'asc' },
  fields: [
    { name: 'articulo', label: 'Artículo', type: 'text', required: true },
    {
      name: 'categoria', label: 'Categoría', type: 'select', default: 'Mobiliario',
      options: ['Mobiliario', 'Equipo de sonido', 'Instrumentos musicales', 'Equipo audiovisual', 'Electrodomésticos', 'Cocina', 'Vehículos', 'Inmuebles', 'Material didáctico', 'Otro'],
    },
    {
      name: 'ambito', label: 'Nivel', type: 'select', required: true, default: 'Iglesia local',
      options: NIVELES,
      help: 'De la corporación (toda la organización), de una iglesia local, o de un cuerpo o grupo, que tiene sus propias cosas.',
    },
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias',
      showIf: { field: 'ambito', in: ['Iglesia local', 'Cuerpo / Grupo'] },
      help: 'De qué iglesia local es el artículo. En un bien de cuerpo o grupo se toma del cuerpo.',
    },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos',
      showIf: { field: 'ambito', equals: 'Cuerpo / Grupo' },
      help: 'De qué cuerpo o grupo es el artículo.',
    },
    {
      name: 'regimen', label: 'Régimen del bien', type: 'select', required: true, default: 'Propio',
      options: ajenos.REGIMENES,
      help: 'PROPIO: es de la organización. PRESTADO: un hermano se lo prestó a la iglesia y hay que '
        + 'devolvérselo. EN DEPÓSITO: lo dejó guardado bajo su propia responsabilidad, y la iglesia '
        + 'no responde por daño, deterioro ni pérdida.',
    },
    {
      name: 'dueno', label: 'Dueño del artículo', type: 'persona', ref: 'miembros', buscador: true,
      showIf: { field: 'regimen', in: ['Prestado', 'En depósito'] },
      help: 'De quién es. Si está en la membresía se enlaza a su ficha; si no, se escribe el nombre.',
    },
    {
      name: 'dueno_contacto', label: 'Teléfono o correo del dueño', type: 'text',
      showIf: { field: 'regimen', in: ['Prestado', 'En depósito'] },
      help: 'Para poder ubicarlo cuando haya que devolvérselo.',
    },
    {
      name: 'fecha_recepcion', label: 'Desde cuándo está en la iglesia', type: 'date',
      showIf: { field: 'regimen', in: ['Prestado', 'En depósito'] },
    },
    {
      name: 'fecha_devolucion', label: 'Fecha de devolución comprometida', type: 'date',
      // Es futura por definición, y no puede caer antes de que la cosa llegara:
      // las dos reglas las aplica el motor (ver server/fechas.js)
      futuro: true, noAntesDe: 'fecha_recepcion',
      showIf: { field: 'regimen', equals: 'Prestado' },
      help: 'Cuándo se prometió devolverlo. El sistema avisa cuando se acerque. Si el préstamo no '
        + 'tiene plazo, se deja en blanco.',
    },
    {
      name: 'deslinde_aceptado', label: 'El dueño aceptó la cláusula de responsabilidad',
      type: 'boolean', default: 0,
      showIf: { field: 'regimen', equals: 'En depósito' },
      help: 'Se marca cuando el dueño firmó la hoja de depósito, donde dice que la iglesia no '
        + 'responde por daño, deterioro ni pérdida. El texto se edita en Configuración → Organización.',
    },
    {
      name: 'deslinde_fecha', label: 'Fecha en que la aceptó', type: 'date',
      showIf: { field: 'regimen', equals: 'En depósito' },
    },
    {
      name: 'documento_tenencia', label: 'Hoja firmada (préstamo o depósito)', type: 'file',
      showIf: { field: 'regimen', in: ['Prestado', 'En depósito'] },
      help: 'La hoja que firmó el dueño, escaneada o fotografiada.',
    },
    {
      name: 'fecha_devuelto', label: 'Fecha en que se devolvió', type: 'date',
      // Sin `futuro`: algo no se devuelve mañana, se devuelve y se anota
      noAntesDe: 'fecha_recepcion',
      showIf: { field: 'regimen', in: ['Prestado', 'En depósito'] },
      help: 'Al llenarla, el artículo deja de estar en el inventario activo y queda como historia de '
        + 'que estuvo y de que se devolvió.',
    },
    { name: 'cantidad', label: 'Cantidad', type: 'number', required: true, default: 1, min: 0, },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Bueno',
      options: ['Bueno', 'Regular', 'Malo', 'En reparación', 'De baja'],
    },
    { name: 'valor_estimado', label: 'Valor estimado (unitario)', type: 'money', min: 0, },
    { name: 'fecha_adquisicion', label: 'Fecha de adquisición', type: 'date' },
    { name: 'ubicacion', label: 'Ubicación física', type: 'text' },
    { name: 'responsable_id', label: 'Responsable', type: 'ref', ref: 'miembros' },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  hooks: {
    beforeSave(data, { existing, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);

      const delNivel = acomodarElNivel(db, data, dato);
      if (delNivel) return delNivel;

      /*
       * El nivel primero y el régimen después, porque el nivel es de quién
       * ADMINISTRA la cosa y el régimen de quién ES: sin nivel el artículo no
       * se puede guardar en ninguna parte, así que esa pregunta va antes.
       */
      const delRegimen = ajenos.acomodarElRegimen(data, dato);
      // Lo que se pregunta se calla si ya está contestado; lo que se frena, no
      if (delRegimen && delRegimen.confirmar && confirmado) return null;
      return delRegimen;
    },
  },

  /**
   * Lo prestado que hay que devolver, para el aviso del panel.
   *
   * Es la misma forma que `documentos_miembros.porVencer`: sale del módulo y no
   * de una ruta, para que la pantalla y el aviso no puedan discrepar. Se cuenta
   * desde HOY, así que lo que ya se pasó de la fecha entra con días negativos:
   * algo que había que devolver hace un mes es más urgente que algo que vence
   * en veinte días, y los dos tienen que salir en la misma lista.
   *
   * Lo ya devuelto no entra: `fecha_devuelto` puesta es el fin del asunto. Y lo
   * que no tiene fecha de devolución tampoco —un préstamo sin plazo no está
   * atrasado—; `date()` devuelve nulo con lo que no sea una fecha y comparar
   * contra nulo no es cierto, así que quedan fuera solos.
   */
  porVencer(usuario, dentroDe) {
    const { db } = require('../db');
    const alcance = require('../alcance');
    const dias = dentroDe === undefined
      ? require('../ajustes').numero('inventario_aviso_devolucion_dias', 1, 365)
      : dentroDe;

    const params = [];
    const donde = alcance.condiciones(module.exports, usuario, params);
    return db
      .prepare(
        `SELECT id, articulo, dueno, dueno_contacto, fecha_devolucion, iglesia_id, cuerpo_id,
                CAST(julianday(fecha_devolucion) - julianday(date('now','localtime')) AS INTEGER) AS dias
           FROM inventarios
          WHERE regimen = 'Prestado'
            AND (fecha_devuelto IS NULL OR fecha_devuelto = '')
            AND date(fecha_devolucion) <= date('now','localtime', '+' || ? || ' days')
            ${donde ? `AND id IN (SELECT id FROM inventarios WHERE ${donde})` : ''}
          ORDER BY fecha_devolucion LIMIT 200`
      )
      .all(dias, ...params);
  },

  extraRoutes(router, { requirePerm }) {
    /*
     * La cláusula que va en la hoja de depósito.
     *
     * La hoja se arma en el navegador y el texto vive en Configuración, donde
     * lo escribe la corporación. Pero leer la configuración pide el permiso de
     * configuración, y quien lleva el inventario no tiene por qué tenerlo: se
     * quedaría sin poder imprimir la hoja que necesita hacer firmar.
     *
     * Así que se ofrece por acá, con la llave del inventario, y sale solo ese
     * texto: no es una puerta trasera a la configuración entera.
     */
    router.get('/inventarios/clausula-deposito', requirePerm('inventarios', 'view'), (req, res) => {
      res.json({ texto: require('../ajustes').obtener('inventario_clausula_deposito') || '' });
    });

    /*
     * EL INVENTARIO DE UN NIVEL, con lo suyo y sus totales.
     *
     * «El inventario de este cuerpo» no se podía pedir: la ficha del cuerpo no
     * tenía esa pestaña —sí las de integrantes, cuotas, tesorería, directivas y
     * actas—, la de la iglesia tampoco, y el listado no se dejaba filtrar por
     * cuerpo. Había que ir al listado general y buscarlo a ojo.
     *
     * LOS TOTALES VAN SEPARADOS POR RÉGIMEN, y ésa es la razón de que esta ruta
     * exista en vez de sumar las filas en la pantalla. Un inventario que suma en
     * un mismo total la batería que un hermano dejó en depósito y las bancas que
     * la iglesia compró no sirve para ninguna de las dos cosas: ni dice cuánto
     * tiene la iglesia, ni cuánto está cuidando de otros. Se cuenta cantidad por
     * valor unitario, que es lo que vale lo que hay, no lo que costó una unidad.
     *
     * Lo devuelto no entra: el artículo ya se fue. Queda anotado, y su ficha lo
     * cuenta, pero no es parte de lo que hay hoy.
     *
     * El alcance es el mismo del listado, pedido a `condiciones`: acá no se
     * escribe ninguna comprobación a mano, que es de donde salían las diez rutas
     * propias que encontró la auditoría de aislamiento.
     */
    router.get('/inventarios/de-nivel', requirePerm('inventarios', 'view'), (req, res) => {
      const ambito = String(req.query.ambito || '');
      if (!NIVELES.includes(ambito)) {
        return res.status(400).json({ error: `El nivel tiene que ser uno de estos tres: ${NIVELES.join(', ')}` });
      }

      const params = [];
      const where = ['ambito = ?'];
      params.push(ambito);
      if (ambito === 'Cuerpo / Grupo') {
        if (!req.query.cuerpo_id) return res.status(400).json({ error: 'Indique de qué cuerpo o grupo' });
        where.push('cuerpo_id = ?');
        params.push(Number(req.query.cuerpo_id));
      } else if (ambito === 'Iglesia local') {
        if (!req.query.iglesia_id) return res.status(400).json({ error: 'Indique de qué iglesia' });
        where.push('iglesia_id = ?');
        params.push(Number(req.query.iglesia_id));
      }
      const suyo = require('../alcance').condiciones(module.exports, req.user, params);
      if (suyo) where.push(suyo);

      const filas = require('../db').db
        .prepare(
          `SELECT id, articulo, categoria, cantidad, estado, valor_estimado, ubicacion,
                  regimen, dueno, fecha_devolucion, fecha_devuelto
             FROM inventarios
            WHERE ${where.join(' AND ')}
            ORDER BY regimen, articulo LIMIT 1000`
        )
        .all(...params);

      const enPie = filas.filter((f) => !f.fecha_devuelto);
      const cuenta = (cuales) => cuales.reduce(
        (t, f) => ({
          articulos: t.articulos + 1,
          unidades: t.unidades + (Number(f.cantidad) || 0),
          valor: t.valor + (Number(f.cantidad) || 0) * (Number(f.valor_estimado) || 0),
        }),
        { articulos: 0, unidades: 0, valor: 0 }
      );

      res.json({
        ambito,
        filas,
        totales: {
          propio: cuenta(enPie.filter((f) => !ajenos.esAjeno(f.regimen))),
          prestado: cuenta(enPie.filter((f) => f.regimen === 'Prestado')),
          deposito: cuenta(enPie.filter((f) => f.regimen === 'En depósito')),
          ajeno: cuenta(enPie.filter((f) => ajenos.esAjeno(f.regimen))),
          devueltos: cuenta(filas.filter((f) => f.fecha_devuelto)),
        },
      });
    });
  },

  // Las listas las necesitan también la puesta al día de server/migraciones.js
  // y las pruebas, y escribirlas dos veces es tener dos listas que un día van a
  // decir cosas distintas
  NIVELES,
  REGIMENES: ajenos.REGIMENES,
};
