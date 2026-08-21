/**
 * Módulo 11 · Actas de reunión de cuerpo.
 *
 * El sistema anterior guardaba un acta de reunión de cuerpo. El texto venía
 * con marcas de HTML —era un editor con formato—, así que se pasa a texto
 * simple respetando los saltos de línea y las viñetas.
 *
 * El acta no traía número; se le pone uno con su fecha, que es lo que la
 * identifica, y queda editable.
 */
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');

/** El texto con formato del origen, pasado a texto simple. */
function aTextoSimple(html) {
  const t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t || null;
}

module.exports = function importarActas(origen, { lote, prueba, iglesiaId }) {
  const filas = origen.bodyMinutes || [];

  return importarModulo({ nombre: 'actas', filas, lote, prueba }, (ayuda) => {
    let creadas = 0, actualizadas = 0;

    filas.forEach((a, i) => {
      if (!ayuda.exigir(a.date, 'acta sin fecha', i, a)) return;
      const cuerpoId = equivalencias.resolver('groups', a.groupId);
      if (!cuerpoId) {
        ayuda.problema(i, `acta de un cuerpo que no está importado (${a.groupId})`, a);
        return;
      }

      const asistentes = (a.attendees || [])
        .map((x) => equivalencias.resolver('members', typeof x === 'string' ? x : x && x.id))
        .filter(Boolean);

      const datos = {
        numero_acta: `S/N ${fecha(a.date)}`,
        fecha: fecha(a.date),
        iglesia_id: iglesiaId,
        cuerpo_id: cuerpoId,
        desarrollo: [texto(a.title), aTextoSimple(a.content)].filter(Boolean).join('\n\n'),
        asistentes: JSON.stringify(asistentes),
        estado: 'Borrador',
        created_at: marcaDeTiempo(a._created_at || a.createdAt),
        updated_at: marcaDeTiempo(a._updated_at || a.updatedAt),
      };

      const { nueva } = guardar({
        moduloOrigen: 'bodyMinutes', idOrigen: a.id, tabla: 'actas_reuniones', datos, lote,
      });
      nueva ? creadas++ : actualizadas++;
    });

    return { creadas, actualizadas };
  });
};
