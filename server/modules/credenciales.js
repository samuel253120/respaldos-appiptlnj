/**
 * Módulo: Credenciales pastorales.
 *
 * La credencial es el documento de identidad ministerial de un pastor, una
 * pastora o un guía de obra: la firma el Pastor Presidente, se imprime, se
 * plastifica y se lleva encima. De ahí salen casi todas las reglas de este
 * archivo, que a primera vista parecen exageradas para una tarjeta:
 *
 *   · LOS DATOS NO SE ESCRIBEN, SE TOMAN. Nombres, apellidos, RUT, grado,
 *     función, iglesia, categoría y comuna salen del registro de la persona y
 *     del de su iglesia. Escribirlos de nuevo a mano sería pedir que un día no
 *     coincidan.
 *
 *   · Y AL EMITIR SE CONGELAN. La credencial guarda una copia de lo que salió
 *     impreso. Si mañana la persona cambia de iglesia o sube de grado, el papel
 *     que anda en su bolsillo sigue diciendo lo que decía: la ficha cambia, la
 *     credencial emitida no. Para reflejar el cambio se emite una nueva.
 *
 *   · EL NÚMERO LO PONE EL SISTEMA. No se escribe ni se corrige en ninguna
 *     pantalla (ver server/credenciales/serie.js).
 *
 *   · EL ESTADO NO SE GUARDA COMPLETO. «Por vencer» y «Vencida» se calculan de
 *     las fechas cada vez que se miran. Guardarlos obligaría a un proceso
 *     nocturno que los pusiera al día, y el día que ese proceso fallara la
 *     credencial diría «vigente» estando vencida.
 *
 * El diseño impreso está en public/credencial.css y public/app.js; el original
 * aprobado, en docs/credencial-pastor.html.
 */
const serie = require('../credenciales/serie');

/** Con cuánta anticipación se avisa que una credencial está por vencer. */
const diasPorVencer = () => require('../ajustes').numero('credencial_aviso_dias', 7, 365);

/**
 * Qué día es hoy PARA LA IGLESIA, no para el servidor.
 *
 * Esto decía `new Date().toISOString().slice(0, 10)`, y ahí estaba el error:
 * `toISOString` devuelve SIEMPRE la fecha universal, y no mira la zona horaria
 * que el sistema tiene configurada. En Chile eso son tres o cuatro horas de
 * diferencia, todas las noches.
 *
 * Y de esta fecha depende lo único que la tarjeta impresa no puede decir por
 * sí sola: si está vigente, por vencer o vencida. MEDIDO con el reloj puesto
 * en el lunes 24 de agosto de 2026 a las 21:30 en Chile continental, una
 * credencial que vencía ese mismo 24 ya salía como VENCIDA —le quedaban dos
 * horas y media—, y eso es lo que contestaba la página pública a quien
 * escaneara su código en la puerta de una iglesia. Pasaba entre las 20:00 y la
 * medianoche en invierno y entre las 21:00 y la medianoche en verano: justo
 * las horas en que hay culto.
 *
 * `fechas.hoy()` pregunta con los métodos locales de la fecha, que sí obedecen
 * la zona que `zona-horaria.aplicar()` deja puesta al arrancar y al guardar la
 * configuración. Es la misma que usa el resto del sistema.
 */
const hoyISO = () => require('../fechas').hoy();

/**
 * En qué está realmente una credencial.
 *
 * Lo guardado manda cuando es una decisión de alguien —un borrador, una
 * revocación, un reemplazo—; las fechas mandan cuando es el calendario el que
 * decide.
 */
function situacionDe(fila) {
  const guardado = fila.estado || 'Borrador';
  if (guardado !== 'Vigente') return guardado;
  const hoy = hoyISO();
  const vence = fila.fecha_vencimiento;
  if (!vence) return 'Vigente'; // sin vencimiento no caduca sola
  if (vence < hoy) return 'Vencida';
  const faltan = Math.round((new Date(vence) - new Date(hoy)) / 86400000);
  return faltan <= diasPorVencer() ? 'Por vencer' : 'Vigente';
}

module.exports = {
  name: 'credenciales',
  label: 'Credenciales',
  labelSingular: 'Credencial',
  genero: 'f', // «una credencial»: la regla por la terminación no lo acierta
  icon: '🪪',
  group: 'Documentación',
  order: 64,
  display: '{serie_completa} — {snap_apellidos} {snap_nombres}',
  dateField: 'fecha_emision',
  printable: true,
  searchFields: ['serie', 'snap_nombres', 'snap_apellidos', 'snap_rut'],
  listFields: ['serie_completa', 'snap_apellidos', 'snap_nombres', 'snap_grado', 'iglesia_id', 'fecha_vencimiento', 'situacion'],
  filterFields: ['estado', 'iglesia_id'],
  defaultSort: { field: 'id', dir: 'desc' },

  computed: [
    {
      name: 'serie_completa', label: 'N.º de serie', type: 'text',
      calc: (r) => serie.conDigito(r.serie, r.serie_dv),
    },
    {
      name: 'situacion', label: 'Situación', type: 'badge',
      calc: (r) => situacionDe(r),
    },
  ],

  fields: [
    /* ---------------- lo que pone el sistema ---------------- */
    {
      name: 'serie', label: 'N.º de serie', type: 'text', readonly: true, unique: true,
      seccion: 'Identificación de la credencial',
      help: 'Lo asigna el sistema al emitirla y no se puede escribir ni corregir. Corre de forma continua: no se reinicia con el año y ningún número se reutiliza.',
    },
    {
      // Se muestra al lado de la serie, como en el diseño impreso: ahí el
      // número y su dígito van separados por el guion. Verlo suelto evita la
      // confusión de leer «0012026» en la ficha y «0012026-1» en la tarjeta.
      name: 'serie_dv', label: 'Dígito verificador', type: 'text', readonly: true,
    },
    { name: 'correlativo', label: 'Correlativo', type: 'number', readonly: true, oculto: true },

    /* ---------------- de quién es ---------------- */
    {
      name: 'pastor_id', label: 'Pastor, pastora o guía de obra', type: 'ref', ref: 'pastores', required: true,
      seccion: 'Titular',
      bloqueadoSi: { field: 'estado', salvo: 'Borrador' },
      help: 'De su ficha salen la fotografía, el grado, la función, el RUT y la iglesia. Si algo está mal, se corrige allá y se emite de nuevo.',
    },
    {
      // No se marca «obligatorio»: no lo escribe nadie, lo pone el sistema
      // desde la ficha del titular. Que esté es cosa del hook de más abajo,
      // que no deja crear una credencial de alguien sin iglesia.
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma de la ficha del titular.',
    },
    /*
     * De qué solicitud salió, si salió de alguna.
     *
     * Lo pone la solicitud al ofrecer el paso siguiente. No toca nada de lo que
     * se imprime ni de lo que se firma: es solo el enlace de vuelta, para que la
     * ficha de la solicitud pueda decir «ya se emitió» en vez de volver a
     * ofrecerlo.
     */
    {
      name: 'solicitud_id', label: 'Solicitud que la originó', type: 'ref', ref: 'solicitudes',
      // Se acepta al crear y nunca más: se sabe en el momento en que se emite,
      // y cambiarlo después sería reescribir de dónde salió
      readonly: true, soloAlCrear: true,
      help: 'Se pone solo cuando se emite desde una solicitud aprobada. En su seguimiento queda anotado.',
    },

    /* ---------------- la copia congelada de lo impreso ---------------- */
    {
      name: 'snap_nombres', label: 'Nombres', type: 'text', readonly: true,
      seccion: 'Lo que dice el papel',
      help: 'Lo que salió impreso. Queda congelado al emitir: si la ficha cambia, esta credencial sigue diciendo lo mismo.',
    },
    { name: 'snap_apellidos', label: 'Apellidos', type: 'text', readonly: true },
    { name: 'snap_rut', label: 'RUT', type: 'text', readonly: true },
    { name: 'snap_grado', label: 'Grado ministerial', type: 'text', readonly: true },
    { name: 'snap_funcion', label: 'Cargo o función', type: 'text', readonly: true },
    { name: 'snap_categoria', label: 'Categoría de la iglesia', type: 'text', readonly: true },
    { name: 'snap_iglesia', label: 'Nombre de la iglesia', type: 'text', readonly: true },
    { name: 'snap_comuna', label: 'Comuna', type: 'text', readonly: true },
    { name: 'snap_foto', label: 'Fotografía usada', type: 'file', accept: 'image/*', readonly: true, oculto: true },

    /* ---------------- vigencia ---------------- */
    {
      name: 'fecha_emision', label: 'Fecha de entrega', type: 'date', required: true,
      seccion: 'Vigencia',
      // Se elige mientras es un borrador y se traba al emitirla: desde ese
      // momento va impresa en una tarjeta que anda en el bolsillo de alguien,
      // y la fila y el papel tienen que seguir diciendo lo mismo. Antes esto
      // se resolvía borrando el campo del guardado sin avisar, así que quien
      // corregía una fecha mal escrita se iba creyendo que la había corregido.
      bloqueadoSi: { field: 'estado', salvo: 'Borrador' },
    },
    {
      name: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', required: true,
      futuro: true, noAntesDe: 'fecha_emision',
      bloqueadoSi: { field: 'estado', salvo: 'Borrador' },
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Borrador',
      options: ['Borrador', 'Vigente', 'Revocada', 'Reemplazada'],
      // De solo lectura: cada cambio de estado tiene su botón y su permiso
      // (ver la comprobación en beforeSave). Ofrecerlo como una lista que se
      // elige era ofrecer algo que el servidor rechaza.
      readonly: true,
      help: 'Se cambia con los botones «Emitir» y «Revocar», no acá. «Por vencer» y «Vencida» los calcula el sistema a partir de la fecha de vencimiento.',
    },
    {
      name: 'motivo_revocacion', label: 'Motivo de la revocación', type: 'textarea',
      showIf: { field: 'estado', equals: 'Revocada' },
      help: 'Obligatorio al revocar. Queda en el registro de cambios: pérdida, robo, cese del cargo.',
    },
    {
      name: 'reemplaza_a', label: 'Reemplaza a la credencial', type: 'ref', ref: 'credenciales',
      readonly: true, oculto: true,
    },

    /* ---------------- encuadre de la fotografía ---------------- */
    // Se guardan para que al reimprimir salga idéntica a la primera vez.
    { name: 'foto_zoom', label: 'Acercamiento de la foto', type: 'number', oculto: true, default: 1 },
    { name: 'foto_x', label: 'Posición horizontal', type: 'number', oculto: true, default: 50 },
    { name: 'foto_y', label: 'Posición vertical', type: 'number', oculto: true, default: 50 },
    { name: 'foto_brillo', label: 'Brillo', type: 'number', oculto: true, default: 100 },
    { name: 'foto_contraste', label: 'Contraste', type: 'number', oculto: true, default: 100 },

    { name: 'notas', label: 'Notas internas', type: 'textarea', seccion: 'Notas' },
  ],

  /**
   * Por qué un campo trabado ya no se puede cambiar.
   *
   * El motor sabe QUE está trabado —lo dice `bloqueadoSi`—; solo el módulo
   * sabe por qué, y decirlo es la diferencia entre un «no se puede» y una
   * explicación que además indica qué hacer en su lugar.
   */
  razonDelBloqueo(fila) {
    const numero = require('../credenciales/serie').conDigito(fila.serie, fila.serie_dv);
    return (
      `La credencial ${numero ? `N.º ${numero} ` : ''}ya fue emitida y lo que dice el papel quedó ` +
      'congelado: la tarjeta que anda en el bolsillo de su titular y esta ficha tienen que seguir ' +
      'diciendo lo mismo. Para reflejar un cambio se emite una credencial nueva desde la ficha de la ' +
      'persona; la anterior queda como reemplazada y se conserva.'
    );
  },

  hooks: {
    /**
     * Lo que salió de una solicitud queda anotado en su seguimiento.
     *
     * Que un documento haya nacido de una solicitud es la mitad de la respuesta
     * que se le dio a quien pidió: si no queda dicho ahí, la solicitud aparece
     * aprobada y sin rastro de qué se hizo con ella.
     */
    afterSave(fila, { isNew, existing, user, db }) {
      if (!fila.solicitud_id) return;
      if (!isNew && existing && Number(existing.solicitud_id) === Number(fila.solicitud_id)) return;
      require('../solicitudes/paso-siguiente')
        .anotarQueSalio(db, fila.solicitud_id, 'credenciales', fila, user);
    },
    /**
     * Antes de guardar.
     *
     * Mientras es BORRADOR, los datos del titular se refrescan en cada
     * guardado: el borrador siempre muestra lo que dice la ficha hoy. En
     * cuanto se emite, se congelan y no se vuelven a tocar —eso es lo que
     * hace que la credencial impresa y la fila digan lo mismo para siempre—.
     */
    beforeSave(data, { isNew, existing, user }) {
      const datos = require('../credenciales/datos');
      const estabaEmitida = existing && existing.estado && existing.estado !== 'Borrador';

      if (estabaEmitida) {
        /**
         * Ya salió en papel: ni la serie, ni el titular, ni lo impreso cambian.
         *
         * Esto es la SEGUNDA capa. La primera son los campos mismos: los que
         * se escriben a mano —el titular y las dos fechas— llevan
         * `bloqueadoSi`, así que la pantalla los dibuja trabados y el motor
         * contesta explicando si igual llegan; y los que no los escribe nadie
         * —la serie, lo congelado, la iglesia— son `readonly` y el motor los
         * descarta antes de llegar hasta acá.
         *
         * Esta pasada se conserva igual, y a propósito: si mañana alguien
         * quitara una de esas marcas, el dato congelado de una credencial
         * emitida seguiría sin poder reescribirse. Es la clase de regla que
         * conviene que sostengan dos cosas y no una.
         */
        for (const campo of Object.keys(data)) {
          if (campo === 'estado' || campo === 'motivo_revocacion' || campo === 'notas') continue;
          if (campo.startsWith('snap_') || campo === 'serie' || campo === 'serie_dv' ||
              campo === 'correlativo' || campo === 'pastor_id' || campo === 'iglesia_id' ||
              campo === 'fecha_emision' || campo === 'fecha_vencimiento') {
            delete data[campo];
          }
        }
      } else {
        // Borrador: los datos se toman de la ficha, no se escriben
        const pastorId = data.pastor_id !== undefined ? data.pastor_id : existing && existing.pastor_id;
        if (!pastorId) return 'Indique de quién es la credencial';
        const suyos = datos.delTitular(pastorId);
        if (!suyos) return 'Esa persona no está en el registro de Pastores / Guías';
        if (!suyos.iglesia_id) {
          return `${suyos.snap_nombres} ${suyos.snap_apellidos} no tiene iglesia en su ficha, y la credencial lleva impresa la iglesia. Complételo allá y vuelva.`;
        }
        /**
         * Y la iglesia del titular tiene que estar entre las suyas.
         *
         * Esta comprobación va acá y no puede faltar: el guardado ya revisó
         * que la iglesia enviada estuviera dentro de lo asignado, pero un
         * renglón más abajo la credencial toma la iglesia DEL TITULAR, que es
         * otra. Sin esto, quien tuviera una iglesia asignada podía crear la
         * credencial de un pastor de cualquier otra mandando su número: la
         * fila quedaba fuera de su alcance —no la volvía a ver— pero la
         * respuesta le devolvía el nombre y el RUT de esa persona.
         */
        const alcance = require('../alcance');
        if (!alcance.alcanzaIglesia(user, suyos.iglesia_id)) {
          return 'Esa persona está fuera de las iglesias que tiene asignadas';
        }
        Object.assign(data, suyos);
      }

      // Revocar exige decir por qué, y queda escrito (punto 10.6)
      const estado = data.estado !== undefined ? data.estado : existing && existing.estado;
      if (estado === 'Revocada') {
        const motivo = data.motivo_revocacion !== undefined
          ? data.motivo_revocacion
          : existing && existing.motivo_revocacion;
        if (!motivo || !String(motivo).trim()) {
          return 'Para revocar una credencial hay que escribir el motivo: se pierde, se roba o cesa el cargo, y eso queda en el registro';
        }
      }

      /**
       * EL ESTADO NO SE CAMBIA DESDE EL FORMULARIO. Ninguno, en ninguna
       * dirección.
       *
       * Cada cambio de estado es un acto con su propia puerta y su propio
       * permiso: emitir pide la llave `credencial_emitir` y consume un número
       * de serie; revocar pide `credencial_revocar` y exige el motivo escrito;
       * el reemplazo lo pone el sistema solo al emitir la siguiente.
       *
       * Antes acá solo se frenaba el salto de Borrador a Vigente, y eso dejaba
       * abierta la puerta de atrás: con el permiso de EDITAR credenciales
       * —sin ninguna de las dos llaves— se podía mandar `estado: 'Revocada'`
       * por el guardado corriente y anular la credencial de cualquiera; o al
       * revés, devolver a «Vigente» una que estaba revocada y que la página
       * pública volviera a darla por buena. Comprobado que pasaba.
       */
      if (!isNew && existing && estado !== undefined && estado !== existing.estado) {
        return estado === 'Vigente'
          ? 'Una credencial se pone en vigencia con el botón «Emitir la credencial», que es lo que le asigna su número de serie'
          : 'El estado de una credencial no se cambia desde el formulario: use «Emitir» o «Revocar», que son los que piden su permiso y dejan constancia';
      }
      if (isNew && estado && estado !== 'Borrador') {
        return 'Una credencial nace como borrador y se emite después, cuando estén todos sus datos';
      }
      return null;
    },

    /**
     * Una credencial emitida no se borra. Nunca (puntos 10.2 y 17.6).
     *
     * Lo que se borra es un borrador: un papel que no salió, que no tiene
     * número y que no está en el bolsillo de nadie. Todo lo demás es historia
     * de un documento de identidad que existió, y borrarla dejaría un hueco en
     * la cuenta de los números de serie —el correlativo no se reutiliza, así
     * que faltaría uno sin explicación— y en el registro de qué se le entregó
     * a quién.
     *
     * Una credencial que ya no vale se REVOCA, con su motivo escrito; una que
     * quedó atrás se marca REEMPLAZADA sola al emitir la siguiente. Las dos
     * siguen ahí.
     */
    beforeDelete(fila) {
      const estado = fila.estado || 'Borrador';
      if (estado === 'Borrador') return null;
      const numero = require('../credenciales/serie').conDigito(fila.serie, fila.serie_dv);
      return (
        `La credencial N.º ${numero} ya fue emitida y no se puede eliminar: es el registro de un ` +
        'documento que se entregó. Si dejó de valer, revóquela con su motivo; si se emitió otra en su ' +
        'lugar, el sistema ya la marcó como reemplazada.'
      );
    },
  },

  extraRoutes(router, { db, requirePerm, can }) {
    const datos = require('../credenciales/datos');
    const serieDe = require('../credenciales/serie');
    const bitacora = require('../bitacora');
    const alcance = require('../alcance');

    /** La credencial pedida, comprobando que esté dentro de lo que alcanza. */
    const suya = (req, res) => {
      const fila = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(req.params.id);
      if (!fila) { res.status(404).json({ error: 'Credencial no encontrada' }); return null; }
      if (!alcance.alcanza(module.exports, fila, req.user)) {
        res.status(403).json({ error: 'Esa credencial está fuera de lo que tiene asignado' });
        return null;
      }
      return fila;
    };

    /**
     * Los datos con que se abre el formulario de una credencial nueva.
     *
     * La pantalla no los pide campo por campo: los recibe ya armados desde la
     * ficha de la persona y la de su iglesia, y de paso se entera de lo que
     * falta antes de que alguien llene nada.
     */
    router.get('/credenciales/nueva/:pastor(\\d+)', requirePerm('credenciales', 'create'), (req, res) => {
      const suyos = datos.delTitular(req.params.pastor);
      if (!suyos) return res.status(404).json({ error: 'Esa persona no está en el registro de Pastores / Guías' });
      if (!alcance.alcanzaIglesia(req.user, suyos.iglesia_id)) {
        return res.status(403).json({ error: 'Esa persona está fuera de las iglesias que tiene asignadas' });
      }
      const vigente = db
        .prepare("SELECT id, serie, serie_dv, fecha_vencimiento FROM credenciales WHERE pastor_id = ? AND estado = 'Vigente'")
        .get(suyos.pastor_id);
      res.json({
        datos: suyos,
        falta: datos.loQueFalta({ ...suyos, fecha_emision: 'x', fecha_vencimiento: 'x' }),
        recursos_que_faltan: datos.recursosQueFaltan(),
        ya_tiene_vigente: vigente || null,
      });
    });

    /**
     * Emitir: le pone el número, congela lo impreso y la deja vigente.
     *
     * Todo en una sola transacción, porque son cosas que no pueden quedar a
     * medias: una credencial vigente sin número, o dos vigentes de la misma
     * persona, serían peores que un error.
     */
    router.post('/credenciales/:id(\\d+)/emitir', requirePerm('credenciales', 'edit'), (req, res) => {
      /**
       * Emitir no va con «editar credenciales» (punto 12.2).
       *
       * Preparar el borrador es trabajo de oficina; ponerle el número de serie
       * y entregarla es una decisión de la corporación, porque la credencial
       * la firma el Pastor Presidente. Y no se deshace: el número queda
       * consumido aunque después se anule.
       */
      if (!can(req.user, 'credencial_emitir', 'view')) {
        return res.status(403).json({
          error:
            'No tiene permiso para emitir credenciales. Puede dejar el borrador preparado; la emisión ' +
            'la hace quien tenga esa llave, porque la credencial la firma el Pastor Presidente.',
        });
      }
      const fila = suya(req, res);
      if (!fila) return;
      if (fila.estado !== 'Borrador') {
        return res.status(400).json({ error: 'Esta credencial ya fue emitida. Para reflejar un cambio se emite una nueva.' });
      }

      const faltanRecursos = datos.recursosQueFaltan();
      if (faltanRecursos.length) {
        return res.status(400).json({
          error: `Falta cargar ${faltanRecursos.join(', ')} en Configuración del Sistema. Sin eso la credencial no se puede imprimir.`,
        });
      }

      // Se vuelven a tomar los datos de la ficha en este momento: lo que se
      // congela es lo que dice el registro cuando se emite, no lo que decía
      // cuando alguien creó el borrador hace tres semanas.
      const suyos = datos.delTitular(fila.pastor_id);
      if (!suyos) return res.status(400).json({ error: 'La persona de esta credencial ya no está en el registro' });
      const completa = { ...fila, ...suyos };
      const falta = datos.loQueFalta(completa);
      if (falta.length) {
        return res.status(400).json({
          error: `No se puede emitir: falta ${falta.join(', ')}. Complételo en la ficha de la persona o de su iglesia y vuelva a intentarlo.`,
          falta,
        });
      }

      const anio = Number(String(fila.fecha_emision || '').slice(0, 4)) || new Date().getFullYear();
      let numero;
      const emitir = db.transaction(() => {
        numero = serieDe.tomarSerie(anio);
        // La anterior de esta persona queda reemplazada, no se borra (17.6)
        const anterior = db
          .prepare("SELECT id FROM credenciales WHERE pastor_id = ? AND estado = 'Vigente' AND id <> ?")
          .get(fila.pastor_id, fila.id);
        if (anterior) {
          db.prepare("UPDATE credenciales SET estado = 'Reemplazada', updated_at = datetime('now','localtime') WHERE id = ?")
            .run(anterior.id);
        }
        db.prepare(
          /**
           * `iglesia_id` se vuelve a fijar acá, igual que lo impreso.
           *
           * Los datos se congelan en este momento, tomados de la ficha de hoy.
           * Si la persona cambió de iglesia entre el día que se creó el
           * borrador y el día que se emite, la tarjeta sale con la iglesia
           * nueva —eso está bien— pero la fila quedaba archivada en la vieja,
           * y de esa columna dependen tres cosas: qué credenciales ve cada
           * usuario según sus iglesias asignadas, el listado y el aviso de
           * «por vencer» del panel. La tarjeta decía una iglesia y el sistema
           * la contaba en otra.
           */
          `UPDATE credenciales SET serie = ?, serie_dv = ?, correlativo = ?, estado = 'Vigente',
             iglesia_id = ?,
             snap_nombres = ?, snap_apellidos = ?, snap_rut = ?, snap_grado = ?, snap_funcion = ?,
             snap_categoria = ?, snap_iglesia = ?, snap_comuna = ?, snap_foto = ?,
             reemplaza_a = ?, updated_at = datetime('now','localtime'), updated_by = ?, version = version + 1
           WHERE id = ?`
        ).run(
          numero.serie, numero.dv, numero.correlativo,
          suyos.iglesia_id,
          suyos.snap_nombres, suyos.snap_apellidos, suyos.snap_rut, suyos.snap_grado, suyos.snap_funcion,
          suyos.snap_categoria, suyos.snap_iglesia, suyos.snap_comuna, suyos.snap_foto,
          anterior ? anterior.id : null, req.user.id, fila.id
        );
        return anterior;
      });

      let anterior = null;
      try {
        anterior = emitir.immediate();
      } catch (e) {
        return res.status(500).json({ error: `No se pudo emitir la credencial: ${e.message}` });
      }

      const quedo = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(fila.id);
      bitacora.anotarCambio({
        def: module.exports, accion: 'Emisión', fila: quedo, usuario: req.user,
        detalle: `Se emitió la credencial N.º ${serieDe.conDigito(quedo.serie, quedo.serie_dv)} a ${quedo.snap_apellidos} ${quedo.snap_nombres}` +
          (anterior ? `. La anterior (#${anterior.id}) quedó reemplazada.` : '.'),
      });

      // Y en la bitácora de su ficha de miembro, cuando la tiene enlazada: que
      // le emitan su credencial es un hecho de su vida, no solo de la oficina
      bitacora.anotarCredencial({
        pastorId: quedo.pastor_id, usuario: req.user, fecha: quedo.fecha_emision,
        texto: `Se le emitió la credencial N.º ${serieDe.conDigito(quedo.serie, quedo.serie_dv)}`
          + (anterior ? ', que reemplaza a la anterior.' : '.'),
      });

      /**
       * Y el reemplazo se anota TAMBIÉN en la credencial que quedó atrás
       * (punto 15.7).
       *
       * Decirlo solo en la nueva no alcanza: quien mira la historia de la
       * credencial vieja —que es la que alguien tiene en la mano y ya no
       * vale— tiene que encontrar ahí por qué dejó de valer, sin ir a
       * buscarlo a la ficha de otra.
       */
      if (anterior) {
        const laVieja = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(anterior.id);
        bitacora.anotarCambio({
          def: module.exports, accion: 'Reemplazo', fila: laVieja, usuario: req.user,
          detalle:
            `Estado: Vigente → Reemplazada. La reemplaza la credencial N.º ` +
            `${serieDe.conDigito(quedo.serie, quedo.serie_dv)} (#${quedo.id}), emitida hoy al mismo titular. ` +
            'Se conserva como parte del historial.',
        });
      }

      res.json({ ok: true, credencial: quedo, reemplazo: anterior ? anterior.id : null });
    });

    /** Revocar: con motivo escrito, y a la vista en la verificación al instante. */
    router.post('/credenciales/:id(\\d+)/revocar', requirePerm('credenciales', 'edit'), (req, res) => {
      /**
       * Revocar tampoco (punto 12.2), y por una razón distinta que emitir:
       * desde el momento en que se revoca, cualquiera que escanee el código de
       * esa credencial ve que no vale. Es una decisión que sale del sistema
       * hacia afuera.
       */
      if (!can(req.user, 'credencial_revocar', 'view')) {
        return res.status(403).json({
          error:
            'No tiene permiso para revocar credenciales. Avise a quien administre el sistema: una vez ' +
            'revocada, quien escanee su código verá que no es válida.',
        });
      }
      const fila = suya(req, res);
      if (!fila) return;
      const motivo = String((req.body && req.body.motivo) || '').trim();
      if (!motivo) {
        return res.status(400).json({ error: 'Escriba el motivo de la revocación: queda en el registro y es lo que explica por qué esta credencial dejó de valer' });
      }
      if (fila.estado === 'Borrador') {
        return res.status(400).json({ error: 'Un borrador no se revoca: se elimina. Revocar es para una credencial que ya salió en papel.' });
      }
      if (fila.estado === 'Revocada') return res.status(400).json({ error: 'Esta credencial ya estaba revocada' });

      res.json({ ok: true, credencial: revocarLa(fila, { motivo, usuario: req.user }) });
    });

    /**
     * Todo lo que la vista de impresión necesita, en una sola respuesta.
     *
     * El código QR se arma acá y no en la pantalla porque lleva el código de
     * autenticidad, que se firma con una clave que no puede salir del
     * servidor (ver credenciales/codigo.js).
     */
    router.get('/credenciales/:id(\\d+)/impresion', requirePerm('credenciales', 'view'), (req, res) => {
      const fila = suya(req, res);
      if (!fila) return;
      const ajustes = require('../ajustes');
      const qr = require('../credenciales/qr');

      // El dominio con que se arma la dirección de verificación sale de la
      // propia petición: es el que el navegador está usando ahora mismo, así
      // que no hay una dirección configurada que se pueda quedar vieja.
      const protocolo = req.get('x-forwarded-proto') || req.protocol;
      const dominio = `${protocolo}://${req.get('host')}`;

      res.json({
        credencial: { ...fila, serie_completa: serieDe.conDigito(fila.serie, fila.serie_dv), situacion: situacionDe(fila) },
        qr: qr.para(fila, { modo: ajustes.obtener('credencial_qr_modo'), dominio }),
        recursos_que_faltan: datos.recursosQueFaltan(),
        institucion: {
          nombre: ajustes.obtener('iglesia_nombre') || '',
          personalidad_juridica: qr.PERSONALIDAD_JURIDICA,
        },
      });
    });

    /**
     * Queda anotado que se volvió a imprimir (punto 15.7).
     *
     * Se llama desde la pantalla al mandar a la impresora. No devuelve nada
     * útil: lo que importa es que quede el rastro de quién y cuándo.
     */
    router.post('/credenciales/:id(\\d+)/impresa', requirePerm('credenciales', 'view'), (req, res) => {
      const fila = suya(req, res);
      if (!fila) return;
      if (fila.estado === 'Borrador') return res.json({ ok: true, anotado: false });
      bitacora.anotarCambio({
        def: module.exports, accion: 'Impresión', fila, usuario: req.user,
        detalle: `Se imprimió la credencial N.º ${serieDe.conDigito(fila.serie, fila.serie_dv)} de ${fila.snap_apellidos} ${fila.snap_nombres}`,
      });
      res.json({ ok: true, anotado: true });
    });

    /** Los totales del listado: generadas desde el comienzo y por situación. */
    router.get('/credenciales/resumen', requirePerm('credenciales', 'view'), (req, res) => {
      const params = [];
      const donde = alcance.condiciones(module.exports, req.user, params);
      const filas = db
        .prepare(`SELECT estado, fecha_vencimiento FROM credenciales ${donde ? 'WHERE ' + donde : ''}`)
        .all(...params);
      const cuenta = { Borrador: 0, Vigente: 0, 'Por vencer': 0, Vencida: 0, Revocada: 0, Reemplazada: 0 };
      for (const f of filas) cuenta[situacionDe(f)] = (cuenta[situacionDe(f)] || 0) + 1;
      res.json({
        // Cuántas se han generado en total desde el comienzo (punto 7.12). No
        // es lo mismo que cuántas hay: los números consumidos no vuelven.
        generadas: serieDe.cuantasSeHanGenerado(),
        por_situacion: cuenta,
      });
    });

    /** Las que están por vencer, para el aviso del panel (punto 10.4). */
    router.get('/credenciales/por-vencer', requirePerm('credenciales', 'view'), (req, res) => {
      res.json(porVencer(req.user));
    });
  },

  situacionDe,
  porVencer,
  revocarLa,
  lasVigentesDe,
  deQuienesYaNoEjercen,
  diasPorVencer,
};

/**
 * Revocar una credencial: dejarla sin valor, conservándola.
 *
 * Vive acá y no dentro de la ruta porque la usan DOS: quien la revoca a mano
 * desde la pantalla, y el gancho que la revoca sola cuando su titular deja de
 * ejercer (ver server/pastor-que-ejerce.js). Escrita dos veces, un día una de
 * las dos se olvidaría de anotarlo en el historial del pastor, y una
 * credencial dejaría de valer sin que quede dicho dónde se ve.
 *
 * NUNCA SE BORRA: una credencial emitida es un documento, y lo que hace que
 * revocarla sirva de algo es que quede, con su motivo y su fecha, para poder
 * mostrarla después. Devuelve la fila como quedó.
 */
function revocarLa(fila, { motivo, usuario }) {
  const { db } = require('../db');
  const bitacora = require('../bitacora');
  const serieDe = require('../credenciales/serie');

  db.prepare(
    `UPDATE credenciales SET estado = 'Revocada', motivo_revocacion = ?,
       updated_at = datetime('now','localtime'), updated_by = ?, version = version + 1 WHERE id = ?`
  ).run(motivo, usuario ? usuario.id : null, fila.id);

  const quedo = db.prepare('SELECT * FROM credenciales WHERE id = ?').get(fila.id);
  const numero = serieDe.conDigito(quedo.serie, quedo.serie_dv);
  bitacora.anotarCambio({
    def: module.exports, accion: 'Revocación', fila: quedo, usuario,
    detalle: `Se revocó la credencial N.º ${numero}. Motivo: ${motivo}`,
  });
  bitacora.anotarCredencial({
    pastorId: quedo.pastor_id, usuario,
    texto: `Se le revocó la credencial N.º ${numero}. Motivo: ${motivo}`,
  });
  return quedo;
}

/**
 * Las credenciales VIGENTES de un pastor: las que hoy contestarían «vigente»
 * a quien escanee su QR. Un borrador no cuenta —no salió en papel— y una
 * revocada o reemplazada ya no vale.
 */
function lasVigentesDe(pastorId) {
  const { db } = require('../db');
  if (!pastorId) return [];
  return db
    .prepare("SELECT * FROM credenciales WHERE pastor_id = ? AND estado = 'Vigente' ORDER BY id")
    .all(pastorId);
}

/**
 * Las credenciales vigentes cuyo titular ya NO ejerce, para el aviso del panel.
 *
 * Existen porque revocar es un acto con fecha y con motivo, y hacerlo al
 * arrancar el servidor le estamparía a todas la fecha de hoy y un motivo que
 * nadie escribió. Las que quedaron de antes se ponen a la vista y las revoca
 * una persona, que es de quien tiene que ser la firma.
 */
function deQuienesYaNoEjercen(usuario) {
  const { db } = require('../db');
  const alcance = require('../alcance');
  const serieDe = require('../credenciales/serie');
  const ejercen = require('../pastor-que-ejerce');

  const params = [];
  const donde = alcance.condiciones(module.exports, usuario, params);
  return db
    .prepare(
      `SELECT c.*, p.estado AS estado_pastor
         FROM credenciales c JOIN pastores p ON p.id = c.pastor_id
        WHERE c.estado = 'Vigente' AND NOT ${ejercen.condicionDeQuienesEjercen('p')}
              ${donde ? 'AND ' + donde.replace(/(^|[^.\w])(iglesia_id)/g, '$1c.$2') : ''}
        ORDER BY c.fecha_emision DESC`
    )
    .all(...params)
    .map((f) => ({
      id: f.id,
      serie: serieDe.conDigito(f.serie, f.serie_dv),
      titular: `${f.snap_apellidos} ${f.snap_nombres}`.trim(),
      estadoPastor: f.estado_pastor,
    }));
}

/**
 * Las credenciales que hay que renovar: las que están por vencer y las vencidas.
 *
 * Sale de acá y no de la ruta porque la usan dos: la pantalla de credenciales y
 * el aviso del panel (punto 10.4). Escrita dos veces, un día una de las dos se
 * olvidaría de acotar por iglesia y el panel mostraría credenciales de otra.
 *
 * Vienen ordenadas por lo que vence primero, que es el orden en que hay que
 * ocuparse de ellas.
 */
function porVencer(usuario) {
  const { db } = require('../db');
  const alcance = require('../alcance');
  const serieDe = require('../credenciales/serie');

  const params = [];
  const donde = alcance.condiciones(module.exports, usuario, params);
  return db
    .prepare(`SELECT * FROM credenciales WHERE estado = 'Vigente' ${donde ? 'AND ' + donde : ''} ORDER BY fecha_vencimiento`)
    .all(...params)
    .filter((f) => situacionDe(f) === 'Por vencer' || situacionDe(f) === 'Vencida')
    .map((f) => ({
      id: f.id,
      serie: serieDe.conDigito(f.serie, f.serie_dv),
      titular: `${f.snap_apellidos} ${f.snap_nombres}`.trim(),
      vence: f.fecha_vencimiento,
      situacion: situacionDe(f),
    }));
}
