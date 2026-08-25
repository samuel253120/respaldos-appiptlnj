/**
 * Módulo: Miembros (membresía de cada iglesia).
 *
 * La edad se calcula sola a partir de la fecha de nacimiento: no se guarda,
 * se resuelve cada vez que se lee la ficha, así nunca queda desactualizada.
 *
 * Las fechas de matrimonio (civil y religioso) solo aparecen cuando el estado
 * civil es "Casado(a)". Si más adelante cambia el estado, el dato no se
 * pierde: queda guardado, solo deja de mostrarse.
 *
 * Los documentos del miembro (carnet, ficha de registro, ficha de
 * actualización, etc.) van en su propio módulo, para poder adjuntar todos los
 * que hagan falta a una misma persona.
 *
 * Trato: cada miembro muestra cómo se le dice —Hermano, Hermana, Oficial,
 * Guía de Obra, Pastor o Pastora—, calculado según su género, si pertenece al
 * cuerpo de oficiales y qué cargo tiene en Pastores / Guías (ver
 * server/tratamiento.js).
 * Se puede fijar a mano cuando corresponda otro trato.
 *
 * Matrimonio: al vincular a dos miembros como cónyuges, el vínculo se
 * devuelve solo en la ficha del otro, y las fechas de matrimonio se copian a
 * quien las tenga en blanco, para no registrarlas dos veces.
 *
 * Acceso al sistema: a un miembro se le puede crear su usuario desde su
 * propia ficha. Quedan enlazados, y el RUT, el nombre, el correo y el
 * teléfono se mantienen iguales en los dos módulos, se cambien donde se
 * cambien.
 *
 * La ficha viene ordenada por secciones: identificación, adulto responsable
 * (solo para menores de 18, según la fecha de nacimiento), educación y
 * trabajo, estado civil y familia, contacto, vida en la iglesia, contacto de
 * emergencia, información médica y notas.
 *
 * Los datos de salud y la nota importante van marcados como `sensible`: el
 * historial deja constancia de que cambiaron, sin copiar su contenido.
 */
const { TRATAMIENTOS, tratamientoDe } = require('../tratamiento');

/** Por dónde llegó cada persona a la iglesia. */
const FORMAS_DE_INGRESO = [
  'Servicio General',
  'Redes Sociales',
  'Traslado de Iglesia',
  'Nacido en la Iglesia',
  'Campaña Evangelística',
  'Invitación de Hermano(a)',
  'Otro',
];

/**
 * Cómo participa cada persona en la vida de la iglesia. No es lo mismo que su
 * estado (activo, inactivo…): una persona activa puede ser oyente, y un menor
 * de edad sigue siendo miembro.
 */
const TIPOS_DE_MIEMBRO = [
  'Miembro Nuevo', 'Miembro Menor de Edad', 'Miembro Oyente', 'Miembro Activo', 'Miembro Líder',
];

/**
 * Deja al día el usuario del sistema enlazado a este miembro: comparten el
 * RUT, el nombre, el correo, el teléfono y la foto. Si el miembro pasa a fallecido o
 * trasladado, su acceso queda desactivado.
 */
function sincronizarUsuario(fila, db) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(fila.id);
  if (!usuario) return;

  const nombre = `${fila.nombres || ''} ${fila.apellidos || ''}`.trim();
  const cambios = [];
  const valores = [];
  const igualar = (columna, valor) => {
    if ((valor || null) === (usuario[columna] || null)) return;
    cambios.push(`"${columna}" = ?`);
    valores.push(valor || null);
  };
  igualar('nombre', nombre);
  igualar('rut', fila.rut);
  igualar('email', fila.email);
  igualar('telefono', fila.telefono);
  igualar('foto', fila.foto);

  // Quien ya no está en la iglesia no debe poder entrar al sistema
  if (['Fallecido', 'Trasladado'].includes(fila.estado) && usuario.activo) {
    cambios.push('activo = ?');
    valores.push(0);
  }
  if (!cambios.length) return;
  db.prepare(`UPDATE usuarios SET ${cambios.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...valores, usuario.id);
}

/** Años cumplidos a la fecha de hoy. */
function edadEnAnios(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(nace.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nace.getFullYear();
  const mes = hoy.getMonth() - nace.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nace.getDate())) anios--;
  return anios >= 0 && anios < 130 ? anios : null;
}

/** Meses cumplidos, para los menores de un año. */
function mesesDeVida(fechaNacimiento) {
  const nace = new Date(String(fechaNacimiento).slice(0, 10) + 'T00:00:00');
  const hoy = new Date();
  let meses = (hoy.getFullYear() - nace.getFullYear()) * 12 + (hoy.getMonth() - nace.getMonth());
  if (hoy.getDate() < nace.getDate()) meses--;
  return Math.max(0, meses);
}

module.exports = {
  name: 'miembros',
  label: 'Miembros',
  labelSingular: 'Miembro',
  icon: '🧍',
  group: 'Personas',
  order: 20,
  display: '{nombres:primero} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email'],
  listFields: ['foto', 'tratamiento', 'nombres', 'apellidos', 'rut', 'edad', 'tipo_miembro', 'iglesia_id', 'estado'],
  filterFields: ['tipo_miembro', 'estado', 'iglesia_id'],
  defaultSort: { field: 'apellidos', dir: 'asc' },
  printable: true,
  computed: [
    {
      name: 'tratamiento', label: 'Trato', type: 'texto',
      calc: (r, { db }) => tratamientoDe(r, db),
    },
    {
      /**
       * Lo que quedó pendiente entre esta ficha y la de su cónyuge.
       *
       * Vincular el matrimonio de un pastor y registrarlo en Pastores / Guías
       * son dos actos distintos, y pueden pasar meses entre uno y otro. En ese
       * rato la pareja queda a medias: él figura como pastor y ella sigue con
       * trato de hermana. Guardar la ficha ya no se bloquea por eso —bloquear
       * castigaba a quien venía a corregir un teléfono— así que se dice acá,
       * arriba de la ficha, que es donde alguien puede hacer algo.
       *
       * Cuesta poco: la ficha que no tiene cónyuge —que son casi todas— se
       * responde sin mirar la base.
       */
      name: 'pareja_pendiente', label: 'Pendiente con su cónyuge', type: 'texto',
      calc: (r, { db }) => {
        if (!r.conyuge_id) return '';
        const { esPastorRegistrado, esPastorPorSiMismo } = require('../tratamiento');
        const otro = db.prepare('SELECT id, nombres, apellidos, genero, rut FROM miembros WHERE id = ?').get(r.conyuge_id);
        if (!otro) return 'La persona que figura como su cónyuge ya no está en Miembros.';
        if (!esPastorRegistrado(otro, db) && !esPastorRegistrado(r, db)) return '';
        const falta = [r, otro].find((quien) => quien && !esPastorPorSiMismo(quien, db));
        if (!falta) return '';
        const trato = falta.genero === 'Femenino' ? 'Pastora' : 'Pastor';
        const quien = Number(falta.id) === Number(r.id) ? 'Esta persona' : `${falta.nombres} ${falta.apellidos}`;
        return `${quien} todavía no tiene trato de ${trato}, y su cónyuge sí figura en Pastores / Guías. ` +
          `Regístrele su ficha en Pastores / Guías, o fíjele el trato de ${trato} en su ficha.`;
      },
    },
    {
      name: 'edad', label: 'Edad', type: 'texto',
      calc: (r) => {
        const a = edadEnAnios(r.fecha_nacimiento);
        if (a == null) return '';
        if (a > 0) return `${a} año${a === 1 ? '' : 's'}`;
        const m = mesesDeVida(r.fecha_nacimiento); // los más pequeños, en meses
        return `${m} mes${m === 1 ? '' : 'es'}`;
      },
    },
  ],
  fields: [
    // ---------------- Identificación ----------------
    {
      name: 'foto', label: 'Foto', type: 'file', accept: 'image/*', seccion: 'Identificación',
      recorte: 'cuadrado',
      help: 'Se puede sacar con el teléfono: al subirla se ajusta sola de tamaño para que cargue rápido.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'rut', label: 'RUT', type: 'rut', unique: true, reservado: 'miembros_identidad',
      help: 'Con o sin puntos. Se valida el dígito verificador y evita miembros repetidos.',
    },
    {
      name: 'tratamiento_personalizado', label: 'Trato (fijado a mano)', type: 'select',
      options: TRATAMIENTOS,
      help: 'Solo si le corresponde un trato distinto del que calcula el sistema. En blanco, se calcula solo.',
    },
    { name: 'nombres', label: 'Nombres', recorta: 'primero', type: 'text', required: true },
    { name: 'apellidos', label: 'Apellidos', type: 'text', required: true },
    {
      name: 'fecha_nacimiento', label: 'Fecha de nacimiento', type: 'date', reservado: 'miembros_identidad',
      mostrarEdad: true, help: 'La edad se calcula sola.',
    },
    {
      name: 'genero', label: 'Sexo', type: 'select',
      options: ['Femenino', 'Masculino'],
    },

    // ------- Adulto responsable (solo para menores de 18) -------
    {
      name: 'responsable_nombre', label: 'Nombre y apellido del adulto responsable', type: 'text',
      seccion: 'Adulto responsable (menor de edad)', showIf: { field: 'fecha_nacimiento', menorDe: 18 },
      help: 'Quién responde por este miembro mientras sea menor de 18 años.',
    },
    {
      name: 'responsable_rut', label: 'RUT del adulto responsable', type: 'rut',
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
    },
    {
      name: 'responsable_parentesco', label: 'Parentesco con el menor', type: 'text',
      sugerencias: ['Madre', 'Padre', 'Abuelo(a)', 'Tío(a)', 'Hermano(a)', 'Tutor(a) legal'],
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
      help: 'Se elige de la lista o se escribe como corresponda (abuela, tía, madrina…).',
    },
    {
      name: 'responsable_telefono', label: 'Teléfono del adulto responsable', type: 'tel',
      showIf: { field: 'fecha_nacimiento', menorDe: 18 },
    },

    // ---------------- Educación y trabajo ----------------
    {
      name: 'nivel_educacional', label: 'Nivel educacional', type: 'select',
      seccion: 'Educación y trabajo',
      options: [
        'Sin estudios formales',
        'Básica en curso', 'Básica incompleta', 'Básica completa',
        'Media en curso', 'Media incompleta', 'Media completa',
        'Técnica en curso', 'Técnica incompleta', 'Técnica completa',
        'Universitaria en curso', 'Universitaria incompleta', 'Universitaria completa',
        'Postgrado',
      ],
      help: '«En curso» es quien está estudiando ahora; «incompleta», quien la dejó.',
    },
    {
      name: 'titulo_estudios', label: 'Título o estudios cursados', type: 'text',
      help: 'Ej: Técnico en enfermería, Profesor de Historia…',
    },
    {
      name: 'ocupacion', label: 'Profesión u oficio', type: 'text',
      help: 'A qué se dedica hoy. Ej: gásfiter, contadora, dueña de casa, estudiante.',
    },
    { name: 'lugar_trabajo', label: 'Lugar de trabajo o estudio', type: 'text' },

    // ---------------- Estado civil y familia ----------------
    {
      name: 'estado_civil', label: 'Estado civil', type: 'select', seccion: 'Estado civil y familia',
      options: ['Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)', 'Divorciado(a)'],
    },
    {
      name: 'fecha_matrimonio_civil', label: 'Fecha de matrimonio civil', type: 'date', noAntesDe: 'fecha_nacimiento',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    {
      name: 'fecha_matrimonio_religioso', label: 'Fecha de matrimonio por la iglesia', type: 'date', noAntesDe: 'fecha_nacimiento',
      showIf: { field: 'estado_civil', equals: 'Casado(a)' },
    },
    {
      name: 'conyuge_nombre', label: 'Nombre del cónyuge', type: 'text',
      showIf: { field: 'estado_civil', in: ['Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)'] },
      help: 'Se anota esté o no registrado como miembro.',
    },
    {
      name: 'conyuge_id', label: 'Cónyuge (miembro)', type: 'ref', ref: 'miembros',
      showIf: { field: 'estado_civil', in: ['Casado(a)', 'Unión libre', 'Separado(a)', 'Viudo(a)'] },
      help: 'Si además está registrado, elíjalo aquí: el vínculo queda en las dos fichas.',
    },

    // ---------------- Contacto ----------------
    // Reservados: se puede quitar el permiso `miembros_contacto` a quien tenga
    // que consultar el registro sin llevarse los teléfonos y las direcciones de
    // la congregación. De fábrica lo tienen todos (ver server/sensibles.js).
    { name: 'telefono', label: 'Teléfono', type: 'tel', seccion: 'Contacto', reservado: 'miembros_contacto' },
    { name: 'email', label: 'Correo electrónico', type: 'email', reservado: 'miembros_contacto' },
    { name: 'direccion', label: 'Dirección', type: 'text', reservado: 'miembros_contacto' },

    // ---------------- Vida en la iglesia ----------------
    {
      name: 'forma_ingreso', label: 'Forma de ingreso', type: 'select', seccion: 'Vida en la iglesia',
      options: FORMAS_DE_INGRESO,
      help: 'Por dónde llegó a esta iglesia.',
    },
    { name: 'fecha_ingreso', label: 'Fecha de ingreso a la iglesia', type: 'date', noAntesDe: 'fecha_nacimiento' },
    { name: 'fecha_conversion', label: 'Fecha de conversión', type: 'date', noAntesDe: 'fecha_nacimiento' },
    { name: 'fecha_bautismo', label: 'Fecha de bautismo', type: 'date', noAntesDe: 'fecha_nacimiento' },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo', 'En disciplina', 'Trasladado', 'Fallecido'],
    },
    {
      name: 'tipo_miembro', label: 'Tipo de miembro', type: 'select',
      options: TIPOS_DE_MIEMBRO,
      help: 'Menor de edad: quien todavía no cumple 18 años. Oyente: asiste sin estar en plena membresía.',
    },

    // ---------------- Contacto de emergencia ----------------
    {
      name: 'emergencia_nombre', label: 'Nombre del contacto', type: 'text',
      seccion: 'Contacto de emergencia',
      help: 'A quién avisar en caso de emergencia.',
    },
    {
      name: 'emergencia_parentesco', label: 'Parentesco', type: 'text',
      sugerencias: ['Cónyuge', 'Esposo', 'Esposa', 'Madre', 'Padre', 'Hijo(a)', 'Hermano(a)',
        'Abuelo(a)', 'Nieto(a)', 'Tío(a)', 'Sobrino(a)', 'Amigo(a)', 'Vecino(a)'],
      help: 'Se elige de la lista o se escribe como corresponda (hija, esposo, nieta…).',
    },
    { name: 'emergencia_telefono', label: 'Teléfono del contacto', type: 'tel' },

    // ---------------- Información médica ----------------
    {
      name: 'enfermedades', label: 'Enfermedades', type: 'textarea', sensible: true,
      seccion: 'Información médica',
      help: 'Diagnósticos o condiciones que conviene conocer (diabetes, hipertensión, epilepsia…).',
    },
    { name: 'alergias', label: 'Alergias', type: 'textarea', sensible: true },
    {
      name: 'indicaciones_medicas', label: 'Indicaciones médicas', type: 'textarea', sensible: true,
      help: 'Medicamentos, cuidados o qué hacer ante una emergencia.',
    },

    // ---------------- Notas ----------------
    {
      name: 'nota_importante', label: 'Nota importante', type: 'textarea', sensible: true,
      destacado: true, seccion: 'Notas',
      help: 'Lo que no se puede pasar por alto de esta persona. Se muestra destacado al abrir su ficha.',
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],

  extraRoutes(router, { db, requirePerm }) {
    /**
     * Los cuerpos y grupos en los que participa este miembro, para verlos en
     * su ficha sin tener que abrir uno por uno. Se busca tanto entre los
     * integrantes como entre quienes los lideran.
     */
    router.get('/miembros/:id(\\d+)/cuerpos', requirePerm('miembros', 'view'), (req, res) => {
      const id = Number(req.params.id);
      const { cuerposDe } = require('../integrantes');

      // Los que lidera cuentan aunque no tengan ficha de integrante
      const suyos = new Map();
      for (const c of db.prepare('SELECT id, nombre, tipo, estado FROM cuerpos WHERE lider_id = ? ORDER BY nombre').all(id)) {
        suyos.set(c.id, { id: c.id, nombre: c.nombre, tipo: c.tipo, estado: c.estado, lidera: true, en: 'Activo' });
      }
      for (const f of cuerposDe(db, id, { conRetirados: true })) {
        const ya = suyos.get(f.cuerpo_id);
        if (ya) { ya.en = f.estado; ya.desde = f.fecha_ingreso; continue; }
        suyos.set(f.cuerpo_id, {
          id: f.cuerpo_id, nombre: f.nombre, tipo: f.tipo, estado: f.estado_cuerpo,
          lidera: false, en: f.estado, desde: f.fecha_ingreso,
        });
      }
      res.json({ cuerpos: [...suyos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)) });
    });

    /** Cómo está el acceso al sistema de este miembro. */
    router.get('/miembros/:id(\\d+)/usuario', requirePerm('miembros', 'view'), (req, res) => {
      const miembro = db.prepare('SELECT * FROM miembros WHERE id = ?').get(req.params.id);
      if (!miembro) return res.status(404).json({ error: 'Miembro no encontrado' });
      const usuario = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(miembro.id)
        || (miembro.rut ? db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(miembro.rut) : null);
      res.json({
        puede_designar: require('../permissions').can(req.user, 'usuarios', 'create'),
        tiene_rut: !!miembro.rut,
        usuario: usuario
          ? { id: usuario.id, nombre: usuario.nombre, rut: usuario.rut, rol: usuario.rol, activo: !!usuario.activo, enlazado: !!usuario.miembro_id }
          : null,
      });
    });

    /**
     * Designa a este miembro como usuario del sistema: crea su cuenta con sus
     * mismos datos y la contraseña inicial, que tendrá que cambiar al entrar.
     * Si ya existe una cuenta con su RUT, solo se enlaza.
     */
    router.post('/miembros/:id(\\d+)/usuario', requirePerm('usuarios', 'create'), async (req, res, next) => {
      const bcryptjs = require('bcryptjs');
      const miembro = db.prepare('SELECT * FROM miembros WHERE id = ?').get(req.params.id);
      if (!miembro) return res.status(404).json({ error: 'Miembro no encontrado' });
      if (!require('../alcance').alcanza(module.exports, miembro, req.user)) {
        return res.status(403).json({ error: 'Ese registro está fuera de lo que tiene asignado' });
      }
      if (!miembro.rut) {
        return res.status(400).json({ error: 'Para entrar al sistema se necesita el RUT: complételo en su ficha.' });
      }

      const yaEnlazado = db.prepare('SELECT * FROM usuarios WHERE miembro_id = ?').get(miembro.id);
      if (yaEnlazado) return res.json({ ok: true, usuario_id: yaEnlazado.id, creado: false });

      const conSuRut = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(miembro.rut);
      if (conSuRut) {
        db.prepare('UPDATE usuarios SET miembro_id = ? WHERE id = ?').run(miembro.id, conSuRut.id);
        return res.json({ ok: true, usuario_id: conSuRut.id, creado: false, enlazado: true });
      }

      // Se le entrega la contraseña inicial del sistema, la misma para todos:
      // al entrar con ella, el sistema le obliga a cambiarla por una suya.
      const inicial = require('../claves').inicial();
      /**
       * Se cifra ANTES de escribir, y esperando de verdad.
       *
       * Cifrar cuesta cerca de una décima de segundo a propósito, y el
       * servidor atiende de a una cosa: hecho de corrido, ese rato lo pagan
       * todos los que estén usando el sistema, no solo quien está designando
       * al miembro.
       */
      let info;
      try {
        const cifrada = await require('../cifrado').cifrar(inicial);
        info = db
          .prepare(
            `INSERT INTO usuarios (rut, nombre, password, password_origen, debe_cambiar_password,
                                   rol, iglesia_id, email, telefono, activo, miembro_id, created_by)
             VALUES (?, ?, ?, 'inicial', 1, 'consulta', ?, ?, ?, 1, ?, ?)`
          )
          .run(
            miembro.rut,
            `${miembro.nombres || ''} ${miembro.apellidos || ''}`.trim(),
            cifrada,
            miembro.iglesia_id || null,
            miembro.email || null,
            miembro.telefono || null,
            miembro.id,
            req.user.id
          );
      } catch (e) {
        /**
         * Dos clics seguidos, o dos personas designando al mismo miembro.
         *
         * Entre la comprobación de más arriba y este INSERT hay ahora una
         * espera de verdad —los ochenta milisegundos que cuesta cifrar—, y en
         * ese rato cabe otra petición idéntica. La primera crea la cuenta; la
         * segunda choca contra el RUT, que es único.
         *
         * No es un error que haya que mostrar: lo que esa persona quería —que
         * el miembro tenga cuenta— ya está hecho. Se busca la que quedó y se
         * contesta como si se hubiera encontrado enlazada, que es lo que la
         * pantalla espera.
         *
         * Y si el fallo es otro, va al manejador de errores. Antes no iba a
         * ninguna parte: la petición se quedaba colgada sin respuesta hasta
         * que el navegador se cansaba. Comprobado: de tres clics a la vez, dos
         * no recibían nada nunca.
         */
        const laQueGano = db.prepare('SELECT id FROM usuarios WHERE rut = ?').get(miembro.rut);
        if (!laQueGano) return next(e);
        db.prepare('UPDATE usuarios SET miembro_id = ? WHERE id = ? AND miembro_id IS NULL')
          .run(miembro.id, laQueGano.id);
        return res.json({ ok: true, usuario_id: laQueGano.id, creado: false, enlazado: true });
      }

      res.status(201).json({ ok: true, usuario_id: info.lastInsertRowid, creado: true, password: inicial, rut: miembro.rut });
    });
  },

  hooks: {
    beforeSave(data, { id, existing, db }) {
      const rutDe = (d, e) => (d.rut !== undefined ? d.rut : e ? e.rut : null);
      const conyuge = data.conyuge_id !== undefined ? data.conyuge_id : existing ? existing.conyuge_id : null;
      if (conyuge && id && Number(conyuge) === Number(id)) {
        return 'Un miembro no puede figurar como su propio cónyuge';
      }

      /**
       * El cónyuge de quien está en Pastores / Guías es del sexo opuesto; y si
       * el cargo es pastoral, nunca queda con trato de Hermano, Hermana ni
       * Oficial: es Pastor o Pastora. Al guía de obra no se le aplica esto
       * último, porque su cónyuge sigue siendo hermano o hermana.
       *
       * Estas dos comprobaciones miran a DOS fichas y a lo que diga Pastores /
       * Guías, y eso puede cambiar sin que esta ficha se toque: se registra al
       * marido en Pastores un mes después de haber vinculado el matrimonio, y
       * desde ese momento la ficha de la señora queda en falta.
       *
       * Antes se exigían en todo guardado, y el resultado era que esa ficha no
       * se dejaba guardar más: ni para corregirle el teléfono, ni la dirección,
       * ni nada. Se topó tres veces probando, así que en el uso real aparece.
       * Y castigaba a quien venía a arreglar otra cosa por algo que no hizo y
       * que a lo mejor ni sabía.
       *
       * Ahora se exigen cuando este guardado es el que está armando o
       * cambiando el vínculo —o el sexo, del que dependen—. Si el vínculo ya
       * venía así, no se bloquea: se avisa arriba de la ficha, que es donde se
       * puede hacer algo al respecto.
       */
      const { estaEnPastores, esPastorRegistrado } = require('../tratamiento');
      const antes = existing || {};
      const cambiaElVinculo = data.conyuge_id !== undefined
        && Number(data.conyuge_id || 0) !== Number(antes.conyuge_id || 0);
      const cambiaElSexo = data.genero !== undefined && data.genero !== antes.genero;
      const revisarLaPareja = !id || cambiaElVinculo || cambiaElSexo;

      if (conyuge && revisarLaPareja) {
        const otro = db.prepare('SELECT id, nombres, apellidos, genero, rut FROM miembros WHERE id = ?').get(conyuge);
        if (!otro) return 'La persona indicada como cónyuge no existe';
        const yo = { id, rut: rutDe(data, existing), genero: data.genero !== undefined ? data.genero : existing ? existing.genero : null };
        const alguienEstaEnPastores = estaEnPastores(otro, db) || (id && estaEnPastores(yo, db));
        if (alguienEstaEnPastores) {
          if (!otro.genero || !yo.genero) {
            return 'Para vincular el matrimonio de alguien registrado en Pastores / Guías, las dos fichas necesitan tener su género registrado.';
          }
          if (otro.genero === yo.genero) {
            return `El cónyuge tiene que ser del sexo opuesto: ${otro.nombres} ${otro.apellidos} figura como ${otro.genero.toLowerCase()}.`;
          }
        }
        // Los dos tienen que tener trato de pastor o pastora por su propio
        // registro: el pastor se casa con la pastora, no con una hermana.
        if (esPastorRegistrado(otro, db) || (id && esPastorRegistrado(yo, db))) {
          const { esPastorPorSiMismo } = require('../tratamiento');
          /**
           * Cómo va a quedar esta ficha después de guardar, no cómo está.
           *
           * Antes se leía de la base por el id, y eso fallaba por los dos
           * lados: al CREAR una ficha ya vinculada no había id que leer, así
           * que la comprobación se saltaba entera y la pareja a medias entraba
           * igual; y al editar se leía el trato viejo, así que fijarle el trato
           * de Pastora en el mismo guardado que arma el vínculo no servía de
           * nada —justo lo que el propio aviso le dice a uno que haga—.
           */
          const completo = { ...(existing || {}), ...data, id };
          for (const quien of [completo, otro]) {
            if (!quien || esPastorPorSiMismo(quien, db)) continue;
            const trato = quien.genero === 'Femenino' ? 'Pastora' : 'Pastor';
            return `${quien.nombres} ${quien.apellidos} todavía no tiene trato de ${trato}. ` +
              `Regístrele su ficha en Pastores / Guías, o fíjele el trato de ${trato} en su ficha, y vuelva a intentarlo.`;
          }
        }
      }

      // A quien el ministerio le impone un trato —Guía de Obra por su cargo,
      // Pastor o Pastora por el suyo o por su cónyuge— no se le puede fijar a
      // mano el de Hermano, Hermana u Oficial.
      const manual = data.tratamiento_personalizado;
      if (manual && ['Hermano', 'Hermana', 'Oficial'].includes(manual) && id) {
        const { tratoMinisterial, CARGO_GUIA } = require('../tratamiento');
        const fila = { ...(existing || {}), ...data, id };
        const impuesto = tratoMinisterial(fila, db);
        if (impuesto) {
          const porque = impuesto === CARGO_GUIA
            ? 'por su cargo en Pastores / Guías'
            : 'por su ficha en Pastores / Guías o por su cónyuge';
          return `A esta persona le corresponde el trato de ${impuesto} —${porque}—, así que no puede quedar como "${manual}".`;
        }
      }

      // Si esta persona tiene además ficha de pastor, su RUT tiene que ser el
      // mismo en las dos: es la misma persona en los dos registros.
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      if (id && rut) {
        const pastor = db.prepare('SELECT nombres, apellidos, rut FROM pastores WHERE miembro_id = ?').get(id);
        if (pastor && pastor.rut && pastor.rut !== rut) {
          return `El RUT no coincide con el de su ficha en Pastores / Guías (${pastor.nombres} ${pastor.apellidos}: ${pastor.rut}). ` +
            'Corrija el que esté equivocado.';
        }
      }
      return null;
    },

    /**
     * El matrimonio se ve desde los dos lados: al vincular a alguien, su
     * cónyuge queda apuntando de vuelta, se sueltan los vínculos anteriores
     * que quedaran colgando y se copian las fechas de matrimonio a quien las
     * tenga en blanco.
     */
    afterSave(fila, { db }) {
      sincronizarUsuario(fila, db);

      const conyugeId = fila.conyuge_id || null;

      // Quien estuviera vinculado a esta persona y ya no corresponda, se suelta
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
        .run(fila.id, conyugeId || 0);
      if (!conyugeId) return;

      const conyuge = db.prepare('SELECT * FROM miembros WHERE id = ?').get(conyugeId);
      if (!conyuge) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(fila.id);
        return;
      }

      // Si la otra persona venía vinculada a alguien más, ese vínculo se suelta
      if (conyuge.conyuge_id && Number(conyuge.conyuge_id) !== Number(fila.id)) {
        db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(conyuge.conyuge_id);
      }

      const campos = ['conyuge_id = ?'];
      const valores = [fila.id];
      for (const f of ['fecha_matrimonio_civil', 'fecha_matrimonio_religioso']) {
        if (fila[f] && !conyuge[f]) {
          campos.push(`"${f}" = ?`);
          valores.push(fila[f]);
        }
      }
      db.prepare(`UPDATE miembros SET ${campos.join(', ')} WHERE id = ?`).run(...valores, conyuge.id);
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
