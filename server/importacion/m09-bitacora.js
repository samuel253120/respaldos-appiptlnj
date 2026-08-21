/**
 * Módulo 9 · Bitácora de miembros.
 *
 * El sistema anterior llevaba dos historiales: la línea de tiempo de cada
 * persona (250 anotaciones) y el registro de gestiones (100). Acá los dos son
 * lo mismo —la bitácora del miembro—, así que se juntan en orden de fecha.
 *
 * El título y el texto venían separados; se guardan juntos, con el título
 * primero, salvo cuando el texto ya lo repite.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');

/** De qué tipo es cada anotación, dicho como lo dice este sistema. */
const TIPO = {
  note: 'Anotación',
  group_join: 'Ingreso a cuerpo',
  group_leave: 'Salida de cuerpo',
  management: 'Cambio de datos',
  social_aid: 'Ayuda social',
  document: 'Documento',
  request: 'Solicitud',
  discipline: 'Disciplina',
  baptism: 'Bautismo',
  status: 'Cambio de estado',
};

module.exports = function importarBitacora(origen, { lote, prueba, iglesiaId }) {
  const linea = (origen.timeline || []).map((x) => ({ ...x, _tabla: 'timeline' }));
  const gestiones = (origen.memberLogs || []).map((x) => ({ ...x, _tabla: 'memberLogs' }));
  const filas = [...linea, ...gestiones];

  return importarModulo({ nombre: 'bitacora', filas, lote, prueba }, (ayuda) => {
    let creadas = 0, actualizadas = 0;
    const porTipo = {};

    // Quién registró cada cosa, cuando el origen lo dice
    const nombreDelUsuario = (idOrigen) => {
      if (!idOrigen) return null;
      const id = equivalencias.resolver('users', idOrigen);
      if (!id) return null;
      const u = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(id);
      return u ? u.nombre : null;
    };

    filas.forEach((b, i) => {
      const miembroId = equivalencias.resolver('members', b.memberId);
      if (!miembroId) {
        ayuda.problema(i, `anotación de alguien que no está en Miembros (${b.memberId})`, b);
        return;
      }
      const tipo = TIPO[b.type] || 'Anotación';
      const titulo = texto(b.title);
      const cuerpo = texto(b.description);
      const descripcion = titulo && cuerpo
        ? (cuerpo.includes(titulo) ? cuerpo : `${titulo}. ${cuerpo}`)
        : titulo || cuerpo;
      if (!ayuda.exigir(descripcion, 'anotación sin texto', i, b)) return;

      const datos = {
        miembro_id: miembroId,
        fecha: fecha(b.date) || fecha(b._created_at || b.createdAt) || fecha(b._updated_at),
        tipo,
        descripcion,
        iglesia_id: iglesiaId,
        origen: 'Automático',
        registrado_por: nombreDelUsuario(b._created_by || b.createdBy) || 'Sistema anterior',
        created_at: marcaDeTiempo(b._created_at || b.createdAt),
        updated_at: marcaDeTiempo(b._updated_at || b.updatedAt),
      };
      if (!ayuda.exigir(datos.fecha, 'anotación sin fecha', i, b)) return;

      const { nueva } = guardar({
        moduloOrigen: b._tabla, idOrigen: b.id, tabla: 'bitacora', datos, lote,
      });
      nueva ? creadas++ : actualizadas++;
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    });

    return {
      linea_de_tiempo: linea.length, gestiones: gestiones.length,
      creadas, actualizadas,
      por_tipo: Object.entries(porTipo).map(([t, n]) => `${t}: ${n}`).join(', '),
    };
  });
};
