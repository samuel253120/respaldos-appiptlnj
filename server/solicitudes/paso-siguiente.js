/**
 * Lo que viene DESPUÉS de aprobar una solicitud.
 *
 * De los nueve tipos de solicitud, solo uno se conectaba con lo que produce:
 * aprobar una de «Ayuda social» registra la ayuda sola, y está bien resuelto.
 * Aprobar una de «Certificado» o de «Credencial» no proponía emitir nada, y una
 * de «Traslado de membresía» no tocaba el traslado: había que acordarse e ir a
 * hacerlo a otro módulo, copiando a mano lo que ya estaba escrito. La mitad del
 * camino estaba construida.
 *
 * ── POR QUÉ SE OFRECE Y NO SE HACE SOLO ──
 *
 * La ayuda social se crea sola porque aprobar la solicitud ES conceder la
 * ayuda: son el mismo acto dicho dos veces. Emitir un certificado no: es un
 * documento que se firma y se entrega, con su número, su fecha y su oficiante,
 * y decidirlo es de una persona. Una credencial, menos todavía. Y un traslado
 * de membresía cambia el estado de alguien en el registro oficial.
 *
 * Así que acá no se crea nada: se ofrece el paso siguiente con lo que la
 * solicitud ya sabe —el titular, la iglesia, la fecha—, para que quien lo tome
 * no vuelva a escribirlo. Lo que se emita queda enlazado a la solicitud, y en
 * su seguimiento queda dicho qué salió de ella.
 */

/** Los tipos que llevan a algún lado, y adónde. */
const PASOS = {
  Certificado: {
    modulo: 'certificados',
    label: 'Emitir el certificado',
    icono: '📜',
    que: 'un certificado',
    /*
     * Lo que la solicitud ya sabe. El tipo de certificado NO se propone: la
     * solicitud dice «Certificado» y nada más, y adivinar cuál —de bautismo,
     * de membresía, de matrimonio— sería inventar el contenido de un papel que
     * se firma.
     */
    precarga(fila) {
      const suyo = { iglesia_id: fila.iglesia_id, nombre_titular: fila.solicitante || '' };
      if (fila.solicitante_tipo === 'Miembro' && fila.miembro_id) suyo.miembro_id = fila.miembro_id;
      return suyo;
    },
  },
  Credencial: {
    modulo: 'credenciales',
    label: 'Emitir la credencial',
    icono: '🪪',
    que: 'una credencial',
    /*
     * Una credencial es de un pastor o guía, no de cualquiera. Si quien la pide
     * es un miembro que además tiene ficha de pastor, se propone esa; si no, se
     * deja en blanco y se elige a mano, que es lo correcto: la credencial la
     * lleva quien la lleva, no quien tramitó el papel.
     */
    precarga(fila, db) {
      const suyo = { iglesia_id: fila.iglesia_id };
      if (fila.solicitante_tipo === 'Miembro' && fila.miembro_id) {
        try {
          const p = db.prepare('SELECT id FROM pastores WHERE miembro_id = ?').get(fila.miembro_id);
          if (p) suyo.pastor_id = p.id;
        } catch (e) { /* sin ficha de pastor, se elige a mano */ }
      }
      return suyo;
    },
  },
  'Traslado de membresía': {
    /*
     * Acá no se crea nada: un traslado es un cambio de estado en la ficha del
     * miembro, en el registro oficial. Lo que se ofrece es llegar a esa ficha
     * sin tener que buscarla.
     */
    modulo: 'miembros',
    label: 'Abrir la ficha del miembro',
    icono: '🧍',
    que: 'el traslado en su ficha',
    abreLaFicha: true,
    aplica: (fila) => fila.solicitante_tipo === 'Miembro' && !!fila.miembro_id,
    precarga: (fila) => ({ id: fila.miembro_id }),
  },
  'Ayuda social': {
    /*
     * Este ya estaba, y se hace solo (ver server/solicitud-ayuda.js). Figura
     * acá para que la ficha lo diga igual: si la ayuda ya nació, el enlace
     * lleva a ella; si no —porque la solicitud todavía no se aprueba—, se
     * explica que va a nacer sola.
     */
    modulo: 'ayudas_sociales',
    label: 'Ver la ayuda registrada',
    icono: '🤝',
    que: 'la ayuda social',
    solo: true,
    campoEnlace: 'ayuda_social_id',
  },
};

/** Dónde guarda cada módulo de destino el enlace de vuelta a la solicitud. */
const ENLACE_DE_VUELTA = { certificados: 'solicitud_id', credenciales: 'solicitud_id' };

/** Cómo se nombra lo que salió, para decirlo en el seguimiento y en la ficha. */
function comoSeLlama(modulo, fila) {
  if (!fila) return '';
  if (modulo === 'credenciales') return fila.serie || `#${fila.id}`;
  return fila.numero || fila.nombre || `#${fila.id}`;
}

/**
 * Qué paso sigue para esta solicitud, y si ya se dio.
 *
 * Devuelve null cuando el tipo no lleva a ninguna parte —«Permiso / Licencia»,
 * «Uso de instalaciones»— o cuando todavía no está aprobada: ofrecer emitir un
 * certificado de algo que aún se está revisando invita a emitirlo antes de
 * tiempo.
 */
function deLaSolicitud(db, fila, { CONCEDIDA }) {
  if (!fila) return null;
  const paso = PASOS[fila.tipo];
  if (!paso) return null;
  if (paso.aplica && !paso.aplica(fila)) return null;

  const concedida = CONCEDIDA.includes(fila.estado);

  // ¿Ya se dio? Por el enlace que guarda la propia solicitud, o por el que
  // guarda lo que se emitió
  let hecho = null;
  if (paso.campoEnlace && fila[paso.campoEnlace]) {
    hecho = { id: fila[paso.campoEnlace] };
    try {
      const suyo = db.prepare(`SELECT * FROM "${paso.modulo}" WHERE id = ?`).get(fila[paso.campoEnlace]);
      if (suyo) hecho = { id: suyo.id, nombre: comoSeLlama(paso.modulo, suyo) };
    } catch (e) { /* la ficha pudo borrarse a mano; el enlace igual se muestra */ }
  } else if (ENLACE_DE_VUELTA[paso.modulo]) {
    try {
      const suyo = db
        .prepare(`SELECT * FROM "${paso.modulo}" WHERE "${ENLACE_DE_VUELTA[paso.modulo]}" = ? ORDER BY id LIMIT 1`)
        .get(fila.id);
      if (suyo) hecho = { id: suyo.id, nombre: comoSeLlama(paso.modulo, suyo) };
    } catch (e) { /* módulo sin la columna todavía */ }
  }

  return {
    tipo: fila.tipo,
    modulo: paso.modulo,
    label: paso.label,
    icono: paso.icono,
    que: paso.que,
    automatico: !!paso.solo,
    abreLaFicha: !!paso.abreLaFicha,
    concedida,
    hecho,
    precarga: concedida && !hecho && !paso.solo ? paso.precarga(fila, db) : null,
  };
}

/**
 * Anota en el seguimiento de la solicitud lo que salió de ella.
 *
 * Que un certificado haya nacido de una solicitud no puede ser invisible: es
 * la mitad de la respuesta que se le dio a quien pidió. Se anota desde el
 * módulo que lo emitió, con la misma conexión, para que las dos cosas entren o
 * no entren juntas.
 */
function anotarQueSalio(db, solicitudId, modulo, fila, user) {
  if (!solicitudId) return;
  try {
    const seguimiento = require('./seguimiento');
    const comoSeDice = { certificados: 'Se emitió el certificado', credenciales: 'Se emitió la credencial' };
    seguimiento.anotar(db, solicitudId, {
      tipo: 'Gestión',
      descripcion: `${comoSeDice[modulo] || 'Se registró'} ${comoSeLlama(modulo, fila)} a partir de esta solicitud.`,
      user,
    });
  } catch (e) {
    console.error(`⚠️  No se pudo anotar en la solicitud ${solicitudId}: ${e.message}`);
  }
}

module.exports = { PASOS, ENLACE_DE_VUELTA, deLaSolicitud, anotarQueSalio, comoSeLlama };
