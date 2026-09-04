/**
 * Módulo: Deudas y Compromisos.
 *
 * Lo que la organización DEBE y lo que le deben, que hasta la 1.247.0 no vivía
 * en ninguna parte. Tesorería lleva el movimiento de la plata —lo que ya
 * ocurrió— y eso está bien; lo que faltaba era el otro lugar, donde vive lo
 * que está comprometido.
 *
 * QUÉ SE MIDIÓ ANTES DE ESCRIBIR ESTO. Siguiendo dos casos reales de la
 * corporación sobre el sistema andando:
 *
 *   un hermano presta $ 400.000 y se le devuelve
 *     → el balance de la reunión decía «entraron $ 1.400.000, salieron
 *       $ 1.400.000» donde la iglesia reunió y gastó un millón: 40 % inflado,
 *       porque un préstamo entra como ingreso corriente;
 *     → la caja de un cuerpo con un préstamo de $ 150.000 decía tener
 *       $ 150.000 propios, teniendo cero y debiendo todo.
 *
 *   sillas por $ 500.000 en seis cuotas
 *     → anotar la compra entera dejaba la caja en $ -366.666, y con razón:
 *       esa plata no salió de ahí;
 *     → anotar solo las cuotas dejaba la caja perfecta y el compromiso
 *       invisible: pagadas dos de seis, el sistema sabía que se gastaron
 *       $ 166.666 y nada más —ni cuánto se debía, ni cuántas cuotas faltaban,
 *       ni con quién era la deuda—.
 *
 * LAS DOS DIRECCIONES. Se anota lo que se debe y lo que se prestó, como el
 * inventario anota lo prestado a la iglesia y lo que la iglesia prestó. Lo
 * dice `direccion`, y se lee siempre RESPECTO DE LA CAJA de la ficha.
 *
 * DE QUIÉN ES LA DEUDA LO DICE LA CAJA, como en todo lo demás de Finanzas: la
 * corporación, una iglesia local o un cuerpo. No hay un campo suelto que
 * pueda contradecirla, que es el mismo motivo por el que un movimiento toma su
 * iglesia y su cuerpo de la cuenta y no de quien lo escribe.
 *
 * CERRAR UNA DEUDA ES OTRA COSA QUE ANOTARLA, y por eso lleva su propia llave
 * (`deudas_cerrar` en server/permissions.js). Anotar que se debe es trabajo de
 * todos los días; declarar que ya no se debe es cerrar el asunto.
 *
 * LO QUE ESTA VERSIÓN TODAVÍA NO TRAE, y viene enseguida: el plan de cuotas
 * —una fila por cuota, y marcarla pagada deja su movimiento—, que los informes
 * cuenten aparte la plata prestada, el aviso del panel y la hoja impresa.
 */

/** Hacia dónde va la deuda, leída desde la caja de esta ficha. */
const POR_PAGAR = 'Por pagar';
const POR_COBRAR = 'Por cobrar';
const DIRECCIONES = [POR_PAGAR, POR_COBRAR];

/**
 * De qué clase es. Una compra a crédito solo existe hacia el lado de pagar:
 * la organización no le vende a nadie a plazo.
 */
const CLASES_POR_PAGAR = ['Préstamo en dinero', 'Compra a crédito', 'Crédito de una institución'];
const CLASES_POR_COBRAR = ['Préstamo en dinero'];
const CLASES = [...new Set([...CLASES_POR_PAGAR, ...CLASES_POR_COBRAR])];

/**
 * Con quién es la deuda.
 *
 * LA TERCERA ES OTRA CAJA DEL PROPIO SISTEMA, y es la que faltaba. La
 * corporación le adelanta plata a una iglesia, una iglesia le presta a un
 * cuerpo para comprar sillas, un cuerpo le presta a otro: la corporación
 * contestó que sí, que las cajas se prestan entre sí, y no había manera de
 * anotarlo. Lo que se hacía era escribir el nombre de la otra caja en el campo
 * de «institución», y entonces pasaba lo que se midió antes de esto:
 *
 *   la caja que RECIBE, antes ......... $  50.000
 *   la caja que PRESTA, antes ......... $ 100.000
 *   se anota el préstamo de $ 400.000
 *   la caja que RECIBE, después ....... $ 450.000
 *   la caja que PRESTA, después ....... $ 100.000  ← no se movió
 *
 * La que prestó seguía mostrando una plata que ya no tenía, y el total de la
 * organización subió $ 400.000 que nadie había recibido de nadie. Un préstamo
 * entre dos partes de la misma organización no hace entrar plata: la cambia de
 * bolsillo, y el sistema tiene desde hace tiempo el mecanismo para eso (ver
 * server/entre-cuentas.js). Por eso una deuda con otra caja mueve las DOS.
 */
const UNA_PERSONA = 'Una persona';
const UNA_INSTITUCION = 'Una institución';
const OTRA_CAJA = 'Otra caja de la organización';
const CONTRAPARTES = [UNA_PERSONA, UNA_INSTITUCION, OTRA_CAJA];

/** En qué estado está. Cerrarla es lo que pide la llave. */
const VIGENTE = 'Vigente';
const PAGADA = 'Pagada';
const CONDONADA = 'Condonada';
const CERRADAS = [PAGADA, CONDONADA];
const ESTADOS = [VIGENTE, ...CERRADAS];

/** Un monto como se lee acá. */
const enPesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;

/**
 * Con quién es esta deuda, en una línea.
 *
 * La caja se busca por su nombre y no se guarda copiado: una caja que se
 * renombra tiene que renombrarse en todas partes, que es la razón por la que
 * una referencia es una referencia y no un texto.
 */
function conQuien(fila, db) {
  if (!fila) return '';
  if (fila.contraparte_tipo === UNA_INSTITUCION) return String(fila.institucion || '').trim();
  if (fila.contraparte_tipo === OTRA_CAJA) {
    if (!db || !fila.contraparte_cuenta_id) return '';
    const caja = db.prepare('SELECT nombre FROM cuentas_tesoreria WHERE id = ?').get(fila.contraparte_cuenta_id);
    return caja ? caja.nombre : '';
  }
  return String(fila.contraparte || '').trim();
}

/**
 * Lo que falta por decir de la otra parte, o null.
 *
 * Se exige la que corresponde al tipo elegido y se suelta la otra: quien
 * anota primero a un hermano y después lo corrige a una casa comercial dejaría
 * el nombre viejo ahí, apuntando a alguien que no prestó nada. Es la misma
 * regla que usa una ayuda social con su beneficiario.
 */
function laOtraParte(data, { existing, db, user, cuentaId }) {
  const valor = (campo) => (data[campo] !== undefined ? data[campo] : existing ? existing[campo] : null);
  const tipo = valor('contraparte_tipo');
  if (!tipo) return 'Indique con quién es esta deuda: una persona, una institución u otra caja';

  if (tipo === UNA_PERSONA) {
    if (!String(valor('contraparte') || '').trim()) {
      return 'Indique con qué persona es esta deuda';
    }
    data.institucion = null;
    data.contraparte_cuenta_id = null;
    return null;
  }

  if (tipo === UNA_INSTITUCION) {
    if (!String(valor('institucion') || '').trim()) {
      return 'Indique con qué institución es esta deuda: el banco, la casa comercial, la empresa';
    }
    data.contraparte = null;
    data.contraparte_id = null;
    data.contraparte_cuenta_id = null;
    return null;
  }

  /*
   * La otra caja. Se comprueba lo mismo que a la caja propia —que exista, que
   * esté dentro de lo que esta persona administra y que no esté cerrada— y una
   * cosa más: que no sea la misma. Una caja no se presta a sí misma, y dejarlo
   * pasar dejaría dos movimientos que se anulan sobre el mismo saldo con una
   * deuda anotada encima.
   */
  const otra = valor('contraparte_cuenta_id');
  if (!otra) return 'Indique con qué caja de la organización es esta deuda';
  if (String(otra) === String(cuentaId)) {
    return 'Una caja no se presta a sí misma: elija la otra caja, la que pone o recibe la plata.';
  }
  /*
   * Que la caja EXISTA no se comprueba acá: el motor rechaza toda referencia
   * rota antes de llegar al gancho, y con mejor mensaje —«La otra caja: no
   * existe cuenta de tesorería n.º 99999999»—. Había una línea que lo
   * comprobaba otra vez; se quitó al ver que romperla no hacía fallar ninguna
   * prueba, que es como se descubre que una defensa no está defendiendo nada.
   */
  const caja = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(otra);
  if (!require('../alcance').alcanzaIglesia(user, caja.iglesia_id)) {
    return `La caja "${caja.nombre}" no está entre las iglesias que administra`;
  }
  const cambia = !existing || String(existing.contraparte_cuenta_id || '') !== String(otra);
  if (cambia) {
    const cerrada = require('../cuenta-cerrada').avisoSiEstaCerrada(caja);
    if (cerrada) return cerrada;
  }
  data.contraparte = null;
  data.contraparte_id = null;
  data.institucion = null;
  return null;
}

/**
 * Lo que impide bajar el número de cuotas, o null.
 *
 * Bajar el plan saca las últimas, y nunca una que tenga plata encima: eso sería
 * borrar un pago anotado. Esa defensa ya existía y funcionaba —el plan
 * simplemente se detenía— pero pasaba callada, y la ficha quedaba diciendo un
 * número que no era cierto.
 *
 * MEDIDO en la v1.355.0: deuda de $ 600.000 en seis cuotas, se paga por
 * adelantado la sexta y se baja el plan a dos. Contestó 200 sin una palabra; la
 * ficha quedó diciendo «en 2 cuotas» y el plan siguió con seis.
 *
 * Ahora se dice, nombrando la cuota que lo impide y qué hacer.
 */
function loQueImpideBajarLasCuotas(data, { existing, db }) {
  if (!existing || data.cuotas === undefined) return null;
  const plan = require('../plan-de-cuotas');
  const trabadas = plan.lasQueNoSePuedenQuitar(db, { id: existing.id, cuotas: data.cuotas });
  if (!trabadas.length) return null;

  const cual = trabadas[0];
  const cuantas = plan.lasDe(db, existing.id).length;
  return (
    `No se puede bajar el plan a ${Number(data.cuotas)} cuota(s): la cuota ${cual.numero} ya tiene `
    + 'pagos anotados, que son movimientos de tesorería. Retire primero ese pago desde el plan, '
    + `o deje el plan en ${cuantas}: bajarlo ahora dejaría la ficha diciendo un número de cuotas `
    + 'que el plan no tiene.'
  );
}

/**
 * El aviso de que las cuotas dejarían de sumar la deuda, o null.
 *
 * El plan se arma UNA VEZ y de ahí en adelante solo se agrega o se quita al
 * final, sin tocar lo que alguien corrigió a mano. La razón está escrita en
 * server/plan-de-cuotas.js y es buena: hay deudas con interés y créditos que se
 * reajustan, y rearmarlo entero borraría a mano lo que alguien corrigió a mano.
 * Lo que faltaba no era rearmarlo: era DECIRLO.
 *
 * MEDIDO en la v1.355.0: se le corrige el monto a una deuda de $ 300.000 en
 * tres cuotas y queda en $ 900.000. Contestó 200; la ficha decía deber
 * $ 900.000 y el plan seguía con tres cuotas de $ 100.000. Ningún aviso.
 *
 * El resumen del plan ya devolvía `total` y `pactado` como dos cifras
 * distintas: el sistema ya sabía que no cuadraban. Nada las comparaba.
 */
function elAvisoDeQueElPlanNoCuadra(data, { existing, db }) {
  if (!existing) return null;
  const como = (campo) => (data[campo] !== undefined ? data[campo] : existing[campo]);

  const plan = require('../plan-de-cuotas');
  const cuotas = plan.lasDe(db, existing.id);
  if (!cuotas.length) return null;

  const total = Math.round(Number(como('monto')) || 0);
  const antes = Math.round(Number(existing.monto) || 0);
  const pactadoAhora = cuotas.reduce((s, c) => s + Math.round(Number(c.monto) || 0), 0);

  const quedara = plan.elPactadoQueQuedara(db, { id: existing.id, monto: total, cuotas: como('cuotas') });
  if (quedara === total) return null;

  /*
   * Si el plan YA venía sin cuadrar y este guardado no toca el monto ni las
   * cuotas, no se vuelve a preguntar: alguien ya contestó eso, y repetirlo cada
   * vez que se le arregla una coma enseña a confirmar sin leer.
   */
  const yaVeniaSinCuadrar = pactadoAhora !== antes;
  const tocaElPlan = total !== antes || Number(como('cuotas')) !== Number(existing.cuotas);
  if (yaVeniaSinCuadrar && !tocaElPlan) return null;

  const dice = quedara > total ? 'más' : 'menos';
  return {
    error: `Las cuotas del plan no suman lo que dice la deuda.`,
    confirmar:
      `Las cuotas del plan suman ${enPesos(quedara)} y la deuda quedaría en ${enPesos(total)}: `
      + `${enPesos(Math.abs(total - quedara))} de ${dice} en el plan. `
      + 'El plan no se rearma solo, a propósito: hay deudas con interés y créditos que se '
      + 'reajustan, y rearmarlo borraría lo que usted haya corregido cuota por cuota. '
      + 'Guarde igual y ajuste las cuotas desde el plan, o deje el monto como estaba. '
      + '¿Guardo el monto nuevo?',
  };
}

/**
 * El aviso de dar vuelta una deuda que ya tiene pagos anotados, o null.
 *
 * Cambiar la dirección le da vuelta el signo a TODA la plata de esta deuda: lo
 * que estaba anotado como que salió pasa a decir que entró, y al revés. Sobre
 * una deuda recién creada eso es corregir un error de tecleo y no merece
 * pregunta; sobre una que ya tiene pagos, es reescribir lo que dice el libro de
 * varios movimientos, y eso se pregunta antes.
 *
 * No se rechaza: dar vuelta una deuda mal anotada es exactamente lo que hay que
 * poder hacer. Lo que no puede es pasar callado.
 */
function elAvisoDeDarLaVuelta(data, { existing, db }) {
  if (!existing || data.direccion === undefined) return null;
  if (String(data.direccion) === String(existing.direccion)) return null;

  const pagos = require('../deuda-tesoreria').losPagosDe(db, existing.id);
  if (!pagos.length) return null;

  const suma = pagos.reduce((s, m) => s + Math.round(Number(m.monto) || 0), 0);
  const cuantos = `${pagos.length.toLocaleString('es-CL')} pago(s) por ${enPesos(suma)}`;
  const antes = existing.direccion === POR_PAGAR ? 'salían de' : 'entraban a';
  const ahora = existing.direccion === POR_PAGAR ? 'entrar a' : 'salir de';
  return {
    error: `Esta deuda tiene ${cuantos} anotados.`,
    confirmar:
      `Esta deuda tiene ${cuantos} anotados. Al cambiarla de «${existing.direccion}» a `
      + `«${data.direccion}» esos movimientos se dan vuelta: hasta ahora ${antes} la caja y pasan `
      + `a ${ahora} ella. De cada pago no se toca nada más: la fecha, el monto, el método y a qué `
      + 'cuota se imputó quedan igual. ¿Le doy vuelta la dirección?',
  };
}

/**
 * El aviso de que esta deuda dejaría una caja en rojo, o null.
 *
 * EL MÓDULO YA CERRABA ESTA PUERTA, PERO SOLO LA CHICA (v1.356.0). La ruta que
 * anota un pago pregunta antes de dejar la caja en negativo, y lo dejó escrito:
 * «si no, pagar desde el plan sería la manera de saltarse lo que el formulario
 * frena». La puerta que quedaba abierta era la del propio formulario, y mueve
 * MÁS plata: el DESEMBOLSO —la entrega del préstamo— lo escribe el guardado de
 * la ficha, derecho en Tesorería, sin pasar por esa comprobación.
 *
 * MEDIDO en la v1.355.0, misma caja, mismo día:
 *   un pago de $ 99.000.000 desde el plan ......... 400 · pregunta antes
 *   un préstamo entregado de $ 5.900.000 .......... 201 · sin preguntar nada
 * La caja tenía $ 900.000 y quedó en $ -5.000.000.
 *
 * SE MIRA LA CAJA QUE PIERDE LA PLATA, que no siempre es la de la ficha:
 *
 *   «Por cobrar» ................ sale de la caja de la deuda
 *   «Por pagar» con otra caja ... sale de la OTRA, que es la que presta
 *
 * Una compra a crédito no mueve un peso al contraerse, así que no se pregunta
 * nada. Y al corregir una deuda ya guardada se descuenta su propio movimiento,
 * porque si no la comprobación lo contaría dos veces.
 */
function elAvisoDeLaCajaEnRojo(data, { existing, db, cuentaId }) {
  const como = (campo, porDefecto) => (data[campo] !== undefined
    ? data[campo] : existing ? existing[campo] : porDefecto);

  const comoQuedaria = {
    id: existing ? existing.id : null,
    direccion: como('direccion', POR_PAGAR),
    clase: como('clase', null),
    contraparte_tipo: como('contraparte_tipo', null),
    contraparte_cuenta_id: como('contraparte_cuenta_id', null),
    cuenta_id: cuentaId,
    monto: como('monto', 0),
    fecha: como('fecha', null),
  };

  const puente = require('../deuda-tesoreria');
  if (!puente.tieneDesembolso(comoQuedaria)) return null;

  const { desembolso: signo } = puente.losSignosDe(comoQuedaria);
  const interna = puente.esInterna(comoQuedaria);

  // De qué caja sale la plata, y con qué nombre llamarla en el aviso
  let deQueCaja = null;
  let queEs = null;
  if (signo === 'Egreso') {
    deQueCaja = comoQuedaria.cuenta_id;
    queEs = 'Este préstamo entregado';
  } else if (interna) {
    deQueCaja = comoQuedaria.contraparte_cuenta_id;
    queEs = 'Este préstamo, que sale de la otra caja,';
  }
  if (!deQueCaja) return null;

  /*
   * Al corregir, su propio movimiento no cuenta: ya está en el saldo de esa
   * caja, y sumarlo otra vez haría preguntar por una plata que no se está
   * moviendo de nuevo.
   */
  let excluirMovimiento = null;
  if (existing) {
    const ya = puente.elDesembolsoDe(db, existing.id);
    if (ya) {
      const espejo = puente.elEspejoDe(db, ya.id);
      excluirMovimiento = String(ya.cuenta_id) === String(deQueCaja)
        ? ya.id
        : (espejo && String(espejo.cuenta_id) === String(deQueCaja) ? espejo.id : null);
    }
  }

  return require('../saldos').avisoSiQuedaEnRojo(deQueCaja, {
    tipo: 'Egreso',
    monto: Math.round(Number(comoQuedaria.monto) || 0),
    fecha: comoQuedaria.fecha,
    excluirMovimiento,
    queEs,
  });
}

/**
 * Lo que impide cerrar una deuda, o null.
 *
 * Cerrar es declarar que ya no se debe, y eso no es lo mismo que anotar que se
 * debe: lleva su propia llave. Se comprueba sobre el estado que queda después
 * de este guardado y solo cuando ESTE guardado la cierra —si ya estaba cerrada
 * y alguien le corrige una coma, no se le pide nada—.
 */
function loQueImpideCerrarla(data, { existing, user }) {
  if (!estaCerrandola(data, existing)) return null;
  if (require('../permissions').can(user, 'deudas_cerrar', 'view')) return null;
  return (
    'No tiene la llave para dar por cerrada una deuda. Puede anotarla y corregirla; declarar que ya '
    + 'no se debe la cierra, y eso se concede aparte en «Permisos».'
  );
}

/** ¿ESTE guardado es el que la cierra? Corregirle una coma a una ya cerrada, no. */
function estaCerrandola(data, existing) {
  const ahora = data.estado !== undefined ? data.estado : existing ? existing.estado : VIGENTE;
  if (!CERRADAS.includes(ahora)) return false;
  if (existing && CERRADAS.includes(existing.estado)) return false;
  return true;
}

/**
 * El aviso de darla por PAGADA cuando todavía falta plata, o null.
 *
 * Cerrar una deuda es lo único de este módulo que pide una llave propia, y su
 * cabecera explica bien por qué: «anotar que se debe es trabajo de todos los
 * días; declarar que ya no se debe es cerrar el asunto». Se comprobaba QUIÉN lo
 * hace. No se comprobaba lo único que el sistema sabe con certeza: cuánto
 * falta.
 *
 * MEDIDO en la v1.355.0, deuda de $ 300.000 en 3 cuotas y sin un peso pagado:
 * se marcó «Pagada» y contestó 200 sin una palabra; el plan de esa misma deuda
 * seguía diciendo «falta $ 300.000, 0 de 3 cuotas pagadas»; y la fila del
 * listado mostraba «Pagada» y «Falta pagar $ 300.000» una al lado de la otra.
 *
 * SOLO SE PREGUNTA POR «PAGADA», y a propósito. «Condonada» es la palabra que
 * este módulo ya ofrece para una deuda que se perdona sin pagarse: ahí que
 * quede plata sin pagar no es una contradicción, es lo que la palabra
 * significa. La contradicción es decir que se pagó lo que no se pagó.
 *
 * No se rechaza: una deuda se puede haber pagado por fuera del sistema y eso
 * hay que poder anotarlo. Lo que no puede es pasar callado, y el aviso nombra
 * los dos caminos correctos antes de ofrecer el atajo.
 */
function elAvisoDeCerrarlaDebiendo(data, { existing, db }) {
  if (!existing || !estaCerrandola(data, existing)) return null;
  const estado = data.estado !== undefined ? data.estado : existing.estado;
  if (estado !== PAGADA) return null;

  const comoQuedaria = {
    ...existing,
    monto: data.monto !== undefined ? data.monto : existing.monto,
  };
  const { resumen } = require('../plan-de-cuotas').planDe(db, comoQuedaria);
  if (resumen.falta <= 0) return null;

  const deCuanto = `${enPesos(resumen.falta)} de ${enPesos(resumen.total)}`;
  return {
    error: `Esta deuda todavía tiene ${enPesos(resumen.falta)} sin pagar.`,
    confirmar:
      `Según sus pagos anotados, de esta deuda falta ${deCuanto}. Darla por «Pagada» va a dejar la `
      + 'ficha diciendo que se pagó entera y el libro de la plata diciendo que no. '
      + 'Si el pago se hizo, anótelo en el plan de cuotas y la deuda se cierra sola con la cuenta '
      + 'cuadrada; si se perdonó, ciérrela como «Condonada», que es la palabra para eso. '
      + '¿La doy por pagada igual?',
  };
}

module.exports = {
  name: 'deudas',
  label: 'Deudas y Compromisos',
  labelSingular: 'Deuda',
  icon: '🤝',
  group: 'Finanzas',
  order: 46,
  printable: true,
  display: '{concepto}',
  dateField: 'fecha',
  searchFields: ['concepto', 'contraparte', 'institucion', 'notas'],
  /*
   * Una deuda se recuerda por su monto, igual que un gasto. Va en
   * `buscaTambien` por lo mismo que en Tesorería: el motor pegaría el decimal
   * del número, y quien no ve los montos tampoco los busca a tientas.
   */
  buscaTambien: [{ sql: 'CAST(monto AS INTEGER)', reservado: 'tesoreria_montos' }],
  listFields: ['fecha', 'direccion', 'clase', 'concepto', 'quien', 'monto', 'falta', 'proxima', 'estado'],
  filterFields: ['direccion', 'clase', 'estado', 'cuenta_id'],
  defaultSort: { field: 'fecha', dir: 'desc' },

  computed: [
    {
      /*
       * Con quién es, en una sola columna. Son dos campos en la base —una
       * persona enlazada o una institución escrita— y en el listado tienen que
       * verse como una sola cosa: quien mira una lista de deudas pregunta «¿a
       * quién?», no «¿de qué tipo es la contraparte?».
       */
      name: 'quien', label: 'Con quién', type: 'texto',
      // Sin desarmar el segundo argumento: `conQuien` se llama también desde
      // fuera del motor —una prueba, la hoja impresa— y ahí no viene ninguno.
      calc: (fila, opciones) => conQuien(fila, opciones && opciones.db),
    },
    {
      /*
       * Lo que falta pagar, que es la pregunta que trae a alguien a esta
       * pantalla. Sale de restarle a la deuda lo que suman sus movimientos, y
       * no de una cifra guardada: una cifra guardada hay que acordarse de
       * corregirla cada vez que entra un peso, y un día no se corrige.
       */
      name: 'falta', label: 'Falta pagar', type: 'money', reservado: 'tesoreria_montos',
      /*
       * Una deuda CERRADA no debe nada: eso es lo que quiere decir cerrarla, y
       * es lo mismo que ya hacía la columna de al lado, que no muestra próxima
       * cuota. Antes seguía calculando, y la fila mostraba «Pagada» y «Falta
       * pagar $ 300.000» una al lado de la otra. Lo que se dejó de pagar sigue
       * a la vista donde corresponde: dentro del plan, en lo pagado contra el
       * total.
       */
      calc: (fila, { db }) => (CERRADAS.includes(fila.estado)
        ? 0
        : require('../plan-de-cuotas').planDe(db, fila).resumen.falta),
    },
    {
      name: 'proxima', label: 'Próxima cuota', type: 'badge',
      calc: (fila, { db }) => {
        if (CERRADAS.includes(fila.estado)) return null;
        const { resumen } = require('../plan-de-cuotas').planDe(db, fila);
        if (!resumen.proxima) return null;
        const atrasadas = resumen.atrasadas;
        const cual = `${resumen.proxima.numero} de ${resumen.cuotas}`;
        return atrasadas
          ? { texto: `${cual} · atrasada`, nivel: 'vencida' }
          : { texto: `${cual} · ${require('../fechas').comoSeLee(resumen.proxima.vence || '')}`, nivel: '' };
      },
    },
  ],

  fields: [
    {
      name: 'direccion', label: 'Dirección', type: 'select', required: true, default: POR_PAGAR,
      options: DIRECCIONES, seccion: 'Qué deuda es',
      help: 'Se lee respecto de la caja de más abajo: «Por pagar» es lo que esa caja debe, y «Por '
        + 'cobrar» lo que le deben a ella.',
    },
    {
      /*
       * Sin `options` a mano: la lista sale de la ruta, que la acota según la
       * dirección. Declarar las dos cosas dejaría escrita una lista que no
       * manda —lo pilló la prueba que existe justamente para eso— y el día que
       * las dos dijeran cosas distintas nadie sabría cuál vale.
       */
      name: 'clase', label: 'Clase', type: 'select', required: true, default: CLASES[0],
      optionsRoute: '/deudas/clases?direccion={direccion}',
      help: 'Un préstamo en dinero entra a la caja; una compra a crédito no —llega la cosa y queda '
        + 'el compromiso—. Una compra a crédito solo existe hacia el lado de pagar.',
    },
    {
      name: 'concepto', label: 'Concepto', type: 'text', required: true,
      help: 'Para qué es, dicho como se dice: «Sillas para el templo», «Préstamo para la reparación del techo».',
    },
    {
      name: 'monto', label: 'Monto total', type: 'money', required: true, min: 1,
      reservado: 'tesoreria_montos', seccion: 'Cuánto y cuándo',
      help: 'Lo que se debe en total, no la cuota.',
    },
    { name: 'fecha', label: 'Fecha en que se contrajo', type: 'date', required: true },
    {
      name: 'fecha_vencimiento', label: 'Fecha comprometida de pago', type: 'date',
      // Futura por definición, y no puede caer antes de contraerse la deuda:
      // las dos reglas las aplica el motor (ver server/fechas.js)
      futuro: true, noAntesDe: 'fecha',
      help: 'Cuándo se comprometió pagarla. Si no hay plazo —«cuando se pueda»—, se deja en blanco.',
    },
    {
      name: 'cuotas', label: 'En cuántas cuotas', type: 'number', required: true, default: 1,
      min: 1, max: 120, seccion: 'El plan de pagos',
      help: 'Una sola cuota es pagarla de una vez. El sistema arma el plan mensual y lo que sobra de '
        + 'la división va a la última, para que las cuotas sumen exactamente el total.',
    },
    {
      name: 'primera_cuota', label: 'Vence la primera', type: 'date',
      // Una cuota se pacta hacia adelante: sin esto el motor la rechazaría por
      // «todavía no llega», que es la regla correcta para el libro de la plata
      // y la equivocada para un compromiso
      futuro: true,
      help: 'Desde ahí se cuentan las demás, mes a mes. Cada cuota se puede corregir después.',
    },
    {
      name: 'cuenta_id', label: 'Caja de esta deuda', type: 'ref', ref: 'cuentas_tesoreria', required: true,
      optionsRoute: '/cuentas_tesoreria/activas', seccion: 'De quién es',
      placeholder: 'Escriba el nombre de la cuenta…',
      help: 'De quién es la deuda: la caja de la corporación, la de una iglesia o la de un cuerpo. '
        + 'Es la misma caja por la que pasa o pasará su plata.',
    },
    {
      name: 'contraparte_tipo', label: 'Con quién es', type: 'select', required: true, default: UNA_PERSONA,
      options: CONTRAPARTES, seccion: 'Con quién',
    },
    {
      name: 'contraparte', label: 'Persona', type: 'persona', ref: 'miembros', buscador: true,
      showIf: { field: 'contraparte_tipo', equals: UNA_PERSONA },
      help: 'Si está en la membresía se enlaza a su ficha; si no, se escribe el nombre.',
    },
    {
      /*
       * La otra caja de la organización. Es una referencia y no un nombre
       * escrito: de ella sale el movimiento del otro lado, así que tiene que
       * apuntar a una caja de verdad y seguirla si la renombran.
       */
      name: 'contraparte_cuenta_id', label: 'La otra caja', type: 'ref', ref: 'cuentas_tesoreria',
      showIf: { field: 'contraparte_tipo', equals: OTRA_CAJA },
      help: 'La caja que pone la plata, o la que la recibe. El movimiento se anota en las dos: '
        + 'un préstamo entre dos partes de la organización no hace entrar plata, la cambia de bolsillo.',
    },
    {
      name: 'institucion', label: 'Institución', type: 'text',
      showIf: { field: 'contraparte_tipo', equals: UNA_INSTITUCION },
      help: 'El banco, la casa comercial, la empresa.',
    },
    {
      name: 'contacto', label: 'Teléfono o correo', type: 'text',
      help: 'Para poder ubicar a quien corresponde cuando haya que pagar o cobrar.',
    },
    {
      name: 'documento', label: 'Documento firmado', type: 'file', seccion: 'Respaldo',
      help: 'El pagaré, el contrato o la hoja que se firmó, escaneada o fotografiada.',
    },
    {
      name: 'inventario_id', label: 'Artículo del inventario', type: 'ref', ref: 'inventarios',
      help: 'Opcional: lo que se compró, si está inventariado. Anotar la deuda no depende de haberlo '
        + 'inventariado primero.',
    },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: VIGENTE,
      options: ESTADOS, seccion: 'Cómo está',
      help: 'Darla por Pagada o Condonada la cierra, y eso pide su propia llave.',
    },
    {
      name: 'fecha_cierre', label: 'Fecha en que se cerró', type: 'date',
      noAntesDe: 'fecha',
      showIf: { field: 'estado', in: CERRADAS },
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
    // De la caja, como en Tesorería: son los que deciden el alcance y no se
    // escriben a mano, para que no puedan contradecir a la cuenta
    {
      name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', readonly: true,
      help: 'Se toma de la caja elegida. Las cajas de la corporación no pertenecen a una iglesia.',
    },
    {
      name: 'cuerpo_id', label: 'Cuerpo / Grupo', type: 'ref', ref: 'cuerpos', readonly: true,
      help: 'Se toma de la caja elegida, igual que la iglesia.',
    },
  ],

  hooks: {
    beforeSave(data, { user, existing, db, confirmado }) {
      // La caja manda: de ella salen la iglesia y el cuerpo de esta deuda
      const cuentaId = data.cuenta_id !== undefined ? data.cuenta_id : existing ? existing.cuenta_id : null;
      if (!cuentaId) return 'Indique la caja de esta deuda';
      const cuenta = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
      if (!cuenta) return 'La caja indicada no existe';

      if (!require('../alcance').alcanzaIglesia(user, cuenta.iglesia_id)) {
        return `La caja "${cuenta.nombre}" no está entre las iglesias que administra`;
      }

      /*
       * Una caja cerrada no recibe deudas nuevas, por lo mismo que no recibe
       * movimientos: contraer una deuda a nombre de una caja que la
       * organización ya dio por terminada es anotar algo que después nadie va a
       * poder pagar desde ahí. Las suyas se siguen corrigiendo.
       */
      const cambiaDeCaja = !existing || String(existing.cuenta_id) !== String(cuentaId);
      if (cambiaDeCaja) {
        const cerrada = require('../cuenta-cerrada').avisoSiEstaCerrada(cuenta);
        if (cerrada) return cerrada;
      }

      data.iglesia_id = cuenta.iglesia_id || null;
      data.cuerpo_id = cuenta.cuerpo_id || null;

      const direccion = data.direccion !== undefined
        ? data.direccion : existing ? existing.direccion : POR_PAGAR;
      const clase = data.clase !== undefined ? data.clase : existing ? existing.clase : null;
      if (direccion === POR_COBRAR && !CLASES_POR_COBRAR.includes(clase)) {
        return `Una deuda «${POR_COBRAR}» solo puede ser un préstamo en dinero: la organización no `
          + 'vende a plazo. Cambie la clase o la dirección.';
      }

      const falta = laOtraParte(data, { existing, db, user, cuentaId });
      if (falta) return falta;

      const noPuedeCerrar = loQueImpideCerrarla(data, { existing, user });
      if (noPuedeCerrar) return noPuedeCerrar;

      const noPuedeBajar = loQueImpideBajarLasCuotas(data, { existing, db });
      if (noPuedeBajar) return noPuedeBajar;

      /*
       * ¿Y esta deuda deja alguna caja en rojo? Se pregunta, no se bloquea: una
       * caja puede quedar en rojo de verdad. Va al final porque es la única de
       * las comprobaciones que se puede contestar «igual así»: las de más
       * arriba son reparos, y un reparo no se confirma.
       */
      if (!confirmado) {
        /*
         * De las dos que se pueden contestar «igual así», primero la que
         * reescribe plata ya anotada: la confirmación es una sola para todo el
         * guardado, así que la pregunta que se muestra tiene que ser la que más
         * importa. Un saldo en rojo se ve en la cartola; una deuda dada vuelta
         * cambia lo que dicen movimientos que ya estaban.
         */
        const alReves = elAvisoDeDarLaVuelta(data, { existing, db });
        if (alReves) return alReves;

        const debiendo = elAvisoDeCerrarlaDebiendo(data, { existing, db });
        if (debiendo) return debiendo;

        const noCuadra = elAvisoDeQueElPlanNoCuadra(data, { existing, db });
        if (noCuadra) return noCuadra;

        const enRojo = elAvisoDeLaCajaEnRojo(data, { existing, db, cuentaId });
        if (enRojo) return enRojo;
      }

      /*
       * Al cerrarla se le pone la fecha del día si nadie la escribió: una deuda
       * cerrada sin fecha no dice cuándo se saldó, que es justo lo que se le
       * pregunta después. Y al reabrirla se suelta, para que no quede diciendo
       * que se cerró un día en que sigue viva.
       */
      const estado = data.estado !== undefined ? data.estado : existing ? existing.estado : VIGENTE;
      if (CERRADAS.includes(estado)) {
        if (!data.fecha_cierre && !(existing && existing.fecha_cierre)) {
          data.fecha_cierre = require('../fechas').hoy();
        }
      } else if (existing && CERRADAS.includes(existing.estado)) {
        data.fecha_cierre = null;
      }

      return null;
    },

    /**
     * Ya guardada: su plan de cuotas y el movimiento que le corresponde.
     *
     * El plan se arma UNA VEZ y de ahí en adelante solo se agrega o se quita al
     * final, sin tocar lo que alguien corrigió a mano (ver
     * server/plan-de-cuotas.js). El desembolso se crea, se corrige o se retira
     * con la ficha, como el egreso de una ayuda social.
     */
    afterSave(fila, { user, db }) {
      require('../plan-de-cuotas').ponerLasQueFalten(db, fila);
      const puente = require('../deuda-tesoreria');
      puente.ponerElDesembolso(db, fila, user);
      /*
       * Y los pagos con él. Antes se ponía al día el desembolso y nada más, y
       * los pagos —que también son movimientos de esta deuda— se quedaban con
       * el signo, la caja y el espejo de antes. Ver `ponerLosPagosAlDia`.
       */
      puente.ponerLosPagosAlDia(db, fila);
    },

    /**
     * Una deuda con pagos anotados no se borra.
     *
     * Sus pagos son movimientos de tesorería de verdad —plata que salió de una
     * caja— y borrarlos con la ficha sería hacer desaparecer del libro un
     * dinero que se movió. El desembolso sí se va con ella: existe solo porque
     * la deuda existe, igual que el egreso de una ayuda social.
     */
    beforeDelete(fila, { db }) {
      const pagos = require('../deuda-tesoreria').losPagosDe(db, fila.id);
      if (pagos.length) {
        return `Esta deuda tiene ${pagos.length} pago(s) anotado(s), que son movimientos de `
          + 'tesorería. Retire primero esos pagos desde su plan de cuotas: borrarla ahora haría '
          + 'desaparecer del libro una plata que sí se movió.';
      }
      /*
       * Y con él SU ESPEJO, si la deuda era con otra caja de la organización.
       * Lo pilló el sondeo en vivo: borrando la deuda se iba el desembolso y el
       * movimiento del otro lado se quedaba, dejando a la caja que había
       * prestado en $ -300.000 por una deuda que ya no existía. Un movimiento
       * de un par no se borra solo: o se van los dos o no se va ninguno.
       */
      const deudas = require('../deuda-tesoreria');
      const desembolso = deudas.elDesembolsoDe(db, fila.id);
      if (desembolso) {
        const espejo = deudas.elEspejoDe(db, desembolso.id);
        if (espejo) db.prepare('DELETE FROM tesoreria WHERE id = ?').run(espejo.id);
        db.prepare('DELETE FROM tesoreria WHERE id = ?').run(desembolso.id);
      }
      db.prepare('DELETE FROM cuotas_deuda WHERE deuda_id = ?').run(fila.id);
      return null;
    },
  },

  extraRoutes(router, { db, requirePerm }) {
    /** Una línea en el Registro de Cambios a nombre de esta deuda. */
    const anotarEnElRegistro = (deuda, usuario, accion, detalle) =>
      require('../bitacora').anotarCambio({ def: module.exports, accion, fila: deuda, usuario, detalle });

    /**
     * Las clases que se pueden elegir según la dirección. Una compra a crédito
     * no existe hacia el lado de cobrar, y ofrecerla sería ofrecer un error.
     */
    router.get('/deudas/clases', requirePerm('deudas', 'view'), (req, res) => {
      const cuales = req.query.direccion === POR_COBRAR ? CLASES_POR_COBRAR : CLASES_POR_PAGAR;
      res.json(cuales.map((c) => ({ id: c, label: c })));
    });

    /** La deuda pedida, comprobando que sea de las que esta persona alcanza. */
    const laSuya = (req, res) =>
      require('../alcance').registroSuyo(req, res, 'deudas', req.params.id, 'Esa deuda');

    /**
     * El plan de cuotas de una deuda: una fila por cuota con lo que se pactó,
     * lo que se lleva pagado y en qué está. Es lo que pinta la planilla.
     */
    router.get('/deudas/:id(\\d+)/plan', requirePerm('deudas', 'view'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;
      const plan = require('../plan-de-cuotas').planDe(db, deuda);
      const puente = require('../deuda-tesoreria');
      return res.json(require('../sensibles').sinLasCifras(req.user, 'tesoreria_montos', {
        ...plan,
        pagos: puente.losPagosDe(db, deuda.id).map((m) => ({
          id: m.id, fecha: m.fecha, monto: m.monto, metodo: m.metodo,
          cuota_id: m.cuota_id, concepto: m.concepto,
        })),
        desembolso: puente.elDesembolsoDe(db, deuda.id),
        puede_pagar: require('../permissions').can(req.user, 'deudas', 'edit'),
      }, ['cuotas', 'resumen', 'a_cuenta', 'pagos', 'desembolso', 'monto', 'montos', 'pagado',
          'falta', 'total', 'pactado', 'proxima']));
    });

    /**
     * Anotar un pago. Deja su movimiento en la caja de la deuda, enlazado, y
     * de sumarlos sale cuánto falta.
     *
     * Pide el permiso de EDITAR la deuda y no el de cerrarla: pagar una cuota
     * es llevar la deuda al día, no darla por saldada. La llave de cerrar se
     * pide cuando alguien declara que ya no se debe.
     */
    router.post('/deudas/:id(\\d+)/pagos', requirePerm('deudas', 'edit'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;

      const monto = Math.round(Number(req.body.monto) || 0);
      if (monto <= 0) return res.status(400).json({ error: 'Indique cuánto se pagó' });
      // Un pago es un hecho, así que la fecha se revisa como la de cualquier
      // movimiento: sin `futuro`, porque no se paga mañana, se paga y se anota
      const fecha = String(req.body.fecha || require('../fechas').hoy()).slice(0, 10);
      const problema = require('../fechas').revisar({ label: 'Fecha del pago' }, fecha);
      if (problema) return res.status(400).json({ error: problema });

      const cuotaId = req.body.cuota_id ? Number(req.body.cuota_id) : null;
      if (cuotaId && !db.prepare('SELECT id FROM cuotas_deuda WHERE id = ? AND deuda_id = ?').get(cuotaId, deuda.id)) {
        return res.status(400).json({ error: 'Esa cuota no es de esta deuda' });
      }

      const cerrada = require('../cuenta-cerrada')
        .avisoSiEstaCerrada(db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(deuda.cuenta_id));
      if (cerrada) return res.status(400).json({ error: `${cerrada}, así que este pago no quedaría anotado en ninguna parte.` });

      /*
       * Y la misma pregunta que hace cualquier egreso que deja la caja en rojo.
       * Esta ruta escribe el movimiento derecho, sin pasar por el guardado de
       * Tesorería, así que la regla hay que pedirla acá: si no, pagar desde el
       * plan sería la manera de saltarse lo que el formulario frena. Es la
       * misma puerta de atrás que se cerró en el botón «Crear su ficha de
       * miembro» de Pastores.
       */
      const confirmado = req.body.igual_asi === true || req.body.igual_asi === 'true' || req.body.igual_asi === 1;
      if (!confirmado) {
        const enRojo = require('../saldos').avisoSiQuedaEnRojo(deuda.cuenta_id, {
          tipo: require('../deuda-tesoreria').losSignosDe(deuda).pago,
          monto, fecha, queEs: 'Este pago',
        });
        if (enRojo) return res.status(400).json(enRojo);
      }

      const movimiento = require('../deuda-tesoreria').anotarUnPago(db, deuda, {
        cuotaId, fecha, monto, metodo: req.body.metodo, notas: req.body.notas,
      }, req.user);

      /*
       * Y queda anotado. Esta ruta escribe el movimiento derecho, sin pasar por
       * el guardado de Tesorería, así que la línea del Registro de Cambios hay
       * que dejarla acá: si no, la plata se movería sin que nadie pueda
       * preguntar después quién la movió. Es lo mismo que pasaba con el módulo
       * entero antes de la v1.360.0.
       */
      anotarEnElRegistro(deuda, req.user, 'Cambio',
        `Anotó un pago de ${enPesos(monto)} del ${fecha}`
        + (cuotaId ? ` a la cuota ${db.prepare('SELECT numero FROM cuotas_deuda WHERE id = ?').get(cuotaId).numero}` : ' a cuenta'));

      return res.status(201).json({ ok: true, movimiento_id: movimiento.id });
    });

    /** Retirar un pago mal anotado: se va él y se va su movimiento. */
    router.delete('/deudas/:id(\\d+)/pagos/:mov(\\d+)', requirePerm('deudas', 'edit'), (req, res) => {
      const deuda = laSuya(req, res);
      if (!deuda) return undefined;
      const quitado = require('../deuda-tesoreria').retirarUnPago(db, deuda.id, Number(req.params.mov));
      if (!quitado) return res.status(404).json({ error: 'Ese pago no es de esta deuda' });

      // Retirar un pago hace reaparecer plata en una caja: de las dos, ésta es
      // la que más falta hace poder consultar después.
      anotarEnElRegistro(deuda, req.user, 'Cambio',
        `Retiró un pago de ${enPesos(quitado.monto)} del ${String(quitado.fecha).slice(0, 10)}`);

      return res.json({ ok: true });
    });
  },

  // Lo que hace falta afuera: las reglas y los rótulos, en un solo lugar
  POR_PAGAR, POR_COBRAR, DIRECCIONES, CLASES, CLASES_POR_PAGAR, CLASES_POR_COBRAR,
  UNA_PERSONA, UNA_INSTITUCION, OTRA_CAJA, VIGENTE, PAGADA, CONDONADA, CERRADAS, ESTADOS,
  conQuien, enPesos,
};
