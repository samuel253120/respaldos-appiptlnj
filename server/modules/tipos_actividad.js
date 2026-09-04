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
/**
 * ¿Este guardado dejaría a la iglesia sin ningún tipo que ofrecer?
 *
 * Desmarcar «En uso» es la salida que el propio módulo recomienda en vez de
 * borrar, y está bien, pero no había ningún piso: se podían apagar todos.
 * MEDIDO en la v1.349.0, contra el sistema andando: se desactivaron los quince
 * tipos, uno por uno, y ninguno dijo nada; la ruta que los ofrece pasó a
 * devolver cero; y una actividad nueva se guardó igual —201— con el valor de
 * fábrica escrito en el código. Con la lista en cero, quien pasa lista se
 * encuentra un desplegable vacío y la actividad se guarda de todos modos, con
 * un nombre que no está en ninguna lista viva.
 *
 * Se pregunta por el estado en que quedaría la lista DESPUÉS del cambio, que es
 * lo que cubre las dos puertas por las que se llega: desactivar el último y
 * borrar el último.
 *
 * `como` es cómo quedaría ESTA fila, o null si se está borrando.
 */
function dejariaSinNingunTipo(db, id, como) {
  const vivos = db
    .prepare('SELECT COUNT(*) AS c FROM tipos_actividad WHERE id != ? AND activo = 1')
    .get(id).c;
  if (vivos) return false;
  return !(como && Number(como.activo) !== 0);
}

/** El reparo, escrito para quien lo va a leer. */
const EL_AVISO_DE_QUEDARSE_SIN_TIPOS =
  'Con eso no quedaría ningún tipo de actividad en uso: al pasar lista el desplegable saldría '
  + 'vacío y no habría con qué decir si la reunión fue un servicio, un ensayo o una salida. '
  + 'Deje al menos uno en uso, o cree antes el que va a usar.';

module.exports = {
  name: 'tipos_actividad',
  label: 'Tipos de Actividad',
  labelSingular: 'Tipo de actividad',
  icon: '🗓️',
  group: 'Sistema',
  ayudaPermiso:
    'Las clases de actividad que se ofrecen al crear una en Asistencia. Quien pasa lista ' +
    'necesita poder agregar una en el momento; si no, todo termina anotado como «Otro».',
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
    /**
     * UN TIPO QUE YA SE USÓ SE RENOMBRA, Y SE LLEVA SUS ACTIVIDADES CONSIGO.
     *
     * El módulo frenaba el BORRADO de un tipo en uso con el argumento correcto
     * —dejaría esas actividades «sin tipo»— y dejaba el RENOMBRADO abierto, sin
     * cartel, haciendo exactamente el mismo daño: las actividades guardan el
     * NOMBRE, así que seguían diciendo el viejo.
     *
     * MEDIDO en la v1.349.0, con «Ensayo» en dos actividades: renombrarlo a
     * «Ensayo del coro» contestó 200 sin una palabra, y las dos actividades
     * quedaron diciendo «Ensayo», que ya no estaba en la lista. El informe de
     * asistencia por tipo se parte en dos y las actividades viejas quedan
     * apuntando a un nombre que el desplegable ya no ofrece.
     *
     * Es el mismo hallazgo que en Categorías de Tesorería (CT-03) y se resuelve
     * igual, por la misma razón: lo que cambia es la ETIQUETA de una actividad,
     * no la actividad. La fecha, los cuerpos convocados, el lugar y las marcas
     * de quién fue y quién faltó quedan intactos. El tipo es el nombre de una
     * clase de reunión, y la clase no cambió: lo que la iglesia llamaba
     * «Ensayo» y ahora llama «Ensayo del coro» es lo mismo.
     *
     * Así que se pregunta, y si dice que sí, el nombre nuevo se lleva las
     * actividades. Los dos pasos van en la MISMA transacción del motor —el
     * arrastre está en `afterSave`— así que o cambian los dos o no cambia
     * ninguno.
     */
    beforeSave(data, { db, isNew, existing, confirmado }) {
      /*
       * Lo primero: que este guardado no deje a quien pasa lista sin ningún
       * tipo que elegir. Va antes que lo del nombre porque no depende de él
       * —se llega acá desmarcando «En uso»— y porque es lo que impide que la
       * pantalla de asistencia quede sin poder clasificar nada.
       */
      if (!isNew && existing) {
        const comoQuedaria = { activo: data.activo !== undefined ? data.activo : existing.activo };
        if (dejariaSinNingunTipo(db, existing.id, comoQuedaria)) return EL_AVISO_DE_QUEDARSE_SIN_TIPOS;
      }

      if (isNew || !existing || data.nombre === undefined) return null;

      const seLlamaba = String(existing.nombre || '');
      const seVaALlamar = String(data.nombre || '');
      if (seLlamaba.trim().toLowerCase() === seVaALlamar.trim().toLowerCase()) return null;

      const usos = db
        .prepare('SELECT COUNT(*) AS c FROM asistencias WHERE lower(tipo_reunion) = lower(?)')
        .get(seLlamaba).c;
      if (!usos || confirmado) return null;

      const cuantas = `${usos.toLocaleString('es-CL')} actividad(es)`;
      return {
        error: `«${seLlamaba}» está en ${cuantas}.`,
        confirmar:
          `«${seLlamaba}» está en ${cuantas}. Al cambiarle el nombre a «${seVaALlamar}», esas `
          + 'actividades pasan a quedar clasificadas con el nombre nuevo, para que el informe de '
          + 'asistencia siga cuadrando en una sola línea en vez de partirse en dos. De cada '
          + 'actividad no se toca nada más: la fecha, los cuerpos convocados, el lugar y las marcas '
          + 'de quién fue y quién faltó quedan igual. ¿Le cambio el nombre?',
      };
    },

    /**
     * El nombre nuevo se lleva las actividades.
     *
     * Va acá y no en `beforeSave` porque tiene que ocurrir DESPUÉS de que el
     * tipo quede guardado, y dentro de la misma transacción del motor: si esto
     * fallara a mitad de camino, el tipo tampoco se guarda y todo queda como
     * estaba.
     *
     * Se compara sin distinguir mayúsculas para alcanzar también lo que se
     * anotó antes de la v1.352.0, cuando el guardado todavía no dejaba el tipo
     * escrito como está en la lista.
     */
    afterSave(row, { db, isNew, existing, user }) {
      if (isNew || !existing) return;
      const seLlamaba = String(existing.nombre || '');
      const seLlama = String(row.nombre || '');
      if (!seLlamaba || seLlamaba === seLlama) return;

      const movidas = db
        .prepare('UPDATE asistencias SET tipo_reunion = ? WHERE lower(tipo_reunion) = lower(?)')
        .run(seLlama, seLlamaba).changes;
      if (!movidas) return;

      /*
       * Y queda dicho cuántas se movieron. El motor anota solo el cambio de la
       * ficha —«Nombre del tipo: X → Y»—, que no dice lo que de verdad pasó con
       * los informes de asistencia. Esta línea sí.
       */
      require('../bitacora').anotarCambio({
        def: module.exports,
        accion: 'Cambio',
        fila: row,
        usuario: user,
        detalle: `Al cambiar el nombre, ${movidas.toLocaleString('es-CL')} actividad(es) `
          + `pasaron de «${seLlamaba}» a «${seLlama}»`,
      });
    },

    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM asistencias WHERE tipo_reunion = ?').get(row.nombre).c;
      if (usos) {
        return (
          `«${row.nombre}» está en ${usos.toLocaleString('es-CL')} actividad(es), así que no se puede borrar sin ` +
          'dejarlas sin tipo. Desmárquelo en «En uso» y dejará de ofrecerse para las nuevas, sin tocar las que ya están.'
        );
      }

      // Y que borrarlo no deje la lista en cero: es la misma comprobación que
      // al desmarcar «En uso», con esta fila fuera.
      if (dejariaSinNingunTipo(db, row.id, null)) return EL_AVISO_DE_QUEDARSE_SIN_TIPOS;

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
