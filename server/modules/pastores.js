/**
 * Módulo: Pastores y Guías (liderazgo ministerial).
 *
 * El pastor y la pastora de una iglesia local son **también miembros de esa
 * iglesia**: además de su ficha aquí, tienen su ficha de miembro. Por eso
 * cada registro se enlaza con su ficha de miembro —el sistema la reconoce
 * sola por el RUT— y quien todavía no la tenga aparece marcado, con un botón
 * para crearla con sus mismos datos.
 *
 * De ese enlace depende, además, el trato: a quien tiene cargo pastoral se
 * le dice Pastor o Pastora en todo el sistema, y a su cónyuge también; al
 * guía de obra se le dice guía de obra.
 *
 * Matrimonio: el pastor y la pastora se vinculan entre sí; el vínculo queda
 * en las dos fichas. Si el cónyuge no está en este módulo sino en Miembros,
 * se vincula allá.
 *
 * Cada ficha lleva además su historial ministerial (historial_pastores) y sus
 * documentos (documentos_pastores), que se ven al pie de su ficha.
 */

/**
 * Los cargos salen de server/tratamiento.js, que es donde vive la escala del
 * ministerio. El guía de obra es el primer cargo y todavía no es pastoral: se
 * le dice guía de obra, y su cónyuge no pasa a ser Pastor ni Pastora.
 */
const { CARGO_GUIA, CARGOS_MINISTERIO: CARGOS, CARGO_UNICO } = require('../tratamiento');

/** ¿Este cargo es pastoral? El de guía de obra todavía no lo es. */
const esCargoPastoral = (cargo) => !!cargo && cargo !== CARGO_GUIA;

/**
 * Cómo está el pastor respecto de su ficha de miembro. El enlace vale desde
 * ya; el RUT es la verificación: cuando está en las dos fichas, tiene que ser
 * el mismo, porque es la misma persona.
 */
function estadoFichaMiembro(pastor, db) {
  const miembro = fichaDeMiembro(pastor, db);
  if (!miembro) return { texto: 'Falta registrarlo', nivel: 'bajo', miembro: null };
  if (pastor.rut && miembro.rut && pastor.rut !== miembro.rut) {
    return { texto: 'RUT distinto', nivel: 'bajo', miembro };
  }
  if (pastor.rut && !miembro.rut) return { texto: 'Falta el RUT en su ficha', nivel: 'medio', miembro };
  if (!pastor.rut && miembro.rut) return { texto: 'Falta el RUT aquí', nivel: 'medio', miembro };
  return { texto: 'Registrado', nivel: 'ok', miembro };
}

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
  order: 51,
  display: '{nombres:primero} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono'],
  listFields: ['foto', 'rut', 'nombres', 'apellidos', 'cargo', 'iglesia_id', 'ficha_miembro', 'estado'],
  computed: [
    {
      name: 'ficha_miembro', label: 'Ficha de miembro', type: 'badge',
      calc: (r, { db }) => {
        const { texto, nivel } = estadoFichaMiembro(r, db);
        return { texto, nivel };
      },
    },
  ],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  fields: [
    { name: 'nombres', label: 'Nombres', recorta: 'primero', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    {
      name: 'cargo', label: 'Cargo', type: 'select', required: true, default: CARGO_GUIA,
      options: CARGOS,
      help: 'De menor a mayor. El de Pastor Presidente lo ocupa una sola persona en toda la organización.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true, reservado: 'miembros_identidad',
      help: 'Con o sin puntos. Se valida el dígito verificador y evita registros repetidos.',
    },
    {
      name: 'funcion', label: 'Cargo o función que ejerce', type: 'text',
      sugerencias: ['Pastor Titular', 'Pastora Titular', 'Pastor Supervisor', 'Pastor Auxiliar', 'Encargado de Obra'],
      help:
        'La función que ejerce hoy, distinta del grado. El grado es la escala del ministerio —el campo de arriba—; ' +
        'esto es el puesto: Pastor Titular, Pastor Supervisor. Es opcional: si se deja en blanco, en la credencial ' +
        'no se imprime esa línea y su espacio se reparte entre los demás datos.',
    },
    { name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', reservado: 'miembros_identidad' },
    // Reservados igual que en la ficha de miembro (ver server/sensibles.js)
    { name: 'telefono', label: 'Teléfono', type: 'tel', reservado: 'miembros_contacto' },
    { name: 'email', label: 'Correo electrónico', type: 'email', reservado: 'miembros_contacto' },
    { name: 'direccion', label: 'Dirección', type: 'text', reservado: 'miembros_contacto' },
    { name: 'documento_identidad', label: 'Otro documento (pasaporte / extranjero)', type: 'text' },
    { name: 'fecha_ordenacion', label: 'Fecha de ordenación', type: 'date', noAntesDe: 'fecha_nacimiento' },
    {
      name: 'miembro_id', label: 'Su ficha de miembro', type: 'ref', ref: 'miembros',
      help: 'El pastor y la pastora son también miembros de su iglesia. Si tienen el mismo RUT, el sistema la reconoce sola.',
    },
    {
      name: 'conyuge_id', label: 'Cónyuge', type: 'ref', ref: 'miembros',
      optionsRoute: '/pastores/conyuges?pastor_id={id}',
      help: 'Se ofrecen las personas del sexo opuesto; si el cargo es pastoral, solo las que ya tienen trato de Pastor o Pastora —registradas en Pastores / Guías o con ese trato fijado en su ficha—. El vínculo queda también en las fichas de miembro de ambos.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'],
    },
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*', recorte: 'cuadrado' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  extraRoutes(router, { db, requirePerm }) {

    /**
     * Los pastores, cada uno junto a su cónyuge: «Pastor Juan Pérez Soto y
     * Pastora Ana Díaz Soto». Lo usa la ficha de la iglesia para elegir al
     * pastor principal, porque de una iglesia responden los dos y al elegirlo
     * conviene ver a la pareja completa.
     */
    router.get('/pastores/con-conyuge', requirePerm('pastores', 'view'), (req, res) => {
      const trato = require('../tratamiento');
      const nombres = require('../nombres');
      const params = [];
      const donde = require('../alcance').condiciones(module.exports, req.user, params);
      const filas = db
        .prepare(`SELECT * FROM pastores ${donde ? 'WHERE ' + donde : ''} ORDER BY apellidos, nombres`)
        .all(...params);
      res.json(
        filas.map((p) => {
          const suyo = p.miembro_id ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(p.miembro_id) : null;
          const el = suyo ? trato.conTratamiento(suyo, db) : nombres.paraMostrar(p.nombres, p.apellidos);
          const ella = p.conyuge_id ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(p.conyuge_id) : null;
          return { id: p.id, label: ella ? `${el} y ${trato.conTratamiento(ella, db)}` : el };
        })
      );
    });
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

    /**
     * Quiénes pueden ser cónyuge de este pastor: los miembros del sexo
     * opuesto, dentro de lo que el usuario tiene asignado. Mientras la ficha
     * no diga el sexo del pastor —o sea una ficha nueva— se ofrecen todos los
     * que tengan género registrado, y la comprobación se hace al guardar.
     */
    router.get('/pastores/conyuges', requirePerm('pastores', 'view'), (req, res) => {
      const { getModule, displayOf } = require('../registry');
      const alcance = require('../alcance');
      const miembros = getModule('miembros');

      const pastor = req.query.pastor_id
        ? db.prepare('SELECT * FROM pastores WHERE id = ?').get(Number(req.query.pastor_id))
        : null;
      const suya = pastor ? fichaDeMiembro(pastor, db) : null;
      const suGenero = suya ? suya.genero : null;

      const cond = ["genero IS NOT NULL", "genero != ''", "(estado IS NULL OR estado != 'Fallecido')"];
      const params = [];
      if (suGenero) {
        cond.push('genero != ?');
        params.push(suGenero);
      }
      if (suya) {
        cond.push('id != ?');
        params.push(suya.id);
      }
      const suyas = alcance.iglesiasDe(req.user);
      if (suyas.length) {
        cond.push(`iglesia_id IN (${suyas.map(() => '?').join(',')})`);
        params.push(...suyas);
      }

      const { esPastorPorSiMismo } = require('../tratamiento');
      const exigePastoral = !pastor || esCargoPastoral(pastor.cargo);
      const filas = db
        .prepare(`SELECT * FROM miembros WHERE ${cond.join(' AND ')} ORDER BY apellidos, nombres LIMIT 1000`)
        .all(...params)
        // El cónyuge de un pastor tiene trato de pastora (y el de una pastora,
        // de pastor): son quienes tienen su propia ficha en Pastores / Guías o
        // ese trato fijado en la suya. Al guía de obra no se le exige, porque
        // su cónyuge sigue siendo hermano o hermana.
        .filter((f) => !exigePastoral || esPastorPorSiMismo(f, db));

      res.json(
        filas.map((f) => {
          const label = displayOf(miembros, f);
          return { id: f.id, label, buscar: `${label} ${f.rut || ''} ${f.telefono || ''}`.trim() };
        })
      );
    });

    /** Cómo está el enlace con su ficha de miembro, para mostrarlo en su ficha. */
    router.get('/pastores/:id(\\d+)/ficha-miembro', requirePerm('pastores', 'view'), (req, res) => {
      const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(req.params.id);
      if (!pastor) return res.status(404).json({ error: 'Pastor no encontrado' });
      const estado = estadoFichaMiembro(pastor, db);
      res.json({
        estado: estado.texto,
        nivel: estado.nivel,
        rut_pastor: pastor.rut || null,
        miembro: estado.miembro
          ? {
              id: estado.miembro.id,
              nombre: `${estado.miembro.nombres || ''} ${estado.miembro.apellidos || ''}`.trim(),
              rut: estado.miembro.rut || null,
            }
          : null,
      });
    });

    /**
     * Copia el RUT del pastor a su ficha de miembro cuando allá falta. No
     * pisa un RUT ya escrito: si los dos existen y no calzan, hay que
     * corregir el que esté equivocado.
     */
    router.post('/pastores/:id(\\d+)/copiar-rut', requirePerm('miembros', 'edit'), (req, res) => {
      const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(req.params.id);
      if (!pastor) return res.status(404).json({ error: 'Pastor no encontrado' });
      if (!pastor.rut) return res.status(400).json({ error: 'Esta ficha no tiene RUT que copiar' });
      const miembro = fichaDeMiembro(pastor, db);
      if (!miembro) return res.status(400).json({ error: 'Todavía no tiene ficha de miembro' });
      if (miembro.rut && miembro.rut !== pastor.rut) {
        return res.status(400).json({ error: 'Su ficha de miembro ya tiene otro RUT: corrija el que esté equivocado' });
      }
      const ocupado = db.prepare('SELECT id, nombres, apellidos FROM miembros WHERE rut = ? AND id != ?').get(pastor.rut, miembro.id);
      if (ocupado) {
        return res.status(400).json({
          error: `Ese RUT ya lo tiene otro miembro (${ocupado.nombres} ${ocupado.apellidos}). Revise cuál es el correcto.`,
        });
      }
      db.prepare('UPDATE miembros SET rut = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(pastor.rut, miembro.id);
      res.json({ ok: true, miembro_id: miembro.id, rut: pastor.rut });
    });
  },

  hooks: {
    beforeSave(data, { id, existing, db }) {
      // Un solo Pastor Presidente en toda la organización
      const cargo = data.cargo !== undefined ? data.cargo : existing ? existing.cargo : null;
      if (cargo === CARGO_UNICO) {
        const otro = db
          .prepare(`SELECT nombres, apellidos FROM pastores WHERE cargo = ? AND id != ? AND (estado IS NULL OR estado = 'Activo')`)
          .get(CARGO_UNICO, id || 0);
        if (otro) {
          return `Ya hay un ${CARGO_UNICO}: ${otro.nombres} ${otro.apellidos}. ` +
            'Cámbiele el cargo o su estado antes de designar a otro.';
        }
      }

      // Si no se indicó su ficha de miembro, se busca por RUT: es la misma persona
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      let enlace = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      if (!enlace && rut) {
        const miembro = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut);
        if (miembro) {
          data.miembro_id = miembro.id;
          enlace = miembro.id;
        }
      }

      // Nadie es su propio cónyuge
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && enlace && Number(conyuge) === Number(enlace)) {
        return 'Un pastor no puede figurar como su propio cónyuge';
      }

      // El cónyuge de un pastor es del sexo opuesto: la esposa del pastor es
      // mujer y el marido de la pastora es varón.
      if (conyuge) {
        const otro = db.prepare('SELECT nombres, apellidos, genero FROM miembros WHERE id = ?').get(conyuge);
        if (!otro) return 'La ficha de miembro indicada como cónyuge no existe';
        if (!otro.genero) {
          return `Antes de vincularlos, indique el género en la ficha de ${otro.nombres} ${otro.apellidos}.`;
        }
        const propia = enlace ? db.prepare('SELECT genero FROM miembros WHERE id = ?').get(enlace) : null;
        if (propia && propia.genero && propia.genero === otro.genero) {
          return `El cónyuge tiene que ser del sexo opuesto: ${otro.nombres} ${otro.apellidos} figura como ${otro.genero.toLowerCase()}, igual que esta ficha.`;
        }

        // Y, si el cargo es pastoral, tiene que tener trato de pastor o
        // pastora por su propio registro. El cónyuge del guía de obra no:
        // sigue siendo hermano o hermana.
        const { esPastorPorSiMismo } = require('../tratamiento');
        const completa = db.prepare('SELECT * FROM miembros WHERE id = ?').get(conyuge);
        if (esCargoPastoral(cargo) && !esPastorPorSiMismo(completa, db)) {
          const trato = otro.genero === 'Femenino' ? 'Pastora' : 'Pastor';
          return `${otro.nombres} ${otro.apellidos} todavía no tiene trato de ${trato}. ` +
            `Regístrele su ficha en Pastores / Guías, o fíjele el trato de ${trato} en su ficha de miembro, y vuelva a intentarlo.`;
        }
      }

      // El RUT tiene que ser el mismo en las dos fichas: es la misma persona
      if (enlace && rut) {
        const miembro = db.prepare('SELECT nombres, apellidos, rut FROM miembros WHERE id = ?').get(enlace);
        if (miembro && miembro.rut && miembro.rut !== rut) {
          return `El RUT no coincide con el de su ficha de miembro (${miembro.nombres} ${miembro.apellidos}: ${miembro.rut}). ` +
            'Corrija el que esté equivocado, o enlace la ficha que corresponda.';
        }
      }
      return null;
    },

    /**
     * El matrimonio vive en las fichas de miembro: al indicar aquí al cónyuge,
     * el vínculo queda también entre la ficha de miembro del pastor y la de
     * su cónyuge, en los dos sentidos.
     */
    afterSave(fila, { db }) {
      const conyugeId = fila.conyuge_id || null;
      if (!conyugeId) return;

      const suyaDeMiembro = fichaDeMiembro(fila, db);
      if (!suyaDeMiembro || Number(suyaDeMiembro.id) === Number(conyugeId)) return;

      // Se sueltan los vínculos anteriores que quedaran colgando
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(suyaDeMiembro.id, conyugeId);
      const otro = db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(conyugeId);
      if (otro && otro.conyuge_id && Number(otro.conyuge_id) !== Number(suyaDeMiembro.id)) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(otro.conyuge_id);
      }
      db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(conyugeId, suyaDeMiembro.id);
      db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(suyaDeMiembro.id, conyugeId);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
