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

      /*
       * ESTO EVALÚA UN PERÍODO DE PRUEBA, ASÍ QUE HACE FALTA QUE HAYA UNO.
       *
       * La pantalla ya lo sabe: el botón «📋 Evaluar» de la lista del cuerpo
       * aparece SOLO cuando el estado del integrante es «En prueba». Acá no se
       * comprobaba nada, y lo que la pantalla no ofrece el servidor lo tiene
       * que rechazar de todas maneras —está escrito así en el gancho de
       * server/modules/integrantes_cuerpo.js, para la regla de al lado—.
       *
       * Medido en la v1.399.0, aprobando por la API a quien no está en prueba:
       *
       *   a quien ya es integrante oficial ...  201, y le reescribe la fecha
       *                                         de oficial: de 15-01-2020 pasó
       *                                         a 25-05-2026
       *   a quien ya se retiró ..............  201, y vuelve a «Activo»
       *                                         conservando su fecha de retiro
       *                                         del 30-06-2025
       *
       * Las dos dejan la ficha diciendo dos cosas a la vez, y la primera borra
       * el historial de alguien sin avisar: basta evaluar a la persona
       * equivocada de una lista larga.
       *
       * Se mira SOLO al anotar una evaluación nueva. Corregirle a una ya
       * anotada el informe, la fecha o el nombre de quien evaluó tiene que
       * seguir siendo posible: para entonces la ficha ya se movió, y exigirle
       * «En prueba» dejaría sin arreglar justamente lo que se anotó mal. Es la
       * misma línea que separa el alta de la corrección en todo el sistema.
       */
      if (!existing) {
        if (ficha.estado !== 'En prueba') {
          const quien = ficha.persona || 'Esa persona';
          const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);
          const donde = cuerpo ? `«${cuerpo.nombre}»` : 'ese cuerpo';
          const comoSeLee = require('../fechas').comoSeLee;
          if (ficha.estado === 'Retirado') {
            return `${quien} ya no pertenece a ${donde}: se retiró`
              + `${ficha.fecha_retiro ? ` el ${comoSeLee(ficha.fecha_retiro)}` : ''}. `
              + 'La evaluación es del período de prueba, así que no hay ninguno que evaluar. '
              + 'Si volvió, ábrale su ficha de integrante y póngala «En prueba»: desde ahí se la '
              + 'puede evaluar cuando le toque.';
          }
          return `${quien} ya es integrante oficial de ${donde}`
            + `${ficha.fecha_oficial ? `, desde el ${comoSeLee(ficha.fecha_oficial)}` : ''}. `
            + 'La evaluación es del período de prueba, así que no hay ninguno que evaluar. '
            + 'Si tiene que dejar de serlo, cámbiele el estado en su ficha de integrante.';
        }

        /*
         * Ni de un cuerpo que dejó de funcionar (ver server/cuerpo-inactivo.js).
         * La regla general del motor no llega hasta acá por lo mismo que no
         * llega a las cuotas: `cuerpo_id` no se elige, se copia de la ficha del
         * integrante, y por eso es una columna y no una referencia. Medido: a
         * ese mismo cuerpo no se le puede meter un integrante nuevo —lo dice
         * con todas sus letras— y sí se le podía evaluar uno.
         */
        const cerrado = require('../cuerpo-inactivo')
          .avisoSiEstaInactivo(db, ficha.cuerpo_id, 'evaluar períodos de prueba');
        if (cerrado) return cerrado;
      }
      return null;
    },

    /**
     * BORRAR EL ACTA DE LA DECISIÓN NO DESHACE LA DECISIÓN.
     *
     * Una evaluación no es una anotación cualquiera: es lo que MOVIÓ la ficha
     * del integrante. Borrarla no la devuelve —ni debería, porque la persona
     * pasó a oficial o salió del cuerpo de verdad— así que lo que queda es un
     * estado sin nada que lo explique.
     *
     * Medido en la v1.399.0: se aprueba una evaluación, la ficha queda «Activo»
     * con su fecha de oficial, se borra la evaluación, contesta 200 sin
     * preguntar, y la ficha sigue igual. La persona es integrante oficial y ya
     * no existe ningún papel que diga por qué.
     *
     * Se PREGUNTA y no se prohíbe, por lo mismo que en las actas: una anotada
     * por error —la persona equivocada, el cuerpo equivocado— tiene que poder
     * sacarse. Lo que hace falta es que quien la borre sepa las dos cosas que
     * no son evidentes: que el estado se queda como está, y por dónde se
     * cambia si eso no era lo que quería.
     */
    beforeDelete(fila, { db, confirmado }) {
      if (confirmado) return null;
      const { comoSeLee } = require('../fechas');
      const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(fila.integrante_id);
      const quien = (ficha && ficha.persona) || 'esa persona';
      const queDijo = fila.resultado || 'lo que decía';
      const enQue = ficha
        ? `sigue «${ficha.estado}»${ficha.estado === 'Activo' && ficha.fecha_oficial
            ? `, integrante oficial desde el ${comoSeLee(ficha.fecha_oficial)}` : ''}`
        : 'no cambia';
      return {
        error: `Esta evaluación del ${comoSeLee(fila.fecha)} es la que dejó a ${quien} como está: `
          + `«${queDijo}». Borrarla NO deshace eso —su ficha ${enQue}— y después no quedará `
          + 'ningún registro de por qué. Si lo que hay que cambiar es su estado, hágalo en su '
          + 'ficha de integrante; si la evaluación se anotó mal, corríjala en vez de borrarla.',
        confirmar: 'evaluacion_que_se_borra',
      };
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

      /*
       * LA QUE MANDA ES LA ÚLTIMA QUE OCURRIÓ, NO LA ÚLTIMA QUE SE ESCRIBIÓ.
       *
       * Este gancho movía la ficha con LO QUE SE ACABA DE GUARDAR, sin mirar si
       * había otra evaluación posterior. Medido en la v1.399.0, sobre alguien
       * aprobado el 20-05-2026:
       *
       *   se anota después una evaluación del 01-04-2026 que la retira
       *   → 201, y la ficha queda:
       *        estado  = Retirado
       *        retiro  = 01-04-2026
       *        oficial = 20-05-2026   ← de la aprobación que quedó deshecha
       *
       * O sea que anotar tarde una evaluación vieja deshacía una decisión
       * posterior, y dejaba la ficha contradiciéndose sola. Lo mismo al
       * corregirle el resultado a una ya guardada.
       *
       * Ahora, después de guardar, la ficha se rehace con LA ÚLTIMA evaluación
       * de esa persona en ese cuerpo, que es como se lee un historial: por
       * fecha, y a igual fecha la que se anotó después —el id—, porque dos
       * evaluaciones del mismo día solo se pueden ordenar por cuándo se
       * escribieron.
       *
       * Se rehace SIEMPRE, incluso cuando la que manda es la que se acaba de
       * guardar: así hay un solo camino, y borrar la última —que también deja
       * a otra al mando— entra por él sin escribirlo dos veces.
       */
      const manda = db.prepare(
        `SELECT * FROM evaluaciones_integrantes
          WHERE integrante_id = ?
          ORDER BY fecha DESC, id DESC
          LIMIT 1`
      ).get(fila.integrante_id) || fila;

      /*
       * La bitácora, en cambio, anota EL HECHO y no el estado que quedó: que a
       * alguien se le anotara tarde una evaluación vieja es algo que pasó, y su
       * libro tiene que decirlo. Por eso sigue mirando la fila que se guardó.
       */
      const anotar = (estado, hasta) => {
        if (!esUnHechoNuevo) return;
        bitacora.anotarPasoDeIntegrante(ficha.id, { estado, hasta, fecha: fila.fecha, usuario: user });
      };

      if (manda.resultado === 'Aprobado') {
        db.prepare(
          `UPDATE integrantes_cuerpo
              SET estado = 'Activo', fecha_oficial = ?, fecha_fin_prueba = NULL,
                  updated_at = datetime('now','localtime')
            WHERE id = ?`
        ).run(manda.fecha, ficha.id);
        anotar('Activo');
        return;
      }

      if (manda.resultado === 'Retirado del cuerpo') {
        db.prepare(
          `UPDATE integrantes_cuerpo
              SET estado = 'Retirado', fecha_retiro = ?,
                  motivo_retiro = COALESCE(motivo_retiro, 'No aprobó su período de prueba'),
                  updated_at = datetime('now','localtime')
            WHERE id = ?`
        ).run(manda.fecha, ficha.id);
        // Después del UPDATE, para que el motivo que se anota sea el que quedó
        anotar('Retirado');
        return;
      }

      // No aprobado: sigue en prueba, con el plazo corriendo desde hoy
      const meses = Number(manda.meses_extension) > 0
        ? Number(manda.meses_extension)
        : null;
      const nuevoPlazo = meses
        ? sumarMeses(manda.fecha, meses)
        : require('../integrantes').finDelPeriodoDePrueba(db, ficha.cuerpo_id, manda.fecha);
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
