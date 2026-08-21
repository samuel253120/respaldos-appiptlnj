/**
 * Módulo 12 · Documentos de los miembros.
 *
 * El sistema anterior guardaba los documentos dentro de la ficha de cada
 * persona: 145 fichas de registro escaneadas en PDF. Acá cada documento es un
 * registro propio —con su nombre, su tipo y su fecha—, colgado de la ficha de
 * su dueño.
 *
 * Los archivos en sí no venían en la exportación: se crea el registro con
 * todos sus datos y la ruta del archivo queda anotada en la lista de
 * pendientes, para reconectarla en cuanto llegue la carpeta.
 */
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');

/** De qué tipo es cada documento, dicho como lo dice este sistema. */
const TIPO = {
  ficha_registro: 'Ficha de registro de miembro',
  ficha_actualizacion: 'Ficha de actualización de registro',
  carnet: 'Carnet de identidad',
  bautismo: 'Certificado de bautismo',
  matrimonio: 'Certificado de matrimonio',
  nacimiento: 'Certificado de nacimiento',
  traslado: 'Carta de traslado',
};

/** "40_LUIS_ESPINAZA.pdf" → "40 LUIS ESPINAZA" */
const nombreLegible = (a) => texto(a.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();

module.exports = function importarDocumentos(origen, { lote, prueba, iglesiaId }) {
  const conDocumentos = (origen.members || []).filter((m) => (m.attachments || []).length);
  const filas = conDocumentos.flatMap((m) => (m.attachments || []).map((a) => ({ ...a, _miembro: m.id })));

  return importarModulo({ nombre: 'documentos', filas, lote, prueba }, (ayuda) => {
    let creados = 0, actualizados = 0, pendientes = 0;
    const porTipo = {};

    filas.forEach((a, i) => {
      const miembroId = equivalencias.resolver('members', a._miembro);
      if (!miembroId) {
        ayuda.problema(i, `documento de alguien que no está en Miembros (${a._miembro})`, a);
        return;
      }
      const tipo = TIPO[a.category] || 'Otro';
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;

      const datos = {
        miembro_id: miembroId,
        tipo,
        nombre: nombreLegible(a) || tipo,
        fecha: fecha(a.uploadedAt),
        iglesia_id: iglesiaId,
        observaciones: 'Documento del sistema anterior. El archivo se adjunta cuando llegue la carpeta de respaldos.',
        created_at: marcaDeTiempo(a.uploadedAt),
      };

      const { id, nueva } = guardar({
        moduloOrigen: 'memberAttachments', idOrigen: a.id, tabla: 'documentos_miembros', datos, lote,
      });
      nueva ? creados++ : actualizados++;

      if (a.storagePath) {
        equivalencias.archivoPendiente({
          moduloDestino: 'documentos_miembros', idDestino: id, campo: 'archivo',
          ruta: a.storagePath, nombre: a.name, tipo: a.type, tamano: a.size, lote,
        });
        pendientes++;
      }
    });

    return {
      miembros_con_documentos: conDocumentos.length,
      creados, actualizados, archivos_pendientes: pendientes,
      por_tipo: Object.entries(porTipo).map(([t, n]) => `${t}: ${n}`).join(', '),
    };
  });
};
