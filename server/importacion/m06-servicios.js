/**
 * Módulo 6 · Registro de Servicios.
 *
 * Los 16 servicios del sistema anterior, con su coordinador, su salmista, su
 * predicador, la asistencia contada y la ofrenda.
 *
 * La ofrenda es la parte delicada: los $1.841.560 de los 15 servicios que la
 * tuvieron ya entraron a tesorería en el módulo 4, tal como los tenía el
 * sistema anterior. Acá cada servicio queda **enlazado con su movimiento**,
 * de modo que el sistema sabe que ese ingreso es esa ofrenda: no se crea otro,
 * el movimiento queda protegido de una edición suelta en Tesorería y, si
 * alguien corrige la ofrenda del servicio, se corrige ese mismo movimiento.
 *
 * El sistema anterior no apartaba porcentaje para la corporación: toda la
 * ofrenda quedaba en la caja general. Por eso los servicios importados quedan
 * con "aparte para el fondo" en cero y el total como lo que quedó para la
 * iglesia: es lo que efectivamente pasó. De ahí en adelante, los servicios
 * nuevos aplican el porcentaje que diga Configuración.
 *
 * Tampoco registraba el **tipo** de servicio: los 16 quedan como "Servicio
 * General", que es lo que eran, y se puede corregir uno a uno.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');

/** Sin tildes, sin mayúsculas y sin espacios de más: para comparar nombres. */
const llaveDeNombre = (t) => String(t || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/^(hno|hna|hermano|hermana|pastor|pastora|oficial)\.?\s+/i, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Un número del origen, o null. */
const numero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : v === 0 || v === '0' ? 0 : null;
};

module.exports = function importarServicios(origen, { lote, prueba, iglesiaId }) {
  const filas = origen.services || [];
  const ingresos = origen.incomes || [];

  return importarModulo({ nombre: 'servicios', filas, lote, prueba }, (ayuda) => {
    let creados = 0, actualizados = 0, conOfrenda = 0, enlazados = 0, personasSueltas = 0;
    let enlazadosPorNombre = 0;
    let totalOfrenda = 0;

    // Los miembros, por su nombre completo. Solo sirve cuando un nombre le
    // calza a una sola persona: si hay dos que se llaman igual, no se elige.
    const porNombre = new Map();
    for (const m of db.prepare('SELECT id, nombres, apellidos FROM miembros').all()) {
      const llave = llaveDeNombre(`${m.nombres || ''} ${m.apellidos || ''}`);
      if (!llave) continue;
      porNombre.set(llave, porNombre.has(llave) ? null : m.id); // repetido: no se elige
    }

    /**
     * El nombre y, si está registrado, el enlace a su ficha. El origen enlazaba
     * a la mitad: cuando no trae el enlace pero el nombre completo le calza a
     * una sola persona registrada, queda enlazado igual. Si no calza con
     * nadie, o calza con dos, se guarda el nombre tal cual, que es como se
     * anota a un predicador de visita.
     */
    const persona = (nombre, idOrigen, datos, campo) => {
      datos[campo] = texto(nombre);
      let id = idOrigen ? equivalencias.resolver('members', idOrigen) : null;
      if (!id && datos[campo]) {
        const calza = porNombre.get(llaveDeNombre(datos[campo]));
        if (calza) {
          id = calza;
          enlazadosPorNombre++;
        }
      }
      datos[`${campo}_id`] = id;
      if (datos[campo] && !id) personasSueltas++;
    };

    filas.forEach((s, i) => {
      if (!ayuda.exigir(s.date, 'servicio sin fecha', i, s)) return;

      const datos = {
        fecha: fecha(s.date),
        hora_inicio: texto(s.startTime),
        hora_termino: texto(s.endTime),
        tipo: 'Servicio General',
        iglesia_id: iglesiaId,
        salmo_libro: texto(s.psalmBook),
        salmo_capitulo: numero(s.psalmChapter),
        salmo_versiculo_inicial: numero(s.psalmVerseStart),
        salmo_versiculo_final: numero(s.psalmVerseEnd),
        mensaje_libro: texto(s.messageBook),
        mensaje_capitulo: numero(s.messageChapter),
        mensaje_versiculo_inicial: numero(s.messageVerseStart),
        mensaje_versiculo_final: numero(s.messageVerseEnd),
        asistencia_adultos: numero(s.attendanceAdults),
        asistencia_ninos: numero(s.attendanceChildren),
        asistencia_total: numero(s.attendanceTotal),
        ofrenda_total: numero(s.offeringAmount) || 0,
        // El sistema anterior no apartaba porcentaje: todo quedó en la iglesia
        ofrenda_fondo: 0,
        ofrenda_iglesia: numero(s.offeringAmount) || 0,
        observaciones: texto(s.observations),
        created_at: marcaDeTiempo(s._created_at || s.createdAt),
        updated_at: marcaDeTiempo(s._updated_at || s.updatedAt),
      };
      persona(s.coordinatorName, s.coordinatorId, datos, 'coordinador');
      persona(s.psalmistName, s.psalmistId, datos, 'salmista');
      persona(s.preacherName, s.preacherId, datos, 'predicador');
      if (datos.ofrenda_total) {
        conOfrenda++;
        totalOfrenda += datos.ofrenda_total;
      }

      const { id: servicioId, nueva } = guardar({
        moduloOrigen: 'services', idOrigen: s.id, tabla: 'servicios', datos, lote,
      });
      nueva ? creados++ : actualizados++;

      // El ingreso que dejó esta ofrenda ya está en tesorería: se enlaza con
      // el servicio por los dos lados, para que nadie lo cuente dos veces.
      const suIngreso = ingresos.find((x) => x.linkedServiceId === s.id);
      if (!suIngreso) return;
      const movimientoId = equivalencias.resolver('incomes', suIngreso.id);
      if (!movimientoId) {
        ayuda.problema(i, `la ofrenda de este servicio no está importada en tesorería (${suIngreso.id})`, s);
        return;
      }
      db.prepare('UPDATE servicios SET movimiento_iglesia_id = ? WHERE id = ?').run(movimientoId, servicioId);
      db.prepare('UPDATE tesoreria SET servicio_id = ? WHERE id = ?').run(servicioId, movimientoId);
      enlazados++;
    });

    return {
      creados, actualizados, con_ofrenda: conOfrenda,
      total_de_ofrendas: totalOfrenda.toLocaleString('es-CL'),
      ofrendas_enlazadas_a_tesoreria: enlazados,
      enlazados_por_su_nombre: enlazadosPorNombre,
      personas_no_registradas: personasSueltas,
    };
  });
};
