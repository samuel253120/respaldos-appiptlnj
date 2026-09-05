/**
 * Módulo: Cuotas mensuales de los cuerpos.
 *
 * Cada integrante de un cuerpo tiene el deber de pagar una cuota todos los
 * meses. Acá queda constancia de cada pago: de quién, de qué mes, cuánto y
 * cuándo se pagó.
 *
 * Hay dos maneras de no deber cuota, y las dos se respetan solas:
 *
 *   · el cuerpo entero no cobra (se apaga en la ficha del cuerpo);
 *   · un integrante está exento, con su motivo (se marca en su ficha).
 *
 * El pago entra como ingreso a la tesorería del propio cuerpo, y ese
 * movimiento se mantiene al día con el pago: si se corrige el monto se
 * corrige, y si se borra el pago se va con él. Se puede apagar en
 * Configuración → Organización.
 *
 * No aparece en el menú: se maneja desde la ficha del cuerpo, con la planilla
 * de quién pagó cada mes.
 */
const { OPCIONES_MES, sincronizarConLaTesoreria } = require('../cuotas');


module.exports = {
  name: 'cuotas_cuerpo',
  label: 'Cuotas de Cuerpos',
  labelSingular: 'Cuota',
  icon: '🎟️',
  group: 'Finanzas',
  order: 44,
  menu: false,
  display: '{mes}/{anio} — {persona}',
  dateField: 'fecha_pago',
  searchFields: ['persona', 'notas'],
  listFields: ['fecha_pago', 'cuerpo_id', 'persona', 'anio', 'mes', 'monto'],
  /*
   * Solo el mes: es lo único de los tres que la barra sabía dibujar, y los
   * otros dos llevaban ahí desde el principio sin aparecer nunca —`cuerpo_id`
   * es un campo oculto que resuelve el módulo, y el año es un número, y la
   * barra pinta desplegables—. Declarar un filtro que no se dibuja no da error
   * ni deja rastro: la barra sale con un selector menos. Desde la v1.371.0 el
   * registro se niega a arrancar con uno así (ver server/registry.js).
   *
   * No se pierde nada: por el cuerpo se acota desde su propia ficha, que trae
   * sus cuotas por su ruta y con su selector de año, y desde la dirección se
   * puede seguir acotando por los dos con ?f_anio= y ?f_cuerpo_id=.
   */
  filterFields: ['mes'],
  defaultSort: { field: 'fecha_pago', dir: 'desc' },

  fields: [
    {
      name: 'integrante_id', label: 'Integrante', type: 'ref', ref: 'integrantes_cuerpo', required: true,
      seccion: 'Quién paga',
    },
    {
      /*
       * Un año no es una cantidad: salía «2.026», con separador de miles, en el
       * listado, en el formulario y en el Registro de Cambios. `sinMiles` lo
       * dice de una vez y los tres sitios lo respetan; se sigue guardando y
       * revisando como número, que es lo que es.
       */
      name: 'anio', label: 'Año', type: 'number', sinMiles: true, required: true,
      seccion: 'Qué mes se paga',
    },
    { name: 'mes', label: 'Mes', type: 'select', required: true, options: OPCIONES_MES },
    { name: 'monto', label: 'Monto pagado', type: 'money', required: true, seccion: 'El pago', min: 0, reservado: 'tesoreria_montos' },
    { name: 'fecha_pago', label: 'Fecha del pago', type: 'date', required: true },
    {
      name: 'metodo', label: 'Forma de pago', type: 'select', default: 'Efectivo',
      options: ['Efectivo', 'Transferencia', 'Cheque', 'Otro'],
    },
    { name: 'notas', label: 'Notas', type: 'text' },
    /*
     * Se toman del integrante, para poder filtrar y para los permisos.
     *
     * El cuerpo va declarado como ENLACE aunque no se elija: quien registra la
     * cuota elige a la persona, y de su ficha sale el cuerpo. Estaba como
     * número suelto, y el Registro de Cambios —que arma cada línea con los
     * campos del listado— quedaba diciendo esto, medido en la v1.412.0:
     *
     *   Fecha del pago: 05-07-2026 · cuerpo_id: 1 · Quién pagó: C884812 Cuota
     *   · Año: 2.026 · Mes: 03 · Monto pagado: $ 5.000
     *
     * El módulo gemelo lo hace bien y por eso se notaba: la línea de una cuota
     * de deuda dice «Deuda: Sillas del templo», porque ahí el campo sí es un
     * enlace. Un número suelto además no tiene ni etiqueta, así que salía el
     * nombre de la columna. Siendo enlace, el libro dice el nombre del cuerpo
     * —que es lo que se está buscando cuando se rastrea un movimiento— y el
     * listado y los filtros siguen funcionando igual, porque el módulo lo
     * escribe en su gancho como siempre.
     */
    { name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', oculto: true, readonly: true },
    { name: 'miembro_id', type: 'number', oculto: true, readonly: true },
    /*
     * Quién pagó, escrito.
     *
     * El número de miembro ya no alcanza: en un grupo también paga cuota gente
     * que no está inscrita en la membresía, y esa no tiene número de miembro
     * (ver server/integrantes.js). El nombre se copia de la ficha de
     * integrante, que es la que sabe de qué registro sale la persona.
     */
    { name: 'persona', label: 'Quién pagó', type: 'text', readonly: true },
    { name: 'iglesia_id', type: 'number', oculto: true, readonly: true },
    { name: 'movimiento_id', type: 'number', oculto: true, readonly: true },
  ],

  hooks: {
    beforeSave(data, { existing, id, db, confirmado }) {
      const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
      const ficha = db.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(dato('integrante_id'));
      if (!ficha) return 'No encuentro la ficha del integrante que está pagando.';
      data.cuerpo_id = ficha.cuerpo_id;
      data.miembro_id = ficha.miembro_id || null;
      data.persona = ficha.persona || null;
      data.iglesia_id = ficha.iglesia_id;

      /*
       * Y EL MONTO SE MIRA CONTRA LA CUOTA DEL CUERPO.
       *
       * El cuerpo declara cuánto es su cuota —el sistema ya la usa para
       * proponer el monto en la planilla— y al registrar un pago a mano ese
       * número no se miraba. Medido en la v1.412.0, sobre un cuerpo cuya cuota
       * es de $ 5.000: un pago de $ 99.000.000 se registró con un 201 y quedó
       * en la caja del cuerpo, sin que nada hiciera ruido.
       *
       * Se PREGUNTA, no se rechaza: pagar varios meses juntos, o redondear
       * hacia arriba, se hace. El tope son diez veces la cuota porque un cero
       * de más es exactamente eso, diez veces; quien pague el año entero de una
       * vez va a ver la pregunta y va a poder decir que sí.
       *
       * Si el cuerpo no tiene cuota declarada no hay con qué comparar, y no se
       * inventa un tope: se deja pasar.
       */
      const CUANTAS_CUOTAS_YA_SON_MUCHAS = 10;
      if ('monto' in data) {
        const suCuerpo = db.prepare('SELECT nombre, cuota_mensual FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);
        const mensual = Number(suCuerpo && suCuerpo.cuota_mensual) || 0;
        const pagado = Number(data.monto);
        if (mensual > 0 && pagado >= mensual * CUANTAS_CUOTAS_YA_SON_MUCHAS && !confirmado) {
          const { enPesos } = require('../repetido');
          return {
            error: `Está anotando ${enPesos(pagado)} y la cuota de ${suCuerpo.nombre} es de `
              + `${enPesos(mensual)} al mes: son ${Math.round(pagado / mensual)} cuotas. `
              + 'Revise si se le fue un dígito; si de verdad pagó eso, confirme.',
            confirmar: 'el_monto_no_calza_con_la_cuota',
          };
        }
      }

      const anio = Number(dato('anio'));
      const mes = String(dato('mes') || '');
      if (!(anio > 1900 && anio < 2200)) return 'El año del pago no parece correcto';
      if (!/^(0[1-9]|1[0-2])$/.test(mes)) return 'Elija el mes que se está pagando';

      /*
       * UNA CUOTA DE $ 0 NO ES UN PAGO.
       *
       * El campo declaraba `min: 0`, así que el cero pasaba: quedaba una cuota
       * registrada, sin movimiento en la caja —`sincronizarConLaTesoreria` ya
       * exige `monto > 0` para anotar la plata— y con la MISMA marca que una
       * pagada de verdad. Medido en la v1.411.0, dos personas del mismo cuerpo
       * en la planilla de julio:
       *
       *                        casilla   pagado    en la caja
       *   la que pagó ......   ✓         $ 5.000   $ 5.000
       *   la de la cuota 0 .   ✓         $ 0       nada
       *
       * Ese ✓ es lo que se mira para saber si alguien está al día, y ahí «pagó»
       * y «no pagó nada» se veían igual: quien revisara el año iba a dar por
       * saldado un mes que no lo está.
       *
       * El aviso nombra las dos salidas de verdad, porque quien escribió un
       * cero quería una de las dos: si no tiene que pagar, se marca exenta en
       * su ficha —con su motivo, que es lo que hace entender por qué—; y si no
       * ha pagado, el mes se deja sin registrar, que es justamente lo que la
       * casilla vacía significa.
       *
       * Se mira `data.monto` y no el valor efectivo: lo que no se está tocando
       * no se revisa, que es la misma línea del motor (ver `revisarLimites` en
       * server/crud.js). Así una cuota vieja anotada en cero se puede seguir
       * corrigiendo por partes, y lo único que no se acepta es volver a
       * escribir el cero. Los negativos no llegan hasta acá: el `min: 0` del
       * campo los para antes, con su propio aviso.
       */
      if ('monto' in data && !(Number(data.monto) > 0)) {
        return 'Una cuota de $ 0 no es un pago: la casilla quedaría marcada como pagada '
          + 'y no habría plata detrás. Si esta persona no tiene que pagar, márquela como '
          + 'exenta en su ficha de integrante; si todavía no paga, deje el mes sin registrar.';
      }

      /*
       * Y el mes que se paga no puede estar a años de distancia. La regla vive
       * en server/cuotas.js —escrita una sola vez— y las dos puertas la piden:
       * es la misma lección de `aQuienNoSeLeCobra`, del hallazgo CU-01.
       */
      const muyAdelante = require('../cuotas').avisoSiElMesEstaMuyAdelante(anio, mes);
      if (muyAdelante) return muyAdelante;

      const repetida = db
        .prepare('SELECT id FROM cuotas_cuerpo WHERE integrante_id = ? AND anio = ? AND mes = ? AND id != ?')
        .get(ficha.id, anio, mes, id || 0);
      if (repetida) return 'Esa persona ya tiene registrado el pago de ese mes en este cuerpo.';

      // Una cuota que no tiene dónde quedar anotada no se registra: la cuota ES
      // la plata (ver `avisoSiLaCuentaEstaCerrada` en server/cuotas.js). Solo
      // para las nuevas: una ya anotada se sigue corrigiendo.
      if (!id) {
        /*
         * Y A QUIEN NO LE TOCA PAGAR, NO SE LE COBRA POR NINGUNA DE LAS DOS
         * PUERTAS.
         *
         * Son las tres reglas que el módulo anuncia en su primera línea —el
         * cuerpo que no cobra, el integrante exento, y ahora también quien ya
         * se fue— y hasta la v1.409.0 solo las aplicaba la planilla. La regla
         * vive en server/cuotas.js, escrita una sola vez, y las dos puertas la
         * piden: así no puede volver a pasar que una sepa lo que la otra no.
         *
         * Solo al COBRAR una cuota nueva, como las dos de abajo: una ya
         * anotada se sigue corrigiendo, porque cuando se cobró correspondía y
         * lo que hay que poder arreglar es el monto o la fecha, no la
         * situación de la persona hoy.
         */
        const noLeToca = require('../cuotas').aQuienNoSeLeCobra(db, ficha);
        if (noLeToca) return noLeToca;

        const sinDonde = require('../cuotas').avisoSiLaCuentaEstaCerrada(ficha.cuerpo_id, db);
        if (sinDonde) return sinDonde;

        /*
         * Ni de un cuerpo que dejó de funcionar (ver
         * server/cuerpo-inactivo.js). La regla general del motor no llega
         * hasta acá: `cuerpo_id` no se elige, se copia de la ficha del
         * integrante, y por eso es una columna y no una referencia. Es la
         * segunda de las dos puertas por las que entra una cuota —la otra es
         * la planilla, en server/cuotas.js— y las dos piden la misma regla.
         */
        const cerrado = require('../cuerpo-inactivo')
          .avisoSiEstaInactivo(db, ficha.cuerpo_id, 'cobrar cuotas nuevas');
        if (cerrado) return cerrado;

        /*
         * Y NO SE PUDO PAGAR ANTES DE ENTRAR AL CUERPO.
         *
         * La fecha del pago no se comparaba con nada de la persona que paga:
         * medido en la v1.412.0, un pago fechado el 05-01-2020 entró con un 201
         * a nombre de alguien que ingresó al cuerpo el 10-01-2026, seis años
         * después. El libro quedaba diciendo algo que no pudo pasar.
         *
         * Solo al cobrar una cuota nueva, como las de arriba: la fecha de
         * ingreso se corrige, y si al corregirla alguna cuota vieja quedara
         * «antes», lo que hay que poder hacer es justamente arreglarla.
         */
        const pagado = dato('fecha_pago');
        if (pagado && ficha.fecha_ingreso && pagado < ficha.fecha_ingreso) {
          const { comoSeLee } = require('../fechas');
          return `${ficha.persona || 'Esta persona'} entró al cuerpo el `
            + `${comoSeLee(ficha.fecha_ingreso)}, así que no pudo pagar una cuota el `
            + `${comoSeLee(pagado)}. Revise la fecha del pago, o la de ingreso en su `
            + 'ficha de integrante si es esa la que está mal.';
        }
      }

      if (!dato('fecha_pago')) data.fecha_pago = require('../fechas').hoy();
      return null;
    },

    afterSave(fila, { db }) {
      sincronizarConLaTesoreria(fila, db);
    },

    beforeDelete(fila, { db }) {
      // El ingreso de una cuota que se borra no puede quedar en tesorería
      if (fila.movimiento_id) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(fila.movimiento_id);
      return null;
    },
  },
};
