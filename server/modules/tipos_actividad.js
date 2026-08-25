/**
 * Módulo: Tipos de Actividad.
 *
 * Qué clase de reunión es cada una al pasar lista: un Servicio General, un
 * Ensayo, una Salida a Visitar. Antes esa lista venía escrita dentro del
 * programa, así que agregar «Escuela Dominical» o dejar de usar una obligaba
 * a tocar el código. Ahora la mantiene la propia iglesia desde acá.
 *
 * Es el mismo camino que ya recorrieron las categorías de tesorería, y por la
 * misma razón: son nombres que cada congregación usa a su manera y que cambian
 * con los años, no una estructura del sistema.
 *
 * Un tipo que ya se usó no se borra: se **desactiva**. Borrarlo dejaría a esas
 * actividades con un nombre que ya no existe en ninguna parte, y los informes
 * de asistencia de años anteriores dejarían de cuadrar. Desactivado deja de
 * ofrecerse en las actividades nuevas y lo antiguo queda como estaba.
 */
module.exports = {
  name: 'tipos_actividad',
  label: 'Tipos de Actividad',
  labelSingular: 'Tipo de actividad',
  icon: '🗓️',
  group: 'Sistema',
  order: 75,
  display: '{nombre}',
  searchFields: ['nombre', 'notas'],
  listFields: ['nombre', 'activo', 'notas'],
  filterFields: ['activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'nombre', label: 'Nombre del tipo', type: 'text', required: true, unique: true,
      help: 'Como se verá al crear una actividad y en los informes de asistencia. Ej: «Servicio General».',
    },
    {
      name: 'activo', label: 'En uso', type: 'boolean', default: 1,
      help: 'Al desmarcarlo deja de ofrecerse en las actividades nuevas. Las que ya lo tienen no se tocan.',
    },
    { name: 'notas', label: 'Para qué es', type: 'text', help: 'Opcional: cuándo se usa este tipo, para que todos lo usen igual.' },
  ],
  hooks: {
    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM asistencias WHERE tipo_reunion = ?').get(row.nombre).c;
      if (usos) {
        return (
          `«${row.nombre}» está en ${usos.toLocaleString('es-CL')} actividad(es), así que no se puede borrar sin ` +
          'dejarlas sin tipo. Desmárquelo en «En uso» y dejará de ofrecerse para las nuevas, sin tocar las que ya están.'
        );
      }
      return null;
    },
  },
  extraRoutes(router, { db, requirePerm }) {
    /**
     * Los tipos que se pueden elegir hoy. Devuelve el NOMBRE como valor,
     * porque es el nombre lo que se guarda en la actividad: así, si algún día
     * el tipo se renombra o se desactiva, lo ya registrado sigue diciendo lo
     * que decía.
     */
    router.get('/tipos_actividad/opciones', requirePerm('asistencias', 'view'), (req, res) => {
      res.json(
        db.prepare("SELECT nombre FROM tipos_actividad WHERE activo = 1 ORDER BY nombre").all()
          .map((t) => ({ id: t.nombre, label: t.nombre }))
      );
    });
  },
};
