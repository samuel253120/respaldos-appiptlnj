/**
 * El perfil de cada persona: sus propios datos, que puede mantener al día
 * ella misma sin depender de la oficina.
 *
 * Lo que edita aquí es **lo suyo**: cómo se llama, cómo contactarla, sus
 * estudios, a quién avisar en una emergencia y su información médica. Lo que
 * decide la iglesia —su iglesia, su estado, su tipo de miembro, sus fechas de
 * bautismo e ingreso, su trato, su rol en el sistema— no se toca desde acá.
 *
 * Si la persona está enlazada a su ficha de miembro, sus datos se guardan
 * ALLÁ, que es donde viven, y el usuario del sistema queda al día solo (RUT,
 * nombre, correo y teléfono se mantienen iguales en los dos, como siempre).
 * Si no lo está, se guardan en su cuenta de usuario.
 */
const { db } = require('./db');
const { getModule } = require('./registry');
const { coerce } = require('./crud');
const bitacora = require('./bitacora');

/**
 * Los datos que cada persona puede cambiar de sí misma, en el orden en que
 * se le muestran. Salen del propio módulo de Miembros: mismos campos, mismas
 * etiquetas, mismas listas y mismas condiciones que en su ficha.
 */
const MIOS_EN_MIEMBROS = [
  'foto', 'nombres', 'apellidos', 'fecha_nacimiento', 'genero',
  'nivel_educacional', 'titulo_estudios', 'ocupacion', 'lugar_trabajo',
  'estado_civil', 'fecha_matrimonio_civil', 'fecha_matrimonio_religioso',
  'telefono', 'email', 'direccion',
  'emergencia_nombre', 'emergencia_parentesco', 'emergencia_telefono',
  'enfermedades', 'alergias', 'indicaciones_medicas',
];

/** Y estos, cuando la cuenta todavía no está enlazada a una ficha de miembro. */
const MIOS_EN_USUARIOS = ['nombre', 'email', 'telefono'];

/** Los campos pedidos, tal como los declara su módulo. */
function camposDe(modulo, nombres) {
  const def = getModule(modulo);
  if (!def) return [];
  return nombres
    .map((n) => def.fields.find((f) => f.name === n))
    .filter(Boolean)
    .map(({ name, label, type, options, help, accept, showIf, seccion, mostrarEdad, buscador, sensible }) => ({
      name, label, type, options: options || null, help: help || null, accept: accept || null,
      showIf: showIf || null, seccion: seccion || null, mostrarEdad: !!mostrarEdad,
      buscador: buscador === undefined ? null : !!buscador, sensible: !!sensible,
      required: false, default: null, ref: null, optionsRoute: null, readonly: false,
      calcula: null, destacado: false, computed: false,
    }));
}

/** Todo lo que la pantalla de perfil necesita saber de quien la abre. */
function leer(usuarioId) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!usuario) return null;
  const miembro = usuario.miembro_id
    ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(usuario.miembro_id)
    : null;

  const iglesia = (miembro && miembro.iglesia_id) || usuario.iglesia_id;
  const nombreIglesia = iglesia
    ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(iglesia) || {}).nombre
    : null;

  const datos = {};
  const campos = miembro ? camposDe('miembros', MIOS_EN_MIEMBROS) : camposDe('usuarios', MIOS_EN_USUARIOS);
  for (const f of campos) datos[f.name] = (miembro || usuario)[f.name] ?? null;

  return {
    enlazado: !!miembro,
    campos,
    datos,
    // Lo que decide la iglesia, para verlo sin poder cambiarlo
    ficha: {
      rut: usuario.rut,
      rol: usuario.rol,
      iglesia: nombreIglesia,
      tratamiento: miembro ? require('./tratamiento').tratamientoDe(miembro, db) : null,
      tipo_miembro: miembro ? miembro.tipo_miembro : null,
      estado: miembro ? miembro.estado : null,
      fecha_ingreso: miembro ? miembro.fecha_ingreso : null,
      fecha_bautismo: miembro ? miembro.fecha_bautismo : null,
      miembro_id: miembro ? miembro.id : null,
    },
  };
}

/**
 * Guarda los cambios del perfil donde corresponde, pasando por las mismas
 * comprobaciones y las mismas sincronizaciones que si los hubiera hecho la
 * oficina desde la ficha.
 */
function guardar(usuario, cambios) {
  const enMiembro = !!usuario.miembro_id;
  const modulo = enMiembro ? 'miembros' : 'usuarios';
  const def = getModule(modulo);
  const id = enMiembro ? usuario.miembro_id : usuario.id;
  const permitidos = enMiembro ? MIOS_EN_MIEMBROS : MIOS_EN_USUARIOS;

  const antes = db.prepare(`SELECT * FROM "${modulo}" WHERE id = ?`).get(id);
  if (!antes) return { error: 'No se encontró su ficha' };

  // Solo lo que es suyo: cualquier otro campo que venga se descarta
  const data = {};
  for (const nombre of permitidos) {
    if (cambios[nombre] === undefined) continue;
    const campo = def.fields.find((f) => f.name === nombre);
    if (!campo) continue;
    data[nombre] = coerce(campo, cambios[nombre]);
  }
  if (!Object.keys(data).length) return { ok: true, sinCambios: true };

  if (def.hooks && def.hooks.beforeSave) {
    const problema = def.hooks.beforeSave(data, { isNew: false, id, existing: antes, db, user: usuario });
    if (problema) return { error: problema };
  }

  const columnas = Object.keys(data);
  db.prepare(
    `UPDATE "${modulo}" SET ${columnas.map((c) => `"${c}" = ?`).join(', ')},
            updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(...columnas.map((c) => data[c]), id);

  const despues = db.prepare(`SELECT * FROM "${modulo}" WHERE id = ?`).get(id);
  if (def.hooks && def.hooks.afterSave) def.hooks.afterSave(despues, { isNew: false, db, user: usuario });
  bitacora.registrarGuardado(def, { isNew: false, antes, despues, datos: data, user: usuario });

  return { ok: true };
}

module.exports = { leer, guardar, MIOS_EN_MIEMBROS, MIOS_EN_USUARIOS };
