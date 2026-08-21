/**
 * Módulo 10 · Segunda pasada: lo que solo se puede enlazar al final.
 *
 * Hay vínculos que no se pueden escribir mientras se importa cada módulo,
 * porque apuntan a filas que todavía no existen:
 *
 *  - **Los matrimonios.** Cada ficha apunta a la de su cónyuge, y las dos
 *    tienen que existir antes. Se enlazan por los dos lados y las fechas de
 *    matrimonio se copian a quien las tenga en blanco, igual que cuando se
 *    hace a mano en el sistema.
 *  - **Quién creó cada registro.** El origen lo anota con el id de su usuario,
 *    y los usuarios se importan casi al final. Acá cada movimiento de
 *    tesorería, cada servicio y cada gestión de la bitácora queda con su
 *    autor.
 */
const { db } = require('../db');
const { importarModulo } = require('./motor');
const equivalencias = require('./equivalencias');

/** Dónde vive cada tabla del origen, y de qué campo sale su autor. */
const AUTORES = [
  { origen: 'incomes', tabla: 'tesoreria' },
  { origen: 'expenses', tabla: 'tesoreria' },
  { origen: 'services', tabla: 'servicios' },
  { origen: 'memberLogs', tabla: 'bitacora' },
  { origen: 'timeline', tabla: 'bitacora' },
  { origen: 'groups', tabla: 'cuerpos' },
  { origen: 'activities', tabla: 'asistencias' },
  { origen: 'members', tabla: 'miembros' },
];

module.exports = function segundaPasada(origen, { lote, prueba }) {
  return importarModulo({ nombre: 'segunda pasada', filas: [], lote, prueba }, (ayuda) => {
    // ---------- Los matrimonios ----------
    let matrimonios = 0, fechasCopiadas = 0, sinPareja = 0;
    for (const m of origen.members || []) {
      if (!m.spouseMemberId) continue;
      const yo = equivalencias.resolver('members', m.id);
      const otro = equivalencias.resolver('members', m.spouseMemberId);
      if (!yo) continue;
      if (!otro) {
        sinPareja++; // su cónyuge no está entre los importados
        continue;
      }
      db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(otro, yo);
      db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(yo, otro);
      matrimonios++;

      // Las fechas del matrimonio son de los dos: se copian a quien no las tenga
      const uno = db.prepare('SELECT * FROM miembros WHERE id = ?').get(yo);
      const dos = db.prepare('SELECT * FROM miembros WHERE id = ?').get(otro);
      for (const campo of ['fecha_matrimonio_civil', 'fecha_matrimonio_religioso']) {
        if (uno[campo] && !dos[campo]) {
          db.prepare(`UPDATE miembros SET "${campo}" = ? WHERE id = ?`).run(uno[campo], dos.id);
          fechasCopiadas++;
        } else if (dos[campo] && !uno[campo]) {
          db.prepare(`UPDATE miembros SET "${campo}" = ? WHERE id = ?`).run(dos[campo], uno.id);
          fechasCopiadas++;
        }
      }
    }
    // Cada matrimonio se recorre desde sus dos fichas: se cuenta una sola vez
    matrimonios = Math.round(matrimonios / 2) || matrimonios;

    // ---------- Quién creó cada registro ----------
    let conAutor = 0, sinAutorConocido = 0;
    for (const { origen: tablaOrigen, tabla } of AUTORES) {
      for (const fila of origen[tablaOrigen] || []) {
        const autorOrigen = fila._created_by || fila.createdBy;
        if (!autorOrigen) continue;
        const destino = equivalencias.resolver(tablaOrigen, fila.id);
        if (!destino) continue;
        const usuario = equivalencias.resolver('users', autorOrigen);
        if (!usuario) {
          sinAutorConocido++;
          continue;
        }
        db.prepare(`UPDATE "${tabla}" SET created_by = ? WHERE id = ? AND created_by IS NULL`)
          .run(usuario, destino);
        conAutor++;
      }
    }

    return {
      matrimonios_enlazados: matrimonios,
      fechas_de_matrimonio_copiadas: fechasCopiadas,
      conyuges_fuera_del_registro: sinPareja,
      registros_con_su_autor: conAutor,
      autores_no_reconocidos: sinAutorConocido,
    };
  });
};
