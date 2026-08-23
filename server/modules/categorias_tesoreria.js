/**
 * Módulo: Categorías de Tesorería.
 *
 * En qué se clasifica cada movimiento: diezmos, ofrendas, servicios públicos,
 * mantenimiento… Antes esa lista venía escrita dentro del programa, así que
 * agregar «Pro-Templo Sede Sur» o dejar de usar una obligaba a tocar el
 * código. Ahora la mantiene la propia iglesia desde acá.
 *
 * Cada categoría dice si es de **ingreso**, de **egreso** o de las dos, y al
 * registrar un movimiento solo se ofrecen las que corresponden a lo que se
 * está anotando: al registrar un gasto no aparece «Diezmos».
 *
 * Una categoría que ya se usó no se borra: se **desactiva**. Borrarla dejaría
 * a esos movimientos clasificados con un nombre que ya no existe en ninguna
 * parte, y los informes de años anteriores dejarían de cuadrar. Desactivada
 * deja de ofrecerse en los movimientos nuevos y lo antiguo queda como estaba.
 */
const TIPOS = ['Ingreso', 'Egreso', 'Ambos'];

module.exports = {
  name: 'categorias_tesoreria',
  label: 'Categorías de Tesorería',
  labelSingular: 'Categoría',
  icon: '🏷️',
  group: 'Finanzas',
  order: 41,
  display: '{nombre}',
  searchFields: ['nombre', 'notas'],
  listFields: ['nombre', 'tipo', 'activo', 'notas'],
  filterFields: ['tipo', 'activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'nombre', label: 'Nombre de la categoría', type: 'text', required: true, unique: true,
      help: 'Como se verá al registrar un movimiento y en los informes. Ej: «Diezmos», «Servicios públicos».',
    },
    {
      name: 'tipo', label: 'Se usa en', type: 'select', required: true, default: 'Ingreso', options: TIPOS,
      help: 'Al registrar un ingreso solo se ofrecen las de ingreso, y al registrar un gasto, las de egreso. «Ambos» aparece en los dos.',
    },
    {
      name: 'activo', label: 'En uso', type: 'boolean', default: 1,
      help: 'Al desmarcarla deja de ofrecerse en los movimientos nuevos. Los que ya estaban clasificados con ella no se tocan.',
    },
    { name: 'notas', label: 'Para qué es', type: 'text', help: 'Opcional: qué entra en esta categoría, para que todos la usen igual.' },
  ],
  hooks: {
    /**
     * Una categoría que ya se usó no se borra. Si se borrara, los movimientos
     * que la tienen quedarían clasificados con un nombre que ya no existe.
     */
    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE categoria = ?').get(row.nombre).c;
      if (usos) {
        return (
          `«${row.nombre}» está en ${usos.toLocaleString('es-CL')} movimiento(s) de tesorería, así que no se puede ` +
          'borrar sin dejarlos sin clasificación. Desmárquela en «En uso» y dejará de ofrecerse para los nuevos, ' +
          'sin tocar los que ya están.'
        );
      }
      return null;
    },
  },
  extraRoutes(router, { db, requirePerm }) {
    /**
     * Las categorías que se pueden elegir para un movimiento, según sea un
     * ingreso o un egreso. Devuelve el nombre como valor, porque es el nombre
     * lo que se guarda en el movimiento: así, si algún día la categoría se
     * borra o se renombra, lo ya registrado sigue diciendo lo que decía.
     */
    router.get('/categorias_tesoreria/opciones', requirePerm('tesoreria', 'view'), (req, res) => {
      const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
      const donde = tipo && tipo !== 'Ambos' ? "AND tipo IN (?, 'Ambos')" : '';
      const filas = db
        .prepare(`SELECT nombre FROM categorias_tesoreria WHERE activo = 1 ${donde} ORDER BY nombre`)
        .all(...(donde ? [tipo] : []));
      res.json(filas.map((f) => ({ id: f.nombre, label: f.nombre })));
    });
  },
};
