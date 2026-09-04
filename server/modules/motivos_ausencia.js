/**
 * Módulo: Motivos de Ausencia.
 *
 * Por qué alguien no estuvo, cuando su ausencia queda justificada: trabajo,
 * enfermedad, una emergencia. Estaba escrito dentro del programa, y son
 * nombres que cada iglesia usa a su manera.
 *
 * Cada motivo dice si PIDE DETALLE. «Enfermedad» se entiende solo; «Otro
 * motivo» sin explicación no dice nada tres meses después, cuando alguien
 * revisa por qué un integrante figura ausente medio año. Esa marca es la que
 * decide si al justificar se exige escribir el porqué.
 *
 * Un motivo que ya se usó no se borra: se desactiva, como los tipos de
 * actividad y las categorías de tesorería.
 */
module.exports = {
  name: 'motivos_ausencia',
  label: 'Motivos de Ausencia',
  labelSingular: 'Motivo',
  icon: '🤒',
  group: 'Sistema',
  ayudaPermiso:
    'Los motivos que se ofrecen al justificar una ausencia, y cuáles exigen explicación. Mismo ' +
    'caso que los tipos de actividad.',
  order: 76,
  display: '{nombre}',
  searchFields: ['nombre', 'notas'],
  listFields: ['nombre', 'pide_detalle', 'activo', 'notas'],
  filterFields: ['activo', 'pide_detalle'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'nombre', label: 'Nombre del motivo', type: 'text', required: true, unique: true,
      help: 'Como se verá al justificar una ausencia. Ej: «Trabajo», «Enfermedad».',
    },
    {
      name: 'pide_detalle', label: 'Pide explicación', type: 'boolean', default: 0,
      help: 'Marcado, al elegir este motivo se exige escribir el detalle. Conviene para los motivos vagos: ' +
        '«Otro motivo» sin explicación no dice nada cuando alguien lo lee meses después.',
    },
    {
      name: 'activo', label: 'En uso', type: 'boolean', default: 1,
      help: 'Al desmarcarlo deja de ofrecerse al justificar. Las marcas que ya lo tienen no se tocan.',
    },
    { name: 'notas', label: 'Para qué es', type: 'text', help: 'Opcional: qué entra en este motivo.' },
  ],
  hooks: {
    /**
     * UN MOTIVO QUE YA SE USÓ SE RENOMBRA, Y SE LLEVA SUS MARCAS CONSIGO.
     *
     * El módulo frenaba el BORRADO de un motivo en uso con el argumento
     * correcto —dejaría esas marcas «sin motivo»— y dejaba el RENOMBRADO
     * abierto, sin cartel, haciendo exactamente el mismo daño: las marcas
     * guardan el NOMBRE, así que seguían diciendo el viejo.
     *
     * MEDIDO en la v1.362.0, con «Trabajo» en una marca: renombrarlo a «Trabajo
     * o estudio» contestó 200 sin una palabra; la marca siguió diciendo
     * «Trabajo», que a partir de ese momento ya no se ofrecía en ninguna parte.
     *
     * Es el mismo hallazgo que en Tipos de Actividad (TA-04) y en Categorías de
     * Tesorería (CT-03), y se resuelve igual y por la misma razón: lo que cambia
     * es la ETIQUETA de una ausencia, no la ausencia. La fecha, la persona, el
     * cuerpo, el estado y la explicación escrita quedan intactos. El motivo es
     * el nombre de una razón, y la razón no cambió.
     */
    beforeSave(data, { db, isNew, existing, confirmado }) {
      if (isNew || !existing || data.nombre === undefined) return null;

      const seLlamaba = String(existing.nombre || '');
      const seVaALlamar = String(data.nombre || '');
      if (seLlamaba.trim().toLowerCase() === seVaALlamar.trim().toLowerCase()) return null;

      const usos = db
        .prepare('SELECT COUNT(*) AS c FROM asistencia_detalle WHERE lower(motivo) = lower(?)')
        .get(seLlamaba).c;
      if (!usos || confirmado) return null;

      const cuantas = `${usos.toLocaleString('es-CL')} marca(s) de asistencia`;
      return {
        error: `«${seLlamaba}» está en ${cuantas}.`,
        confirmar:
          `«${seLlamaba}» está en ${cuantas}. Al cambiarle el nombre a «${seVaALlamar}», esas `
          + 'marcas pasan a quedar justificadas con el nombre nuevo, para que el informe de '
          + 'asistencia por motivo siga cuadrando en una sola línea en vez de partirse en dos. '
          + 'De cada marca no se toca nada más: la fecha, la persona, el cuerpo, el estado y la '
          + 'explicación escrita quedan igual. ¿Le cambio el nombre?',
      };
    },

    /**
     * El nombre nuevo se lleva las marcas.
     *
     * Va acá y no en `beforeSave` porque tiene que ocurrir DESPUÉS de que el
     * motivo quede guardado, y dentro de la misma transacción del motor: si
     * esto fallara a mitad de camino, el motivo tampoco se guarda y todo queda
     * como estaba.
     *
     * Se compara sin distinguir mayúsculas para alcanzar también lo que se
     * anotó antes de la v1.363.0, cuando el guardado todavía no dejaba el
     * motivo escrito como está en la lista.
     */
    afterSave(row, { db, isNew, existing, user }) {
      if (isNew || !existing) return;
      const seLlamaba = String(existing.nombre || '');
      const seLlama = String(row.nombre || '');
      if (!seLlamaba || seLlamaba === seLlama) return;

      const movidas = db
        .prepare('UPDATE asistencia_detalle SET motivo = ? WHERE lower(motivo) = lower(?)')
        .run(seLlama, seLlamaba).changes;
      if (!movidas) return;

      /*
       * Y queda dicho cuántas se movieron. El motor anota solo el cambio de la
       * ficha —«Nombre del motivo: X → Y»—, que no dice lo que de verdad pasó
       * con los informes de asistencia. Esta línea sí.
       */
      require('../bitacora').anotarCambio({
        def: module.exports,
        accion: 'Cambio',
        fila: row,
        usuario: user,
        detalle: `Al cambiar el nombre, ${movidas.toLocaleString('es-CL')} marca(s) de asistencia `
          + `pasaron de «${seLlamaba}» a «${seLlama}»`,
      });
    },

    beforeDelete(row, { db }) {
      const usos = db.prepare('SELECT COUNT(*) AS c FROM asistencia_detalle WHERE motivo = ?').get(row.nombre).c;
      if (usos) {
        return (
          `«${row.nombre}» está en ${usos.toLocaleString('es-CL')} marca(s) de asistencia, así que no se puede ` +
          'borrar sin dejarlas sin motivo. Desmárquelo en «En uso» y dejará de ofrecerse, sin tocar las que ya están.'
        );
      }
      return null;
    },
  },
  extraRoutes(router, { db, requirePerm }) {
    /** Los motivos que se pueden elegir hoy, y cuáles piden explicación. */
    router.get('/motivos_ausencia/opciones', requirePerm('asistencia_detalle', 'view'), (req, res) => {
      res.json(
        db.prepare('SELECT nombre, pide_detalle FROM motivos_ausencia WHERE activo = 1 ORDER BY nombre').all()
          .map((m) => ({ id: m.nombre, label: m.nombre, pide_detalle: !!m.pide_detalle }))
      );
    });
  },
};
