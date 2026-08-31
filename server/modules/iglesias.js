/**
 * Módulo: Iglesias (congregaciones administradas por el sistema).
 *
 * Al crear una iglesia se le crean solas sus dos cuentas de tesorería: la
 * general y el fondo donde aparta lo que le corresponde a la corporación.
 *
 * Cada iglesia lleva además su fotografía, su historial (historial_iglesias)
 * y sus documentos (documentos_iglesias), que se ven al pie de su ficha.
 *
 * La organización distingue cuatro tipos de iglesia, de mayor a menor: la
 * MATRIZ —una sola en toda la organización—, las SEDES, las LOCALES y los
 * ANEXOS. El sistema hace cumplir que la matriz sea única.
 *
 * Una iglesia NO SE BORRA: se marca inactiva, y eso significa algo —no recibe
 * gente, cuerpos ni plata nuevos— desde la 1.232.0. La regla entera, con lo
 * que se midió antes de tenerla, está en server/iglesia-inactiva.js.
 */

const { REGIONES } = require('../regiones');

/** Los tipos de iglesia, de mayor a menor. */
const TIPOS_DE_IGLESIA = ['Iglesia Matriz', 'Iglesia Sede', 'Iglesia Local', 'Iglesia Anexo'];

/** El que ocupa una sola iglesia en toda la organización. */
const TIPO_UNICO = 'Iglesia Matriz';

/**
 * Dos congregaciones que se llaman igual.
 *
 * El código no se puede repetir y el sistema lo hace cumplir; el NOMBRE sí se
 * repetía, y se guardaban dos «Iglesia Central» con un 201 sin decir nada. Y el
 * nombre es lo ÚNICO que muestran los desplegables: el código, que es lo que
 * las distingue, no aparece en ninguna de las listas donde se elige a cuál va
 * un miembro, un movimiento o un certificado. Dos «Iglesia Central» en un
 * desplegable son indistinguibles.
 *
 * SE PREGUNTA Y SE DEJA SEGUIR: dos congregaciones del mismo nombre en ciudades
 * distintas es un caso real —«Iglesia Central» de Concepción y de Temuco—. Es
 * el mismo mecanismo de la ficha de miembro repetida.
 *
 * Y EL DESPLEGABLE MUESTRA EL CÓDIGO cuando hay dos que se llaman igual, y solo
 * entonces: ponérselo siempre llenaría de ruido el caso normal, que es el de la
 * congregación con un nombre propio.
 */

/** Dos nombres se comparan sin tildes, sin mayúsculas y sin espacios de más. */
const comoSeCompara = (nombre) => String(nombre || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Las otras iglesias que se llaman igual que ésta. Se traen todas y se comparan
 * acá porque SQLite no sabe ignorar las tildes, que es justo lo que hay que
 * ignorar; son unas pocas decenas de filas y se pregunta al crear una iglesia o
 * al cambiarle el nombre, que se hace de a una y a mano.
 */
function lasQueSeLlamanIgual(db, nombre, id) {
  const buscado = comoSeCompara(nombre);
  if (!buscado) return [];
  return db
    .prepare('SELECT id, nombre, codigo, ciudad FROM iglesias WHERE id IS NOT ?')
    .all(id || 0)
    .filter((otra) => comoSeCompara(otra.nombre) === buscado);
}

/** Cómo se distingue una iglesia de otra que se llama igual. */
const comoSeDistingue = (fila) =>
  [fila.codigo ? `código ${fila.codigo}` : '', fila.ciudad || ''].filter(Boolean).join(', ')
  || 'sin código ni ciudad anotados';

/** El aviso de que ya hay otra con ese nombre, o null. */
function avisoDeIglesiaRepetida(db, nombre, id, confirmado) {
  if (confirmado || !nombre) return null;
  const iguales = lasQueSeLlamanIgual(db, nombre, id);
  if (!iguales.length) return null;

  const listadas = iguales.slice(0, 3).map((o) => `${o.nombre} (${comoSeDistingue(o)})`).join('; ');
  const yMas = iguales.length > 3 ? `, y ${iguales.length - 3} más` : '';
  return {
    error:
      (iguales.length === 1
        ? `Ya hay una iglesia llamada así (${comoSeDistingue(iguales[0])}). `
        : `Ya hay ${iguales.length} iglesias llamadas así: ${listadas}${yMas}. `)
      + 'El nombre es lo único que muestran los desplegables donde se elige a qué iglesia va un '
      + 'miembro, un movimiento o un certificado, así que dos con el mismo nombre no se distinguen '
      + 'ahí. Si son dos congregaciones distintas —el mismo nombre en dos ciudades—, confirme: en '
      + 'los desplegables van a salir con su código al lado.',
    confirmar: 'iglesia_con_el_mismo_nombre',
  };
}

/**
 * Las mismas opciones, con el código al lado de las que comparten nombre.
 *
 * Lo usan los DOS caminos por los que se pide una lista de iglesias —la ruta
 * propia del módulo, que es la que piden los formularios, y la genérica del
 * motor, que es la que piden los filtros—, para que las dos muestren lo mismo.
 * Escrito dos veces, un día una mostraría el código y la otra no.
 */
function conElCodigoSiSeRepite(opciones, filas) {
  const cuantas = new Map();
  for (const o of opciones) {
    const clave = comoSeCompara(o.label);
    cuantas.set(clave, (cuantas.get(clave) || 0) + 1);
  }
  return opciones.map((o, i) => {
    if (cuantas.get(comoSeCompara(o.label)) < 2) return o;
    const codigo = filas[i] && filas[i].codigo;
    // El separador es un punto medio a propósito: la pantalla acorta el nombre
    // de una iglesia partiéndolo por «/», «—» o «–» (ver iglesiaDeTrabajo en
    // public/app.js), y con cualquiera de esos el código se perdería por el
    // camino en la mitad de las listas.
    return codigo ? { ...o, label: `${o.label} · ${codigo}` } : o;
  });
}

module.exports = {
  name: 'iglesias',
  label: 'Iglesias',
  labelSingular: 'Iglesia',
  icon: '⛪',
  group: 'Organización',
  order: 50,
  /*
   * Su hoja se imprime. El código que la arma estaba escrito y completo desde
   * la 1.202.0 —dos listas de public/app.js nombran a este módulo justamente
   * para que salga con su historial y con su carpeta, y el historial de
   * versiones lo daba por hecho: «las hojas de iglesia y pastor salen con su
   * historial y su carpeta»— y no salía ninguna, porque sin esta línea el botón
   * de imprimir no aparece y ese código no se ejecuta jamás. Quince módulos se
   * imprimían; éste, que es de los que se piden en papel —para entregar una
   * congregación, para una visita, para un trámite—, había que copiarlo a mano.
   */
  printable: true,
  display: '{nombre}',
  /*
   * Lo que esta iglesia ofrece cuando otro módulo la referencia en un
   * formulario: las que reciben cosas nuevas, más la que ese campo ya tuviera
   * elegida. Sin lo segundo, abrir la ficha de un miembro de una iglesia
   * inactiva la habría dejado sin iglesia en el desplegable, y guardar la
   * habría borrado.
   */
  opcionesPorDefecto: '/iglesias/activas?ademas={iglesia_id}',
  searchFields: ['nombre', 'codigo', 'ciudad', 'direccion'],
  listFields: ['foto', 'nombre', 'tipo', 'codigo', 'ciudad', 'telefono', 'pastor_id', 'estado'],
  filterFields: ['tipo', 'estado'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'foto', label: 'Fotografía del templo', type: 'file', accept: 'image/*',
      recorte: 'cuadrado',
      help: 'La foto con la que se reconoce a esta iglesia. Se puede sacar con el teléfono: al subirla se ajusta sola de tamaño.',
    },
    { name: 'nombre', label: 'Nombre', type: 'text', required: true },
    {
      name: 'tipo', label: 'Tipo de iglesia', type: 'select', default: 'Iglesia Local',
      options: TIPOS_DE_IGLESIA,
      help: 'De mayor a menor. La Iglesia Matriz es una sola en toda la organización.',
    },
    {
      name: 'codigo', label: 'Código', type: 'text', required: true, unique: true,
      help: 'Identificador corto de esta iglesia, ej. CENTRAL o IG-001. Va dentro del número de cada '
        + 'solicitud —SOL-CENTRAL-0001-2026— para que se sepa de qué iglesia es, así que no puede repetirse. '
        + 'Se escribe en mayúsculas, sin tildes ni espacios; lo que se escriba se ajusta solo.',
    },
    { name: 'direccion', label: 'Dirección', type: 'text' },
    { name: 'ciudad', label: 'Ciudad', type: 'text' },
    {
      name: 'departamento', label: 'Región', type: 'select', options: REGIONES, buscador: true,
      help: 'Las dieciséis regiones del país, de norte a sur.',
    },
    { name: 'pais', label: 'País', type: 'text' },
    { name: 'telefono', label: 'Teléfono', type: 'tel' },
    { name: 'email', label: 'Correo electrónico', type: 'email' },
    { name: 'fecha_fundacion', label: 'Fecha de fundación', type: 'date' },
    {
      name: 'pastor_id', label: 'Pastor principal', type: 'ref', ref: 'pastores',
      /*
       * Al elegirlo se ve también a su cónyuge: de una iglesia responden los
       * dos. Y solo se ofrecen los que ejercen, más el que esta ficha ya
       * tuviera: sin ese «además», abrir la iglesia de un pastor fallecido y
       * guardar le borraría el dato, porque el desplegable no lo traería.
       */
      optionsRoute: '/pastores/con-conyuge?ademas={pastor_id}',
      help: 'Al buscarlo aparece junto a su cónyuge, que es con quien está a cargo de la iglesia.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activa',
      options: ['Activa', 'Inactiva', 'En formación'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  computed: [
    {
      name: 'responsables', label: 'A cargo de la iglesia', type: 'texto',
      help: 'El pastor principal y su cónyuge: de la iglesia responden los dos.',
      calc: (fila, { db }) => {
        if (!fila.pastor_id) return '';
        const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(fila.pastor_id);
        if (!pastor) return '';
        const trato = require('../tratamiento');
        const nombres = require('../nombres');
        const suyo = pastor.miembro_id
          ? db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.miembro_id)
          : null;
        const el = suyo
          ? trato.conTratamiento(suyo, db)
          : nombres.paraMostrar(pastor.nombres, pastor.apellidos);
        if (!pastor.conyuge_id) return el;
        const ella = db.prepare('SELECT * FROM miembros WHERE id = ?').get(pastor.conyuge_id);
        return ella ? `${el} y ${trato.conTratamiento(ella, db)}` : el;
      },
    },
  ],
  /*
   * Y la lista genérica del motor —la que piden los filtros del listado— sale
   * con lo mismo. Es la otra puerta por la que se ofrece una iglesia, y
   * mostrar el código en una y no en la otra dejaría el desplegable de los
   * filtros con dos opciones idénticas.
   */
  comoSeOfrecen: conElCodigoSiSeRepite,

  extraRoutes(router, { db, requirePerm, scopeClause, can }) {
    /*
     * Las iglesias que reciben cosas nuevas, para los desplegables.
     *
     * `ademas` trae lo que ese campo ya tenía elegido, y esa iglesia entra
     * aunque esté inactiva: es la ficha de alguien que pertenece a una
     * congregación que se retiró, y su iglesia tiene que seguir a la vista.
     *
     * Se pide con la llave de VER iglesias, que es la que ya hace falta para
     * que el desplegable diga sus nombres, y sale acotado por el alcance de
     * siempre.
     */
    router.get('/iglesias/activas', requirePerm('iglesias', 'view'), (req, res) => {
      const inactivas = require('../iglesia-inactiva');
      const params = [];
      const where = [];
      const suyas = scopeClause(req.user, params);
      if (suyas) where.push(suyas);

      const ademas = Number(req.query.ademas) || 0;
      if (ademas) {
        params.push(ademas);
        where.push(`(${inactivas.condicionDeActivas()} OR id = ?)`);
      } else {
        where.push(inactivas.condicionDeActivas());
      }

      const filas = db
        .prepare(`SELECT id, nombre, codigo FROM iglesias${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY nombre`)
        .all(...params);
      res.json(conElCodigoSiSeRepite(filas.map((i) => ({ id: i.id, label: i.nombre })), filas));
    });

    /**
     * La iglesia cuyo resumen se está pidiendo, comprobando que sea suya.
     *
     * El alcance se comprueba acá y no se da por supuesto: la ruta se pide
     * desde una ficha que la persona ya está mirando, pero escribiendo la
     * dirección a mano se llegaría a la de al lado. Es la misma comprobación
     * que hace la ficha de un cuerpo (ver server/modules/cuerpos.js).
     */
    const iglesiaDelUsuario = (req, res) => {
      const fila = db.prepare('SELECT id, nombre FROM iglesias WHERE id = ?').get(req.params.id);
      if (!fila) {
        res.status(404).json({ error: 'Esa iglesia no se encontró' });
        return null;
      }
      if (!require('../alcance').alcanzaIglesia(req.user, fila.id)) {
        res.status(403).json({ error: 'Esa iglesia está fuera de lo que tiene asignado' });
        return null;
      }
      return fila;
    };

    /**
     * EL RESUMEN DE UNA IGLESIA: cuánta gente, cuántos cuerpos, cuánto en caja.
     *
     * La ficha de una iglesia mostraba cinco datos —nombre, tipo, código,
     * ciudad, estado— y nueve campos en blanco, mientras el sistema sabía de
     * ella 600 miembros, 13 cuerpos, 28 cuentas, 3.001 movimientos y 150
     * actividades. Para saber cuánta gente tiene una congregación había que ir
     * a Miembros y filtrar; para saber cuánto tiene en caja, a Cuentas de
     * Tesorería y filtrar. La ficha del cuerpo más chico decía más de sí mismo
     * que la de la congregación entera.
     *
     * CADA CIFRA PIDE SU PROPIO PERMISO, y la que no se puede ver no viaja.
     * Es la misma corrección que se le hizo a los paneles del cuerpo: pintarlos
     * dentro de una ficha que la persona ya puede abrir no convierte lo de
     * adentro en algo que también pueda ver. Un resumen es más peligroso que un
     * listado, no menos: entrega la cifra sin que haya que abrir nada.
     *
     * Y LO DE SUS CUERPOS VA APARTE de lo suyo, con la misma regla que el
     * inventario de la 1.231.0: la caja de la iglesia y las cajas de sus
     * cuerpos son plata de dos dueños distintos, y una sola cifra que las sume
     * no contesta ninguna de las dos preguntas.
     */
    router.get('/iglesias/:id(\\d+)/resumen', requirePerm('iglesias', 'view'), (req, res) => {
      const iglesia = iglesiaDelUsuario(req, res);
      if (!iglesia) return;
      const { YA_OCURRIO } = require('../saldos');
      const id = iglesia.id;
      const resumen = {};

      const cuantos = (sql, ...params) => db.prepare(sql).get(id, ...params).n;

      /*
       * QUIÉN SIGUE SIENDO PARTE DE ESTA IGLESIA.
       *
       * No es «los que dicen Activo», y la diferencia importa en las dos
       * puntas. Por un lado, alguien «En disciplina» sigue siendo miembro de
       * la congregación: contarlo fuera diría que la iglesia tiene menos gente
       * de la que tiene. Por el otro, un pastor «Jubilado» ya no la pastorea,
       * aunque su ficha no diga «Inactivo».
       *
       * Y un estado EN BLANCO no es una salida: es un dato que nadie llenó. El
       * resto del sistema ya lo lee así —«(estado IS NULL OR estado != …)» en
       * los cumpleaños, en la directiva y en los pastores—, y contarlo al revés
       * se vio en la primera versión de esta ruta: sobre una iglesia con trece
       * cuerpos, el resumen decía «1 activo» porque doce tenían el estado sin
       * escribir, mientras el listado de al lado los mostraba a los trece sin
       * una sola marca de retirados. Dos cifras de lo mismo que se contradecían
       * en la misma pantalla.
       */
      const YA_NO_ESTAN = {
        miembros: ['Inactivo', 'Trasladado', 'Fallecido'],
        cuerpos: ['Inactivo'],
        pastores: ['Inactivo', 'Jubilado', 'Trasladado', 'Fallecido'],
      };
      const siguenAhi = (tabla) => {
        const fuera = YA_NO_ESTAN[tabla];
        const marcas = fuera.map(() => '?').join(', ');
        return {
          activos: db
            .prepare(`SELECT COUNT(*) AS n FROM "${tabla}"
                       WHERE iglesia_id = ? AND (estado IS NULL OR estado NOT IN (${marcas}))`)
            .get(id, ...fuera).n,
          total: cuantos(`SELECT COUNT(*) AS n FROM "${tabla}" WHERE iglesia_id = ?`),
        };
      };

      if (can(req.user, 'miembros', 'view')) resumen.miembros = siguenAhi('miembros');
      if (can(req.user, 'cuerpos', 'view')) resumen.cuerpos = siguenAhi('cuerpos');
      if (can(req.user, 'pastores', 'view')) resumen.pastores = siguenAhi('pastores');

      if (can(req.user, 'cuentas_tesoreria', 'view')) {
        /*
         * El saldo de una cuenta es su punto de partida más lo que ya entró
         * menos lo que ya salió —«ya», no lo agendado más adelante: eso todavía
         * no está en la caja—. Se suma acá con la misma condición con que lo
         * calcula cada cuenta por su lado, para que la cifra del resumen y la
         * de la cartola no puedan discrepar.
         */
        const caja = (deCuerpos) => db.prepare(
          `SELECT COUNT(*) AS cuentas,
                  COALESCE(SUM(c.saldo_inicial), 0)
                  + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'Ingreso' THEN t.monto ELSE -t.monto END)
                              FROM tesoreria t
                             WHERE t.cuenta_id IN (SELECT id FROM cuentas_tesoreria
                                                    WHERE iglesia_id = ? AND cuerpo_id IS ${deCuerpos ? 'NOT NULL' : 'NULL'})
                               AND ${YA_OCURRIO}), 0) AS saldo
             FROM cuentas_tesoreria c
            WHERE c.iglesia_id = ? AND c.cuerpo_id IS ${deCuerpos ? 'NOT NULL' : 'NULL'}`
        ).get(id, id);

        const suya = caja(false);
        const deSusCuerpos = caja(true);
        // La llave de los montos es aparte de la de ver las cuentas: quien no
        // la tenga ve cuántas cajas hay y no cuánto hay en ellas. Un cero
        // inventado sería peor que no decir nada (ver server/sensibles.js).
        const montos = can(req.user, 'tesoreria_montos', 'view');
        resumen.tesoreria = {
          cuentas: suya.cuentas,
          cuentas_de_cuerpos: deSusCuerpos.cuentas,
          saldo: montos ? suya.saldo : null,
          saldo_de_cuerpos: montos ? deSusCuerpos.saldo : null,
          reservado: !montos,
        };
      }

      if (can(req.user, 'asistencias', 'view')) {
        const ultima = db
          .prepare(`SELECT fecha FROM asistencias WHERE iglesia_id = ? AND ${YA_OCURRIO} ORDER BY fecha DESC LIMIT 1`)
          .get(id);
        resumen.asistencia = {
          este_ano: cuantos("SELECT COUNT(*) AS n FROM asistencias WHERE iglesia_id = ? AND fecha >= date('now','localtime','start of year')"),
          ultima: ultima ? ultima.fecha : null,
        };
      }
      if (can(req.user, 'solicitudes', 'view')) {
        resumen.solicitudes = {
          abiertas: cuantos("SELECT COUNT(*) AS n FROM solicitudes WHERE iglesia_id = ? AND estado NOT IN ('Cerrada', 'Rechazada')"),
        };
      }

      res.json(resumen);
    });
  },

  hooks: {
    beforeSave(data, { id, existing, db, confirmado }) {
      /*
       * EL CÓDIGO SE AJUSTA SOLO, porque ya no es un dato de adorno.
       *
       * Va dentro del número de cada solicitud, y ahí tiene que poder
       * escribirse en un acta, dictarse por teléfono y buscarse en el sistema.
       * Así que lo que se escriba —«Iglesia Ñuñoa», «ig 001»— se guarda como
       * IGLESIA-NUNO o IG-001. Corregirlo al guardar es mejor que rechazarlo:
       * lo que la persona quiso decir se entiende igual.
       *
       * Que no se repita lo comprueba el motor, porque el campo está declarado
       * único; acá solo se deja normalizado ANTES de esa comprobación, o dos
       * códigos que se escriben distinto y valen lo mismo pasarían los dos.
       */
      /*
       * El nombre se guarda sin espacios de más. No es cosmética: es lo único
       * que muestran los desplegables, y « iglesia  Central » salía tal cual,
       * ordenándose antes que todas las demás por el espacio de adelante y
       * pareciendo otra iglesia que la que se llama igual sin ellos.
       */
      if (data.nombre !== undefined && data.nombre !== null) {
        data.nombre = String(data.nombre).replace(/\s+/g, ' ').trim();
      }

      if (data.codigo !== undefined) {
        const codigos = require('../codigo-iglesia');
        data.codigo = codigos.normalizar(data.codigo);
        if (!data.codigo) {
          return 'Escriba el código de esta iglesia: es lo que la identifica dentro del número de cada '
            + 'solicitud. Sirve algo corto y propio, como CENTRAL o IG-001.';
        }
        // El largo se avisa, no se recorta: cortarlo en silencio puede dejar
        // dos códigos distintos convertidos en el mismo
        if (data.codigo.length > codigos.LARGO_MAXIMO) {
          return `El código «${data.codigo}» es muy largo: hasta ${codigos.LARGO_MAXIMO} caracteres. `
            + 'Va dentro del número de cada solicitud —SOL-CENTRAL-0001-2026—, que se dicta por teléfono '
            + 'y se escribe en un acta, así que tiene que ser corto.';
        }
      }

      // Una sola Iglesia Matriz en toda la organización
      const tipo = data.tipo !== undefined ? data.tipo : existing ? existing.tipo : null;
      if (tipo === TIPO_UNICO) {
        const otra = db
          .prepare(`SELECT nombre FROM iglesias WHERE tipo = ? AND id != ?`)
          .get(TIPO_UNICO, id || 0);
        if (otra) {
          return `Ya hay una ${TIPO_UNICO}: ${otra.nombre}. ` +
            'Cámbiele el tipo a esa antes de designar otra.';
        }
      }

      /*
       * ¿Ya hay otra iglesia llamada así? Va antes que la del pastor porque el
       * motor deja pasar UNA pregunta por guardado y ésta es la más grave: una
       * congregación indistinguible en todos los desplegables del sistema.
       */
      const nombre = data.nombre !== undefined ? data.nombre : existing ? existing.nombre : null;
      const seLlamaIgual = avisoDeIglesiaRepetida(db, nombre, id, confirmado);
      // Solo cuando ESTE guardado toca el nombre: si no, corregirle el teléfono
      // a una de dos iglesias que ya se llaman igual volvería a preguntarlo
      if (seLlamaIgual && data.nombre !== undefined
          && (!existing || comoSeCompara(existing.nombre) !== comoSeCompara(data.nombre))) {
        return seLlamaIgual;
      }

      /*
       * Y el pastor principal que le están poniendo, si es de otra iglesia.
       *
       * Va AL FINAL: se frena antes lo que no se puede guardar de ninguna
       * manera —el código, la matriz repetida— y recién después se pregunta lo
       * que sí se puede. El motor deja pasar UNA pregunta por guardado, así que
       * el orden decide cuál se ve, y una pregunta que se contesta «está bien»
       * sobre una ficha que igual va a ser rechazada es una pregunta perdida.
       */
      return require('../pastor-de-la-iglesia')
        .avisoSiElPastorEsDeOtraIglesia(db, id, { data, existing, confirmado });
    },

    afterSave(fila, { isNew, existing, user, db }) {
      /*
       * Sus dos cuentas: se abren al crearla y siguen su nombre después.
       *
       * Las dos cosas están en server/el-nombre-de-la-iglesia.js y no acá,
       * porque la plantilla del nombre —«Tesorería general — Iglesia Central»—
       * tiene que ser LA MISMA con la que después se las reconoce. Escrita dos
       * veces, el día que una cambiara la otra dejaría de reconocer las cuentas
       * que ella misma bautizó, y el renombrado no tocaría ninguna sin que
       * nadie se enterara.
       */
      const suNombre = require('../el-nombre-de-la-iglesia');
      if (isNew) {
        suNombre.abrirLasSuyas(db, fila.id, fila.nombre);
        return;
      }

      /*
       * Al cambiarle el nombre, sus cajas cambian con ella.
       *
       * El «solo cuando el nombre cambia» lo decide `seguirAlNombre` y no se
       * repite acá: escrito en los dos lados, quitar cualquiera de los dos no
       * rompía nada, porque el otro sostenía la regla en silencio.
       */
      const cambiadas = suNombre.seguirAlNombre(db, fila.id, existing && existing.nombre, fila.nombre);
      if (cambiadas.length) {
        require('../bitacora').anotarCambio({
          def: module.exports,
          accion: 'Cambio',
          fila,
          detalle: `Al cambiar el nombre de la iglesia se renombraron sus cuentas: ${suNombre.comoSeLee(cambiadas)}.`,
          usuario: user,
        });
      }
    },

    /**
     * Borrar una iglesia: se frena si tiene algo dentro, y se pregunta si no.
     *
     * Hasta acá una iglesia no se podía borrar NUNCA, ni la que se acababa de
     * crear con el nombre mal escrito: las dos cuentas que este mismo módulo le
     * abre unas líneas más arriba y la línea de historial que la bitácora le
     * anota bastaban para que el motor contara «tres registros colgando» y se
     * negara. El sistema fabricaba los motivos por los que después se negaba.
     *
     * Qué cuenta como el rastro de haberla creado y qué cuenta como su
     * contenido está en server/iglesia-vacia.js, y de ahí lo leen los dos que
     * tienen que estar de acuerdo: esta pregunta y el plan del borrado que arma
     * server/dependencias.js. Si dijeran cosas distintas, el borrado se
     * aceptaría acá y se frenaría dos líneas después —o peor, al revés—.
     */
    beforeDelete(fila, { db, confirmado }) {
      const vacia = require('../iglesia-vacia');
      const dependencias = require('../dependencias');
      const { contenido, rastro } = vacia.loQueCuelga(
        db, fila.id, dependencias.referenciasHacia('iglesias'), dependencias.cuantasApuntan
      );

      // Lo que frena lo escribe el motor con las mismas palabras al armar el
      // plan; acá se sale sin decir nada y se deja que lo diga él, para que no
      // haya dos avisos distintos para lo mismo.
      if (contenido.length) return null;
      if (confirmado) return null;

      /*
       * Se pregunta aunque no cuelgue absolutamente nada. La primera versión se
       * saltaba la pregunta en ese caso —«no hay nada que advertir»— y quedaba
       * al revés de como tiene que ser: la iglesia más vacía era la única que se
       * borraba de un clic. Borrar una iglesia no se deshace, y el botón,
       * apretado sobre la de al lado, es irreparable.
       */

      return {
        error: vacia.preguntaDeBorrado(`«${fila.nombre}»`, rastro),
        confirmar: 'iglesia_sin_nada',
      };
    },
  },
};
