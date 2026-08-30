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
    return 'Antes de marcarla «Entregada» hay que decir de dónde salió: de una cuenta de tesorería '
      + 'o en especie. Es lo que decide si el egreso queda anotado en el libro de la plata.';
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

  // Una cuenta cerrada no recibe movimientos nuevos, pero los suyos se corrigen
  const cambiaDeCuenta = !existing || String(existing.cuenta_id) !== String(cuentaId);
  if (cuenta.estado === 'Cerrada' && cambiaDeCuenta) {
    return `La cuenta "${cuenta.nombre}" está cerrada: no admite nuevos movimientos.`;
  }

  if (estado === 'Entregada' && !(Number(dato('valor_estimado')) > 0)) {
    return 'Para descontarla de una cuenta hace falta el monto entregado: un egreso de cero no es '
      + 'un egreso. Anótelo en «Valor estimado», o marque que la ayuda fue en especie.';
  }

  return null;
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
  DE_UNA_CUENTA, EN_ESPECIE, DE_DONDE, CATEGORIA,
};
