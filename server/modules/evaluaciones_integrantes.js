/**
 * Módulo: Evaluaciones del período de prueba.
 *
 * Quien entra a un cuerpo lo hace en período de prueba. Antes de que se le
 * cumpla el plazo, la directiva revisa su informe y decide:
 *
 *   Aprobado        pasa a ser integrante oficial del cuerpo
 *   No aprobado     se le extiende el período de prueba, con un plazo nuevo
 *   Retirado        no continúa en el cuerpo
 *
 * Cada evaluación queda registrada con su fecha, quién decidió y el informe
 * —adjunto como documento o escrito acá mismo—, de modo que el recorrido de
 * cada integrante se pueda leer completo años después.
 *
 * La evaluación es la que mueve el estado de la ficha del integrante: no hay
 * que cambiarlo a mano ni acordarse de hacerlo.
 */
const RESULTADOS = ['Aprobado', 'No aprobado (se extiende la prueba)', 'Retirado del cuerpo'];

/** Suma meses a una fecha, para el plazo nuevo de una prueba que se extiende. */
function sumarMeses(desde, meses) {
  if (!desde || !meses) return null;
  const [a, m, d] = String(desde).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(Date.UTC(a, m - 1 + Number(meses), d)).toISOString().slice(0, 10);
}

module.exports = {
  name: 'evaluaciones_integrantes',
  label: 'Evaluaciones de Integrantes',
  labelSingular: 'Evaluación',
  icon: '📋',
  group: 'Organización',
  order: 59,
  menu: false,
  display: '{fecha} — {resultado}',
  dateField: 'fecha',
  printable: true,
  searchFields: ['informe', 'observaciones', 'evaluado_por'],
  listFields: ['fecha', 'integrante_id', 'resultado', 'evaluado_por'],
  filterFields: ['integrante_id', 'resultado'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  fields: [
    {
      name: 'integrante_id', label: 'Integrante', type: 'ref', ref: 'integrantes_cuerpo', required: true,
      seccion: 'Qué se evalúa',
    },
    { name: 'fecha', label: 'Fecha de la evaluación', type: 'date', required: true },
    {
      name: 'resultado', label: 'Resultado', type: 'select', required: true, default: 'Aprobado',
      options: RESULTADOS,
      help: 'Aprobado: pasa a integrante oficial. No aprobado: sigue en prueba, con un plazo nuevo.',
    },
    {
      name: 'meses_extension', label: 'Meses que se extiende la prueba', type: 'number',
      showIf: { field: 'resultado', equals: 'No aprobado (se extiende la prueba)' },
      help: 'Cuánto más dura su prueba, contado desde esta evaluación. En blanco, se repiten los meses del cuerpo.',
    },
    { name: 'evaluado_por', label: 'Evaluado por', type: 'text', seccion: 'El informe',
      help: 'Quién o qué instancia lo evaluó: la directiva, el oficial supervisor, una comisión…' },
    {
      name: 'informe', label: 'Informe', type: 'richtext',
      help: 'El informe escrito acá mismo. Se puede dejar en blanco si se adjunta el documento.',
    },
    { name: 'documento', label: 'Informe adjunto (documento)', type: 'file' },
    { name: 'observaciones', label: 'Observaciones', type: 'textarea', seccion: 'Notas' },
    // Se toman del integrante, para los permisos y para poder filtrar
    { name: 'cuerpo_id', type: 'number', oculto: true, readonly: true },
    { name: 'iglesia_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing, db }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(dato('integrante_id'));
      if (!ficha) return 'No encuentro la ficha del integrante que se está evaluando.';
      data.cuerpo_id = ficha.cuerpo_id;
      data.iglesia_id = ficha.iglesia_id;
      if (dato('resultado') !== 'No aprobado (se extiende la prueba)') data.meses_extension = null;
      return null;
    },

    /**
     * La evaluación mueve la ficha del integrante: aprobado pasa a oficial,
     * no aprobado sigue en prueba con un plazo nuevo, y retirado sale.
     *
     * Y lo deja escrito en la bitácora de la persona. Hay que anotarlo desde
     * acá: la ficha se mueve con un UPDATE directo —tiene que ser directo,
     * porque escribe campos de solo lectura—, y por ese camino el motor no se
     * entera. Medido antes: aprobar la evaluación dejaba la ficha en Activo con
     * su fecha y la bitácora de la persona sin una sola línea, siendo la
     * decisión más importante que se toma sobre alguien en un cuerpo.
     *
     * Se anota cuando la evaluación es nueva o cuando cambia su resultado, que
     * es cuando ocurre el hecho. Corregirle el informe o el nombre de quien
     * evaluó no vuelve a anotarlo: no pasó nada nuevo.
     */
    afterSave(fila, { db, user, isNew, existing }) {
      const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(fila.integrante_id);
      if (!ficha) return;
      const bitacora = require('../bitacora');
      const esUnHechoNuevo = isNew || !existing || existing.resultado !== fila.resultado;
      const anotar = (estado, hasta) => {
        if (!esUnHechoNuevo) return;
        bitacora.anotarPasoDeIntegrante(ficha.id, { estado, hasta, fecha: fila.fecha, usuario: user });
      };

      if (fila.resultado === 'Aprobado') {
        db.prepare(
          `UPDATE integrantes_cuerpo
              SET estado = 'Activo', fecha_oficial = ?, fecha_fin_prueba = NULL,
                  updated_at = datetime('now','localtime')
            WHERE id = ?`
        ).run(fila.fecha, ficha.id);
        anotar('Activo');
        return;
      }

      if (fila.resultado === 'Retirado del cuerpo') {
        db.prepare(
          `UPDATE integrantes_cuerpo
              SET estado = 'Retirado', fecha_retiro = ?,
                  motivo_retiro = COALESCE(motivo_retiro, 'No aprobó su período de prueba'),
                  updated_at = datetime('now','localtime')
            WHERE id = ?`
        ).run(fila.fecha, ficha.id);
        // Después del UPDATE, para que el motivo que se anota sea el que quedó
        anotar('Retirado');
        return;
      }

      // No aprobado: sigue en prueba, con el plazo corriendo desde hoy
      const meses = Number(fila.meses_extension) > 0
        ? Number(fila.meses_extension)
        : null;
      const nuevoPlazo = meses
        ? sumarMeses(fila.fecha, meses)
        : require('../integrantes').finDelPeriodoDePrueba(db, ficha.cuerpo_id, fila.fecha);
      db.prepare(
        `UPDATE integrantes_cuerpo
            SET estado = 'En prueba', fecha_fin_prueba = ?, fecha_oficial = NULL,
                updated_at = datetime('now','localtime')
          WHERE id = ?`
      ).run(nuevoPlazo, ficha.id);
      anotar('En prueba', nuevoPlazo);
    },
  },
};
