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
 * Y aparte de esos tres hay un cuarto libro, que no cuenta una historia sino
 * que responde una pregunta: el **Registro de Cambios**, donde queda anotado
 * quién tocó el dinero y los permisos —altas, cambios y eliminaciones—.
 *
 * Puede desactivarse desde la configuración del sistema
 * (bitacora_automatica), y en ese caso ninguno de los tres se escribe solo.
 */
const { db } = require('./db');
const ajustes = require('./ajustes');

/** Nombre de presentación de un miembro. */
function nombreMiembro(id) {
  const m = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(id);
  return m ? require('./nombres').paraMostrar(m.nombres, m.apellidos) : null;
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
 * Qué queda anotado en el Registro de Cambios.
 *
 * La regla tiene dos partes, y la diferencia entre las dos es a propósito:
 * anotarlo todo llenaría el registro de ruido y taparía justo lo que se
 * quiere encontrar.
 *
 * **Todo lo que se borra, en cualquier módulo.** Borrar es raro y no se
 * deshace, y con la ficha se va también su propio historial: si mañana falta
 * un miembro de la lista, el Registro de Cambios es el único lugar donde
 * puede quedar quién lo borró y qué decía. Por eso la eliminación se anota
 * aunque el módulo no esté en la lista de abajo.
 *
 * **Las creaciones y los cambios, solo donde importan**: el dinero, las
 * llaves del sistema y lo que no lleva historial propio —los cuerpos, sus
 * directivas, sus actas y quiénes los integran—. Miembros, pastores e
 * iglesias no están acá porque cada uno tiene su propia bitácora, que cuenta
 * lo mismo con más detalle y en el lugar donde se busca.
 */
const MODULOS_VIGILADOS = [
  // El dinero
  'tesoreria', 'cuentas_tesoreria', 'traspasos', 'cuotas_cuerpo', 'ayudas_sociales',
  // Las llaves
  'usuarios', 'perfiles_permisos',
  // Lo que no tiene historial propio
  'cuerpos', 'directivas', 'actas_reuniones', 'actas_asambleas', 'integrantes_cuerpo',
  // Los documentos de identidad ministerial: quién la creó, la emitió, la
  // revocó y la volvió a imprimir tiene que poder consultarse después
  'credenciales',
  /*
   * La actividad, no sus marcas.
   *
   * Cambiarle la fecha o los cuerpos convocados a una actividad que ya tiene
   * lista pasada mueve o deja huérfanas las marcas de mucha gente, y eso no
   * dejaba rastro en ninguna parte. Son unas ciento cincuenta al año: cabe de
   * sobra en el registro.
   */
  'asistencias',
];

/**
 * Lo único que se borra sin quedar anotado.
 *
 * Las marcas de asistencia se borran de a montones cada vez que alguien
 * corrige una lista, y anotarlas una por una sepultaría el registro. El
 * propio Registro de Cambios no se puede borrar, así que la línea sobra,
 * pero se deja escrita para que nadie la agregue por descuido.
 *
 * Que no se anote MARCA POR MARCA no significa que corregir una lista pase sin
 * dejar rastro: la toma de lista anota UNA línea por corrección —«Corrigió 2
 * marca(s) de la lista de Damas: Juan Pérez: Presente → Ausente»—, que es lo
 * que de verdad se quiere poder consultar después. Ver `anotarLaCorreccion` en
 * server/modules/asistencias.js. Por lo mismo, `asistencia_detalle` tampoco
 * puede entrar en MODULOS_VIGILADOS: serían treinta mil líneas.
 */
const BORRADOS_QUE_NO_SE_ANOTAN = ['asistencia_detalle', 'registro_cambios'];

/** Escribe una línea en el Registro de Cambios. */
function anotarCambio({ def, accion, fila, detalle, usuario }) {
  try {
    const { displayOf } = require('./registry');
    db.prepare(
      `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id, created_by)
       VALUES (date('now','localtime'), strftime('%H:%M','now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      def.label,
      accion,
      displayOf(def, fila).slice(0, 120),
      fila.id || null,
      detalle || null,
      usuario ? usuario.nombre : 'Sistema',
      fila.iglesia_id || null,
      usuario ? usuario.id : null
    );
  } catch (e) {
    console.error('No se pudo anotar en el registro de cambios:', e.message);
  }
}

/**
 * Un valor escrito como lo lee una persona: la plata con su signo y sus miles,
 * y una referencia con el nombre de aquello a lo que apunta, no con su número.
 * «Cuenta: 5» no le dice nada a nadie; «Cuenta: Tesorería general», sí.
 */
function legible(campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '(vacío)';
  if (campo.type === 'money') {
    const n = Number(valor);
    return Number.isFinite(n) ? `$\u00a0${n.toLocaleString('es-CL')}` : String(valor);
  }
  if (campo.type === 'number') {
    const n = Number(valor);
    return Number.isFinite(n) ? n.toLocaleString('es-CL') : String(valor);
  }
  if (campo.type === 'ref' && campo.ref) {
    try {
      const { getModule, displayOf } = require('./registry');
      const refDef = getModule(campo.ref);
      const fila = refDef && db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(valor);
      if (fila) return displayOf(refDef, fila);
    } catch (e) {
      /* si no se puede resolver, queda el número */
    }
  }
  /*
   * Un campo de varios enlaces se guarda como JSON —`[2,5]`—, y así salía
   * escrito en el registro: «Cuerpos convocados: [2]». Acá se resuelve a los
   * nombres, que es lo que el registro existe para poder leer después.
   */
  if (campo.type === 'multiref' && campo.ref) {
    try {
      const { getModule, displayOf } = require('./registry');
      const refDef = getModule(campo.ref);
      const ids = Array.isArray(valor) ? valor : JSON.parse(valor || '[]');
      if (refDef && Array.isArray(ids)) {
        const nombres = ids
          .map((id) => db.prepare(`SELECT * FROM "${refDef.name}" WHERE id = ?`).get(Number(id)))
          .map((fila, i) => (fila ? displayOf(refDef, fila) : `#${ids[i]}`));
        return nombres.length ? nombres.join(', ') : '(ninguno)';
      }
    } catch (e) {
      /* si no se puede resolver, queda el texto tal cual */
    }
  }
  if (campo.type === 'boolean') return String(valor) === '1' ? 'Sí' : 'No';
  return String(valor);
}

/**
 * Un resumen de lo que traía un registro, para que su eliminación no quede
 * como una línea muda: el que revisa después necesita saber qué se borró.
 *
 * De los campos marcados como `sensible` —las enfermedades, las alergias, la
 * nota importante— se deja constancia de que traían algo, pero no de qué:
 * el Registro de Cambios lo leen el pastor y el tesorero, y los datos de
 * salud de una persona no tienen por qué quedar copiados ahí para siempre.
 */
function resumenDe(def, fila) {
  return (def.listFields || [])
    .map((nombre) => {
      const campo = def.fields.find((f) => f.name === nombre);
      if (!campo || campo.type === 'password' || campo.type === 'file') return null;
      if (campo.sensible) {
        const traia = fila[nombre];
        return traia === null || traia === undefined || traia === '' ? null : `${campo.label}: (tenía dato)`;
      }
      const valor = fila[nombre];
      if (valor === null || valor === undefined || valor === '') return null;
      return `${campo.label}: ${legible(campo, valor)}`;
    })
    .filter(Boolean)
    .join(' · ');
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
    lista.push(`${f.label}: ${legible(f, previo)} → ${legible(f, nuevo)}`);
  }
  return lista;
}

/**
 * Se llama desde el motor CRUD después de guardar un registro de cualquier
 * módulo. Traduce el hecho a una anotación en la bitácora del miembro.
 */
function registrarGuardado(def, { isNew, antes, despues, datos, user }) {
  const iglesia = despues.iglesia_id || null;

  // 0. El dinero y las llaves, en el Registro de Cambios
  if (MODULOS_VIGILADOS.includes(def.name)) {
    if (isNew) {
      anotarCambio({ def, accion: 'Creación', fila: despues, usuario: user, detalle: resumenDe(def, despues) });
    } else {
      const lista = cambios(def, antes, datos);
      if (lista.length) {
        anotarCambio({ def, accion: 'Cambio', fila: despues, usuario: user, detalle: lista.join(' · ') });
      }
    }
  }

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
    const quien = require('./nombres').paraMostrar(despues.nombres, despues.apellidos);
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

  // 5. Cuerpos: quién queda a cargo
  if (def.name === 'cuerpos') {
    const nombre = despues.nombre || 'un cuerpo';
    // Solo cuando el líder es un miembro inscrito: un grupo lo puede dirigir
    // alguien del registro aparte, y esa persona no tiene bitácora
    if (despues.lider_id && (isNew || antes.lider_id !== despues.lider_id)) {
      anotar({ miembroId: despues.lider_id, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: `Queda como líder / encargado de "${nombre}".` });
    }
    return;
  }

  // 5b. Integrantes de cuerpos: ingreso, paso a oficial, retiro
  if (def.name === 'integrantes_cuerpo') {
    const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(despues.cuerpo_id);
    const nombre = cuerpo ? cuerpo.nombre : 'un cuerpo';
    const quien = Number(despues.miembro_id);
    /*
     * La bitácora es el historial del MIEMBRO. En los grupos ahora también
     * sirve gente que no está inscrita en la membresía, y esa gente no tiene
     * bitácora: su pertenencia queda en la ficha del grupo y nada más.
     */
    if (!quien) return;
    const estado = despues.estado;
    if (isNew) {
      anotar({ miembroId: quien, tipo: 'Ingreso a cuerpo', iglesiaId: iglesia, usuario: user,
        descripcion: estado === 'En prueba'
          ? `Ingresa a "${nombre}" en período de prueba.`
          : `Ingresa a "${nombre}".` });
      return;
    }
    if (antes.estado === estado) return;    // solo interesa el cambio de estado
    if (estado === 'Activo') {
      anotar({ miembroId: quien, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: `Queda como integrante oficial de "${nombre}".` });
    } else if (estado === 'Retirado') {
      anotar({ miembroId: quien, tipo: 'Salida de cuerpo', iglesiaId: iglesia, usuario: user,
        descripcion: `Sale de "${nombre}"${despues.motivo_retiro ? ` (${despues.motivo_retiro})` : ''}.` });
    } else if (estado === 'En prueba') {
      anotar({ miembroId: quien, tipo: 'Anotación', iglesiaId: iglesia, usuario: user,
        descripcion: `Vuelve a período de prueba en "${nombre}".` });
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

/**
 * Se llama desde el motor CRUD antes de eliminar un registro.
 *
 * Se anota **en cualquier módulo**, con un resumen de lo que traía: una vez
 * borrado ya no hay dónde ir a mirarlo, y su propio historial se fue con él.
 *
 * Si el borrado se llevó cosas por delante —las fichas de integrante de un
 * cuerpo, las marcas de asistencia de un miembro— eso se anota en la misma
 * entrada y no en una por fila. Son consecuencia de un solo acto, y ponerlas
 * sueltas llenaría el registro de doscientas líneas que dicen lo mismo. Pero
 * anotarlas hace falta: son las que después explican por qué desapareció algo
 * que nadie borró a mano.
 */
function registrarEliminado(def, fila, user, arrastre) {
  if (BORRADOS_QUE_NO_SE_ANOTAN.includes(def.name)) return;
  let detalle = resumenDe(def, fila);
  if (arrastre && arrastre.arrastradas) {
    const lista = (arrastre.detalle || []).join(', ');
    detalle += `${detalle ? ' — ' : ''}Se llevó consigo ${arrastre.arrastradas} registro(s)${lista ? `: ${lista}` : ''}.`;
  }
  anotarCambio({ def, accion: 'Eliminación', fila, usuario: user, detalle });
}

module.exports = {
  anotar, anotarIglesia, anotarPastor, registrarGuardado, registrarEliminado,
  // Para los actos que no son «guardar una ficha» y aun así tienen que quedar
  // anotados: emitir una credencial, revocarla, volver a imprimirla.
  anotarCambio,
};
