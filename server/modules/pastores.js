/**
 * Módulo: Pastores y Guías (liderazgo ministerial).
 *
 * El pastor y la pastora de una iglesia local son **también miembros de esa
 * iglesia**: además de su ficha aquí, tienen su ficha de miembro. Por eso
 * cada registro se enlaza con su ficha de miembro —el sistema la reconoce
 * sola por el RUT— y quien todavía no la tenga aparece marcado, con un botón
 * para crearla con sus mismos datos.
 *
 * El trato sale del cargo: a quien tiene cargo pastoral se le dice Pastor o
 * Pastora en todo el sistema, y a su cónyuge también; al guía de obra se le
 * dice guía de obra. Entre Pastor y Pastora decide el sexo, que se lee de la
 * ficha de miembro cuando la hay y, si no, del campo que esta ficha lleva.
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
const {
  CARGO_GUIA, CARGOS_MINISTERIO: CARGOS, CARGO_UNICO, fichaDeMiembro,
} = require('../tratamiento');

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
  /*
   * Una ficha de miembro es de un solo pastor. Las que quedaron compartidas de
   * antes no se corrigen solas —no hay manera de saber cuál de los dos es el
   * bueno— así que se ponen a la vista acá, que es donde alguien las mira.
   */
  if (require('../su-ficha-de-miembro').quienesMasLaTienen(db, miembro.id, pastor.id).length) {
    return { texto: 'La comparte con otro', nivel: 'bajo', miembro };
  }
  if (pastor.rut && miembro.rut && pastor.rut !== miembro.rut) {
    return { texto: 'RUT distinto', nivel: 'bajo', miembro };
  }
  if (pastor.rut && !miembro.rut) return { texto: 'Falta el RUT en su ficha', nivel: 'medio', miembro };
  if (!pastor.rut && miembro.rut) return { texto: 'Falta el RUT aquí', nivel: 'medio', miembro };
  return { texto: 'Registrado', nivel: 'ok', miembro };
}

module.exports = {
  name: 'pastores',
  label: 'Pastores / Guías',
  labelSingular: 'Pastor / Guía',
  icon: '🧑‍💼',
  group: 'Organización',
  order: 51,
  /*
   * Su hoja se imprime, por lo mismo que la de la iglesia: el código estaba
   * escrito desde la 1.202.0 y sin esta línea no se ejecutaba nunca (ver
   * server/modules/iglesias.js). La hoja de un pastor se pide en papel al
   * presentarlo en otra congregación y al entregar o recibir un ministerio.
   */
  printable: true,
  display: '{nombres:primero} {apellidos}',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono'],
  listFields: ['foto', 'rut', 'nombres', 'apellidos', 'cargo', 'iglesia_id', 'ficha_miembro', 'estado'],
  /*
   * Lo que este módulo ofrece cuando otro lo referencia en un formulario: los
   * que ejercen, más el que ese campo ya tuviera. Vale para el titular de una
   * credencial igual que para el pastor principal de una iglesia; los filtros
   * de un listado siguen ofreciéndolos a todos, que es como se consulta lo de
   * un pastor jubilado (lo distingue el propio programa de la pantalla).
   */
  opcionesPorDefecto: '/pastores/con-conyuge?ademas={pastor_id}',
  computed: [
    {
      name: 'ficha_miembro', label: 'Ficha de miembro', type: 'badge',
      /*
       * En la pantalla dice de un vistazo si esta ficha está enlazada con la
       * de su miembro, que es lo que hay que arreglar cuando no lo está. En el
       * papel sobra: dos líneas más arriba la hoja ya dice «Su ficha de
       * miembro: Elena Díaz Díaz», que es el mismo dato mejor dicho. Se vio al
       * imprimir por primera vez esta hoja, en la 1.235.0: salían las dos
       * seguidas, y en un papel que alguien firma el mismo dato dicho dos veces
       * hace dudar de cuál manda.
       */
      enElPapel: false,
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
    {
      /*
       * Opcional, y solo para el trato: de Pastor Probando hacia arriba los
       * cargos son gradas de la escala y se escriben en masculino, así que el
       * trato lo decide el sexo de quien la ocupa. Antes ese dato vivía nada
       * más que en la ficha de miembro, y quien no la tuviera —el módulo mismo
       * cuenta con que muchos no la tengan— salía con el nombre pelado.
       *
       * Manda la ficha de miembro cuando existe y lo tiene anotado: es la
       * ficha de la persona. Este campo es el que queda mientras tanto, y el
       * que se copia al crearla desde acá.
       */
      name: 'genero', label: 'Sexo', type: 'select', options: ['Femenino', 'Masculino'],
      help: 'Decide entre «Pastor» y «Pastora». Si tiene ficha de miembro, manda lo que diga allá.',
    },
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
    { name: 'foto', label: 'Foto', type: 'file', accept: 'image/*', recorte: 'cuadrado',
      reservado: 'miembros_foto' },
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
      const ejercen = require('../pastor-que-ejerce');
      const params = [];
      const donde = require('../alcance').condiciones(module.exports, req.user, params);
      /*
       * Solo los que ejercen, MÁS el que este campo ya tuviera. Ese «además»
       * es lo que evita que abrir la ficha de una iglesia cuyo pastor falleció
       * le borre el dato al guardar: el desplegable no lo ofrecería y el
       * formulario mandaría el campo vacío. Es el mismo arreglo que la
       * 1.232.0 le hizo a las iglesias inactivas.
       */
      const ademas = Number(req.query.ademas) || 0;
      const suyos = [...(donde ? [donde] : []), `(${ejercen.condicionDeQuienesEjercen()}${ademas ? ' OR id = ?' : ''})`];
      if (ademas) params.push(ademas);
      const filas = db
        .prepare(`SELECT * FROM pastores WHERE ${suyos.join(' AND ')} ORDER BY apellidos, nombres`)
        .all(...params);
      res.json(
        filas.map((p) => {
          const el = trato.conTratamientoDePastor(p, db);
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
        /*
         * Esta puerta escribe el enlace derecho, sin pasar por el guardado, así
         * que la regla hay que pedirla acá también: si no, el botón «Crear su
         * ficha de miembro» sería la manera de saltarse lo que el formulario
         * frena.
         */
        const deOtro = require('../su-ficha-de-miembro')
          .avisoSiEsaFichaYaEsDeOtro(db, pastor.id, ya.id, { porElRut: !pastor.miembro_id });
        if (deOtro) return res.status(400).json({ error: deOtro });

        db.prepare('UPDATE pastores SET miembro_id = ? WHERE id = ?').run(ya.id, pastor.id);
        return res.json({ ok: true, miembro_id: ya.id, creada: false });
      }

      const info = db
        .prepare(
          `INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, fecha_nacimiento, genero, telefono, email,
                                 direccion, foto, estado, notas, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, ?)`
        )
        .run(
          pastor.nombres, pastor.apellidos, pastor.rut || null, pastor.iglesia_id,
          pastor.fecha_nacimiento || null, pastor.genero || null,
          pastor.telefono || null, pastor.email || null,
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
      // El de su ficha de miembro y, si no lo tiene, el de la suya de pastor:
      // sin ficha de miembro se ofrecían los dos sexos.
      const suGenero = (suya && suya.genero) || (pastor && pastor.genero) || null;

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

    /*
     * El pastor pedido por su número, comprobando que sea de una iglesia suya.
     *
     * La ruta hermana que CREA la ficha ya lo comprobaba; estas dos no, y por
     * ahí salían el RUT del pastor de otra iglesia y el nombre y el RUT de su
     * ficha de miembro, a quien tenía una sola iglesia asignada.
     */
    const pastorSuyo = (req, res) =>
      require('../alcance').registroSuyo(req, res, 'pastores', req.params.id, 'Ese pastor');

    /** Cómo está el enlace con su ficha de miembro, para mostrarlo en su ficha. */
    router.get('/pastores/:id(\\d+)/ficha-miembro', requirePerm('pastores', 'view'), (req, res) => {
      const pastor = pastorSuyo(req, res);
      if (!pastor) return;
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
      const pastor = pastorSuyo(req, res);
      if (!pastor) return;
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
    beforeSave(data, { id, existing, db, confirmado }) {
      // Un solo Pastor Presidente en toda la organización
      const cargo = data.cargo !== undefined ? data.cargo : existing ? existing.cargo : null;
      if (cargo === CARGO_UNICO) {
        const otro = db
          .prepare(`SELECT nombres, apellidos FROM pastores
                     WHERE cargo = ? AND id != ? AND ${require('../pastor-que-ejerce').condicionDeQuienesEjercen()}`)
          .get(CARGO_UNICO, id || 0);
        if (otro) {
          return `Ya hay un ${CARGO_UNICO}: ${otro.nombres} ${otro.apellidos}. ` +
            'Cámbiele el cargo o su estado antes de designar a otro.';
        }
      }

      // Si no se indicó su ficha de miembro, se busca por RUT: es la misma persona
      const rut = data.rut !== undefined ? data.rut : existing ? existing.rut : null;
      let enlace = data.miembro_id !== undefined ? data.miembro_id : existing ? existing.miembro_id : null;
      let porElRut = false;
      if (!enlace && rut) {
        const miembro = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut);
        if (miembro) {
          data.miembro_id = miembro.id;
          enlace = miembro.id;
          porElRut = true;
        }
      }

      /*
       * Y esa ficha de miembro tiene que ser suya y de nadie más: una persona
       * no es dos pastores (ver server/su-ficha-de-miembro.js). Se comprueba
       * sobre el enlace YA RESUELTO, así que atrapa las dos maneras de
       * llegar: eligiéndolo a mano y dejando que el RUT lo reconozca solo.
       */
      const yaEsDeOtro = require('../su-ficha-de-miembro')
        .avisoSiEsaFichaYaEsDeOtro(db, id, enlace, { porElRut });
      if (yaEsDeOtro) return yaEsDeOtro;

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

      /*
       * Y si al cambiarlo de iglesia deja a la anterior nombrándolo como su
       * pastor principal. Va al final por lo mismo que en la ficha de la
       * iglesia: primero lo que se rechaza, después lo que se pregunta.
       */
      /*
       * ¿Se está jubilando, trasladando o falleciendo dejando algo suyo
       * colgando —su iglesia, sus credenciales—? Va ANTES que la del traslado
       * porque el motor deja pasar UNA pregunta por guardado y ésta es la más
       * grave: la del traslado dice que cambió de congregación; ésta, que dejó
       * de ejercer, y de ella cuelga que una credencial deje de valer.
       */
      const dejaDeEjercer = require('../pastor-que-ejerce')
        .avisoSiDejaDeEjercer(db, id, { data, existing, confirmado });
      if (dejaDeEjercer) return dejaDeEjercer;

      const dejaSuIglesia = require('../pastor-de-la-iglesia')
        .avisoSiDejaSuIglesiaSinPastor(db, id, { data, existing, confirmado });
      if (dejaSuIglesia) return dejaSuIglesia;

      /*
       * Y la última: ¿la persona que le están poniendo de cónyuge ya figura
       * casada con otro? Va al final porque el motor deja pasar UNA pregunta
       * por guardado y las tres están ordenadas por lo que cuesta deshacer:
       * revocarle una credencial, dejar una congregación sin pastor anotado, y
       * soltar un vínculo que se vuelve a escribir eligiendo de nuevo.
       */
      return require('../el-conyuge-del-pastor')
        .avisoSiYaEstaCasada(db, id, { data, existing, confirmado });
    },

    /**
     * El matrimonio vive en las fichas de miembro: al indicar aquí al cónyuge,
     * el vínculo queda también entre la ficha de miembro del pastor y la de
     * su cónyuge, en los dos sentidos.
     */
    afterSave(fila, { existing, user, db }) {
      /*
       * Ya confirmado el traslado, se le quita a la iglesia anterior: es
       * exactamente lo que la pregunta dijo que iba a pasar. Dejarlo puesto
       * sería el defecto —la ficha de esa iglesia diciendo que su pastor es
       * alguien que ya es de otra— y quitarlo sin avisar sería peor.
       *
       * Solo cuando la iglesia CAMBIA en este guardado: si no, corregirle el
       * teléfono a un pastor le sacaría el pastor principal a su iglesia.
       */
      if (existing && String(existing.iglesia_id || '') !== String(fila.iglesia_id || '')) {
        const suIglesia = require('../pastor-de-la-iglesia');
        const sueltas = suIglesia.soltarLasQueLoNombraban(db, fila.id, fila.iglesia_id);
        for (const iglesia of sueltas) {
          require('../bitacora').anotarIglesia(iglesia.id, {
            tipo: 'Otro',
            descripcion: `${fila.nombres} ${fila.apellidos} dejó de figurar como pastor(a) principal: `
              + 'su ficha pasó a otra iglesia. Queda por designar quién queda a cargo.',
            usuario: user,
          });
        }
      }

      /*
       * Y cuando deja de ejercer se suelta su iglesia y se revocan sus
       * credenciales, que es lo que la pregunta dijo que iba a pasar. Va
       * aparte del traslado y no junto con él porque son dos hechos distintos
       * y la línea del historial tiene que decir cuál fue: quien la lea el año
       * que viene necesita saber si se fue o si dejó de ejercer.
       */
      const ejercen = require('../pastor-que-ejerce');
      if (ejercen.estaDejandoDeEjercer({ data: fila, existing })) {
        const { sueltas } = ejercen.soltarLoSuyo(db, fila, user);
        for (const iglesia of sueltas) {
          require('../bitacora').anotarIglesia(iglesia.id, {
            tipo: 'Otro',
            descripcion: `${fila.nombres} ${fila.apellidos} dejó de figurar como pastor(a) principal: `
              + `su ficha pasó a «${fila.estado}». Queda por designar quién queda a cargo.`,
            usuario: user,
          });
        }
      }

      /*
       * Y el vínculo del matrimonio, en las dos fichas y soltando el anterior.
       * Vive entero en server/el-conyuge-del-pastor.js: acá estaba solo la
       * mitad —soltaba lo viejo del lado de las fichas de MIEMBRO y se
       * olvidaba del de Pastores / Guías, que es justo donde quedaban dos
       * pastores apuntando a la misma esposa—.
       */
      require('../el-conyuge-del-pastor').anotarElVinculo(db, fila, fichaDeMiembro(fila, db));
    },

    beforeDelete(fila, { db }) {
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ?').run(fila.id);
      return null;
    },
  },
};
