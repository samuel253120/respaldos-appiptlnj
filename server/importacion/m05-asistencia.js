/**
 * Módulo 5 · Actividades y asistencia.
 *
 * Es el módulo con más filas: 159 actividades y 5.626 marcas. Cada marca dice
 * si la persona estuvo, faltó o se justificó, y las justificaciones traen su
 * motivo y su texto.
 *
 * Dos cosas que se resuelven acá:
 *
 *  - **El tipo de actividad.** El origen lo trae en código, y 35 actividades
 *    no lo traen. En esos casos se deduce del nombre que le puso la iglesia
 *    ("Servicio General", "Clase de Dorcas", "Ensayo General Coro"), que es un
 *    dato del propio registro, no una suposición: si el nombre no alcanza,
 *    queda como "Otros".
 *  - **El nombre de la actividad**, que en el sistema anterior era libre, se
 *    conserva tal cual en el campo nuevo "Nombre de la actividad".
 *
 * Lo que no tiene dónde ir: la **recurrencia** (76 actividades venían de una
 * serie semanal, pero todas están materializadas, así que no falta ninguna) y
 * la lista de **excluidos** de cada actividad (acá no hace falta: las marcas
 * que existen son las que se tomaron). Se informa al terminar.
 *
 * **Una persona, una marca por actividad.** El sistema anterior guardaba la
 * marca por cuerpo, así que quien pertenece a tres cuerpos podía quedar
 * marcado tres veces en un mismo servicio —hasta cinco—, y a veces con
 * resultados distintos entre sí. Acá cada persona tiene una sola marca por
 * actividad: las repetidas se juntan en una, y cuando no coinciden manda
 * **Presente** sobre Justificado y Justificado sobre Ausente, porque si
 * estuvo, estuvo. Las filas del origen quedan todas anotadas en la tabla de
 * equivalencias, apuntando a la marca que las representa, y el informe final
 * dice cuántas se juntaron y en cuáles no coincidían.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const tr = require('./traducciones');

/** Cuando el origen no trae el tipo, lo dice el nombre que le puso la iglesia. */
const PORELNOMBRE = [
  [/vigilia/i, 'Servicio Vigilia'],
  [/servicio\s+general/i, 'Servicio General'],
  [/dorcas/i, 'Clase de Dorcas'],
  [/estudio\s*b[ií]blico/i, 'Estudio Bíblico'],
  [/oraci[oó]n/i, 'Oración'],
  [/ensayo/i, 'Ensayo'],
  [/gira/i, 'Salida a Gira'],
  [/visita/i, 'Salida a Visitar'],
  [/directiva/i, 'Reunión Directivas'],
  [/reuni[oó]n/i, 'Reunión Administrativa'],
  [/servicio/i, 'Servicio General'],
];

function tipoDeActividad(a) {
  if (a.activityType) return tr.traducir(tr.TIPO_ACTIVIDAD, a.activityType, 'tipo de actividad');
  const nombre = String(a.name || '');
  for (const [patron, tipo] of PORELNOMBRE) if (patron.test(nombre)) return tipo;
  return 'Otros';
}

/**
 * El texto de una justificación, sin repetir el motivo: el origen guardaba
 * "Trabajo: Trabajo" o "Otros: Fuera de Concepción".
 */
function detalleDeJustificacion(texto_, motivo) {
  const t = texto(texto_);
  if (!t) return null;
  const sinPrefijo = t.replace(/^[^:]{1,30}:\s*/, '').trim();
  const limpio = sinPrefijo || t;
  if (motivo && limpio.toLowerCase() === String(motivo).toLowerCase()) return null;
  return limpio;
}

module.exports = function importarAsistencia(origen, { lote, prueba, iglesiaId }) {
  const actividades = origen.activities || [];
  const marcas = origen.attendance || [];

  return importarModulo({ nombre: 'asistencia', filas: [...actividades, ...marcas], lote, prueba }, (ayuda) => {
    let creadas = 0, actualizadas = 0, sinTipoEnElOrigen = 0, conNombre = 0;
    let marcasCreadas = 0, marcasActualizadas = 0;
    const porEstado = { Presente: 0, Ausente: 0, Justificado: 0 };

    // ---------- Las actividades ----------
    actividades.forEach((a, i) => {
      if (!ayuda.exigir(a.date, 'actividad sin fecha', i, a)) return;

      const cuerpos = [];
      for (const g of a.groupIds || []) {
        const id = equivalencias.resolver('groups', g);
        if (!id) {
          ayuda.problema(i, `la actividad convoca a un cuerpo que no está importado (${g})`, a);
          continue;
        }
        if (!cuerpos.includes(id)) cuerpos.push(id);
      }
      if (!cuerpos.length) {
        ayuda.problema(i, 'actividad sin ningún cuerpo convocado', a);
        return;
      }
      if (!a.activityType) sinTipoEnElOrigen++;

      // Lo que el origen contaba aparte —el detalle del tipo y la descripción—
      // va junto en las observaciones, sin perder ninguno de los dos
      const observaciones = [texto(a.description), texto(a.activityTypeDetail)]
        .filter(Boolean)
        .filter((t, k, todos) => todos.indexOf(t) === k)
        .join('\n');

      const datos = {
        fecha: fecha(a.date),
        cuerpos: JSON.stringify(cuerpos),
        tipo_reunion: tipoDeActividad(a),
        nombre: texto(a.name),
        iglesia_id: iglesiaId,
        observaciones: observaciones || null,
        created_at: marcaDeTiempo(a._created_at || a.createdAt),
        updated_at: marcaDeTiempo(a._updated_at || a.updatedAt),
      };
      if (datos.nombre) conNombre++;

      const { nueva } = guardar({
        moduloOrigen: 'activities', idOrigen: a.id, tabla: 'asistencias', datos, lote,
      });
      nueva ? creadas++ : actualizadas++;
    });

    // ---------- Las marcas ----------
    // Primero se juntan las del mismo par actividad + persona: en el sistema
    // anterior venían por cuerpo, y una misma persona podía traer varias.
    const PESO = { Presente: 3, Justificado: 2, Ausente: 1 };
    const porPersona = new Map();
    marcas.forEach((m, k) => {
      const i = k + actividades.length;
      const actividadId = equivalencias.resolver('activities', m.activityId);
      if (!actividadId) {
        ayuda.problema(i, `marca de una actividad que no está importada (${m.activityId})`, m);
        return;
      }
      const miembroId = equivalencias.resolver('members', m.memberId);
      if (!miembroId) {
        ayuda.problema(i, `marca de alguien que no está en Miembros (${m.memberId})`, m);
        return;
      }
      const estado = tr.traducir(tr.ESTADO_ASISTENCIA, m.status, 'estado de asistencia')
        || (m.present ? 'Presente' : 'Ausente');
      // El motivo se traduce siempre: si no se sabe traducir, hay que saberlo
      const motivo = estado === 'Justificado'
        ? tr.traducir(tr.MOTIVO, m.justificationType, 'motivo de la justificación')
        : null;

      const clave = `${actividadId}|${miembroId}`;
      if (!porPersona.has(clave)) porPersona.set(clave, []);
      porPersona.get(clave).push({ fila: m, actividadId, miembroId, estado, motivo });
    });

    let juntadas = 0;
    const noCoinciden = [];

    for (const grupo of porPersona.values()) {
      // La que manda: estuvo > se justificó > faltó. A igual estado, la primera.
      const gana = grupo.reduce((mejor, x) => (PESO[x.estado] > PESO[mejor.estado] ? x : mejor), grupo[0]);
      const m = gana.fila;

      if (grupo.length > 1) {
        juntadas += grupo.length - 1;
        if (new Set(grupo.map((x) => x.estado)).size > 1) {
          const persona = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(gana.miembroId);
          const actividad = db.prepare('SELECT fecha, tipo_reunion FROM asistencias WHERE id = ?').get(gana.actividadId);
          noCoinciden.push({
            fecha: actividad ? actividad.fecha : '',
            actividad: actividad ? actividad.tipo_reunion : '',
            persona: persona ? `${persona.nombres} ${persona.apellidos}`.trim() : `#${gana.miembroId}`,
            venia: grupo.map((x) => x.estado).join(' / '),
            queda: gana.estado,
          });
        }
      }

      const datos = {
        asistencia_id: gana.actividadId,
        miembro_id: gana.miembroId,
        estado: gana.estado,
        motivo: gana.motivo,
        detalle: gana.motivo ? detalleDeJustificacion(m.justification, gana.motivo) : null,
        cuerpo_id: m.groupId ? equivalencias.resolver('groups', m.groupId) : null,
        fecha: fecha(m.date),
        iglesia_id: iglesiaId,
        created_at: marcaDeTiempo(m.createdAt || m._created_at),
        updated_at: marcaDeTiempo(m.updatedAt || m._updated_at),
      };

      const { id, nueva } = guardar({
        moduloOrigen: 'attendance', idOrigen: m.id, tabla: 'asistencia_detalle', datos, lote,
      });
      nueva ? marcasCreadas++ : marcasActualizadas++;
      porEstado[gana.estado]++;

      // Las filas que se juntaron quedan igualmente anotadas, apuntando a la
      // marca que las representa: ninguna fila del origen queda sin cuenta.
      for (const otra of grupo) {
        if (otra.fila.id === m.id) continue;
        if (!equivalencias.resolver('attendance', otra.fila.id)) {
          equivalencias.registrar('attendance', otra.fila.id, 'asistencia_detalle', id, lote);
        }
      }
    }

    return {
      actividades: actividades.length, creadas, actualizadas,
      tipo_deducido_del_nombre: sinTipoEnElOrigen, con_nombre_propio: conNombre,
      marcas_en_el_origen: marcas.length, marcas: marcasCreadas + marcasActualizadas,
      marcas_creadas: marcasCreadas, marcas_actualizadas: marcasActualizadas,
      repetidas_juntadas: juntadas, sin_coincidir: noCoinciden.length,
      presentes: porEstado.Presente, ausentes: porEstado.Ausente, justificados: porEstado.Justificado,
      detalle_marcas_que_no_coincidian: noCoinciden,
    };
  });
};
