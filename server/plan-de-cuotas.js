/**
 * El plan de pagos de una deuda: una fila por cuota.
 *
 * POR QUÉ EXISTE. Una deuda de $ 500.000 «en seis cuotas» no es un dato: son
 * seis compromisos con su fecha y su monto. Medido antes de la 1.248.0, con
 * dos de seis cuotas pagadas, el sistema sabía que se habían gastado
 * $ 166.666 y nada más —ni cuánto se debía en total, ni cuántas cuotas
 * faltaban, ni cuándo vencía la próxima—. Lo único escrito era el concepto
 * que alguien había tecleado: «Sillas para el templo, cuota 2 de 6».
 *
 * CÓMO SE ARMA. Al crear la deuda se dice en cuántas cuotas y cuándo vence la
 * primera, y el plan sale solo, mensual. Los montos se reparten en partes
 * iguales y **lo que sobra de la división va a la última**: seis cuotas de
 * $ 500.000 son cinco de $ 83.333 y una de $ 83.335, que suman exactamente el
 * total. Repartir el resto en la primera dejaría la cuota más cara justo al
 * principio, que es cuando menos se puede.
 *
 * Y SE PUEDE CORREGIR CUOTA POR CUOTA, porque algunas deudas llevan interés y
 * hay créditos que se reajustan: lo que el sistema propone es un punto de
 * partida, no una imposición. Por eso el plan se arma UNA VEZ, al crearla; de
 * ahí en adelante, cambiar el número de cuotas agrega o quita al final y no
 * toca las que ya están escritas. Rearmarlo entero borraría a mano lo que
 * alguien corrigió a mano.
 *
 * LO QUE MANDA ES LO PAGADO, no lo pactado (así lo decidió la corporación).
 * Una cuota puede pagarse antes, después, de menos, de más o en dos veces: los
 * pagos son movimientos de tesorería enlazados a su cuota, y de sumarlos sale
 * cuánto se lleva pagado. La cuota no guarda un «pagada: sí»: guarda lo que se
 * pactó, y la verdad está en los movimientos.
 */

/** Cuántas cuotas se admiten. Diez años de cuotas mensuales es de sobra. */
const MAXIMO_DE_CUOTAS = 120;

/**
 * Cómo se reparte un monto en cuotas, en pesos enteros.
 *
 * Devuelve un arreglo de `cuantas` montos que suma exactamente `total`. Lo que
 * sobra de la división va a la última: la primera cuota se paga cuando la
 * deuda recién se contrajo, y es la peor para cargarle el resto.
 */
function comoSeReparte(total, cuantas) {
  const n = Math.max(1, Math.floor(Number(cuantas) || 1));
  const entero = Math.max(0, Math.round(Number(total) || 0));
  const base = Math.floor(entero / n);
  const montos = new Array(n).fill(base);
  montos[n - 1] = entero - base * (n - 1);
  return montos;
}

/** El mes siguiente a una fecha, cuidando los meses cortos. */
function elMesSiguiente(iso, cuantos) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  const mes = m - 1 + cuantos;
  const anio = a + Math.floor(mes / 12);
  const enElAnio = ((mes % 12) + 12) % 12;
  // El 31 de enero a un mes es el 28 o el 29 de febrero, no el 3 de marzo
  const ultimo = new Date(Date.UTC(anio, enElAnio + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${anio}-${String(enElAnio + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Las cuotas de una deuda, en orden. */
function lasDe(db, deudaId) {
  return db.prepare('SELECT * FROM cuotas_deuda WHERE deuda_id = ? ORDER BY numero').all(deudaId);
}

/**
 * Lo pagado de cada cuota, por su número: la suma de sus movimientos.
 *
 * Los pagos son movimientos de tesorería con la cuota escrita; sumarlos es lo
 * que hace que valga «lo que se pagó de verdad» y no «lo que se pactó».
 */
function loPagadoPorCuota(db, deudaId) {
  const filas = db
    .prepare(
      /*
       * Sin los ESPEJOS. Un préstamo entre dos cajas de la organización deja
       * su movimiento en las dos, y las dos filas llevan la misma deuda y la
       * misma cuota: sumándolas, cada pago se contaría dos veces y la deuda
       * se daría por saldada con la mitad. El original es el que se apunta a
       * sí mismo (ver server/deuda-tesoreria.js).
       */
      `SELECT cuota_id, COALESCE(SUM(monto), 0) AS pagado, COUNT(*) AS pagos, MAX(fecha) AS ultimo
         FROM tesoreria
        WHERE deuda_id = ? AND cuota_id IS NOT NULL AND (espejo_de IS NULL OR espejo_de = id)
        GROUP BY cuota_id`
    )
    .all(deudaId);
  return new Map(filas.map((f) => [f.cuota_id, f]));
}

/** Lo abonado a la deuda sin decir a qué cuota. */
function loAbonadoSinCuota(db, deudaId) {
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS pagado, COUNT(*) AS pagos
         FROM tesoreria
        WHERE deuda_id = ? AND cuota_id IS NULL AND desembolso = 0
          AND (espejo_de IS NULL OR espejo_de = id)`
    )
    .get(deudaId);
  return f || { pagado: 0, pagos: 0 };
}

/**
 * El plan de una deuda, con lo que se lleva pagado de cada cuota.
 *
 * Cada cuota sale con su estado, que NO se guarda: se deduce de lo pagado y de
 * la fecha. Guardarlo obligaría a mantenerlo al día cada vez que pasa un día,
 * y un estado que hay que recordar actualizar es un estado que un día miente.
 */
function planDe(db, deuda) {
  const cuotas = lasDe(db, deuda.id);
  const pagos = loPagadoPorCuota(db, deuda.id);
  const hoy = require('./fechas').hoy();

  let primeraPendiente = true;
  const filas = cuotas.map((c) => {
    const suyo = pagos.get(c.id) || { pagado: 0, pagos: 0, ultimo: null };
    const falta = Math.max(0, Math.round(c.monto) - Math.round(suyo.pagado));
    const saldada = falta === 0 && Math.round(suyo.pagado) > 0;
    let estado = 'Pendiente';
    if (saldada) estado = 'Pagada';
    else if (suyo.pagado > 0) estado = 'Pagada en parte';
    else if (c.vence && c.vence < hoy) estado = 'Atrasada';

    const esLaProxima = !saldada && primeraPendiente;
    if (esLaProxima) primeraPendiente = false;

    return {
      id: c.id, numero: c.numero, vence: c.vence, monto: c.monto,
      pagado: Math.round(suyo.pagado), falta, pagos: suyo.pagos, ultimo_pago: suyo.ultimo,
      estado, proxima: esLaProxima,
    };
  });

  const aCuenta = loAbonadoSinCuota(db, deuda.id);
  const pactado = filas.reduce((s, f) => s + Math.round(f.monto), 0);
  const pagado = filas.reduce((s, f) => s + f.pagado, 0) + Math.round(aCuenta.pagado);
  const total = Math.round(Number(deuda.monto) || 0);

  return {
    cuotas: filas,
    a_cuenta: { pagado: Math.round(aCuenta.pagado), pagos: aCuenta.pagos },
    resumen: {
      total, pactado, pagado,
      /*
       * ¿Las cuotas del plan suman la deuda? El plan se arma una vez y no se
       * rearma solo —para no borrar lo que alguien corrigió a mano— así que
       * puede quedar diciendo otra cosa que la ficha. Las dos cifras ya
       * estaban acá; lo que faltaba era compararlas y decirlo.
       */
      cuadra: pactado === total,
      descuadre: total - pactado,
      falta: Math.max(0, total - pagado),
      cuotas: filas.length,
      pagadas: filas.filter((f) => f.estado === 'Pagada').length,
      atrasadas: filas.filter((f) => f.estado === 'Atrasada').length,
      proxima: filas.find((f) => f.proxima) || null,
    },
  };
}

/**
 * Le arma a una deuda las cuotas que le falten, sin tocar las que ya tiene.
 *
 * Se llama al crearla y cada vez que cambia el número de cuotas. Agregar va al
 * final, con la fecha corrida un mes por cuota y el reparto de lo que todavía
 * no está repartido; quitar saca las últimas, y nunca una que tenga pagos
 * encima: eso sería borrar plata anotada.
 *
 * Devuelve qué hizo, para poder decirlo.
 */
function ponerLasQueFalten(db, deuda) {
  const cuantas = Math.max(1, Math.min(MAXIMO_DE_CUOTAS, Math.floor(Number(deuda.cuotas) || 1)));
  const ya = lasDe(db, deuda.id);
  if (ya.length === cuantas) return { agregadas: 0, quitadas: 0 };

  if (ya.length < cuantas) {
    /*
     * Los montos se recalculan sobre el TOTAL y se escriben solo en las que
     * nacen ahora: las que ya estaban se quedan como están, corregidas o no.
     * Así, pasar de tres a seis cuotas no le cambia el monto a las tres que
     * alguien ya revisó.
     */
    const montos = comoSeReparte(deuda.monto, cuantas);
    /*
     * Las fechas se cuentan SIEMPRE desde la primera, no una desde la
     * anterior. Contándolas en cadena, una deuda que vence los 31 se corre
     * sola: el 31 de enero más un mes es el 28 de febrero, y de ahí en
     * adelante todas caen 28. Desde el ancla, febrero se acorta y marzo vuelve
     * al 31, que es como se pactan las cuotas.
     */
    const ancla = (ya[0] && ya[0].vence) || deuda.primera_cuota || null;
    const crear = db.prepare(
      'INSERT INTO cuotas_deuda (deuda_id, numero, vence, monto) VALUES (?, ?, ?, ?)'
    );
    let agregadas = 0;
    for (let n = ya.length + 1; n <= cuantas; n += 1) {
      crear.run(deuda.id, n, ancla ? elMesSiguiente(ancla, n - 1) : null, montos[n - 1]);
      agregadas += 1;
    }
    return { agregadas, quitadas: 0 };
  }

  // Quitar: solo las de más, y solo las que no tienen plata encima
  const conPagos = loPagadoPorCuota(db, deuda.id);
  const borrar = db.prepare('DELETE FROM cuotas_deuda WHERE id = ?');
  let quitadas = 0;
  for (let i = ya.length - 1; i >= cuantas; i -= 1) {
    if (conPagos.has(ya[i].id)) break; // con pagos encima no se toca, ni las de más abajo
    borrar.run(ya[i].id);
    quitadas += 1;
  }
  return { agregadas: 0, quitadas };
}

/**
 * Cuánto va a sumar el plan DESPUÉS de este guardado, sin escribir nada.
 *
 * Existe para poder avisar antes, y es el espejo exacto de `ponerLasQueFalten`:
 * las dos tienen que decir lo mismo o el aviso mentiría. Hay una prueba que las
 * compara —«lo que se avisa es lo que después queda escrito»— justamente porque
 * son dos copias de la misma cuenta y las copias se separan.
 *
 * Se le pasa la deuda COMO VA A QUEDAR: con su monto y su número de cuotas
 * nuevos, y el id de la que ya está guardada.
 */
function elPactadoQueQuedara(db, deuda) {
  const cuantas = Math.max(1, Math.min(MAXIMO_DE_CUOTAS, Math.floor(Number(deuda.cuotas) || 1)));
  const ya = deuda.id ? lasDe(db, deuda.id) : [];
  const suma = (filas) => filas.reduce((s, c) => s + Math.round(Number(c.monto) || 0), 0);

  if (ya.length === cuantas) return suma(ya);

  if (ya.length < cuantas) {
    // Las que ya están se quedan como están; las que nacen ahora se reparten
    // sobre el total, igual que allá.
    const montos = comoSeReparte(deuda.monto, cuantas);
    let total = suma(ya);
    for (let n = ya.length + 1; n <= cuantas; n += 1) total += Math.round(montos[n - 1]);
    return total;
  }

  // Quitando: solo las de más, y solo mientras no tengan plata encima
  const conPagos = deuda.id ? loPagadoPorCuota(db, deuda.id) : new Map();
  const quedan = ya.slice();
  for (let i = ya.length - 1; i >= cuantas; i -= 1) {
    if (conPagos.has(ya[i].id)) break;
    quedan.pop();
  }
  return suma(quedan);
}

/**
 * Las cuotas que sobrarían de este guardado y no se pueden quitar, en orden.
 *
 * Bajar el número de cuotas saca las últimas, y nunca una que tenga pagos
 * encima: eso sería borrar plata anotada. Antes eso pasaba callado y la ficha
 * quedaba diciendo «en 2 cuotas» con un plan de seis.
 */
function lasQueNoSePuedenQuitar(db, deuda) {
  const cuantas = Math.max(1, Math.min(MAXIMO_DE_CUOTAS, Math.floor(Number(deuda.cuotas) || 1)));
  const ya = deuda.id ? lasDe(db, deuda.id) : [];
  if (ya.length <= cuantas) return [];
  const conPagos = loPagadoPorCuota(db, deuda.id);
  return ya.slice(cuantas).filter((c) => conPagos.has(c.id));
}

/** Las cuotas que tienen pagos encima, para poder decir que no se quitan. */
function lasQueTienenPagos(db, deudaId) {
  const pagos = loPagadoPorCuota(db, deudaId);
  return lasDe(db, deudaId).filter((c) => pagos.has(c.id));
}

module.exports = {
  MAXIMO_DE_CUOTAS, comoSeReparte, elMesSiguiente, lasDe, planDe,
  ponerLasQueFalten, loPagadoPorCuota, loAbonadoSinCuota, lasQueTienenPagos,
  elPactadoQueQuedara, lasQueNoSePuedenQuitar,
};
