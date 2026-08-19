/**
 * Registro automático en la bitácora de miembros.
 *
 * Se conecta al motor CRUD: cada vez que se guarda o elimina un registro,
 * anota en la bitácora del miembro correspondiente lo que ocurrió. Puede
 * desactivarse desde la configuración del sistema (bitacora_automatica).
 */
const { db } = require('./db');
const ajustes = require('./ajustes');

/** Nombre de presentación de un miembro. */
function nombreMiembro(id) {
  const m = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  return m ? `${m.nombres} ${m.apellidos}`.trim() : null;
}

/** Escribe un registro automático en la bitácora. */
function anotar({ miembroId, tipo, descripcion, iglesiaId, usuario }) {
  if (!miembroId || !ajustes.activo('bitacora_automatica')) return;
  if (!nombreMiembro(miembroId)) return; // el miembro ya no existe
  try {
    db.prepare(
      `INSERT INTO bitacora (miembro_id, fecha, tipo, descripcion, iglesia_id, origen, registrado_por, created_by)
       VALUES (?, date('now','localtime'), ?, ?, ?, 'Automático', ?, ?)`
    ).run(miembroId, tipo, descripcion, iglesiaId || null, usuario ? usuario.nombre : 'Sistema', usuario ? usuario.id : null);
  } catch (e) {
    console.error('No se pudo anotar en la bitácora:', e.message);
  }
}

/** Lista legible de los campos que cambiaron entre dos versiones de un registro. */
function cambios(def, antes, despues) {
  const lista = [];
  for (const f of def.fields) {
    if (f.type === 'password' || f.name === 'foto') continue;
    if (!(f.name in despues)) continue;
    const previo = antes[f.name];
    const nuevo = despues[f.name];
    if (String(previo ?? '') === String(nuevo ?? '')) continue;
    const texto = (v) => (v === null || v === undefined || v === '' ? '(vacío)' : String(v));
    lista.push(`${f.label}: ${texto(previo)} → ${texto(nuevo)}`);
  }
  return lista;
}

/** Ids de un campo multiref, tolerante a formatos. */
function idsDe(valor) {
  if (Array.isArray(valor)) return valor.map(Number).filter(Boolean);
  try {
    const p = JSON.parse(valor || '[]');
    return Array.isArray(p) ? p.map(Number).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Se llama desde el motor CRUD después de guardar un registro de cualquier
 * módulo. Traduce el hecho a una anotación en la bitácora del miembro.
 */
function registrarGuardado(def, { isNew, antes, despues, datos, user }) {
  const iglesia = despues.iglesia_id || null;

  // 1. El propio miembro: alta y cambios de sus datos
  if (def.name === 'miembros') {
    if (isNew) {
      anotar({ miembroId: despues.id, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: 'Alta del miembro en el sistema.' });
    } else {
      const lista = cambios(def, antes, datos);
      if (lista.length) {
        const cambioEstado = lista.find((c) => c.startsWith('Estado:'));
        anotar({
          miembroId: despues.id, iglesiaId: iglesia, usuario: user,
          tipo: cambioEstado ? 'Cambio de estado' : 'Cambio de datos',
          descripcion: lista.join(' · '),
        });
      }
    }
    return;
  }

  // 2. Cuerpos: ingresos y salidas de integrantes
  if (def.name === 'cuerpos') {
    const previos = isNew ? [] : idsDe(antes.integrantes);
    const actuales = idsDe(despues.integrantes);
    const nombre = despues.nombre || 'un cuerpo';
    for (const id of actuales.filter((i) => !previos.includes(i))) {
      anotar({ miembroId: id, tipo: 'Ingreso a cuerpo', iglesiaId: iglesia, usuario: user,
        descripcion: `Ingresa a "${nombre}".` });
    }
    for (const id of previos.filter((i) => !actuales.includes(i))) {
      anotar({ miembroId: id, tipo: 'Salida de cuerpo', iglesiaId: iglesia, usuario: user,
        descripcion: `Sale de "${nombre}".` });
    }
    // Cambio de líder
    if (despues.lider_id && (isNew || antes.lider_id !== despues.lider_id)) {
      anotar({ miembroId: despues.lider_id, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: `Queda como líder / encargado de "${nombre}".` });
    }
    return;
  }

  // 3. Directivas: se anota a cada miembro el cargo que asume
  if (def.name === 'directivas') {
    const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(despues.cuerpo_id);
    const nombreCuerpo = cuerpo ? cuerpo.nombre : 'un cuerpo';
    const cargos = [
      ['oficial_supervisor_id', 'Oficial supervisor(a)'],
      ['primer_jefe_id', 'Primer jefe / Primera jefa'],
      ['segundo_jefe_id', 'Segundo jefe / Segunda jefa'],
      ['secretario_id', 'Secretario(a)'],
      ['tesorero_id', 'Tesorero(a)'],
      ['consejero_id', 'Consejero(a)'],
    ];
    for (const [campo, cargo] of cargos) {
      const nuevo = despues[campo];
      const previo = isNew ? null : antes[campo];
      if (nuevo && nuevo !== previo) {
        anotar({
          miembroId: nuevo, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
          descripcion: `Asume como ${cargo} de "${nombreCuerpo}" — período ${despues.periodo || ''}.`.trim(),
        });
      }
    }
    return;
  }

  // 4. Módulos que apuntan a un miembro
  const relacionados = {
    solicitudes: (r) => ({ tipo: 'Solicitud', texto: `Solicitud "${r.asunto || r.tipo}" (${r.estado || 'Pendiente'}).` }),
    ayudas_sociales: (r) => ({ tipo: 'Ayuda social', texto: `Ayuda social: ${r.tipo_ayuda || ''} — ${r.estado || ''}.` }),
    certificados: (r) => ({ tipo: 'Certificado', texto: `Certificado de ${r.tipo || ''} N.º ${r.numero || ''}.` }),
    credenciales: (r) => ({ tipo: 'Credencial', texto: `Credencial ${r.tipo || ''} N.º ${r.numero || ''}.` }),
    documentos_miembros: (r) => ({ tipo: 'Documento', texto: `Se adjuntó "${r.nombre || r.tipo || 'un documento'}" (${r.tipo || ''}).` }),
  };
  const traductor = relacionados[def.name];
  if (traductor && despues.miembro_id) {
    // Solo al crear, o cuando cambia el estado de una solicitud o ayuda
    const cambioEstado = !isNew && antes && antes.estado !== despues.estado;
    if (isNew || cambioEstado) {
      const { tipo, texto } = traductor(despues);
      anotar({
        miembroId: despues.miembro_id, tipo, iglesiaId: iglesia, usuario: user,
        descripcion: (isNew ? '' : 'Actualización — ') + texto,
      });
    }
  }
}

module.exports = { anotar, registrarGuardado };
