/**
 * El motor de la importación: lo común a todos los módulos.
 *
 * Reglas que valen para todos, sin excepción:
 *
 *  - **Todo o nada por módulo.** Cada módulo se importa dentro de una
 *    transacción. Si algo no cuadra —un dato obligatorio vacío, una
 *    referencia que no resuelve, un código que no sé traducir— se deshace el
 *    módulo entero y la importación se detiene. Nunca queda a medias.
 *  - **Ensayo primero.** En modo prueba se hace todo el trabajo de verdad y
 *    al final se deshace: sirve para ver los conteos y los problemas sin
 *    tocar nada.
 *  - **Idempotente.** Cada fila se busca en la tabla de equivalencias antes
 *    de crearla. Correr la importación dos veces no duplica nada.
 */
const { db } = require('../db');
const equivalencias = require('./equivalencias');

/** Un error de importación que ya viene explicado; no necesita traza. */
class ErrorDeImportacion extends Error {}

/**
 * Corre un módulo completo. `trabajo` recibe un ayudante y devuelve el
 * detalle de lo que hizo; si algo falla, lanza y no queda nada escrito.
 */
function importarModulo({ nombre, filas, lote, prueba }, trabajo) {
  const problemas = [];
  let resultado = null;

  const correr = db.transaction(() => {
    const ayuda = {
      lote,
      /** Anota un problema con la fila que lo provocó. */
      problema(indice, detalle, fila) {
        problemas.push({ fila: indice + 1, detalle, id_origen: fila && fila.id });
      },
      /** Exige que un dato esté; si no, detiene el módulo. */
      exigir(valor, detalle, indice, fila) {
        if (valor === undefined || valor === null || String(valor).trim() === '') {
          this.problema(indice, detalle, fila);
          return false;
        }
        return true;
      },
    };

    resultado = trabajo(ayuda);

    if (problemas.length) {
      const muestra = problemas.slice(0, 12)
        .map((p) => `   fila ${p.fila}${p.id_origen ? ` (${p.id_origen})` : ''}: ${p.detalle}`)
        .join('\n');
      throw new ErrorDeImportacion(
        `El módulo "${nombre}" tiene ${problemas.length} problema(s) y no se importó nada:\n${muestra}` +
          (problemas.length > 12 ? `\n   … y ${problemas.length - 12} más` : '')
      );
    }
    if (prueba) throw new EnsayoTerminado(); // deshace todo: era un ensayo
  });

  try {
    correr.immediate();
  } catch (e) {
    if (!(e instanceof EnsayoTerminado)) throw e;
  }

  return {
    modulo: nombre,
    origen: filas ? filas.length : 0,
    ...resultado,
    prueba: !!prueba,
  };
}

/** Señal interna para deshacer lo hecho al terminar un ensayo. */
class EnsayoTerminado extends Error {}

/**
 * Inserta o actualiza una fila conservando su equivalencia con el origen.
 * Devuelve el id de acá y si fue nueva.
 */
function guardar({ moduloOrigen, idOrigen, tabla, datos, lote }) {
  const existente = equivalencias.resolver(moduloOrigen, idOrigen);
  const columnas = Object.keys(datos);
  if (existente) {
    if (columnas.length) {
      db.prepare(`UPDATE "${tabla}" SET ${columnas.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`)
        .run(...columnas.map((c) => datos[c]), existente);
    }
    return { id: existente, nueva: false };
  }
  const info = db
    .prepare(
      `INSERT INTO "${tabla}" (${columnas.map((c) => `"${c}"`).join(', ')})
       VALUES (${columnas.map(() => '?').join(', ')})`
    )
    .run(...columnas.map((c) => datos[c]));
  equivalencias.registrar(moduloOrigen, idOrigen, tabla, info.lastInsertRowid, lote);
  return { id: Number(info.lastInsertRowid), nueva: true };
}

/** Una fecha del origen, en el formato que guarda este sistema. */
function fecha(valor) {
  if (!valor) return null;
  const t = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

/** Una marca de tiempo del origen, como la guarda este sistema. */
function marcaDeTiempo(valor) {
  if (!valor) return null;
  const t = String(valor).trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`;
  return null;
}

/** Texto limpio, o null si no había nada. */
const texto = (v) => {
  const t = v === undefined || v === null ? '' : String(v).trim();
  return t === '' ? null : t;
};

module.exports = { importarModulo, guardar, fecha, marcaDeTiempo, texto, ErrorDeImportacion };
