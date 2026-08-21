/**
 * Módulo 8 · Pastores / Guías.
 *
 * El sistema anterior guardaba una sola ficha: la del pastor presidente de la
 * iglesia. Acá queda enlazada con su ficha de miembro —es la misma persona— y
 * con su cónyuge, si está registrada, de modo que el trato de Pastor y
 * Pastora salga solo en todo el sistema.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const rut = require('../rut');
const { CARGOS_MINISTERIO, CARGO_UNICO } = require('../tratamiento');

/**
 * El cargo, dicho como lo dice este sistema. El origen los escribe igual,
 * así que basta con reconocerlos sin reparar en mayúsculas ni en espacios.
 */
const CARGO = new Map(CARGOS_MINISTERIO.map((c) => [c.toLowerCase(), c]));
const comoLoDecimosAca = (cargo) => CARGO.get(String(cargo || '').trim().toLowerCase()) || null;

module.exports = function importarPastores(origen, { lote, prueba, iglesiaId }) {
  const filas = origen.pastorGuias || [];

  return importarModulo({ nombre: 'pastores', filas, lote, prueba }, (ayuda) => {
    let creados = 0, actualizados = 0, conFicha = 0, conConyuge = 0;

    filas.forEach((p, i) => {
      if (!ayuda.exigir(p.nombres, 'ficha sin nombres', i, p)) return;
      if (!ayuda.exigir(p.apellidos, 'ficha sin apellidos', i, p)) return;

      const cargo = comoLoDecimosAca(p.cargo);
      if (p.cargo && !cargo) {
        ayuda.problema(i, `no sé traducir el cargo "${p.cargo}"`, p);
        return;
      }

      let suRut = null;
      if (texto(p.rut)) {
        if (!rut.validar(p.rut)) {
          ayuda.problema(i, `RUT inválido en la ficha del pastor: ${p.rut}`, p);
          return;
        }
        suRut = rut.canonico(p.rut);
      }

      // Su ficha de miembro: es la misma persona, y se reconoce por el RUT
      const miembro = suRut ? db.prepare('SELECT * FROM miembros WHERE rut = ?').get(suRut) : null;
      if (miembro) conFicha++;
      const conyuge = miembro && miembro.conyuge_id
        ? db.prepare('SELECT id FROM miembros WHERE id = ?').get(miembro.conyuge_id)
        : null;
      if (conyuge) conConyuge++;

      const datos = {
        nombres: texto(p.nombres),
        apellidos: texto(p.apellidos),
        cargo: cargo || CARGO_UNICO,
        iglesia_id: iglesiaId,
        rut: suRut,
        estado: p.estado === 'no vigente' ? 'Inactivo' : 'Activo',
        miembro_id: miembro ? miembro.id : null,
        conyuge_id: conyuge ? conyuge.id : null,
        telefono: miembro ? miembro.telefono : null,
        email: miembro ? miembro.email : null,
        direccion: miembro ? miembro.direccion : null,
        fecha_nacimiento: miembro ? miembro.fecha_nacimiento : null,
        notas: p.comuna ? `Comuna registrada en el sistema anterior: ${texto(p.comuna)}.` : null,
        created_at: marcaDeTiempo(p.createdAt),
        updated_at: marcaDeTiempo(p.updatedAt),
      };

      const { nueva } = guardar({
        moduloOrigen: 'pastorGuias', idOrigen: p.id, tabla: 'pastores', datos, lote,
      });
      nueva ? creados++ : actualizados++;
    });

    return { creados, actualizados, con_ficha_de_miembro: conFicha, con_conyuge_enlazada: conConyuge };
  });
};
