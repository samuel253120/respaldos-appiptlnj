/**
 * Módulo: Registro de Cambios.
 *
 * Quién tocó qué, en lo que no admite dudas: el dinero y las llaves.
 *
 * Los miembros, las iglesias y los pastores ya tenían su historial, donde se
 * cuenta su vida en la iglesia. Esto es otra cosa y se lee de otra manera: es
 * el libro donde queda anotado cada movimiento de tesorería que se creó, se
 * cambió o se borró, y cada vez que alguien tocó los usuarios o sus permisos.
 * No está para contar una historia, está para poder responder «¿quién cambió
 * este monto?» sin que quede en la palabra de nadie.
 *
 * Se escribe solo. No se puede agregar, editar ni borrar a mano —el sistema
 * lo impide, incluso al administrador—: un registro que se puede maquillar no
 * sirve para lo que existe.
 */
module.exports = {
  name: 'registro_cambios',
  label: 'Registro de Cambios',
  labelSingular: 'Cambio registrado',
  icon: '🧾',
  group: 'Sistema',
  order: 75,
  display: '{modulo} · {registro}',
  dateField: 'fecha',
  searchFields: ['registro', 'detalle', 'usuario', 'modulo'],
  listFields: ['fecha', 'hora', 'modulo', 'accion', 'registro', 'usuario'],
  filterFields: ['modulo', 'accion', 'usuario'],
  defaultSort: { field: 'fecha', dir: 'desc' },
  fields: [
    { name: 'fecha', label: 'Fecha', type: 'date', readonly: true },
    { name: 'hora', label: 'Hora', type: 'time', readonly: true },
    {
      name: 'modulo', label: 'Módulo', type: 'select', readonly: true,
      /*
       * Es el filtro más útil que puede tener este libro —«muéstreme solo lo de
       * Tesorería»— y estaba declarado desde el principio sin dibujarse nunca:
       * la barra solo pintaba desplegables y enlaces, y un texto lo descartaba
       * en silencio. Medido sobre doce líneas de tres módulos: el servidor
       * contestaba `f_modulo=Tesorería` con las ocho que correspondían y nadie
       * se lo pedía.
       *
       * Ahora es un desplegable cuya lista sale de una ruta, y no de una lista
       * escrita acá: los módulos que de verdad tienen líneas anotadas. Escrita
       * a mano se quedaría vieja —anotan más módulos que los que el registro
       * vigila— y además ofrecería filtrar por módulos sin ninguna línea. Lo
       * que se guarda es el NOMBRE del módulo, como en las demás listas que se
       * ofrecen así, y por eso una línea vieja sigue diciendo lo que decía
       * aunque su módulo se renombre.
       */
      optionsRoute: '/registro_cambios/modulos',
    },
    {
      name: 'accion', label: 'Qué pasó', type: 'select', readonly: true,
      /*
       * TODAS las que el sistema escribe, no solo las tres de todos los días.
       *
       * Esta lista es el desplegable con que se filtra el registro, así que lo
       * que no esté acá no se puede buscar. Estaban las tres primeras y el
       * sistema escribía once: las ocho de las credenciales y las listas de
       * asistencia no se podían filtrar, aunque se vieran en la tabla. Se notó
       * al agregar «Importación» en la v1.389.0, y una prueba del motor
       * comprueba que ninguna acción que el servidor escriba falte de acá.
       */
      options: [
        'Creación', 'Cambio', 'Eliminación', 'Importación',
        'Corrección de lista',
        // Poner, restablecer o recuperar una contraseña, desde la v1.422.0
        // (hallazgo AU-07). Es la que se busca cuando la pregunta es «¿quién le
        // cambió la clave a la tesorera, y cuándo?».
        'Contraseña',
        'Emisión', 'Reemplazo', 'Revocación', 'Repetición', 'Impresión', 'Envío', 'Retiro',
      ],
    },
    { name: 'registro', label: 'Registro', type: 'text', readonly: true },
    { name: 'registro_id', label: 'Número del registro', type: 'number', readonly: true },
    {
      name: 'detalle', label: 'Detalle', type: 'textarea', readonly: true, ancho: 'completo',
      /*
       * El detalle no es un dato suyo: es una COPIA de lo que decía la ficha de
       * otro módulo, y ahí puede venir cualquiera de las cifras que el sistema
       * reserva —el monto de un movimiento, el RUT de un miembro borrado, su
       * teléfono—. Por eso se le declara lo que puede traer: a quien le falte
       * una de esas llaves se le recorta al leerlo (`alLeer`, más abajo) y no
       * puede buscar ni filtrar por él, que sería la misma fuga por la otra
       * puerta (ver server/sensibles.js).
       */
      copiaDe: '*',
    },
    {
      name: 'usuario', label: 'Quién', type: 'select', readonly: true,
      /*
       * «¿Qué tocó esta persona?» es la otra mitad de la pregunta con que este
       * libro existe. La primera —«¿quién cambió este monto?»— se contesta
       * mirando una línea; ésta pide recorrer el libro entero por alguien, y
       * hasta acá había que bajar la planilla y filtrar en Excel.
       *
       * La lista sale de una ruta y no de una escrita acá, por lo mismo que la
       * de módulos: los nombres son los que de verdad dejaron líneas, y acotados
       * a lo que quien pregunta alcanza.
       *
       * Y se guarda el NOMBRE, no el número de la cuenta —así estaba desde el
       * principio y así se queda—: una línea de hace tres años tiene que seguir
       * diciendo quién la hizo aunque esa cuenta se haya borrado o renombrado.
       * Un `ref` a Usuarios dejaría el libro cambiando de contenido cada vez que
       * alguien edita su propia ficha, que es justo lo que un registro no puede
       * hacer.
       */
      optionsRoute: '/registro_cambios/usuarios',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true },
  ],
  /**
   * Lo que hay anotado, para los dos filtros de la barra: qué módulos tienen
   * líneas y quiénes las dejaron.
   *
   * Sale de la propia tabla y no de la lista de módulos ni de la de usuarios del
   * sistema: se ofrece filtrar por lo que hay, no por lo que podría haber. Una
   * cuenta recién creada, que todavía no tocó nada, no tiene por qué aparecer en
   * el desplegable de «Quién».
   *
   * Y acotado a lo que esta persona alcanza, con el mismo alcance del listado:
   * ofrecerle «Tesorería» a quien no puede ver ninguna de esas líneas sería un
   * desplegable que siempre contesta vacío, y ofrecerle un nombre que solo
   * aparece en líneas de otra congregación sería contarle algo que su listado no
   * le muestra.
   */
  extraRoutes(router, { db, requirePerm, scopeClause }) {
    /*
     * Las dos listas son la misma pregunta sobre otra columna, así que se
     * escriben una sola vez. El nombre de la columna no sale de la dirección:
     * está acá, en una lista cerrada de dos, para que nunca pueda llegar de
     * afuera y terminar pegado dentro del SQL.
     */
    const loQueHayAnotado = (columna) => (req, res) => {
      const params = [];
      const alcance = scopeClause(req.user, params);
      const filas = db.prepare(
        `SELECT DISTINCT "${columna}" AS valor FROM registro_cambios
          WHERE "${columna}" IS NOT NULL AND TRIM("${columna}") <> ''${alcance ? ` AND ${alcance}` : ''}
          ORDER BY "${columna}"`
      ).all(...params);
      res.json(filas.map((f) => ({ id: f.valor, label: f.valor })));
    };

    const puedeVerlo = requirePerm('registro_cambios', 'view');
    router.get('/registro_cambios/modulos', puedeVerlo, loQueHayAnotado('modulo'));
    /*
     * Medido sobre 120.000 líneas: 40,1 ms, y con un índice compuesto de
     * (iglesia_id, usuario) bajaría a 11,3. No se puso, por lo mismo que en la
     * v1.437.0 no se puso el de tesorería: es una consulta que corre UNA vez, al
     * abrir la barra de filtros, y este libro se escribe en cada cambio de
     * dinero y de permisos. La de módulos, que ya existía, cuesta lo mismo.
     */
    router.get('/registro_cambios/usuarios', puedeVerlo, loQueHayAnotado('usuario'));
  },
  /*
   * El registro lo escribe el sistema y nadie más: no se le agrega una línea,
   * no se le corrige una, no se le borra una, ni siendo administrador. Si se
   * pudiera maquillar, dejaría de valer como registro.
   *
   * Está dicho acá, en una declaración, y no en dos ganchos de guardado. Con
   * los ganchos la regla se cumplía —el servidor contestaba 400— pero la
   * pantalla no se enteraba: le ofrecía al administrador «Nuevo cambio
   * registrado», «Importar» y el lápiz y el tarro de basura de cada fila.
   * Ahora la miran el motor, la pantalla y la importación por planilla.
   */
  soloLectura: {
    alGuardar: 'El registro de cambios lo escribe el sistema solo: no se agrega ni se corrige a mano.',
    alBorrar: 'El registro de cambios no se borra: para eso está.',
  },
  hooks: {
    /*
     * Cada línea, como la puede leer quien la está mirando.
     *
     * Lo que se recorta y por qué está contado en server/bitacora.js, donde se
     * escribe: la cifra queda guardada entera —el registro existe para poder
     * contestar «¿quién cambió este monto?»— y es la lectura la que la tapa
     * para quien no tiene su llave.
     */
    alLeer(fila, { usuario }) {
      fila.detalle = require('../bitacora').elDetalleQueSeLee(fila, usuario);
      return fila;
    },
  },
};
