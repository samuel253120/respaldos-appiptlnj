/**
 * La ayuda que se entregó, anotada en Tesorería.
 *
 * Una ayuda social es la única cosa del sistema que saca plata y mercadería
 * para dársela a una persona, y era la única salida de recursos que no dejaba
 * rastro en el libro de la plata. Medido antes de esto: tres ayudas marcadas
 * «Entregada» por $123.000, tres mil y tantos movimientos en Tesorería, y
 * ninguno que viniera de una ayuda. No es que faltara una cifra: eran dos
 * verdades sobre la misma plata en dos pantallas del mismo sistema.
 *
 * El sistema ya sabía hacer esto en otras dos partes —la ofrenda de un
 * servicio (server/ofrenda-tesoreria.js) y la cuota de un integrante
 * (server/cuotas.js)—, y este puente es el mismo mecanismo por tercera vez.
 *
 * PERO NO TODA AYUDA ES PLATA, y esa es la diferencia con las otras dos. Una
 * caja de mercadería donada no salió de ninguna cuenta, y forzar un egreso por
 * cada ayuda descuadraría la caja al revés: la iglesia aparecería gastando un
 * dinero que nunca tuvo. Por eso el puente puede decir que no, y lo dice
 * alguien: al marcar una ayuda como entregada hay que indicar DE DÓNDE SALIÓ.
 *
 *   · «De una cuenta de tesorería» → se anota el egreso en esa cuenta;
 *   · «En especie» → no se anota nada, y queda escrito que fue en especie.
 *
 * Lo que ya no puede pasar es que la decisión no exista. Las ayudas anteriores
 * a esto no la traen y no se les inventa: quedan como estaban hasta que
 * alguien vuelva a guardar la suya, igual que se hizo con el método de la
 * ofrenda.
 *
 * CÓMO SE PAGÓ lo dice la ayuda, y no va escrito fijo. La ofrenda anotaba
 * «Efectivo» en todos sus movimientos y con parte de la plata llegando al
 * banco el libro no cuadraba con la cartola; se arregló allá y no tiene por
 * qué repetirse acá.
 *
 * El movimiento es de la ayuda: se crea, se corrige y se retira con ella, y no
 * se edita por separado en Tesorería.
 */

/** De dónde salió lo que se entregó. Las dos únicas respuestas. */
const DE_UNA_CUENTA = 'De una cuenta de tesorería';
const EN_ESPECIE = 'En especie (no salió de una cuenta)';
const DE_DONDE = [DE_UNA_CUENTA, EN_ESPECIE];

const NOTA = 'Movimiento generado por Ayudas Sociales.';

/**
 * La categoría con que se anota. Es una de las que vienen de fábrica en
 * Categorías de Tesorería, y de tipo egreso: ver server/migraciones.js.
 */
const CATEGORIA = 'Ayuda social';

/**
 * El egreso que le corresponde a esta ayuda, o null si no le corresponde
 * ninguno.
 *
 * Le corresponde uno cuando se entregó de verdad, salió de una cuenta que
 * existe y tiene un monto. Los tres tienen que darse: una ayuda aprobada
 * todavía no sacó nada de ninguna parte, y un egreso de cero no es un egreso.
 */
function egresoDeLaAyuda(fila, db) {
  if (fila.estado !== 'Entregada') return null;
  if (fila.salida !== DE_UNA_CUENTA) return null;

  const monto = Number(fila.valor_estimado) || 0;
  if (monto <= 0) return null;

  const cuenta = fila.cuenta_id
    ? db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(fila.cuenta_id)
    : null;
  if (!cuenta) return null;

  const quien = String(fila.beneficiario || '').trim();
  const tipo = String(fila.tipo_ayuda || '').trim();
  const concepto = `Ayuda social${tipo ? `: ${tipo}` : ''}${quien ? ` — ${quien}` : ''}`;

  return {
    cuenta,
    monto,
    concepto,
    metodo: fila.metodo || 'Efectivo',
    /*
     * No es un traslado entre cuentas: esta plata sale de la organización y no
     * vuelve por otra puerta, que es justo lo que distingue un aporte al fondo
     * de un gasto de verdad (ver server/entre-cuentas.js).
     */
    entreCuentas: 0,
  };
}

/**
 * Lo que hay que haber decidido antes de guardar, o el reparo que corresponda.
 *
 * Vive acá y no en el módulo porque es la otra mitad de la misma regla: allá
 * están los campos, acá lo que significan. Devuelve un texto para mostrar, o
 * null si no hay nada que decir.
 *
 * La cuenta se revisa SIEMPRE que se haya elegido una, esté la ayuda entregada
 * o no: una cuenta que no se alcanza o que es de otra iglesia está mal puesta
 * desde el momento en que se elige, y esperar a la entrega para decirlo es
 * hacérselo descubrir a alguien el día que ya entregó.
 */
function revisarDeDondeSalio(data, { user, existing, db }) {
  const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
  const estado = dato('estado');
  const salida = dato('salida');

  if (estado === 'Entregada' && !salida) {
    /*
     * Se exige EN EL MOMENTO EN QUE SALE, y solo ahí.
     *
     * Las ayudas entregadas antes de que esta pregunta existiera no la traen, y
     * exigírsela al primer guardado dejaba una ficha vieja imposible de tocar:
     * quien entra a arreglarle una coma se topaba con un reparo que a lo mejor
     * no sabe contestar —la entrega fue hace dos años— y no podía guardar nada.
     * Se descubrió al escribir la prueba de la pregunta al entregar.
     *
     * Así que de las viejas no se exige: quedan como estaban, el informe las
     * cuenta aparte y lo dice en pantalla, y el día que alguien complete el
     * dato, se completa.
     */
    if (!existing || existing.estado !== 'Entregada') {
      return 'Antes de marcarla «Entregada» hay que decir de dónde salió: de una cuenta de tesorería '
        + 'o en especie. Es lo que decide si el egreso queda anotado en el libro de la plata.';
    }
    return null;
  }

  /*
   * Corregida a «en especie», se suelta la cuenta y el método: si no, la ayuda
   * quedaría diciendo que salió de una cuenta de la que no salió, igual que
   * pasaba con el enlace del beneficiario que no correspondía.
   */
  if (salida && salida !== DE_UNA_CUENTA) {
    data.cuenta_id = null;
    data.metodo = null;
    return null;
  }
  if (!salida) return null;

  const cuentaId = dato('cuenta_id');
  if (!cuentaId) return 'Indique de qué cuenta de tesorería salió lo que se entregó.';

  const cuenta = db.prepare('SELECT * FROM cuentas_tesoreria WHERE id = ?').get(cuentaId);
  if (!cuenta) return 'La cuenta de tesorería indicada no existe.';

  // El mismo alcance que pide Tesorería para mover dinero de una cuenta
  if (!require('./alcance').alcanzaIglesia(user, cuenta.iglesia_id)) {
    return `La cuenta "${cuenta.nombre}" no está entre las iglesias que administra.`;
  }

  /*
   * La cuenta tiene que ser de la iglesia de la ayuda, o de la corporación
   * —que no pertenece a ninguna—. Sin esto, una iglesia podía descontarle una
   * entrega a la cuenta de otra congregación y el descuadre aparecía en un
   * libro que nadie iba a revisar por esa ayuda.
   */
  const iglesiaDeLaAyuda = dato('iglesia_id');
  if (cuenta.iglesia_id && String(cuenta.iglesia_id) !== String(iglesiaDeLaAyuda)) {
    return `La cuenta "${cuenta.nombre}" es de otra iglesia: elija una de la iglesia de esta ayuda `
      + 'o una de la corporación.';
  }

  // Una cuenta cerrada no recibe movimientos nuevos, pero los suyos se
  // corrigen (la regla, entera, en server/cuenta-cerrada.js)
  const cambiaDeCuenta = !existing || String(existing.cuenta_id) !== String(cuentaId);
  if (cambiaDeCuenta) {
    const cerrada = require('./cuenta-cerrada').avisoSiEstaCerrada(cuenta);
    if (cerrada) return `${cerrada}.`;
  }

  if (estado === 'Entregada' && !(Number(dato('valor_estimado')) > 0)) {
    return 'Para descontarla de una cuenta hace falta el monto entregado: un egreso de cero no es '
      + 'un egreso. Anótelo en «Valor estimado», o marque que la ayuda fue en especie.';
  }

  return null;
}

/**
 * Lo que le falta a una ayuda que se marca como entregada.
 *
 * Tres datos, y ninguno es un capricho:
 *
 *   · EL MONTO, porque sin él el informe la cuenta como cero. No dice «falta
 *     el dato»: dice «$ 0», y quien lo lee entiende que se entregó algo que no
 *     valía nada. Medido antes de esto: una ayuda guardada con lo mínimo salía
 *     en el informe como «Otro · entregas 1 · valor estimado $ 0».
 *   · EL RESPALDO, que es la boleta, la foto de la entrega o el papel firmado.
 *     Cuando llega una revisión, el respaldo que no está en el sistema hay que
 *     buscarlo en una carpeta, entrega por entrega.
 *   · QUIÉN LA APROBÓ, porque entregar plata o mercadería de la iglesia es una
 *     decisión de alguien, y sin nombre no es de nadie.
 *
 * SE PREGUNTA, NO SE BLOQUEA. Es exactamente lo que ya hace Tesorería con la
 * boleta de un egreso grande: hay entregas que se documentan después, y el
 * sistema no está para discutírselo a quien está en el mostrador con la
 * persona enfrente. Lo que no puede es dejarlo pasar en silencio.
 *
 * SE PREGUNTA UNA VEZ, cuando la ayuda pasa a «Entregada», que es cuando la
 * cosa salió. Volver a preguntarlo cada vez que se le arregla una coma a una
 * ficha vieja es ruido, y el ruido enseña a confirmar sin leer, que es lo
 * contrario de lo que esto busca. La excepción es borrar un dato que ya
 * estaba: eso no es una coma, es perderlo.
 */
function loQueLeFaltaAlEntregar({ data, existing, confirmado }) {
  if (confirmado) return null;
  if (!require('./ajustes').activo('ayuda_pregunta_al_entregar')) return null;

  const dato = (n) => (data[n] !== undefined ? data[n] : existing ? existing[n] : null);
  if (dato('estado') !== 'Entregada') return null;

  const vacio = (v) => v === null || v === undefined || String(v).trim() === '';
  const faltan = [
    !(Number(dato('valor_estimado')) > 0) ? 'cuánto valía' : null,
    vacio(dato('soporte')) ? 'el respaldo de la entrega' : null,
    vacio(dato('aprobada_por')) ? 'quién la aprobó' : null,
  ].filter(Boolean);
  if (!faltan.length) return null;

  /*
   * ¿Es este el momento en que sale? Lo es si recién pasa a entregada, y
   * también si se está borrando uno de los tres datos que sí estaba: abrir una
   * ficha y guardar no puede dejar en blanco algo que alguien anotó.
   */
  const reciénSale = !existing || existing.estado !== 'Entregada';
  const seEstáBorrando = ['valor_estimado', 'soporte', 'aprobada_por'].some(
    (n) => existing && !vacio(existing[n]) && data[n] !== undefined && vacio(data[n])
  );
  if (!reciénSale && !seEstáBorrando) return null;

  const lista = faltan.length === 1
    ? faltan[0]
    : `${faltan.slice(0, -1).join(', ')} ni ${faltan[faltan.length - 1]}`;

  return {
    error:
      `Esta ayuda queda como entregada y no dice ${lista}. `
      + (faltan.includes('cuánto valía')
        ? 'Sin el monto, el informe la suma como $ 0, que se lee como que no valía nada. '
        : '')
      + 'Se puede completar después abriendo la ayuda. Si va así, confirme.',
    confirmar: 'ayuda_entregada_sin_datos',
  };
}

/**
 * El aviso de una entrega que se deshace, o null si no hay nada que decir.
 *
 * Cambiar «Entregada» por «Solicitada» no es corregir un tipeo: es decir que
 * la mercadería no salió después de haber dicho que sí. Medido antes de esto,
 * el cambio pasaba con un 200 y sin una palabra —quedaba anotado en el
 * Registro de Cambios, que ya es más de lo que hacen otros módulos, pero nadie
 * se enteraba en el momento—.
 *
 * Y desde la 1.204.0 arrastra algo más: si la ayuda había salido de una cuenta
 * de tesorería, deshacerla RETIRA ese egreso del libro. Eso es lo correcto
 * —no se gastó lo que no se entregó— y es justamente lo que hay que decir
 * antes, con el monto, porque quien deshace la entrega por un descuido está
 * moviendo el saldo de una cuenta sin saberlo.
 *
 * Se pregunta, no se bloquea: marcar «Entregada» por error y tener que
 * deshacerlo es exactamente para lo que sirve poder corregir una ficha. Es el
 * mismo mecanismo con que se avisa al mover el saldo inicial de una cuenta.
 */
function avisoSiSeDeshaceLaEntrega({ data, existing, db, confirmado }) {
  if (confirmado || !existing) return null;
  if (existing.estado !== 'Entregada') return null;

  const ahora = data.estado;
  if (ahora === undefined || ahora === null || ahora === existing.estado) return null;

  const egreso = existing.movimiento_id
    ? db.prepare('SELECT monto FROM tesoreria WHERE id = ?').get(existing.movimiento_id)
    : null;

  const enPesos = (n) => require('./formato').enPlata(n);

  return {
    error:
      `Esta ayuda está marcada como entregada y pasaría a «${ahora}». Deshacer una entrega no es `
      + 'corregir un tipeo: es decir que lo que ya se había dado por entregado no salió, y así queda '
      + 'anotado. '
      + (egreso
        ? `Además se retira de Tesorería el egreso de ${enPesos(egreso.monto)} que dejó, así que el `
          + 'saldo de esa cuenta cambia. '
        : '')
      + 'Si de verdad no se entregó, confirme.',
    confirmar: 'entrega_que_se_deshace',
  };
}

/**
 * Deja la tesorería calzando con lo que dice la ayuda: crea el egreso que
 * falte, corrige el que cambió y retira el que ya no corresponde.
 *
 * Retirar es tan importante como crear: una ayuda que vuelve de «Entregada» a
 * «Solicitada», o que se corrige a «en especie», dejaba si no un egreso
 * anotado por algo que no salió.
 */
function sincronizarEgresoDeAyuda(fila, db) {
  const registrar = require('./ajustes').activo('ayuda_registra_tesoreria');
  const lado = registrar ? egresoDeLaAyuda(fila, db) : null;

  const guardado = fila.movimiento_id
    ? db.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila.movimiento_id)
    : null;

  if (!lado) {
    if (guardado) {
      db.prepare('DELETE FROM tesoreria WHERE id = ?').run(guardado.id);
      db.prepare('UPDATE ayudas_sociales SET movimiento_id = NULL WHERE id = ?').run(fila.id);
    }
    return;
  }

  if (guardado) {
    db.prepare(
      `UPDATE tesoreria
          SET fecha = ?, tipo = 'Egreso', categoria = ?, concepto = ?, monto = ?, metodo = ?,
              entre_cuentas = ?, cuenta_id = ?, iglesia_id = ?, cuerpo_id = ?,
              updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(fila.fecha, CATEGORIA, lado.concepto, lado.monto, lado.metodo, lado.entreCuentas,
          lado.cuenta.id, lado.cuenta.iglesia_id || null, lado.cuenta.cuerpo_id || null, guardado.id);
    return;
  }

  const info = db
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, entre_cuentas,
                              cuenta_id, iglesia_id, cuerpo_id, notas, ayuda_id)
       VALUES (?, 'Egreso', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(fila.fecha, CATEGORIA, lado.concepto, lado.monto, lado.metodo, lado.entreCuentas,
         lado.cuenta.id, lado.cuenta.iglesia_id || null, lado.cuenta.cuerpo_id || null, NOTA, fila.id);
  db.prepare('UPDATE ayudas_sociales SET movimiento_id = ? WHERE id = ?').run(info.lastInsertRowid, fila.id);
}

/** El egreso de una ayuda que se elimina no puede quedar en el libro. */
function retirarEgresoDeAyuda(id, db) {
  db.prepare('DELETE FROM tesoreria WHERE ayuda_id = ?').run(id);
}

module.exports = {
  sincronizarEgresoDeAyuda, retirarEgresoDeAyuda, egresoDeLaAyuda, revisarDeDondeSalio,
  loQueLeFaltaAlEntregar, avisoSiSeDeshaceLaEntrega,
  DE_UNA_CUENTA, EN_ESPECIE, DE_DONDE, CATEGORIA,
};
