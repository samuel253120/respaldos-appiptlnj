/**
 * La cuota mensual de los integrantes de un cuerpo.
 *
 * Acá vive lo que hay que saber de una cuota: cómo se nombra el mes que se
 * está pagando y qué deja el pago en la tesorería del cuerpo. Lo usan el
 * módulo "cuotas_cuerpo" —cuando se registra una cuota a mano— y el botón de
 * la planilla en la ficha del cuerpo, para que los dos hagan exactamente lo
 * mismo.
 */
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** El mes como se guarda ("01".."12") y como se lee. */
const OPCIONES_MES = MESES.map((nombre, i) => ({ value: String(i + 1).padStart(2, '0'), label: nombre }));

const nombreDelMes = (mes) => (OPCIONES_MES.find((m) => m.value === String(mes)) || {}).label || String(mes);

/**
 * Deja el ingreso que corresponde a este pago en la cuenta de cuotas del
 * cuerpo —que es aparte de su tesorería general, porque es plata que se
 * maneja por separado—: lo crea, lo corrige o lo retira, según lo que diga la
 * cuota. Se puede apagar en Configuración → Organización.
 */
function sincronizarConLaTesoreria(fila, conexion) {
  const registrar = require('./ajustes').activo('cuota_registra_tesoreria');
  // Las cuotas van a su propia cuenta: es plata que el cuerpo maneja aparte
  const cuenta = conexion
    .prepare("SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ? AND tipo = 'Cuotas de integrantes'")
    .get(fila.cuerpo_id);
  const guardado = fila.movimiento_id
    ? conexion.prepare('SELECT id FROM tesoreria WHERE id = ?').get(fila.movimiento_id)
    : null;

  if (!registrar || !cuenta || !(Number(fila.monto) > 0)) {
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
          SET fecha = ?, tipo = 'Ingreso', categoria = 'Aportes', concepto = ?, monto = ?,
              cuenta_id = ?, iglesia_id = ?, cuerpo_id = ?, updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(fila.fecha_pago, concepto, fila.monto, cuenta.id, fila.iglesia_id, fila.cuerpo_id, guardado.id);
    return;
  }
  const info = conexion
    .prepare(
      `INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, metodo, cuenta_id,
                              iglesia_id, cuerpo_id, notas)
       VALUES (?, 'Ingreso', 'Aportes', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      fila.fecha_pago, concepto, fila.monto, fila.metodo || 'Efectivo', cuenta.id,
      fila.iglesia_id, fila.cuerpo_id, 'Movimiento generado por las cuotas del cuerpo.'
    );
  conexion.prepare('UPDATE cuotas_cuerpo SET movimiento_id = ? WHERE id = ?').run(info.lastInsertRowid, fila.id);
}

/**
 * Anota que una persona pagó su cuota de un mes. Devuelve { error } cuando no
 * corresponde cobrarla, para poder decirlo en pantalla tal cual.
 */
function registrarPago(conexion, { integranteId, anio, mes, monto, fecha, metodo, usuarioId }) {
  const ficha = conexion.prepare('SELECT * FROM integrantes_cuerpo WHERE id = ?').get(integranteId);
  if (!ficha) return { error: 'No encuentro la ficha de ese integrante.' };
  if (ficha.estado === 'Retirado') return { error: 'Esa persona ya no pertenece al cuerpo.' };
  if (ficha.exento_cuota) return { error: 'Esa persona está exenta de pagar la cuota.' };

  const cuerpo = conexion.prepare('SELECT * FROM cuerpos WHERE id = ?').get(ficha.cuerpo_id);
  if (!cuerpo || !cuerpo.cobra_cuota) return { error: 'Este cuerpo no cobra cuota mensual.' };

  const elMes = String(mes || '').padStart(2, '0');
  if (!/^(0[1-9]|1[0-2])$/.test(elMes)) return { error: 'Ese mes no existe.' };
  const elAnio = Number(anio);
  if (!(elAnio > 1900 && elAnio < 2200)) return { error: 'Ese año no parece correcto.' };

  const repetida = conexion
    .prepare('SELECT id FROM cuotas_cuerpo WHERE integrante_id = ? AND anio = ? AND mes = ?')
    .get(ficha.id, elAnio, elMes);
  if (repetida) return { error: 'Esa cuota ya estaba registrada.' };

  const cuanto = Number(monto) > 0 ? Number(monto) : Number(cuerpo.cuota_mensual) || 0;
  if (!(cuanto > 0)) return { error: 'Este cuerpo todavía no tiene definido el monto de su cuota.' };

  const cuando = fecha || new Date().toISOString().slice(0, 10);
  const info = conexion
    .prepare(
      `INSERT INTO cuotas_cuerpo (integrante_id, anio, mes, monto, fecha_pago, metodo,
                                  cuerpo_id, miembro_id, iglesia_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(ficha.id, elAnio, elMes, cuanto, cuando, metodo || 'Efectivo',
         ficha.cuerpo_id, ficha.miembro_id, ficha.iglesia_id, usuarioId || null);

  const fila = conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(info.lastInsertRowid);
  sincronizarConLaTesoreria(fila, conexion);
  return { cuota: conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(fila.id) };
}

/** Deshace un pago: se va la cuota y el ingreso que dejó en tesorería. */
function borrarPago(conexion, cuotaId) {
  const fila = conexion.prepare('SELECT * FROM cuotas_cuerpo WHERE id = ?').get(cuotaId);
  if (!fila) return { error: 'Esa cuota ya no está registrada.' };
  if (fila.movimiento_id) conexion.prepare('DELETE FROM tesoreria WHERE id = ?').run(fila.movimiento_id);
  conexion.prepare('DELETE FROM cuotas_cuerpo WHERE id = ?').run(fila.id);
  return { borrada: true };
}

module.exports = { MESES, OPCIONES_MES, nombreDelMes, sincronizarConLaTesoreria, registrarPago, borrarPago };
