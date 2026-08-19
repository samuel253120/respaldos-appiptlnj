/**
 * Módulo: Pastores y Guías (liderazgo ministerial).
 *
 * El pastor y la pastora de una iglesia local son **también miembros de esa
 * iglesia**: además de su ficha aquí, tienen su ficha de miembro. Por eso
 * cada registro se enlaza con su ficha de miembro —el sistema la reconoce
 * sola por el RUT— y quien todavía no la tenga aparece marcado, con un botón
 * para crearla con sus mismos datos.
 *
 * De ese enlace depende, además, el trato: a quien está en este módulo se le
 * dice Pastor o Pastora en todo el sistema, y a su cónyuge también.
 *
 * Matrimonio: el pastor y la pastora se vinculan entre sí; el vínculo queda
 * en las dos fichas. Si el cónyuge no está en este módulo sino en Miembros,
 * se vincula allá.
 */
/** La ficha de miembro de un pastor: la enlazada, o la que tenga su mismo RUT. */
function fichaDeMiembro(pastor, db) {
  if (!pastor) return null;
  if (pastor.miembro_id) {
    const m = db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.miembro_id);
    if (m) return m;
  }
  if (pastor.rut) return db.prepare('SELECT * FROM miembros WHERE rut = ?').get(pastor.rut) || null;
  return null;
}

module.exports = {
  name: 'pastores',
  label: 'Pastores / Guías',
  labelSingular: 'Pastor / Guía',
  icon: '🧑‍💼',
  group: 'Organización',
  order: 11,
  display: '{nombres} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono'],
  listFields: ['foto', 'rut', 'nombres', 'apellidos', 'cargo', 'iglesia_id', 'ficha_miembro', 'estado'],
  computed: [
    {
      name: 'ficha_miembro', label: 'Ficha de miembro', type: 'badge',
      calc: (r, { db }) => {
        const m = fichaDeMiembro(r, db);
        return m ? { texto: 'Registrado', nivel: 'ok' } : { texto: 'Falta registrarlo', nivel: 'bajo' };
      },
    },
  ],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  fields: [
    { name: 'nombres', label: 'Nombres', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    {
      name: 'cargo', label: 'Cargo', type: 'select', required: true, default: 'Pastor',
      options: ['Pastor', 'Pastora', 'Guía', 'Anciano', 'Diácono', 'Diaconisa', 'Evangelista', 'Misionero', 'Otro'],
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true,
      help: 'Con o sin puntos. Se valida el dígito verificador y evita registros repetidos.',
    },
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date' },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'documento_identidad', label: 'Otro documento (pasaporte / extranjero)', type: 'text' },
    { name: 'fecha_ordenacion', label: 'Fecha de ordenación', type: 'date' },
    {
      name: 'miembro_id', label: 'Su ficha de miembro', type: 'ref', ref: 'miembros',
      help: 'El pastor y la pastora son también miembros de su iglesia. Si tienen el mismo RUT, el sistema la reconoce sola.',
    },
    {
      name: 'conyuge_id', label: 'Cónyuge (pastor / guía)', type: 'ref', ref: 'pastores',
      help: 'Si su cónyuge también está registrado aquí, elíjalo: el vínculo queda en las dos fichas. Si solo está en Miembros, vincúlelo desde allá.',
    },
    {
      name: 'conyuge_miembro_id', label: 'Cónyuge (miembro)', type: 'ref', ref: 'miembros',
      help: 'Si su cónyuge está registrado como miembro y no como pastor(a).',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'],
    },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Crea la ficha de miembro de un pastor con sus mismos datos y las deja
     * enlazadas. Si ya existe una con su RUT, solo se enlaza.
     */
    router.post('/pastores/:id(\\d+)/ficha-miembro', requirePerm('miembros', 'create'), (req, res) => {
      const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(req.params.id);
      if (!pastor) return res.status(404).json({ error: 'Pastor no encontrado' });
      if (!require('../alcance').alcanzaIglesia(req.user, pastor.iglesia_id)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      if (!pastor.iglesia_id) return res.status(400).json({ error: 'Primero indique a qué iglesia pertenece' });

      const ya = fichaDeMiembro(pastor, db);
      if (ya) {
        db.prepare('UPDATE pastores SET miembro_id = ? WHERE id = ?').run(ya.id, pastor.id);
        return res.json({ ok: true, miembro_id: ya.id, creada: false });
      }

      const info = db
        .prepare(
          `INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, fecha_nacimiento, telefono, email,
                                 direccion, foto, estado, notas, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?)`
        )
        .run(
          pastor.nombres, pastor.apellidos, pastor.rut || null, pastor.iglesia_id,
          pastor.fecha_nacimiento || null, pastor.telefono || null, pastor.email || null,
          pastor.direccion || null, pastor.foto || null,
          'Ficha creada desde Pastores / Guías: es también miembro de su iglesia.', req.user.id
        );
      db.prepare('UPDATE pastores SET miembro_id = ? WHERE id = ?').run(info.lastInsertRowid, pastor.id);
      res.status(201).json({ ok: true, miembro_id: info.lastInsertRowid, creada: true });
    });
  },

  hooks: {
    beforeSave(data, { id, existing, db }) {
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && id && Number(conyuge) === Number(id)) {
        return 'Un pastor no puede figurar como su propio cónyuge';
      }

      // Si no se indicó su ficha de miembro, se busca por RUT: es la misma persona
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      const enlace = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      if (!enlace && rut) {
        const miembro = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut);
        if (miembro) data.miembro_id = miembro.id;
      }
      return null;
    },

    /** El vínculo del matrimonio queda en las dos fichas. */
    afterSave(fila, { db }) {
      const conyugeId = fila.conyuge_id || null;
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(fila.id, conyugeId || 0);
      if (!conyugeId) return;

      const conyuge = db.prepare('SELECT * FROM pastores WHERE id = ?').get(conyugeId);
      if (!conyuge) {
        db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE id = ?').run(fila.id);
        return;
      }
      if (conyuge.conyuge_id && Number(conyuge.conyuge_id) !== Number(fila.id)) {
        db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE id = ?').run(conyuge.conyuge_id);
      }
      db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(fila.id, conyuge.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
