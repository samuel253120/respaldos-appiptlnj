/**
 * Módulo 3 · Cuerpos y grupos, con sus integrantes y su directiva.
 *
 * El sistema anterior guardaba la pertenencia en una tabla aparte
 * (`memberships`), con una fila por persona y por cuerpo. Acá la pertenencia
 * es la lista de integrantes del propio cuerpo, así que esas filas se
 * convierten en esa lista.
 *
 * Tres cosas que se deciden acá:
 *
 *  - **Cuerpo o grupo.** El origen no distinguía. Es cuerpo el que trae una
 *    directiva más allá del primer jefe —segundo jefe, secretaria, tesorera,
 *    supervisor— y también el cuerpo de oficiales, que lo es por definición.
 *    El resto queda como grupo. Es un campo editable: si alguno quedó mal, se
 *    cambia en su ficha.
 *  - **Quién es integrante hoy.** Solo quienes seguían activos en el cuerpo.
 *    Las bajas no se pierden: quedan anotadas en la bitácora de esa persona,
 *    con su fecha y, cuando el origen lo dice, su motivo.
 *  - **La directiva vigente.** Una por cuerpo, sin fecha de término, con los
 *    cargos que traía cada uno (decisión tomada con la iglesia). Queda
 *    editable, para completarle el período y el acta cuando corresponda.
 *
 * Lo que no tiene dónde ir: la **fecha en que cada persona entró a cada
 * cuerpo** (acá la pertenencia no lleva fecha) y su nivel de participación
 * (venía "good" en las 195). Se informa al terminar; no se inventa un lugar
 * para guardarlo.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const tr = require('./traducciones');

/** Fila de diagnóstico del sistema anterior: apunta a un grupo y a una persona que no existen. */
const FILA_DE_DIAGNOSTICO = 'diag-verify-membership';

/** Cargos que hacen formal a un cuerpo: con uno de estos, ya no es un simple grupo. */
const CARGOS_FORMALES = ['second_chief', 'secretary', 'treasurer', 'supervisor', 'counselor'];

/** El cuerpo de oficiales es cuerpo por definición, se llame como se llame. */
const esCuerpoDeOficiales = (nombre) => /oficial/i.test(String(nombre || ''));

/** Motivos de baja del origen, dichos como se dicen acá. */
const MOTIVO_DE_BAJA = {
  deceased: 'fallecimiento',
  transfer: 'traslado',
  resignation: 'renuncia',
  discipline: 'disciplina',
  inactivity: 'inactividad',
  other: 'otro motivo',
};

module.exports = function importarCuerpos(origen, { lote, prueba, iglesiaId }) {
  const filas = origen.groups || [];
  const membresias = (origen.memberships || []).filter((m) => m.id !== FILA_DE_DIAGNOSTICO);
  const bajasDelOrigen = origen.dismissals || [];

  return importarModulo({ nombre: 'cuerpos', filas, lote, prueba }, (ayuda) => {
    let creados = 0, actualizados = 0, cuerpos = 0, grupos = 0;
    let integrantesTotal = 0, directivas = 0, cargos = 0, notasDeBaja = 0;
    const anomalias = [];

    // La pertenencia, agrupada por cuerpo
    const porCuerpo = new Map();
    membresias.forEach((m, i) => {
      if (!filas.some((g) => g.id === m.groupId)) {
        ayuda.problema(i, `pertenencia a un cuerpo que no existe (${m.groupId})`, m);
        return;
      }
      if (!porCuerpo.has(m.groupId)) porCuerpo.set(m.groupId, []);
      porCuerpo.get(m.groupId).push(m);
    });

    /** El id de acá de una persona del origen. */
    const miembro = (idOrigen) => equivalencias.resolver('members', idOrigen);

    filas.forEach((g, i) => {
      if (!ayuda.exigir(g.name, 'cuerpo sin nombre', i, g)) return;
      const suyas = porCuerpo.get(g.id) || [];

      // Quiénes siguen en el cuerpo, y quiénes tienen cargo
      const integrantes = [];
      const deLaDirectiva = {};
      for (const m of suyas) {
        const id = miembro(m.memberId);
        if (!id) {
          ayuda.problema(i, `en "${g.name}" hay una pertenencia de alguien que no está en Miembros (${m.memberId})`, g);
          continue;
        }
        if (m.status === 'active') {
          if (!integrantes.includes(id)) integrantes.push(id);
          const campo = tr.traducir(tr.CARGO_DIRECTIVA, m.role === 'member' || m.role === 'leader' ? null : m.role, 'cargo de la directiva');
          if (campo && !deLaDirectiva[campo]) deLaDirectiva[campo] = id;
        }
      }

      const lider = g.leaderId ? miembro(g.leaderId) : null;
      if (g.leaderId && !lider) {
        ayuda.problema(i, `el líder de "${g.name}" no está en Miembros (${g.leaderId})`, g);
        return;
      }
      if (lider && !integrantes.includes(lider)) {
        const salida = suyas.find((m) => m.memberId === g.leaderId && m.status !== 'active');
        anomalias.push({
          cuerpo: g.name,
          detalle: salida
            ? `su líder figura con baja del cuerpo el ${fecha(salida.leaveDate) || 'sin fecha'}`
            : 'su líder no figura entre los integrantes',
        });
      }

      const formal = esCuerpoDeOficiales(g.name)
        || suyas.some((m) => m.status === 'active' && CARGOS_FORMALES.includes(m.role));

      const datos = {
        nombre: texto(g.name),
        tipo: formal ? 'Cuerpo' : 'Grupo',
        iglesia_id: iglesiaId,
        lider_id: lider,
        fecha_creacion: fecha(g.createdAt),
        estado: g.status === 'inactive' ? 'Inactivo' : 'Activo',
        descripcion: texto(g.description),
        created_at: marcaDeTiempo(g._created_at || g.createdAt),
        updated_at: marcaDeTiempo(g._updated_at || g.updatedAt),
      };

      const { id: cuerpoId, nueva } = guardar({
        moduloOrigen: 'groups', idOrigen: g.id, tabla: 'cuerpos', datos, lote,
      });
      nueva ? creados++ : actualizados++;
      formal ? cuerpos++ : grupos++;
      integrantesTotal += integrantes.length;

      // Cada pertenencia es una ficha propia. Vienen como integrantes activos:
      // llevan tiempo en su cuerpo y no corresponde mandarlos a un período de
      // prueba que ya cumplieron.
      const yaTiene = db.prepare('SELECT id FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?');
      // Todo lo que llega de la importación es gente inscrita: el registro
      // aparte —quienes sirven en un grupo sin estar en la membresía— no viene
      // del sistema de origen, se lleva acá (ver server/integrantes.js).
      const nuevaFicha = db.prepare(
        `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, persona_tipo, persona, estado,
                                         fecha_ingreso, iglesia_id, observaciones)
         VALUES (?, ?, 'Miembro',
                 (SELECT TRIM(COALESCE(nombres, '') || ' ' || COALESCE(apellidos, '')) FROM miembros WHERE id = ?),
                 'Activo', ?, ?, ?)`
      );
      for (const id of integrantes) {
        if (yaTiene.get(cuerpoId, id)) continue;
        const suya = suyas.find((m) => miembro(m.memberId) === id && m.status === 'active');
        nuevaFicha.run(
          cuerpoId, id, id, fecha(suya && (suya.joinDate || suya.createdAt)), iglesiaId,
          'Venía del sistema anterior.'
        );
      }

      // Las bajas del cuerpo, al historial de cada persona: la pertenencia de
      // acá no lleva fecha, pero el hecho de que salió no se pierde. Quien
      // sigue en el cuerpo por otra vía —el líder que además es primer jefe—
      // no está de baja: no se le anota nada.
      for (const m of suyas.filter((x) => x.status !== 'active' || x.leaveDate)) {
        const id = miembro(m.memberId);
        if (!id || integrantes.includes(id)) continue;
        const baja = bajasDelOrigen.find((b) => b.groupId === g.id && b.memberId === m.memberId);
        const motivo = baja ? MOTIVO_DE_BAJA[baja.reason] || baja.reason : null;
        const cuando = fecha(m.leaveDate) || (baja && fecha(baja.date)) || fecha(g.createdAt);
        const descripcion = `Baja del cuerpo "${g.name}"${motivo ? ` por ${motivo}` : ''}.`;
        const ya = db
          .prepare('SELECT id FROM bitacora WHERE miembro_id = ? AND descripcion = ?')
          .get(id, descripcion);
        if (!ya) {
          db.prepare(
            `INSERT INTO bitacora (miembro_id, fecha, tipo, descripcion, iglesia_id, origen, registrado_por)
             VALUES (?, ?, 'Cambio de estado', ?, ?, 'Automático', 'Importación')`
          ).run(id, cuando, descripcion, iglesiaId);
          notasDeBaja++;
        }
      }

      // El período de prueba tampoco tiene campo propio: queda anotado
      for (const m of suyas.filter((x) => x.membershipState === 'trial' && x.status === 'active')) {
        const id = miembro(m.memberId);
        if (!id) continue;
        const p = m.trialPeriod || {};
        const descripcion = `En período de prueba en "${g.name}"`
          + (p.startDate || p.endDate ? `, del ${fecha(p.startDate) || '?'} al ${fecha(p.endDate) || '?'}` : '')
          + '.';
        const ya = db.prepare('SELECT id FROM bitacora WHERE miembro_id = ? AND descripcion = ?').get(id, descripcion);
        if (!ya) {
          db.prepare(
            `INSERT INTO bitacora (miembro_id, fecha, tipo, descripcion, iglesia_id, origen, registrado_por)
             VALUES (?, ?, 'Anotación', ?, ?, 'Automático', 'Importación')`
          ).run(id, fecha(p.startDate) || fecha(g.createdAt), descripcion, iglesiaId);
          notasDeBaja++;
        }
      }

      // La directiva vigente del cuerpo, con los cargos que traiga
      if (Object.keys(deLaDirectiva).length) {
        const inicio = fecha(g.createdAt) || new Date().toISOString().slice(0, 10);
        const datosDirectiva = {
          cuerpo_id: cuerpoId,
          periodo: String(inicio).slice(0, 4),
          fecha_inicio: inicio,
          fecha_termino: null,
          estado: 'Vigente',
          iglesia_id: iglesiaId,
          notas: 'Directiva tomada del sistema anterior, con los cargos que traía el cuerpo. '
            + 'Queda sin fecha de término: complétela cuando se defina el período.',
          created_at: marcaDeTiempo(g._created_at || g.createdAt),
          ...deLaDirectiva,
        };
        const r = guardar({
          moduloOrigen: 'group-directiva', idOrigen: g.id, tabla: 'directivas', datos: datosDirectiva, lote,
        });
        if (r.nueva) directivas++;
        cargos += Object.keys(deLaDirectiva).length;
      }
    });

    return {
      creados, actualizados, cuerpos, grupos,
      integrantes: integrantesTotal, directivas, cargos_en_directivas: cargos,
      notas_en_bitacora: notasDeBaja,
      descartadas: (origen.memberships || []).length - membresias.length,
      detalle_anomalias: anomalias,
    };
  });
};
