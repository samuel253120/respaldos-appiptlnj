/**
 * La cuota mensual de los integrantes de un cuerpo.
 *
 * Acá vive lo que hay que saber de una cuota: cómo se nombra el mes que se
 * está pagando y qué deja el pago en la tesorería del cuerpo. Lo usan el
 * módulo "cuotas_cuerpo" —cuando se registra una cuota a mano— y el botón de
 * la planilla en la ficha del cuerpo, para que los dos hagan exactamente lo
 * mismo.
 */
// El nombre de la categoría lo declara un solo archivo, que es además el que
// impide que alguien la borre o la renombre (ver categorias-del-sistema.js).
const { CATEGORIA } = require('./categorias-del-sistema');

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** El mes como se guarda ("01".."12") y como se lee. */
const OPCIONES_MES = MESES.map((nombre, i) => ({ value: String(i + 1).padStart(2, '0'), label: nombre }));

const nombreDelMes = (mes) => (OPCIONES_MES.find((m) => m.value === String(mes)) || {}).label || String(mes);

/** La cuenta donde va la plata de las cuotas de un cuerpo, si la tiene. */
function cuentaDeLasCuotas(cuerpoId, conexion) {
  return conexion
    .prepare("SELECT * FROM cuentas_tesoreria WHERE cuerpo_id = ? AND tipo = 'Cuotas de integrantes'")
    .get(cuerpoId);
}

/**
 * El aviso de que la cuota no tiene dónde entrar, o null.
 *
 * A diferencia de la ofrenda de un servicio —donde el hecho que se registra es
 * el culto, y la plata es una consecuencia—, una cuota ES la plata: registrarla
 * sabiendo que no va a quedar anotada en ninguna cuenta no le sirve a nadie.
 * Por eso acá se frena y se dice qué hacer, en vez de preguntar.
 *
 * Que el registro esté APAGADO en Configuración es otra cosa y no frena nada:
 * eso es una decisión que alguien tomó; una cuenta cerrada es un accidente.
 */
function avisoSiLaCuentaEstaCerrada(cuerpoId, conexion) {
  if (!require('./ajustes').activo('cuota_registra_tesoreria')) return null;
  const cuenta = cuentaDeLasCuotas(cuerpoId, conexion);
  const cerrada = require('./cuenta-cerrada').avisoSiEstaCerrada(cuenta);
  return cerrada
    ? `${cerrada}, así que esta cuota no quedaría anotada en ninguna parte. Reábrala para poder registrar cuotas.`
    : null;
}

/**
 * Deja el ingreso que corresponde a este pago en la cuenta de cuotas del
 * cuerpo —que es aparte de su tesorería general, porque es plata que se
 * maneja por separado—: lo crea, lo corrige o lo retira, según lo que diga la
 * cuota. Se puede apagar en Configuración → Organización.
 */
function sincronizarConLaTesoreria(fila, conexion) {
  const registrar = require('./ajustes').activo('cuota_registra_tesoreria');
  // Las cuotas van a su propia cuenta: es plata que el cuerpo maneja aparte
  const cuenta = cuentaDeLasCuotas(fila.cuerpo_id, conexion);
  const guardado = fila.movimiento_id
    ? conexion.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila.movimiento_id)
    : null;

  /*
   * Y si la cuenta de cuotas está CERRADA, tampoco. Faltaba: medido, una cuenta
   * de cuotas cerrada con $ 1.000 quedó con $ 4.000 después de registrar una
   * cuota de julio, sin que nada dijera una palabra. Su propio movimiento, si
   * ya lo tiene, se sigue corrigiendo: lo que está anotado es historia (la
   * regla, entera, en server/cuenta-cerrada.js).
   */
  const cerrada = !require('./cuenta-cerrada').admitePlataNueva(cuenta);
  if (!registrar || !cuenta || !(Number(fila.monto) > 0) || (cerrada && !guardado)) {
    if (guardado) {
      conexion.prepare('DELETE FROM tesoreria WHERE id = ?').run(guardado.id);
      conexion.prepare('UPDATE cuotas_cuerpo SET movimiento_id = NULL WHERE id = ?').run(fila.id);
    }
    return;
  }

  /*
   * El nombre lo trae la propia cuota. Buscarlo por el número de miembro
   * dejaba el movimiento diciendo «un integrante» cuando quien paga es alguien
   * de un grupo que no está inscrito en la membresía: no tiene ese número.
   */
  const miembro = fila.miembro_id
    ? conexion.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(fila.miembro_id)
    : null;
  const quien = fila.persona
    || (miembro ? `${miembro.nombres} ${miembro.apellidos}` : 'un integrante');
  const concepto = `Cuota de ${nombreDelMes(fila.mes).toLowerCase()} de ${fila.anio} — ${quien}`;

  if (guardado) {
    conexion.prepare(
      `UPDATE tesoreria
          SET fecha = ?, tipo = 'Ingreso', categoria = ?, concepto = ?, monto = ?,
              cuenta_id = ?, iglesia_id = ?, cuerpo_id = ?, updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(fila.fecha_pago, CATEGORIA.APORTES, concepto, fila.monto, cuenta.id, fila.iglesia_id, fila.cuerpo_id, guardado.id);
    return;
  }
  const info = conexion
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                              iglesia_id, cuerpo_id, notas)
       VALUES (?, 'Ingreso', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fila.fecha_pago, CATEGORIA.APORTES, concepto, fila.monto, fila.metodo || 'Efectivo', cuenta.id,
      fila.iglesia_id, fila.cuerpo_id, 'Movimiento generado por las cuotas del cuerpo.'
    );
  conexion.prepare('UPDATE cuotas_cuerpo SET movimiento_id = ? WHERE id = ?').run(info.lastInsertRowid, fila.id);
}

/**
 * ¿A ESTA PERSONA LE CORRESPONDE PAGAR CUOTA? Devuelve el aviso, o null.
 *
 * Son tres reglas, y el módulo las anuncia en su primera línea: «Hay dos
 * maneras de no deber cuota, y las dos se respetan solas: el cuerpo entero no
 * cobra; un integrante está exento, con su motivo». La tercera es que quien se
 * fue del cuerpo ya no debe nada.
 *
 * VIVEN ACÁ, EN UN SOLO SITIO, porque una cuota entra por DOS puertas —la
 * planilla del cuerpo y la ficha suelta— y hasta la v1.409.0 solo la planilla
 * las aplicaba. Medido en la v1.408.0, la misma cuota de julio por las dos:
 *
 *                                   por su ficha    por la planilla
 *   alguien retirado del cuerpo ..  201             400 «ya no pertenece»
 *   alguien exento de la cuota ...  201             400 «está exenta de pagar»
 *   un cuerpo que no cobra .......  201             400 «no cobra cuota mensual»
 *
 * Y no se quedaba en la tabla de cuotas: sobre un cuerpo con su caja en cero,
 * cobrar por la ficha la cuota de una persona retirada y la de una exenta la
 * dejó en $ 12.000. La exención existe para que a alguien no se le cobre —«
 * situación económica», dice el motivo— y por esa puerta se le cobraba igual.
 *
 * Cerrar una de las dos puertas es lo mismo que no cerrar ninguna, que es la
 * lección que dejó esta misma planilla en la 1.249.0.
 */
function aQuienNoSeLeCobra(conexion, ficha) {
  const quien = ficha.persona || 'Esa persona';
  if (ficha.estado === 'Retirado') {
    const { comoSeLee } = require('./fechas');
    return `${quien} ya no pertenece a este cuerpo`
      + `${ficha.fecha_retiro ? `: se retiró el ${comoSeLee(ficha.fecha_retiro)}` : ''}. `
      + 'A quien se fue no se le cobra cuota. Si volvió, ábrale su ficha de integrante y '
      + 'póngala en un estado vigente.';
  }
  if (ficha.exento_cuota) {
    return `${quien} está exento(a) de pagar la cuota`
      + `${ficha.exento_motivo ? ` (${ficha.exento_motivo})` : ''}. `
      + 'Si eso ya no corresponde, quítele la exención en su ficha de integrante.';
  }
  const cuerpo = conexion.prepare('SELECT nombre, cobra_cuota FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);
  if (!cuerpo || !cuerpo.cobra_cuota) {
    return `${cuerpo ? `«${cuerpo.nombre}»` : 'Este cuerpo'} no cobra cuota mensual, así que no hay `
      + 'cuota que registrar. Si empezó a cobrarla, márquelo en su ficha y dígale de cuánto es.';
  }
  return null;
}

/*
 * EL MES QUE SE PAGA NO PUEDE ESTAR A AÑOS DE DISTANCIA.
 *
 * El año se revisaba contra 1900-2200, que para una cuota mensual no revisa
 * nada. Medido en la v1.412.0, por la ficha suelta: la cuota de 12/2030 se
 * registró con un 201, y quedó en el libro un mes que faltaba cuatro años.
 *
 * Pagar adelantado se hace —hasta el año entero— así que el tope es un año, y
 * lo que se rechaza es el año tecleado de más.
 *
 * Vive acá y no en el módulo por lo mismo que `aQuienNoSeLeCobra`: una cuota
 * entra por dos puertas, y una regla escrita en una sola es una regla que la
 * otra no tiene. Desde la planilla se llega a un año adelante con dos clics en
 * el botón del año siguiente.
 */
const MESES_QUE_SE_PUEDEN_ADELANTAR = 12;

function avisoSiElMesEstaMuyAdelante(anio, mes) {
  const enMeses = (a, m) => a * 12 + (m - 1);
  const hoyEs = require('./fechas').hoy();
  const faltan = enMeses(Number(anio), Number(mes))
    - enMeses(Number(hoyEs.slice(0, 4)), Number(hoyEs.slice(5, 7)));
  if (faltan <= MESES_QUE_SE_PUEDEN_ADELANTAR) return null;
  // `faltan` es siempre 13 o más acá arriba del tope, así que el plural no tiene
  // caso singular: escribirlo sería una rama que ninguna prueba puede recorrer.
  return `Está registrando la cuota de ${nombreDelMes(mes).toLowerCase()} de ${anio}, que faltan `
    + `${faltan} meses. Se puede pagar hasta un año adelantado; revise si se le fue un dígito `
    + 'en el año.';
}

/**
 * Anota que una persona pagó su cuota de un mes. Devuelve { error } cuando no
 * corresponde cobrarla, para poder decirlo en pantalla tal cual.
 */
function registrarPago(conexion, { integranteId, anio, mes, monto, fecha, metodo, usuarioId, usuario }) {
  const ficha = conexion.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(integranteId);
  if (!ficha) return { error: 'No encuentro la ficha de ese integrante.' };
  const noLeToca = aQuienNoSeLeCobra(conexion, ficha);
  if (noLeToca) return { error: noLeToca };

  const cuerpo = conexion.prepare('SELECT * FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);

  /*
   * Y un cuerpo INACTIVO no cobra cuotas nuevas (ver
   * server/cuerpo-inactivo.js). Se pide acá, y no solo en el motor, porque la
   * planilla de cuotas escribe el pago derecho —y con él su ingreso en
   * tesorería— desde su propia ruta: escrita la regla en un solo lado, ésta
   * sería la puerta de atrás para meterle plata nueva a un cuerpo cerrado.
   */
  const cerrado = require('./cuerpo-inactivo')
    .avisoSiEstaInactivo(conexion, ficha.cuerpo_id, 'cobrar cuotas nuevas');
  if (cerrado) return { error: cerrado };

  const elMes = String(mes || '').padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(elMes)) return { error: 'Ese mes no existe.' };
  const elAnio = Number(anio);
  if (!(elAnio > 1900 && elAnio < 2200)) return { error: 'Ese año no parece correcto.' };
  const muyAdelante = avisoSiElMesEstaMuyAdelante(elAnio, elMes);
  if (muyAdelante) return { error: muyAdelante };

  const repetida = conexion
    .prepare('SELECT id FROM cuotas_cuerpo WHERE integrante_id = ? AND anio = ? AND mes = ?')
    .get(ficha.id, elAnio, elMes);
  if (repetida) return { error: 'Esa cuota ya estaba registrada.' };

  const cuanto = Number(monto) > 0 ? Number(monto) : Number(cuerpo.cuota_mensual) || 0;
  if (!(cuanto > 0)) return { error: 'Este cuerpo todavía no tiene definido el monto de su cuota.' };

  const sinDonde = avisoSiLaCuentaEstaCerrada(ficha.cuerpo_id, conexion);
  if (sinDonde) return { error: sinDonde };

  // El día de la iglesia, no el universal: una cuota pagada el domingo por
  // la noche quedaba con fecha del lunes (ver fechas.hoy)
  const cuando = fecha || require('./fechas').hoy();
  /*
   * QUIÉN PAGÓ VA ESCRITO, TAMBIÉN POR ACÁ.
   *
   * La ficha suelta lo copia de la ficha de integrante y esta puerta no lo
   * hacía, y el sistema ya tenía escrito por qué importa, unas líneas más
   * arriba: «Buscarlo por el número de miembro dejaba el movimiento diciendo
   * "un integrante" cuando quien paga es alguien de un grupo que no está
   * inscrito en la membresía: no tiene ese número». El arreglo estaba hecho y
   * esta puerta no lo alimentaba.
   *
   * MEDIDO en la v1.409.0, la misma persona de un grupo, dos cuotas:
   *
   *   por la planilla ..  «Cuota de julio de 2026 — un integrante»
   *   por su ficha .....  «Cuota de agosto de 2026 — Sin Inscribir»
   *
   * En el libro de la plata de ese grupo, el primero no dice de quién es. Y sin
   * el nombre, la línea del Registro de Cambios tampoco lo decía.
   */
  const info = conexion
    .prepare(
      `INSERT INTO cuotas_cuerpo (integrante_id, anio, mes, monto, fecha_pago, metodo,
                                  cuerpo_id, miembro_id, persona, iglesia_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ficha.id, elAnio, elMes, cuanto, cuando, metodo || 'Efectivo',
         ficha.cuerpo_id, ficha.miembro_id, ficha.persona || null, ficha.iglesia_id, usuarioId || null);

  const fila = conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(info.lastInsertRowid);
  sincronizarConLaTesoreria(fila, conexion);
  const guardada = conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(fila.id);
  dejarConstancia({ isNew: true, fila: guardada, usuario });
  return { cuota: guardada };
}

/**
 * LA PLANILLA TAMBIÉN DEJA SU LÍNEA EN EL REGISTRO DE CAMBIOS.
 *
 * Las cuotas están en la lista de módulos vigilados desde hace versiones, y con
 * razón: son dinero. Pero esa lista la mira el motor, y la planilla escribe el
 * pago derecho —un INSERT y su movimiento— sin pasar por él. O sea que el libro
 * anotaba la puerta que casi nadie usa y no la que se usa todos los días: la
 * planilla se cobra con un clic por casilla, mes a mes, persona a persona.
 *
 * MEDIDO en la v1.408.0, contando las líneas nuevas de cada operación:
 *
 *   cobrar por la ficha ......  201 · 1 línea
 *   cobrar por la planilla ...  200 · 0 líneas
 *   borrar por la planilla ...  200 · 0 líneas
 *   borrar por la ficha ......  200 · 1 línea
 *
 * Se anota desde acá y con las MISMAS funciones que usa el motor —no con una
 * copia— para que las dos puertas dejen la misma clase de línea. Y con su
 * `origen`, igual que la importación: la línea contesta sola de dónde salió.
 */
function dejarConstancia({ isNew, fila, usuario, alBorrar }) {
  const bitacora = require('./bitacora');
  const def = require('./registry').getModule('cuotas_cuerpo');
  if (!def) return;
  if (alBorrar) bitacora.registrarEliminado(def, fila, usuario);
  else bitacora.registrarGuardado(def, { isNew, despues: fila, datos: fila, user: usuario, origen: 'Por la planilla' });
}

/** Deshace un pago: se va la cuota y el ingreso que dejó en tesorería. */
function borrarPago(conexion, cuotaId, usuario) {
  const fila = conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(cuotaId);
  if (!fila) return { error: 'Esa cuota ya no está registrada.' };
  if (fila.movimiento_id) conexion.prepare('DELETE FROM tesoreria WHERE id = ?').run(fila.movimiento_id);
  conexion.prepare('DELETE FROM cuotas_cuerpo WHERE id = ?').run(fila.id);
  dejarConstancia({ fila, usuario, alBorrar: true });
  return { borrada: true };
}

module.exports = {
  MESES, OPCIONES_MES, nombreDelMes, sincronizarConLaTesoreria, avisoSiElMesEstaMuyAdelante,
  registrarPago, borrarPago, cuentaDeLasCuotas, avisoSiLaCuentaEstaCerrada,
  aQuienNoSeLeCobra,
};
