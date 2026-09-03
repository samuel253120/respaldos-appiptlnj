/**
 * Módulo: Cuerpos / Grupos de cada iglesia.
 *
 * La organización distingue dos realidades distintas:
 *
 * - CUERPO: entidad formal, con reglamento, deberes y derechos, y su propia
 *   directiva (ej. Damas, Caballeros, Jóvenes). Por eso tiene campos para el
 *   reglamento, la fecha de constitución y los cargos de la directiva.
 * - GRUPO: agrupación de servicio o ayuda, sin reglamento ni obligaciones
 *   formales (ej. equipo de aseo, apoyo social).
 *
 * Los campos propios de los cuerpos se muestran solo cuando el tipo es
 * "Cuerpo", mediante la condición showIf.
 *
 * La directiva de cada cuerpo se registra por períodos en el módulo
 * "directivas" (histórico). Aquí se calcula el ESTADO DE CUMPLIMIENTO a
 * partir de esos datos: reglamento adjunto, directiva en ejercicio con su período
 * cerrado por una fecha de término,
 * y cuerpo activo.
 *
 * De la ficha del cuerpo cuelgan además sus integrantes —cada uno con su
 * estado y su período de prueba, en el módulo "integrantes_cuerpo"—, su
 * tesorería, sus cuotas mensuales y sus actas de reunión.
 *
 * ---------------------------------------------------------------------------
 * DOS COSAS EN LAS QUE UN GRUPO NO SE PARECE A UN CUERPO
 *
 * 1. QUIÉN LO DIRIGE. A un cuerpo lo dirige un miembro inscrito: es formal, y
 *    de sus integrantes sale su directiva. A un grupo lo puede dirigir alguien
 *    que no está en la membresía —el hermano que lleva el equipo de sonido—,
 *    que se busca en el registro aparte (módulo «No Miembros»).
 *
 * 2. LA CUOTA. Un cuerpo nace cobrando cuota mensual; un grupo, no. Casi
 *    ningún grupo cobra, y hasta ahora nacían cobrando igual que los cuerpos:
 *    si nadie se acordaba de apagarlo, su gente quedaba con una deuda que
 *    nunca existió. Se puede encender en el grupo que sí cobre.
 */
const { REGISTROS } = require('../integrantes');

/** Revisa los requisitos formales de un cuerpo y devuelve su estado. */
function evaluarCumplimiento(fila, db) {
  if (fila.tipo !== 'Cuerpo') return { nivel: 'No aplica', texto: 'No aplica', items: [] };

  /*
   * La directiva que dirige HOY, calculada de las fechas y no de la casilla que
   * alguien marcó (ver server/directiva-en-ejercicio.js). Antes esto preguntaba
   * por `estado = 'Vigente'`, así que un cuerpo cuya directiva venció en 2019
   * cumplía «tiene directiva vigente» y una que todavía no asume contaba como
   * la del cuerpo.
   */
  const directiva = require('../directiva-en-ejercicio').laQueEjerce(db, fila.id);

  const items = [
    {
      texto: 'Reglamento adjunto',
      ok: !!fila.reglamento,
      detalle: fila.reglamento ? 'Documento cargado' : 'Falta adjuntar el reglamento vigente',
    },
    {
      texto: 'Directiva en ejercicio',
      ok: !!directiva,
      detalle: directiva
        ? `Período ${directiva.periodo}`
        : 'Ninguna directiva registrada está dirigiendo hoy',
    },
    {
      /*
       * Antes este requisito decía «Directiva dentro de su período» y comprobaba
       * que su fecha de término no hubiera pasado. Desde que la directiva en
       * ejercicio se calcula de las fechas, eso no puede fallar nunca: la que se
       * trae YA está dentro de su período, o no se trae ninguna. Un requisito
       * que no puede fallar no está comprobando nada, así que pasa a pedir lo
       * que de verdad falta en su lugar.
       *
       * UNA DIRECTIVA SIN FECHA DE TÉRMINO NO VENCE NUNCA, y ese es el hueco:
       * nadie se entera de que toca elegir de nuevo, porque no hay día en que
       * el sistema pueda decirlo. La importación del sistema anterior las deja
       * así todas, con la nota «complétela cuando se defina el período», y sin
       * esto ninguna de ellas se completaría jamás.
       */
      texto: 'Período con fecha de término',
      ok: !!directiva && !!directiva.fecha_termino,
      detalle: !directiva
        ? 'Sin directiva en ejercicio'
        : directiva.fecha_termino
          ? `Dirige hasta el ${directiva.fecha_termino}`
          : 'Su directiva no tiene fecha de término: no vence nunca y nadie va a saber cuándo toca elegir de nuevo',
    },
    {
      /*
       * TENER DIRECTIVA Y TENER QUIÉN LA COMPONGA SON DOS COSAS.
       *
       * Los seis cargos son opcionales, así que una directiva con el cuerpo, el
       * período y la fecha, y NADIE adentro, cumplía el requisito de más arriba:
       * un cuerpo con la directiva en blanco se veía en el listado igual que uno
       * con la suya completa y electa en asamblea.
       *
       * Se cuentan los cuatro que salen del propio cuerpo. Quedan fuera el
       * consejero —«cargo adicional, no siempre se designa», lo dice el módulo—
       * y el oficial supervisor, que lo nombra el cuerpo de oficiales desde
       * fuera: reprocharle a un cuerpo un nombramiento que no está en sus manos
       * sería un reproche que no puede resolver.
       */
      /*
       * «Con sus cargos» quiere decir CUATRO PERSONAS en los cuatro cargos, no
       * cuatro casilleros llenos: una directiva donde el primer jefe es también
       * el tesorero tiene una persona, no cuatro, y decir que está designada
       * sería decir algo que no es. Que eso pase se pregunta al guardar y no se
       * prohíbe —un cuerpo chico puede no tener a quién más designar— pero
       * entonces su cumplimiento lo dice, que es lo que se mira sin abrir nada.
       */
      texto: 'Directiva con sus cargos',
      ok: (() => {
        if (!directiva) return false;
        const cargos = require('../cargos-de-la-directiva');
        return cargos.losQueFaltan(directiva).length === 0
          && cargos.losQueYaNoPertenecen(db, directiva).length === 0
          && cargos.quienesSeRepiten(directiva, cargos.LOS_QUE_CUENTAN).length === 0;
      })(),
      detalle: (() => {
        if (!directiva) return 'Sin directiva en ejercicio';
        const cargos = require('../cargos-de-la-directiva');
        const faltan = cargos.losQueFaltan(directiva);
        if (faltan.length) return `Falta${faltan.length === 1 ? '' : 'n'}: ${cargos.enLista(faltan)}`;
        /*
         * Un cargo ocupado por alguien que ya se fue del cuerpo es un cargo
         * vacante con un nombre encima, y por eso se dice antes que un cargo
         * repetido: ahí falta una persona, acá sobra un sombrero.
         */
        const fuera = cargos.losQueYaNoPertenecen(db, directiva);
        if (fuera.length) {
          return fuera
            .map((f) => `${cargos.comoSeLlama(db, f.persona)} figura de ${f.cargo.corto} y ya no `
              + 'pertenece al cuerpo')
            .join('; ');
        }
        const repetidos = cargos.quienesSeRepiten(directiva, cargos.LOS_QUE_CUENTAN);
        if (repetidos.length) {
          return repetidos
            .map((r) => `${cargos.comoSeLlama(db, r.persona)} ocupa ${r.cargos.length} cargos: `
              + cargos.enLista(r.cargos.map((c) => c.corto)))
            .join('; ');
        }
        return 'Los cuatro cargos del cuerpo están designados, y en cuatro personas';
      })(),
    },
    {
      /*
       * Un estado en BLANCO cuenta como activo, que es lo que significa (ver
       * server/cuerpo-inactivo.js). Antes se exigía la palabra escrita, y como
       * el valor de fábrica solo se aplica al abrir el formulario, los cuerpos
       * que ya existían la tenían vacía: doce de dieciséis salían con un
       * reproche —«Cuerpo activo ✗ Sin estado»— por un dato que nadie les
       * había pedido. El «Cuerpo de prueba 1», con 49 integrantes activos,
       * quedaba «Pendiente (4)» en parte por eso.
       */
      texto: 'Cuerpo activo',
      ok: require('../cuerpo-inactivo').funciona(fila),
      detalle: fila.estado || 'Activo',
    },
    {
      /*
       * Y si cobra cuota, que diga de cuánto.
       *
       * Medido sobre la base de trabajo: los DIECISÉIS cuerpos cobraban cuota
       * mensual y ninguno tenía el monto escrito, lo que alcanzaba a las 603
       * personas de la membresía. Se veía únicamente entrando a la planilla de
       * cuotas de cada cuerpo, uno por uno; ni el listado, ni el panel, ni esta
       * evaluación lo decían (ver server/cuota-sin-monto.js).
       *
       * Un cuerpo que NO cobra cumple: no le falta nada.
       */
      texto: 'Cuota mensual con monto',
      ok: !require('../cuota-sin-monto').leFaltaElMonto(fila),
      detalle: !fila.cobra_cuota
        ? 'No cobra cuota mensual'
        : Number(fila.cuota_mensual) > 0
          ? `$ ${Number(fila.cuota_mensual).toLocaleString('es-CL')} al mes`
          : 'Cobra cuota mensual y no dice de cuánto: no se le puede registrar el pago a nadie',
    },
  ];

  const faltan = items.filter((i) => !i.ok).length;
  const nivel = faltan === 0 ? 'Al día' : faltan === 1 ? 'Observado' : 'Pendiente';
  const texto = faltan === 0 ? 'Al día' : `${nivel} (${faltan})`;
  return { nivel, texto, items };
}

module.exports = {
  name: 'cuerpos',
  label: 'Cuerpos / Grupos',
  labelSingular: 'Cuerpo / Grupo',
  icon: '👥',
  group: 'Organización',
  order: 52,
  /*
   * Su hoja se imprime.
   *
   * Dieciocho módulos se imprimían y éste no, teniendo impresos TRES de sus
   * propios hijos: su directiva, sus actas de reunión y las evaluaciones de su
   * gente. Es el mismo hallazgo de la 1.235.0, que destapó que la hoja de la
   * iglesia y la del pastor estaban escritas y no salían porque sus módulos no
   * llevaban esta línea, así que el botón no aparecía y ese código no se
   * ejecutaba jamás.
   *
   * Y como la de la iglesia, sale con LO QUE TIENE HOY —su gente, con su
   * estado y desde cuándo— y no con sus datos a secas: un cuerpo se pide en
   * papel para entregarlo, para llevarlo a una reunión o para presentarlo, y
   * para eso la pregunta es quiénes lo componen.
   */
  printable: true,
  display: '{nombre}',
  /*
   * Lo que este cuerpo ofrece cuando otro módulo lo referencia en un
   * formulario: los que reciben cosas nuevas, más el que ese campo ya tuviera
   * elegido. Sin lo segundo, abrir el acta de un cuerpo que se cerró la
   * dejaría sin cuerpo en el desplegable, y guardar lo habría borrado. Es el
   * mismo arreglo que la 1.232.0 le hizo a las iglesias inactivas.
   */
  opcionesPorDefecto: '/cuerpos/activos?ademas={cuerpo_id}',
  /*
   * Y a los que se llaman igual se les agrega lo que los distingue (ver
   * server/el-nombre-del-cuerpo.js). Esta es la lista genérica del motor —la
   * que piden los filtros del listado—; la otra puerta es la ruta propia de
   * abajo, y las dos tiran del mismo sitio: mostrar la iglesia en una y no en
   * la otra dejaría un desplegable con dos opciones idénticas.
   */
  comoSeOfrecen: (opciones) =>
    require('../el-nombre-del-cuerpo').conLoQueLosDistingue(opciones, require('../db').db),
  searchFields: ['nombre', 'descripcion', 'lider'],
  /*
   * En el listado va `dirigido_por` y no `lider`: los dos dicen el mismo
   * nombre, pero el primero LLEVA a la ficha de esa persona. La columna de
   * texto se queda como campo —es por donde el buscador encuentra un cuerpo
   * por su líder, y es la que sale en la hoja impresa—, pero mostrar las dos
   * sería el mismo dato dos veces.
   */
  listFields: ['foto', 'nombre', 'tipo', 'iglesia_id', 'dirigido_por', 'estado', 'cumplimiento'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  computed: [
    {
      /*
       * QUIÉN LO DIRIGE, con enlace a su ficha.
       *
       * El nombre ya estaba guardado —la columna `lider`, que el sistema copia
       * de la ficha elegida— pero en la cabecera de la ficha no salía por
       * ninguna parte: un cuerpo con 49 integrantes abría con una sola
       * insignia que decía «Cuerpo». Y un nombre suelto tampoco alcanzaba:
       * quien lo lee ahí quiere abrir a esa persona.
       *
       * Se calcula, no se guarda, así que se mantiene solo: sale del enlace
       * —`lider_id` o `lider_no_miembro_id`— y no de la copia, de modo que no
       * puede quedar diciendo algo que ya no es. Usa la capacidad que estrenó
       * la 1.246.0 con «A cargo de» en la ficha de un pastor: un calculado que
       * lleva a donde salió se pinta como enlace, con su rótulo delante.
       *
       * `enElPapel: false` porque la hoja impresa ya lleva «Quién lo dirige»
       * desde el campo guardado, y el mismo dato dicho dos veces en un papel
       * que alguien firma hace dudar de cuál manda.
       */
      name: 'dirigido_por', label: 'Quién lo dirige', type: 'badge', enElPapel: false,
      help: 'Sale del enlace a su ficha, no de la copia del nombre: así no puede quedar viejo.',
      calc: (fila, { db }) => {
        const esNoMiembro = fila.lider_tipo === 'No miembro';
        const id = esNoMiembro ? fila.lider_no_miembro_id : fila.lider_id;
        const tabla = esNoMiembro ? 'no_miembros' : 'miembros';
        /*
         * UNA SOLA SALIDA EN BLANCO. Antes preguntaba primero «¿hay a quién
         * apuntar?» y después «¿existe esa ficha?». La primera pregunta no
         * decidía nada: sin enlace la consulta no encuentra ficha y se sale
         * por la segunda igual. Un guardia que se puede quitar sin que cambie
         * nada no está guardando; la línea que decide es esta.
         */
        const ficha = db.prepare(`SELECT nombres, apellidos FROM "${tabla}" WHERE id = ?`).get(id ?? null);
        if (!ficha) return '';
        return {
          texto: require('../nombres').paraMostrar(ficha.nombres, ficha.apellidos),
          ir: `#/m/${tabla}/ficha/${id}`,
        };
      },
    },
    {
      name: 'cumplimiento', label: 'Cumplimiento', type: 'badge',
      help: 'Se calcula con el reglamento, la directiva que está en ejercicio hoy —que sale de las fechas de su período— y el estado del cuerpo.',
      calc: (fila, { db }) => evaluarCumplimiento(fila, db),
    },
  ],
  fields: [
    {
      name: 'foto', label: 'Fotografía del cuerpo / grupo', type: 'file', accept: 'image/*',
      recorte: 'cuadrado',
      help: 'La foto con la que se reconoce a este cuerpo o grupo. Al subirla se ajusta sola de tamaño.',
    },
    { name: 'nombre', label: 'Nombre', type: 'text', required: true, help: 'Ej: Damas, Caballeros, Jóvenes, Coro, Escuela Dominical…' },
    {
      name: 'tipo', label: 'Tipo', type: 'select', required: true, default: 'Cuerpo',
      options: ['Cuerpo', 'Grupo'],
      help: 'CUERPO: entidad formal, con reglamento, deberes y derechos. GRUPO: agrupación de servicio o ayuda, sin reglamento ni obligaciones formales.',
    },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    {
      name: 'lider_tipo', label: '¿Quién lo dirige?', type: 'select',
      default: 'Miembro', options: REGISTROS,
      help: 'La segunda opción es para el hermano o la hermana que dirige un GRUPO sin estar '
        + 'inscrito en la membresía. Un cuerpo lo dirige un miembro inscrito: es formal, y de sus '
        + 'integrantes sale su directiva.',
    },
    {
      name: 'lider_id', label: 'Líder / Encargado', type: 'ref', ref: 'miembros',
      showIf: { field: 'lider_tipo', equals: 'Miembro' },
    },
    {
      name: 'lider_no_miembro_id', label: 'Encargado(a) no inscrito(a)', type: 'ref', ref: 'no_miembros',
      showIf: { field: 'lider_tipo', equals: 'No miembro' },
      help: 'Se busca en el registro de No Miembros. Si todavía no tiene ficha, créela ahí: basta con el nombre.',
    },
    {
      name: 'lider', label: 'Quién lo dirige', type: 'text', readonly: true,
      help: 'Lo copia el sistema de la ficha elegida, para que el listado y el buscador digan el '
        + 'nombre sin tener que mirar dos registros.',
    },
    {
      name: 'reune_lideres', label: 'Este cuerpo reúne a los miembros líderes de su iglesia', type: 'boolean',
      help: 'Es la directiva. Quien pase a la categoría «Miembro Líder» entra solo, y quien la deje sale solo. '
        + 'Se marca en un solo cuerpo por iglesia.',
    },
    { name: 'fecha_creacion', label: 'Fecha de creación', type: 'date' },

    // --- Cómo entra y cómo aporta cada integrante ---
    {
      name: 'meses_prueba', label: 'Meses de período de prueba', type: 'number',
      seccion: 'Ingreso de integrantes',
      help: 'Cuánto dura la prueba de quien entra a este cuerpo, antes de evaluar su informe. En blanco, se usan los meses de Configuración → Organización.', min: 0, max: 60,
    },
    {
      /*
       * Sin `default` a propósito: cuánto vale de fábrica depende del tipo, y
       * eso se decide en beforeSave. Un cuerpo nace cobrando y un grupo no.
       */
      name: 'cobra_cuota', label: 'Este cuerpo cobra cuota mensual', type: 'boolean',
      seccion: 'Cuota mensual',
      help: 'Los cuerpos nacen cobrando y los grupos no, porque casi ninguno cobra. Enciéndalo en el '
        + 'grupo que sí cobre, o apáguelo en el cuerpo que no. Un integrante suelto se exime desde su propia ficha.',
    },
    {
      name: 'cuota_mensual', label: 'Monto de la cuota', type: 'money', min: 0,
      showIf: { field: 'cobra_cuota', equals: '1' },
      help: 'Lo que le corresponde pagar cada mes a cada integrante de este cuerpo.',
    },

    // --- Propios de los cuerpos formales ---
    {
      name: 'fecha_constitucion', label: 'Fecha de constitución formal', type: 'date', noAntesDe: 'fecha_creacion',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'reglamento', label: 'Reglamento (documento)', type: 'file',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
      help: 'Reglamento vigente del cuerpo, con sus deberes y derechos.',
    },
    {
      name: 'reglamento_fecha', label: 'Fecha de aprobación del reglamento', type: 'date',
      showIf: { field: 'tipo', equals: 'Cuerpo' },
    },
    {
      name: 'estado', label: 'Estado', type: 'select', default: 'Activo',
      options: ['Activo', 'Inactivo'],
    },
    { name: 'descripcion', label: 'Descripción', type: 'textarea' },
  ],
  hooks: {
    /**
     * La directiva es una sola por iglesia.
     *
     * Con dos cuerpos marcados, un miembro líder entraría a los dos y saldría
     * de los dos, y ninguna de las dos listas sería «la directiva». Se dice
     * cuál lo tiene ya, para poder ir a destildarlo si de verdad se quiere
     * cambiar.
     */
    beforeSave(data, { id, existing, isNew, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const tipo = dato('tipo') || 'Cuerpo';
      const iglesiaId = dato('iglesia_id');

      /*
       * De fábrica un cuerpo cobra cuota y un grupo no.
       *
       * No se declara como `default` del campo porque depende del tipo. Solo
       * vale al crear y solo si no viene dicho: quien mande el dato manda.
       */
      if (isNew && (data.cobra_cuota === undefined || data.cobra_cuota === null || data.cobra_cuota === '')) {
        data.cobra_cuota = tipo === 'Grupo' ? 0 : 1;
      }

      /*
       * A un GRUPO lo puede dirigir alguien que no está inscrito.
       *
       * A un cuerpo no: es una entidad formal, y de sus integrantes sale su
       * directiva. Como en la ficha de integrante, la persona sale de uno de
       * los dos registros y el enlace del otro lado se suelta: si no, corregir
       * de un registro al otro dejaría el enlace viejo apuntando a alguien que
       * ya no dirige nada.
       */
      const liderTipo = REGISTROS.includes(dato('lider_tipo')) ? dato('lider_tipo') : 'Miembro';
      data.lider_tipo = liderTipo;
      if (liderTipo === 'No miembro' && tipo !== 'Grupo') {
        return 'Un cuerpo lo dirige un miembro inscrito: es una entidad formal y de sus integrantes '
          + 'sale su directiva. Para poner de encargado a alguien que no está en la membresía, el '
          + 'tipo tiene que ser Grupo.';
      }

      /*
       * De qué registro sale quien lo dirige, y las dos comprobaciones que se
       * le hacen (ver server/quien-dirige-el-cuerpo.js). Estaban escritas acá
       * y solo para la mitad: al encargado NO INSCRITO de un grupo se le
       * comprobaba la iglesia, y al líder formal de un cuerpo —del que sale su
       * directiva— no se le comprobaba nada.
       */
      const dirige = require('../quien-dirige-el-cuerpo');
      const deDonde = dirige.DE_DONDE[liderTipo];
      const campo = liderTipo === 'No miembro' ? 'lider_no_miembro_id' : 'lider_id';
      const otro = liderTipo === 'No miembro' ? 'lider_id' : 'lider_no_miembro_id';
      const quien = Number(dato(campo));
      data[otro] = null;
      let preguntaDelLider = null;
      if (!quien) {
        // Un cuerpo puede no tener líder puesto todavía: eso es legítimo
        data[campo] = null;
        data.lider = null;
      } else {
        const ficha = db
          .prepare(`SELECT nombres, apellidos, iglesia_id FROM "${deDonde.tabla}" WHERE id = ?`)
          .get(quien);
        if (!ficha) return 'La persona que se puso como líder ya no está en el sistema.';

        // La iglesia se FRENA: un cuerpo es de una iglesia y su gente es de esa
        // iglesia, y de ahí sale quién ve cada cosa suya.
        const deOtra = dirige.avisoSiEsDeOtraIglesia(ficha, iglesiaId);
        if (deOtra) return deOtra;

        data[campo] = quien;
        data.lider = `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();

        // Y que sea integrante se PREGUNTA: hay interinatos, y hay cuerpos que
        // se están formando. Se guarda para el final, con las otras preguntas.
        preguntaDelLider = dirige.avisoSiNoEsIntegrante(db, {
          tipo: liderTipo, personaId: quien, ficha, existing, confirmado,
        });
      }

      /*
       * La directiva es una sola por iglesia. Es un RECHAZO, no una pregunta:
       * hay que ir a destildar el otro cuerpo antes de poder guardar éste.
       */
      const marcada = dato('reune_lideres');
      if (marcada && iglesiaId) {
        const otra = db
          .prepare('SELECT id, nombre FROM cuerpos WHERE iglesia_id = ? AND reune_lideres = 1 AND id <> ?')
          .get(iglesiaId, id || 0);
        if (otra) {
          return `"${otra.nombre}" ya es la directiva de esta iglesia. Destíldelo ahí antes de marcar este, ` +
            'para que los miembros líderes no queden en dos cuerpos a la vez.';
        }
      }

      /*
       * Y al final, las dos cosas que este gancho PREGUNTA en vez de rechazar.
       *
       * Van últimas a propósito. Todo lo de arriba son rechazos —el dato no
       * entra, y no hay manera de contestarlos que sí—, así que tienen que
       * salir antes: preguntar primero haría que alguien contestara «está
       * bien» para toparse enseguida con un no.
       *
       * Y entre las dos manda el NOMBRE REPETIDO. El «igual_asi» es UNO solo
       * para todo el guardado —contestar que sí contesta las dos— así que el
       * orden decide cuál se llega a ver, y se pone delante la que cuesta más
       * deshacer: un cuerpo duplicado hay que borrarlo, y un monto sin poner
       * se pone. Además la de la cuota tiene otros dos lugares donde se dice
       * —el panel y el estado de cumplimiento— y ésta no tiene ninguno. Es el
       * mismo criterio con que quedaron ordenadas las tres preguntas de la
       * ficha de un pastor en la 1.242.0.
       */
      const repetido = require('../el-nombre-del-cuerpo')
        .avisoDeCuerpoRepetido(db, data, { existing, confirmado });
      if (repetido) return repetido;

      /*
       * Y en medio, la de quien lo dirige sin ser integrante: cuesta menos de
       * deshacer que un cuerpo duplicado —se cambia el líder y ya— y más que
       * un monto sin poner, que además se dice en otros dos lugares.
       */
      if (preguntaDelLider) return preguntaDelLider;

      return require('../cuota-sin-monto')
        .avisoSiCobraSinMonto(data, { existing, confirmado });
    },

    /**
     * Cada cuerpo estrena dos cuentas: su tesorería general y la de las
     * cuotas de sus integrantes, que se manejan aparte.
     */
    afterSave(fila, { isNew, existing, user, db }) {
      if (isNew) require('../cuentas-de-cuerpos').crearLasQueFalten(db, fila);

      /*
       * Si el cuerpo se cambió de iglesia, lo suyo se va con él.
       *
       * La iglesia de un cuerpo decide QUIÉN VE cada cosa suya, y sus cuentas,
       * sus fichas de integrante y los movimientos de esas cuentas la copian
       * del cuerpo al guardarse: esa copia se hacía una vez y no se volvía a
       * mirar. Medido al mudar un cuerpo de 52 integrantes, todo se quedaba en
       * la iglesia anterior (ver server/lo-que-sigue-al-cuerpo.js).
       *
       * Queda anotado en el Registro de Cambios, y no por prolijidad: son filas
       * de dinero y de gente cambiando de manos, y moverlas en silencio es
       * exactamente lo que ese registro existe para evitar.
       */
      // Sin `existing` no hay de dónde venir, y eso ya deja fuera al recién
      // creado: pedir además `!isNew` no agregaba ninguna condición, solo la
      // repetía. Y la comparación tiene que estar: si se mudara en cada
      // guardado, corregirle el teléfono a un cuerpo dejaría anotado en el
      // Registro de Cambios que su plata se movió de iglesia, que no pasó.
      const cambiaDeIglesia = existing
        && String(existing.iglesia_id) !== String(fila.iglesia_id);
      if (cambiaDeIglesia) {
        const sigue = require('../lo-que-sigue-al-cuerpo');
        const movidas = sigue.mudarLoSuyo(fila.id, fila.iglesia_id, db);
        if (movidas.length) {
          require('../bitacora').anotarCambio({
            def: module.exports,
            accion: 'Cambio',
            fila,
            detalle: `Al cambiar de iglesia se movió con el cuerpo: ${sigue.comoSeLee(movidas)}.`,
            usuario: user,
          });
        }
      }

      /**
       * Recién marcado como directiva: entran los líderes que ya lo eran.
       *
       * Sin esto la casilla solo valdría de ahí en adelante, y la directiva
       * arrancaría vacía teniendo la iglesia sus líderes registrados desde
       * antes. Se corre solo cuando la marca CAMBIA a puesta, no en cada
       * guardado: si no, cada vez que alguien corrigiera el teléfono del
       * cuerpo volvería a meter a los que se hubieran retirado a mano.
       */
      const seAcabaDeMarcar = fila.reune_lideres && (isNew || !(existing && existing.reune_lideres));
      if (seAcabaDeMarcar) require('../directiva').alMarcarUnCuerpo(db, fila, user);
    },

    /**
     * Borrar un cuerpo con gente adentro no se pregunta: se frena.
     *
     * Medido antes de esto, sobre uno con seis integrantes desde 2019 y una
     * directiva vigente, sin confirmar nada: 200, borrado, y se fueron las seis
     * fichas, la directiva y sus dos cajas. Sin una palabra.
     *
     * Lo único que se borra preguntando es el que TODAVÍA NO FUE NADA: el que
     * se creó hace un minuto con el nombre mal tecleado, cuyo único contenido
     * son las dos cajas vacías que el propio sistema le abrió al guardarlo. El
     * porqué de la distinción está en server/cuerpo-vacio.js.
     *
     * Lo que frena lo escribe el motor con las mismas palabras al armar el
     * plan; acá se sale sin decir nada y se deja que lo diga él, para que no
     * haya dos avisos distintos para lo mismo. Es como está resuelto el mismo
     * gancho en Iglesias.
     */
    beforeDelete(fila, { db, confirmado }) {
      const vacio = require('../cuerpo-vacio');
      const dependencias = require('../dependencias');
      const { contenido, rastro } = vacio.loQueCuelga(
        db, fila.id, dependencias.referenciasHacia('cuerpos'), dependencias.cuantasApuntan
      );

      if (contenido.length) return null;
      if (confirmado) return null;

      /*
       * Se pregunta aunque no cuelgue absolutamente nada. Borrar no se
       * deshace, y el mismo botón apretado sobre el cuerpo de al lado es
       * irreparable: en un listado de dieciséis, todos con el mismo icono,
       * eso no es una hipótesis.
       */
      return {
        error: vacio.preguntaDeBorrado(fila, rastro),
        confirmar: 'cuerpo_sin_nada',
      };
    },
  },

  extraRoutes(router, { db, requirePerm, can, scopeClause }) {
    /**
     * Los cuerpos que reciben cosas nuevas, para los desplegables.
     *
     * `ademas` trae lo que ese campo ya tenía elegido, y ese cuerpo entra
     * aunque esté inactivo: es el acta, la cuenta o la ficha de integrante de
     * un cuerpo que se cerró, y su cuerpo tiene que seguir a la vista.
     *
     * Se pide con la llave de VER cuerpos, que es la que ya hace falta para
     * que el desplegable diga sus nombres, y sale acotado por el alcance de
     * siempre.
     */
    router.get('/cuerpos/activos', requirePerm('cuerpos', 'view'), (req, res) => {
      const inactivos = require('../cuerpo-inactivo');
      const params = [];
      const where = [];
      const suyos = scopeClause(req.user, params);
      if (suyos) where.push(suyos);

      const ademas = Number(req.query.ademas) || 0;
      if (ademas) {
        params.push(ademas);
        where.push(`(${inactivos.condicionDeActivos()} OR id = ?)`);
      } else {
        where.push(inactivos.condicionDeActivos());
      }

      const filas = db
        .prepare(`SELECT id, nombre FROM cuerpos WHERE ${where.join(' AND ')} ORDER BY nombre`)
        .all(...params);
      res.json(require('../el-nombre-del-cuerpo')
        .conLoQueLosDistingue(filas.map((c) => ({ id: c.id, label: c.nombre })), db));
    });

    /**
     * El cuerpo del que se está pidiendo el panel, comprobando que sea uno de
     * los suyos.
     *
     * Estas rutas se pidieron siempre desde la ficha de un cuerpo que la
     * persona ya estaba viendo, así que parecía que bastaba con el permiso del
     * módulo. No basta: escribiendo la dirección a mano, quien tiene asignado
     * un cuerpo alcanzaba la gente, las cuotas y la plata de otro. El alcance
     * se comprueba acá, como en cualquier otra consulta.
     */
    const cuerpoDelUsuario = (req, res) => {
      const fila = db.prepare('SELECT * FROM cuerpos WHERE id = ?').get(req.params.id);
      if (!fila) {
        res.status(404).json({ error: 'Cuerpo no encontrado' });
        return null;
      }
      if (!require('../alcance').alcanza(module.exports, fila, req.user)) {
        res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
        return null;
      }
      return fila;
    };

    /**
     * Cada panel de la ficha pide SU permiso, no el del cuerpo.
     *
     * Los paneles se pintan dentro de la ficha del cuerpo, y por eso pedían
     * solo «Cuerpos → ver». Con eso, a quien se le quitaba Integrantes de
     * Cuerpos o Cuotas de Cuerpos igual los veía completos acá: el permiso
     * estaba puesto en el editor y no servía de nada, que es peor que no
     * tenerlo. Escribir en ellos sí exigía lo que corresponde; leer, no.
     *
     * Cada llave que se pide de más se nombra, para que el que se topa con un
     * 403 sepa cuál le falta.
     */
    const conPermisoDe = (...llaves) => (req, res, siguiente) => {
      for (const [modulo, accion, comoSeLlama] of llaves) {
        if (!can(req.user, modulo, accion)) {
          return res.status(403).json({ error: `No tiene permiso para ver ${comoSeLlama}` });
        }
      }
      siguiente();
    };

    const VE_INTEGRANTES = conPermisoDe(['integrantes_cuerpo', 'view', 'los integrantes de los cuerpos']);
    // Las cuotas son plata del cuerpo: hacen falta las dos cosas
    const VE_CUOTAS = conPermisoDe(
      ['cuotas_cuerpo', 'view', 'las cuotas de los cuerpos'],
      ['tesoreria_cuerpo', 'view', 'la tesorería de los cuerpos']
    );
    const COBRA_CUOTAS = conPermisoDe(['tesoreria_cuerpo', 'view', 'la tesorería de los cuerpos']);

    /**
     * EL RESUMEN DE UN CUERPO: cuánta gente, cuánto en caja, cómo va su
     * directiva y cuánto se mueve.
     *
     * La ficha de un cuerpo con 49 integrantes activos, dos cajas y su
     * directiva abría con el nombre, su iglesia y una sola insignia que decía
     * «Cuerpo». Nada más. Todo lo demás estaba detrás de sus siete pestañas, y
     * lo que está detrás de una pestaña no se mira: quien abre la ficha de un
     * cuerpo para saber si conviene fusionarlo, cerrarlo o pedirle su
     * reglamento no va a recorrerlas para averiguarlo. Es lo mismo que la
     * 1.234.0 le agregó a la ficha de una iglesia, y por lo mismo: ES LO QUE SE
     * MIRA ANTES DE DECIDIR.
     *
     * CADA CIFRA PIDE SU PROPIO PERMISO, y la que no se puede ver no viaja. Un
     * resumen es más peligroso que un listado, no menos: entrega la cifra sin
     * que haya que abrir nada. Es la misma corrección que ya se les hizo a los
     * paneles de esta misma ficha.
     */
    router.get('/cuerpos/:id(\\d+)/resumen', requirePerm('cuerpos', 'view'), (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      const { YA_OCURRIO } = require('../saldos');
      const { VIGENTES } = require('../integrantes');
      const id = cuerpo.id;
      const resumen = {};
      const cuantos = (sql, ...params) => db.prepare(sql).get(id, ...params).n;

      if (can(req.user, 'integrantes_cuerpo', 'view')) {
        /*
         * Los que pertenecen HOY —activos y en prueba— y, aparte, los que se
         * retiraron. Es la misma definición que usan la planilla de cuotas y
         * el panel de su ficha (ver server/integrantes.js): dos cifras de lo
         * mismo que se contradigan en la misma pantalla es exactamente lo que
         * le pasó a la primera versión del resumen de una iglesia.
         */
        const marcas = VIGENTES.map(() => '?').join(', ');
        resumen.integrantes = {
          activos: db
            .prepare(`SELECT COUNT(*) AS n FROM integrantes_cuerpo
                       WHERE cuerpo_id = ? AND estado IN (${marcas})`)
            .get(id, ...VIGENTES).n,
          total: cuantos('SELECT COUNT(*) AS n FROM integrantes_cuerpo WHERE cuerpo_id = ?'),
          en_prueba: cuantos("SELECT COUNT(*) AS n FROM integrantes_cuerpo WHERE cuerpo_id = ? AND estado = 'En prueba'"),
        };
      }

      /*
       * Su plata. Pide las DOS llaves, como en todas partes: ver las cuentas y
       * ver sus montos son permisos distintos, y quien no tenga el segundo ve
       * cuántas cajas hay y no cuánto hay en ellas (ver server/sensibles.js).
       */
      if (can(req.user, 'cuentas_tesoreria', 'view')) {
        const caja = db.prepare(
          `SELECT COUNT(*) AS cuentas,
                  COALESCE(SUM(c.saldo_inicial), 0)
                  + COALESCE((SELECT SUM(CASE WHEN t.tipo = 'Ingreso' THEN t.monto ELSE -t.monto END)
                              FROM tesoreria t
                             WHERE t.cuenta_id IN (SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ?)
                               AND ${YA_OCURRIO}), 0) AS saldo
             FROM cuentas_tesoreria c WHERE c.cuerpo_id = ?`
        ).get(id, id);
        const montos = can(req.user, 'tesoreria_montos', 'view');
        resumen.tesoreria = {
          cuentas: caja.cuentas,
          saldo: montos ? caja.saldo : null,
          reservado: !montos,
        };
      }

      /*
       * Su directiva en ejercicio, que es de lo primero que se pregunta al abrir un
       * cuerpo: es uno de los requisitos que su propio cumplimiento evalúa.
       */
      if (can(req.user, 'directivas', 'view')) {
        // La misma definición que el cumplimiento, leída del mismo archivo: el
        // resumen y la insignia de la ficha no pueden decir cosas distintas
        const vigente = require('../directiva-en-ejercicio').laQueEjerce(db, id);
        resumen.directiva = {
          periodo: vigente ? vigente.periodo : null,
          vence: vigente ? vigente.fecha_termino : null,
          total: cuantos('SELECT COUNT(*) AS n FROM directivas WHERE cuerpo_id = ?'),
        };
      }

      if (can(req.user, 'asistencias', 'view')) {
        // A un cuerpo se lo convoca por una LISTA de cuerpos, no por una
        // columna suya: se pregunta como lo pregunta el alcance (ver
        // server/alcance.js), o la cifra saldría siempre en cero.
        const convocado = `EXISTS (SELECT 1 FROM json_each(asistencias.cuerpos) WHERE json_each.value = ?)`;
        const ultima = db
          .prepare(`SELECT fecha FROM asistencias WHERE ${convocado} AND ${YA_OCURRIO} ORDER BY fecha DESC LIMIT 1`)
          .get(id);
        resumen.asistencia = {
          este_ano: cuantos(
            `SELECT COUNT(*) AS n FROM asistencias
              WHERE ${convocado} AND fecha >= date('now','localtime','start of year')`
          ),
          ultima: ultima ? ultima.fecha : null,
        };
      }

      if (can(req.user, 'actas_reuniones', 'view')) {
        const ultima = db
          .prepare('SELECT fecha FROM actas_reuniones WHERE cuerpo_id = ? ORDER BY fecha DESC LIMIT 1')
          .get(id);
        resumen.actas = {
          total: cuantos('SELECT COUNT(*) AS n FROM actas_reuniones WHERE cuerpo_id = ?'),
          ultima: ultima ? ultima.fecha : null,
        };
      }

      if (can(req.user, 'inventarios', 'view')) {
        resumen.inventario = {
          total: cuantos('SELECT COUNT(*) AS n FROM inventarios WHERE cuerpo_id = ?'),
        };
      }

      res.json(resumen);
    });

    // Detalle del cumplimiento de un cuerpo, para mostrarlo en su ficha
    router.get('/cuerpos/:id(\\d+)/cumplimiento', requirePerm('cuerpos', 'view'), (req, res) => {
      const fila = cuerpoDelUsuario(req, res);
      if (!fila) return;
      res.json(evaluarCumplimiento(fila, db));
    });

    /**
     * La gente del cuerpo, para el panel de su ficha: cada uno con su estado,
     * su período de prueba y si le corresponde pagar cuota. Vienen todos,
     * retirados incluidos, y la pantalla decide a quién muestra.
     */
    router.get('/cuerpos/:id(\\d+)/integrantes', requirePerm('cuerpos', 'view'), VE_INTEGRANTES, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      const { integrantesDe } = require('../integrantes');
      const hoy = require('../fechas').hoy();

      const gente = integrantesDe(db, cuerpo.id, { conRetirados: true }).map((f) => ({
        id: f.id,
        persona_tipo: f.persona_tipo,
        miembro_id: f.miembro_id || null,
        no_miembro_id: f.no_miembro_id || null,
        nombre: require('../nombres').paraMostrar(f.nombres, f.apellidos),
        rut: f.rut || null,
        foto: f.foto || null,
        estado: f.estado,
        fecha_ingreso: f.fecha_ingreso,
        fecha_fin_prueba: f.fecha_fin_prueba,
        fecha_oficial: f.fecha_oficial,
        fecha_retiro: f.fecha_retiro,
        motivo_retiro: f.motivo_retiro,
        exento_cuota: !!f.exento_cuota,
        exento_motivo: f.exento_motivo,
        lidera: f.persona_tipo === 'No miembro'
          ? Number(cuerpo.lider_no_miembro_id) === Number(f.no_miembro_id)
          : Number(cuerpo.lider_id) === Number(f.miembro_id),
        prueba_vencida: f.estado === 'En prueba' && !!f.fecha_fin_prueba && f.fecha_fin_prueba < hoy,
        evaluaciones: db
          .prepare('SELECT COUNT(*) n FROM evaluaciones_integrantes WHERE integrante_id = ?')
          .get(f.id).n,
      }));

      res.json({
        cuerpo: {
          id: cuerpo.id, nombre: cuerpo.nombre, tipo: cuerpo.tipo,
          cobra_cuota: !!cuerpo.cobra_cuota, cuota_mensual: cuerpo.cuota_mensual,
          meses_prueba: cuerpo.meses_prueba,
        },
        integrantes: gente,
        resumen: {
          activos: gente.filter((g) => g.estado === 'Activo').length,
          en_prueba: gente.filter((g) => g.estado === 'En prueba').length,
          retirados: gente.filter((g) => g.estado === 'Retirado').length,
          prueba_vencida: gente.filter((g) => g.prueba_vencida).length,
          no_inscritos: gente.filter((g) => g.persona_tipo === 'No miembro' && g.estado !== 'Retirado').length,
        },
        puede_editar: can(req.user, 'integrantes_cuerpo', 'edit'),
        puede_agregar: can(req.user, 'integrantes_cuerpo', 'create'),
        /*
         * Solo en un GRUPO se puede sumar a alguien que no está inscrito en la
         * membresía, y solo si además puede mirar ese registro: la lista de No
         * Miembros no se le abre a cualquiera (son fichas de gente en situación
         * vulnerable). La regla de verdad la aplica el servidor al guardar;
         * esto es para que la pantalla no ofrezca lo que va a ser rechazado.
         */
        admite_no_inscritos: cuerpo.tipo === 'Grupo' && can(req.user, 'no_miembros', 'view'),
      });
    });

    /**
     * La planilla de cuotas de un año: una fila por integrante y una columna
     * por mes, con lo que ya está pagado. Los retirados no salen, y quien está
     * exento —o pertenece a un cuerpo que no cobra— sale marcado como tal.
     */
    router.get('/cuerpos/:id(\\d+)/cuotas', requirePerm('cuerpos', 'view'), VE_CUOTAS, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      const anio = Number(req.query.anio) || new Date().getFullYear();
      const { integrantesDe } = require('../integrantes');

      const pagos = db
        .prepare('SELECT integrante_id, mes, monto, fecha_pago FROM cuotas_cuerpo WHERE cuerpo_id = ? AND anio = ?')
        .all(cuerpo.id, anio);

      const filas = integrantesDe(db, cuerpo.id).map((f) => {
        const suyos = pagos.filter((p) => Number(p.integrante_id) === Number(f.id));
        const meses = {};
        for (const p of suyos) meses[p.mes] = { monto: p.monto, fecha: p.fecha_pago };
        return {
          id: f.id,
          persona_tipo: f.persona_tipo,
          miembro_id: f.miembro_id || null,
          no_miembro_id: f.no_miembro_id || null,
          nombre: require('../nombres').paraMostrar(f.nombres, f.apellidos),
          estado: f.estado,
          exento: !!f.exento_cuota,
          exento_motivo: f.exento_motivo,
          meses,
          pagados: suyos.length,
          total: suyos.reduce((t, p) => t + (Number(p.monto) || 0), 0),
        };
      });

      res.json({
        anio,
        cobra_cuota: !!cuerpo.cobra_cuota,
        cuota_mensual: cuerpo.cuota_mensual,
        filas,
        total_recaudado: filas.reduce((t, f) => t + f.total, 0),
        puede_cobrar: can(req.user, 'cuotas_cuerpo', 'create') && can(req.user, 'tesoreria_cuerpo', 'view'),
      });
    });

    /** Marcar que alguien pagó su cuota de un mes, desde la propia planilla. */
    router.post('/cuerpos/:id(\\d+)/cuotas', requirePerm('cuotas_cuerpo', 'create'), COBRA_CUOTAS, (req, res) => {
      const cuerpo = cuerpoDelUsuario(req, res);
      if (!cuerpo) return;
      // Y que el integrante sea de este cuerpo: si no, se estaría cobrando en
      // el libro de uno la cuota de otro.
      const suyo = db
        .prepare('SELECT id FROM integrantes_cuerpo WHERE id = ? AND cuerpo_id = ?')
        .get(req.body && req.body.integrante_id, cuerpo.id);
      if (!suyo) return res.status(404).json({ error: 'Esa persona no es integrante de este cuerpo.' });

      const { registrarPago } = require('../cuotas');
      const r = registrarPago(db, {
        integranteId: req.body && req.body.integrante_id,
        anio: req.body && req.body.anio,
        mes: req.body && req.body.mes,
        usuarioId: req.user && req.user.id,
      });
      if (r.error) return res.status(400).json({ error: r.error });
      res.json(r.cuota);
    });

    /** Y deshacerlo, cuando se marcó por equivocación. */
    router.delete('/cuerpos/:id(\\d+)/cuotas/:cuota(\\d+)', requirePerm('cuotas_cuerpo', 'delete'), COBRA_CUOTAS, (req, res) => {
      if (!cuerpoDelUsuario(req, res)) return;
      const { borrarPago } = require('../cuotas');
      const cuota = db.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ? AND cuerpo_id = ?')
        .get(req.params.cuota, req.params.id);
      if (!cuota) return res.status(404).json({ error: 'Esa cuota no es de este cuerpo.' });
      const r = borrarPago(db, cuota.id);
      if (r.error) return res.status(400).json({ error: r.error });
      res.json({ ok: true });
    });
  },
};
