/**
 * Módulo 2 · Miembros.
 *
 * Es el más largo porque es el que más traducción necesita: el origen parte
 * los nombres en cuatro campos, guarda la educación en dos, el estado civil
 * con códigos y al adulto responsable dentro de un objeto.
 *
 * Tres cosas que se deciden acá:
 *
 *  - El **cónyuge** se anota en dos partes: el nombre siempre —esté o no
 *    registrado— y el vínculo entre fichas después, en la segunda pasada,
 *    cuando ya existen las dos.
 *  - Quien está de baja por fallecimiento queda con estado **Fallecido**, que
 *    dice más que "inactivo", y el motivo con su fecha van a su bitácora.
 *  - Las **fotos** no llegaron: se anota su ruta en la lista de archivos
 *    pendientes en vez de dejar la ficha apuntando a un archivo que no está.
 */
const { db } = require('../db');
const { importarModulo, guardar, fecha, marcaDeTiempo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const rut = require('../rut');
const tr = require('./traducciones');

/** Nombres y apellidos: el origen los tiene repartidos en cuatro campos. */
const nombresDe = (m) => [m.firstName, m.secondName || m.middleName].map(texto).filter(Boolean).join(' ');
const apellidosDe = (m) => [m.lastName, m.maternalLastName || m.secondLastName].map(texto).filter(Boolean).join(' ');

module.exports = function importarMiembros(origen, { lote, prueba, iglesiaId, rutsInvalidos }) {
  const filas = origen.members || [];
  rutsInvalidos = rutsInvalidos || 'detener';

  return importarModulo({ nombre: 'miembros', filas, lote, prueba }, (ayuda) => {
    let creadas = 0, actualizadas = 0, conFoto = 0, fallecidos = 0, conConyuge = 0;
    const rutsVistos = new Map();
    const invalidos = [];

    filas.forEach((m, i) => {
      const nombres = nombresDe(m);
      const apellidos = apellidosDe(m);
      if (!ayuda.exigir(nombres, 'sin nombre', i, m)) return;
      if (!ayuda.exigir(apellidos, 'sin apellido', i, m)) return;

      // El RUT es la llave natural: se normaliza y se comprueba que no venga repetido
      let rutNormalizado = null;
      let rutPorVerificar = false;
      if (texto(m.rut)) {
        if (!rut.validar(m.rut)) {
          // El dígito verificador no calza. NO se corrige solo: el error puede
          // estar en el dígito o en el número, y adivinar cuál sería inventar
          // el RUT de una persona. Según la política elegida, se detiene la
          // importación, se deja el RUT como vino (marcado) o se deja en blanco.
          if (rutsInvalidos === 'detener') {
            ayuda.problema(i, `RUT inválido: ${m.rut}`, m);
            return;
          }
          rutPorVerificar = true;
          invalidos.push({ nombre: `${nombres} ${apellidos}`, rut: m.rut, id_origen: m.id });
          if (rutsInvalidos === 'vaciar') {
            rutNormalizado = null;
            rutsVistos.set('vacio-' + i, i + 1);
          } else {
            rutNormalizado = rut.canonico(m.rut);
          }
        } else {
          rutNormalizado = rut.canonico(m.rut);
        }
        if (rutNormalizado) {
          if (rutsVistos.has(rutNormalizado)) {
            ayuda.problema(i, `RUT repetido con la fila ${rutsVistos.get(rutNormalizado)}: ${m.rut}`, m);
            return;
          }
          rutsVistos.set(rutNormalizado, i + 1);
        }
      }

      // El fallecimiento manda sobre el estado: dice más que "inactivo"
      const bajaPorFallecimiento = /fallec/i.test(String(m.inactiveReason || ''));
      const estado = bajaPorFallecimiento
        ? 'Fallecido'
        : tr.traducir(tr.ESTADO_MIEMBRO, m.status, 'estado del miembro') || 'Activo';
      if (bajaPorFallecimiento) fallecidos++;

      const datos = {
        iglesia_id: iglesiaId,
        rut: rutNormalizado,
        nombres,
        apellidos,
        fecha_nacimiento: fecha(m.birthDate),
        genero: tr.traducir(tr.SEXO, m.gender, 'sexo'),
        tratamiento_personalizado: tr.traducir(tr.TRATO, m.title, 'trato'),
        estado,
        tipo_miembro: tr.traducir(tr.TIPO_MIEMBRO, m.memberType, 'tipo de miembro'),
        forma_ingreso: tr.traducir(tr.FORMA_INGRESO, m.entryMethod, 'forma de ingreso'),
        fecha_ingreso: fecha(m.joinDate),
        estado_civil: tr.traducir(tr.ESTADO_CIVIL, m.maritalStatus, 'estado civil'),
        fecha_matrimonio_civil: fecha(m.civilMarriageDate),
        fecha_matrimonio_religioso: fecha(m.churchMarriageDate),
        conyuge_nombre: texto(m.spouseName),
        telefono: texto(m.phone),
        email: texto(m.email),
        direccion: texto(m.address),
        nivel_educacional: tr.nivelEducacional(m.education, m.educationStatus),
        titulo_estudios: texto(m.profession),
        ocupacion: texto(m.occupation),
        emergencia_nombre: texto(m.emergencyContactName),
        emergencia_parentesco: texto(m.emergencyContactRelationship),
        emergencia_telefono: texto(m.emergencyContactPhone),
        enfermedades: texto(m.medicalConditions),
        indicaciones_medicas: texto(m.medicalIndications),
        nota_importante: texto(m.importantNote),
        created_at: marcaDeTiempo(m._created_at || m.createdAt) || marcaDeTiempo(m.joinDate),
        updated_at: marcaDeTiempo(m._updated_at || m.updatedAt),
      };

      // El adulto responsable viene en un objeto aparte
      if (m.guardian) {
        datos.responsable_nombre = texto(m.guardian.name);
        datos.responsable_rut = m.guardian.rut && rut.validar(m.guardian.rut) ? rut.canonico(m.guardian.rut) : null;
        datos.responsable_parentesco = texto(m.guardian.relationship);
        datos.responsable_telefono = texto(m.guardian.phone);
      }
      if (datos.conyuge_nombre) conConyuge++;

      const { id, nueva } = guardar({
        moduloOrigen: 'members', idOrigen: m.id, tabla: 'miembros', datos, lote,
      });
      nueva ? creadas++ : actualizadas++;

      // La foto: se guarda su ruta hasta que llegue el archivo
      if (texto(m.photoUrl)) {
        equivalencias.archivoPendiente({
          moduloDestino: 'miembros', idDestino: id, campo: 'foto', ruta: m.photoUrl, lote,
        });
        conFoto++;
      }

      // Un RUT que no calza queda anotado en su ficha: hay que revisarlo con
      // la persona, y mientras tanto nadie puede editarla sin corregirlo
      if (rutPorVerificar) {
        const ya = db.prepare(`SELECT id FROM bitacora WHERE miembro_id = ? AND descripcion LIKE 'RUT por verificar%'`).get(id);
        if (!ya) {
          db.prepare(
            `INSERT INTO bitacora (miembro_id, fecha, tipo, descripcion, iglesia_id, origen, registrado_por)
             VALUES (?, date('now','localtime'), 'Anotación', ?, ?, 'Automático', 'Importación')`
          ).run(id, `RUT por verificar: "${m.rut}" venía así del sistema anterior y su dígito verificador no calza. Confírmelo con la persona y corríjalo.`, iglesiaId);
        }
      }

      // El motivo de la baja, a su historial: es un hecho de su vida en la iglesia
      if (bajaPorFallecimiento || texto(m.inactiveReason)) {
        const cuando = fecha(m.inactiveDate) || datos.updated_at || require('../fechas').hoy();
        const yaEsta = db
          .prepare(`SELECT id FROM bitacora WHERE miembro_id = ? AND tipo = 'Cambio de estado' AND descripcion LIKE ?`)
          .get(id, `%${m.inactiveReason}%`);
        if (!yaEsta) {
          db.prepare(
            `INSERT INTO bitacora (miembro_id, fecha, tipo, descripcion, iglesia_id, origen, registrado_por)
             VALUES (?, ?, 'Cambio de estado', ?, ?, 'Automático', 'Importación')`
          ).run(id, String(cuando).slice(0, 10), `Baja: ${texto(m.inactiveReason)}.`, iglesiaId);
        }
      }
    });

    return {
      creadas, actualizadas, con_foto_pendiente: conFoto, fallecidos,
      con_nombre_de_conyuge: conConyuge, rut_por_verificar: invalidos.length,
      detalle_ruts: invalidos,
    };
  });
};
