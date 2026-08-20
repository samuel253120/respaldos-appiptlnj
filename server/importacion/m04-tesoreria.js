/**
 * Módulo 4 · Tesorería: la cuenta y sus movimientos.
 *
 * El sistema anterior manejaba un solo fondo —"Tesorería General"— con dos
 * tablas, una de ingresos y otra de egresos. Acá los dos son movimientos de
 * una misma cuenta, que es la tesorería general de la iglesia local.
 *
 * La trampa de este módulo son las **ofrendas de los servicios**: 15 de los
 * 16 ingresos los generó un servicio y ya están anotados como ingreso. Se
 * importan una sola vez, tal como venían, y en el módulo de servicios cada
 * uno queda enlazado con su servicio, para que nadie los cuente dos veces.
 *
 * Los comprobantes (una boleta fotografiada) no llegaron en la exportación:
 * su ruta queda en la lista de archivos pendientes.
 */
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const { db } = require('../db');
const tr = require('./traducciones');

module.exports = function importarTesoreria(origen, { lote, prueba, iglesiaId }) {
  const fondos = origen.treasuryFunds || [];
  const ingresos = origen.incomes || [];
  const egresos = origen.expenses || [];

  return importarModulo({ nombre: 'tesoreria', filas: [...ingresos, ...egresos], lote, prueba }, (ayuda) => {
    // La cuenta: el fondo único del origen es la tesorería general de la iglesia
    const general = db
      .prepare(`SELECT * FROM cuentas_tesoreria WHERE iglesia_id = ? AND tipo = 'General'`)
      .get(iglesiaId);
    if (!general) {
      ayuda.problema(0, 'la iglesia no tiene cuenta de tesorería general donde anotar los movimientos', null);
      return {};
    }
    for (const f of fondos) {
      if (!equivalencias.resolver('treasuryFunds', f.id)) {
        equivalencias.registrar('treasuryFunds', f.id, 'cuentas_tesoreria', general.id, lote);
      }
    }

    let creados = 0, actualizados = 0, comprobantes = 0;
    let totalIngresos = 0, totalEgresos = 0, deServicios = 0;

    const mover = (fila, i, { tipo, tabla, categoria, concepto }) => {
      if (!ayuda.exigir(fila.date, 'movimiento sin fecha', i, fila)) return;
      const monto = Number(fila.amount);
      if (!Number.isFinite(monto) || monto <= 0) {
        ayuda.problema(i, `monto que no se puede leer: ${fila.amount}`, fila);
        return;
      }
      if (!ayuda.exigir(concepto, 'movimiento sin concepto', i, fila)) return;

      const datos = {
        fecha: fecha(fila.date),
        tipo,
        categoria,
        concepto,
        monto,
        metodo: 'Efectivo',
        cuenta_id: general.id,
        iglesia_id: iglesiaId,
        created_at: marcaDeTiempo(fila._created_at || fila.createdAt),
        updated_at: marcaDeTiempo(fila._updated_at || fila.updatedAt),
      };

      const { id, nueva } = guardar({ moduloOrigen: tabla, idOrigen: fila.id, tabla: 'tesoreria', datos, lote });
      nueva ? creados++ : actualizados++;
      if (tipo === 'Ingreso') totalIngresos += monto; else totalEgresos += monto;
      if (fila.linkedServiceId) deServicios++;

      // El comprobante: se anota su ruta hasta que llegue el archivo
      if (fila.receiptFile && fila.receiptFile.storagePath) {
        equivalencias.archivoPendiente({
          moduloDestino: 'tesoreria', idDestino: id, campo: 'comprobante',
          ruta: fila.receiptFile.storagePath, nombre: fila.receiptFile.name,
          tipo: fila.receiptFile.type, tamano: fila.receiptFile.size, lote,
        });
        comprobantes++;
      }
    };

    ingresos.forEach((x, i) => mover(x, i, {
      tipo: 'Ingreso', tabla: 'incomes',
      categoria: tr.traducir(tr.CATEGORIA_INGRESO, x.category, 'categoría de ingreso') || 'Otro',
      concepto: texto(x.description) || texto(x.detail) || 'Ingreso',
    }));

    egresos.forEach((x, i) => mover(x, i + ingresos.length, {
      tipo: 'Egreso', tabla: 'expenses',
      categoria: tr.traducir(tr.CATEGORIA_EGRESO, x.category, 'categoría de egreso') || 'Otro',
      concepto: texto(x.detail) || texto(x.description) || 'Egreso',
    }));

    return {
      creados, actualizados,
      ingresos: ingresos.length, total_ingresos: totalIngresos.toLocaleString('es-CL'),
      egresos: egresos.length, total_egresos: totalEgresos.toLocaleString('es-CL'),
      saldo: (totalIngresos - totalEgresos).toLocaleString('es-CL'),
      ofrendas_de_servicios: deServicios,
      comprobantes_pendientes: comprobantes,
    };
  });
};
