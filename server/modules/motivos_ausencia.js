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
