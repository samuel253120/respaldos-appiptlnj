/**
 * Registro automático en los historiales.
 *
 * Se conecta al motor CRUD: cada vez que se guarda un registro, anota en el
 * historial de quien corresponda lo que ocurrió. Hay tres historiales, uno
 * por cada cosa que tiene vida propia en la organización:
 *
 *   miembros  → bitacora              (la bitácora de cada persona)
 *   iglesias  → historial_iglesias    (la historia de cada congregación)
 *   pastores  → historial_pastores    (el recorrido ministerial)
 *
 * Puede desactivarse desde la configuración del sistema
 * (bitacora_automatica), y en ese caso ninguno de los tres se escribe solo.
 */
const { db } = require('./db');
const ajustes = require('./ajustes');

/** Nombre de presentación de un miembro. */
function nombreMiembro(id) {
  const m = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  return m ? `${m.nombres} ${m.apellidos}`.trim() : null;
}

/**
 * Escribe un registro automático en un historial cualquiera: se le indica en
 * qué tabla, con qué columna apunta a su dueño y de quién se trata.
 */
function anotarEn(tabla, columna, id, { tipo, descripcion, iglesiaId, usuario }) {
  if (!id || !ajustes.activo('bitacora_automatica')) return;
  try {
    const tiene = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
    // El dueño primero; las demás, solo si la tabla las tiene. En el historial
    // de una iglesia el dueño ES la iglesia, así que no se repite.
    const pares = [[columna, id], ['tipo', tipo], ['descripcion', descripcion]];
    const opcional = (nombre, valor) => {
      if (nombre !== columna && tiene.has(nombre)) pares.push([nombre, valor]);
    };
    opcional('iglesia_id', iglesiaId || null);
    opcional('origen', 'Automático');
    opcional('registrado_por', usuario ? usuario.nombre : 'Sistema');
    opcional('created_by', usuario ? usuario.id : null);

    const columnas = ['fecha', ...pares.map(([c]) => c)].map((c) => `"${c}"`).join(', ');
    const marcas = ["date('now','localtime')", ...pares.map(() => '?')].join(', ');
    db.prepare(`INSERT INTO "${tabla}" (${columnas}) VALUES (${marcas})`).run(...pares.map(([, v]) => v));
  } catch (e) {
    console.error(`No se pudo anotar en ${tabla}:`, e.message);
  }
}

/** Escribe un registro automático en la bitácora de un miembro. */
function anotar({ miembroId, tipo, descripcion, iglesiaId, usuario }) {
  if (!miembroId) return;
  if (!nombreMiembro(miembroId)) return; // el miembro ya no existe
  anotarEn('bitacora', 'miembro_id', miembroId, { tipo, descripcion, iglesiaId, usuario });
}

/** Escribe un registro automático en el historial de una iglesia. */
function anotarIglesia(iglesiaId, datos) {
  anotarEn('historial_iglesias', 'iglesia_id', iglesiaId, { ...datos, iglesiaId });
}

/** Escribe un registro automático en el historial de un pastor. */
function anotarPastor(pastorId, datos) {
  const pastor = pastorId ? db.prepare('SELECT iglesia_id FROM pastores WHERE id = ?').get(pastorId) : null;
  if (!pastor) return; // la ficha ya no existe
  anotarEn('historial_pastores', 'pastor_id', pastorId, { ...datos, iglesiaId: pastor.iglesia_id });
}

/**
 * Lista legible de los campos que cambiaron entre dos versiones de un
 * registro. De los campos marcados como `sensible` —los datos de salud, la
 * nota importante— solo se deja constancia de que cambiaron: su contenido no
 * se copia al historial.
 */
function cambios(def, antes, despues) {
  const lista = [];
  for (const f of def.fields) {
    if (f.type === 'password' || f.name === 'foto') continue;
    if (!(f.name in despues)) continue;
    const previo = antes[f.name];
    const nuevo = despues[f.name];
    if (String(previo ?? '') === String(nuevo ?? '')) continue;
    if (f.sensible) {
      lista.push(`${f.label}: ${nuevo ? 'actualizada' : 'borrada'}`);
      continue;
    }
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

  // 2. La iglesia: su alta y los cambios de sus datos
  if (def.name === 'iglesias') {
    if (isNew) {
      anotarIglesia(despues.id, { tipo: 'Anotación', usuario: user,
        descripcion: `Se registra la iglesia "${despues.nombre || ''}" en el sistema.`.replace(' ""', '') });
    } else {
      const lista = cambios(def, antes, datos);
      if (lista.length) {
        anotarIglesia(despues.id, { tipo: 'Cambio de datos', usuario: user, descripcion: lista.join(' · ') });
      }
    }
    return;
  }

  // 3. El pastor: su alta, su cargo, su traslado y los demás cambios
  if (def.name === 'pastores') {
    const quien = `${despues.nombres || ''} ${despues.apellidos || ''}`.trim();
    if (isNew) {
      anotarPastor(despues.id, { tipo: 'Anotación', usuario: user,
        descripcion: `Se registra a ${quien} en Pastores / Guías${despues.cargo ? ` como ${despues.cargo}` : ''}.` });
      return;
    }
    if (datos.cargo !== undefined && antes.cargo !== despues.cargo) {
      anotarPastor(despues.id, {
        tipo: 'Cambio de cargo', usuario: user,
        descripcion: `Pasa de ${antes.cargo || '(sin cargo)'} a ${despues.cargo || '(sin cargo)'}.`,
      });
    }
    if (datos.iglesia_id !== undefined && antes.iglesia_id !== despues.iglesia_id) {
      const nombreDe = (id) => {
        const i = id ? db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(id) : null;
        return i ? i.nombre : '(sin iglesia)';
      };
      anotarPastor(despues.id, {
        tipo: 'Traslado de iglesia', usuario: user,
        descripcion: `De ${nombreDe(antes.iglesia_id)} a ${nombreDe(despues.iglesia_id)}.`,
      });
    }
    const otros = cambios(def, antes, datos).filter((c) => !c.startsWith('Cargo:') && !c.startsWith('Iglesia:'));
    if (otros.length) {
      anotarPastor(despues.id, { tipo: 'Cambio de datos', usuario: user, descripcion: otros.join(' · ') });
    }
    return;
  }

  // 4. Documentos adjuntos a una iglesia o a un pastor
  if (def.name === 'documentos_iglesias' && isNew && despues.iglesia_id) {
    anotarIglesia(despues.iglesia_id, {
      tipo: 'Documento', usuario: user,
      descripcion: `Se adjuntó "${despues.nombre || despues.tipo || 'un documento'}" (${despues.tipo || ''}).`,
    });
    return;
  }
  if (def.name === 'documentos_pastores' && isNew && despues.pastor_id) {
    anotarPastor(despues.pastor_id, {
      tipo: 'Documento', usuario: user,
      descripcion: `Se adjuntó "${despues.nombre || despues.tipo || 'un documento'}" (${despues.tipo || ''}).`,
    });
    return;
  }

  // 5. Cuerpos: ingresos y salidas de integrantes
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

  // 6. Directivas: se anota a cada miembro el cargo que asume
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

  // 7. Módulos que apuntan a un miembro
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

module.exports = { anotar, anotarIglesia, anotarPastor, registrarGuardado };
