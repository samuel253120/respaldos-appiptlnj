/**
 * La ayuda social que nace de una solicitud aprobada.
 *
 * Una ayuda social casi siempre empieza como una solicitud: alguien la pide,
 * queda a cargo de una persona, se resuelve. Hasta ahora, aprobarla y después
 * registrar la ayuda eran dos trabajos separados, y el segundo consistía en
 * copiar a mano lo que ya estaba escrito en el primero. Eso se olvida, y
 * cuando no se olvida se copia distinto: el listado de ayudas terminaba sin
 * la mitad de lo que la iglesia entregó.
 *
 * Ahora, cuando una solicitud de tipo «Ayuda social» pasa a Aprobada o a
 * Completada, la ficha en Ayudas Sociales se crea sola, con lo que dice la
 * solicitud, y las dos quedan enlazadas.
 *
 * ── TRES DECISIONES QUE VALE LA PENA EXPLICAR ──
 *
 * SE CREA UNA SOLA VEZ. La solicitud guarda el número de la ayuda que generó.
 * Sin eso, cada vez que alguien corrigiera una coma en una solicitud ya
 * aprobada nacería otra ayuda idéntica, y el registro de lo entregado —que es
 * lo que se rinde— quedaría inflado sin que nadie entienda por qué.
 *
 * NO SE BORRA NUNCA SOLA. Si después la solicitud se corrige a Rechazada, la
 * ayuda queda donde está. Es la diferencia entre esto y los movimientos que
 * genera una ofrenda: aquellos son un cálculo, y este es la constancia de algo
 * que se entregó. Si de verdad no se entregó, alguien tiene que ir a Ayudas
 * Sociales y borrarla a conciencia, no el sistema por su cuenta y de noche.
 *
 * SE ANOTA EN EL HISTORIAL DE LA SOLICITUD. Que la ayuda haya aparecido sola
 * no puede ser invisible: en el seguimiento queda dicho que se creó, con su
 * número, para que quien mire la solicitud entienda de dónde salió.
 */

/** Los estados en que una solicitud se considera concedida. */
const CONCEDIDA = ['Aprobada', 'Completada'];

/**
 * ¿A esta solicitud le toca generar una ayuda ahora?
 *
 * Se mira el estado ANTERIOR además del nuevo: lo que dispara la ayuda es el
 * momento en que se concede, no el hecho de estar concedida. Sin eso, guardar
 * cualquier cambio en una solicitud ya aprobada volvería a entrar acá —y
 * aunque el enlace lo frenaría igual, conviene que la condición diga lo que
 * de verdad se quiere decir.
 */
function leToca(fila, existing) {
  if (fila.tipo !== 'Ayuda social') return false;
  if (!CONCEDIDA.includes(fila.estado)) return false;
  if (fila.ayuda_social_id) return false; // ya generó la suya
  return !existing || !CONCEDIDA.includes(existing.estado);
}

/** El nombre de quien la recibe, copiado de su ficha como hace Ayudas Sociales. */
function nombreDelBeneficiario(db, fila) {
  const esMiembro = fila.solicitante_tipo === 'Miembro';
  const tabla = esMiembro ? 'miembros' : 'no_miembros';
  const id = esMiembro ? fila.miembro_id : fila.no_miembro_id;
  if (!id) return fila.solicitante || '';
  const ficha = db.prepare(`SELECT nombres, apellidos FROM "${tabla}" WHERE id = ?`).get(id);
  if (!ficha) return fila.solicitante || '';
  return `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
}

/**
 * Crea la ayuda si corresponde. Devuelve su id, o null si no había que crearla.
 *
 * Escribe con la misma conexión que trae el guardado de la solicitud, no por
 * la API: así las dos cosas entran o no entran juntas. Si la ayuda fallara
 * después de guardada la solicitud, quedaría una solicitud aprobada que dice
 * haber generado una ayuda que no existe.
 */
function generarSiCorresponde(fila, { db, user, existing }) {
  if (!leToca(fila, existing)) return null;

  const beneficiario = nombreDelBeneficiario(db, fila);
  // La fecha de la ayuda es el día en que se resolvió, no el día en que se
  // pidió: es cuando la iglesia se comprometió a entregarla.
  const fecha = fila.fecha_respuesta || fila.fecha;
  const descripcion = [fila.asunto, fila.descripcion].filter(Boolean).join(' — ');

  const info = db
    .prepare(
      `INSERT INTO ayudas_sociales
         (fecha, iglesia_id, beneficiario_tipo, miembro_id, no_miembro_id, beneficiario,
          tipo_ayuda, descripcion, valor_estimado, aprobada_por, estado, notas, solicitud_id,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Aprobada', ?, ?, ?, ?)`
    )
    .run(
      fecha,
      fila.iglesia_id,
      fila.solicitante_tipo,
      fila.solicitante_tipo === 'Miembro' ? fila.miembro_id : null,
      fila.solicitante_tipo === 'No miembro' ? fila.no_miembro_id : null,
      beneficiario,
      fila.ayuda_tipo || 'Otro',
      descripcion || null,
      fila.ayuda_monto || null,
      (user && user.nombre) || null,
      `Generada por la solicitud ${fila.numero}.`,
      fila.id,
      (user && user.id) || null,
      (user && user.id) || null
    );

  const id = info.lastInsertRowid;
  db.prepare('UPDATE solicitudes SET ayuda_social_id = ? WHERE id = ?').run(id, fila.id);
  fila.ayuda_social_id = id;
  return id;
}

module.exports = { generarSiCorresponde, leToca, nombreDelBeneficiario, CONCEDIDA };
