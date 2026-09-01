/**
 * EL NOMBRE DE UNA PERSONA, DONDE SE COPIÓ.
 *
 * Seis registros del sistema guardan el nombre de una persona en una columna
 * propia. No se escribe a mano: lo copia el sistema de la ficha elegida al
 * guardar, para que el listado y el buscador digan el nombre sin tener que
 * mirar dos registros. Esa copia se hacía una vez y no se volvía a mirar.
 *
 * La 1.226.0 lo arregló para UNA de las seis —el beneficiario de una ayuda
 * social— y ahí se quedó. Medido antes de esto, con la misma persona puesta en
 * todos los papeles y corrigiéndole el nombre en su ficha:
 *
 *   ayudas_sociales.beneficiario ...... Ana María Corregida   ✔ seguía
 *   cuerpos.lider ..................... Ana Vieja
 *   integrantes_cuerpo.persona ........ Ana Vieja
 *   cuotas_cuerpo.persona ............. Ana Vieja
 *   solicitudes.solicitante ........... Ana Vieja
 *
 * Un apellido no se corrige por capricho: se corrige porque estaba mal escrito,
 * porque hubo un matrimonio o porque se regularizó. Y el listado seguía
 * mostrando el nombre viejo, ahora en cuatro módulos a la vez y sin que nadie
 * pudiera arreglarlo desde ahí, porque esos campos son de solo lectura.
 *
 * Es la misma lección que ya dejaron la 1.220.0 —lo del cuerpo sigue al
 * cuerpo—, la 1.226.0 y la 1.236.0 —las cajas siguen al nombre de su iglesia—:
 * LO QUE SE COPIÓ HAY QUE VOLVER A MIRARLO. Escrita módulo por módulo, se
 * olvidó en cinco de seis; escrita acá, en una sola lista, el que venga después
 * se agrega en una línea.
 *
 * ── POR QUÉ SE REESCRIBE LA COPIA Y NO SE MUESTRA EL NOMBRE VIVO ──
 *
 * Mostrar el nombre vivo y dejar la copia quieta parece más limpio —no
 * reescribe nada— y fue lo primero que se pensó. No alcanza: el título de un
 * registro lo arma el motor con las COLUMNAS GUARDADAS (ver `displayOf` y
 * `etiquetasDe` en server/crud.js), porque las etiquetas de un listado entero
 * se resuelven en una sola consulta. Un nombre calculado al leer llegaría al
 * listado y no al título, y el mismo registro diría dos nombres distintos
 * según dónde se lo mire, que es peor que el problema que se venía a arreglar.
 *
 * Reescribir la copia, en cambio, llega de una vez a todo: al listado, al
 * título, a la búsqueda, a la planilla y a lo que se imprime.
 *
 * ── QUÉ NO SE PIERDE ──
 *
 * La constancia de a nombre de quién se hizo cada cosa no vive solo en estas
 * columnas: estos módulos están entre los vigilados por la bitácora del
 * sistema (ver server/bitacora.js), que guarda cada versión con su fecha y su
 * autor. Y las filas que llevan un nombre escrito a mano y no apuntan a
 * ninguna ficha NO se tocan nunca: ahí ese texto es lo único que hay, y es la
 * constancia de verdad.
 *
 * Ninguna de estas seis columnas se puede escribir a mano —las seis son de
 * solo lectura en su formulario— así que acá no hace falta la salvedad que sí
 * hace falta con el nombre de una caja de tesorería, que alguien sí puede
 * haber elegido (ver server/el-nombre-de-la-iglesia.js).
 *
 * El refresco no pasa por el guardado normal de cada registro, a propósito: no
 * es un cambio de ese registro —nadie decidió nada sobre él— sino una copia
 * que se pone al día. Anotarlo en la bitácora llenaría el historial de diez o
 * cuarenta entradas por cada apellido corregido, y ninguna diría nada.
 */

/**
 * Dónde se copia el nombre de una persona, y con qué columna se la reconoce.
 *
 * `miembro` y `noMiembro` son las columnas que apuntan a cada registro. Un
 * `null` quiere decir que esa tabla no puede llegar por ahí.
 */
const DONDE_SE_COPIA = [
  {
    tabla: 'ayudas_sociales', columna: 'beneficiario',
    miembro: 'miembro_id', noMiembro: 'no_miembro_id',
  },
  {
    // El líder de un cuerpo sale de uno de los dos registros según `lider_tipo`,
    // y el gancho del módulo suelta el enlace del otro al cambiar.
    tabla: 'cuerpos', columna: 'lider',
    miembro: 'lider_id', noMiembro: 'lider_no_miembro_id',
  },
  {
    tabla: 'integrantes_cuerpo', columna: 'persona',
    miembro: 'miembro_id', noMiembro: 'no_miembro_id',
  },
  {
    tabla: 'solicitudes', columna: 'solicitante',
    miembro: 'miembro_id', noMiembro: 'no_miembro_id',
  },
  {
    tabla: 'personas_solicitud', columna: 'persona',
    miembro: 'miembro_id', noMiembro: 'no_miembro_id',
  },
];

/**
 * La cuota pagada va aparte, y no por capricho.
 *
 * Su columna `persona` no se copia de la ficha de la persona: se copia de la
 * FICHA DE INTEGRANTE que pagó (ver server/modules/cuotas_cuerpo.js), y la
 * tabla no tiene columna para un no miembro —solo `miembro_id`—, así que la
 * cuota de alguien no inscrito no se alcanza por ese camino. Siguiendo al
 * integrante se alcanzan las dos, y además se copia de donde de verdad salió.
 */
const POR_SU_INTEGRANTE = {
  tabla: 'cuotas_cuerpo', columna: 'persona', porElIntegrante: 'integrante_id',
};

/**
 * Cómo se escribe el nombre de una ficha en una copia. Una sola vez acá: si el
 * hook que copia y el refresco lo armaran cada uno por su lado, un día
 * diferirían por un espacio y los registros quedarían «cambiando» sin motivo.
 */
function comoSeLlama(ficha) {
  if (!ficha) return null;
  return `${ficha.nombres || ''} ${ficha.apellidos || ''}`.trim();
}

/** ¿Esta tabla existe todavía? Las hay que se crean al arrancar. */
function hayTabla(db, tabla) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla);
  } catch (e) {
    return false;
  }
}

/**
 * Pone al día el nombre en todo lo que lo copió de esta persona.
 *
 * `deDonde` es de qué registro sale: 'miembros' o 'no_miembros'. Solo escribe
 * donde el nombre cambió de verdad, así corregir un teléfono no toca ni una
 * fila. Devuelve CUÁNTAS filas quedaron al día, sumando todas las tablas, que
 * es lo que se prueba.
 */
function ponerAlDiaElNombre(db, deDonde, id) {
  const ficha = db.prepare(`SELECT nombres, apellidos FROM "${deDonde}" WHERE id = ?`).get(id);
  const nombre = comoSeLlama(ficha);
  /*
   * Sin nombre no se escribe nada, y cubre los dos casos de una vez: la ficha
   * que ya no está —`comoSeLlama` devuelve null— y la que existe con el nombre
   * vacío, que el formulario no deja crear pero una planilla mal armada o una
   * migración sí. Los dos terminarían dejando la copia en blanco, y eso es
   * cambiar «no sabemos si el nombre está al día» por «no sabemos de quién se
   * trata», que es mucho peor.
   */
  if (!nombre) return 0;

  let puestas = 0;
  for (const donde of DONDE_SE_COPIA) {
    const columna = deDonde === 'miembros' ? donde.miembro : donde.noMiembro;
    if (!columna || !hayTabla(db, donde.tabla)) continue;
    const r = db
      .prepare(
        `UPDATE "${donde.tabla}" SET "${donde.columna}" = ?
          WHERE "${columna}" = ? AND COALESCE("${donde.columna}", '') <> ?`
      )
      .run(nombre, id, nombre);
    puestas += r.changes;
  }

  // Y las cuotas, por su ficha de integrante, que es de donde salió su copia
  if (hayTabla(db, POR_SU_INTEGRANTE.tabla) && hayTabla(db, 'integrantes_cuerpo')) {
    const columna = deDonde === 'miembros' ? 'miembro_id' : 'no_miembro_id';
    const r = db
      .prepare(
        `UPDATE "${POR_SU_INTEGRANTE.tabla}" SET "${POR_SU_INTEGRANTE.columna}" = ?
          WHERE "${POR_SU_INTEGRANTE.porElIntegrante}" IN (
                SELECT id FROM integrantes_cuerpo WHERE "${columna}" = ?)
            AND COALESCE("${POR_SU_INTEGRANTE.columna}", '') <> ?`
      )
      .run(nombre, id, nombre);
    puestas += r.changes;
  }
  return puestas;
}

module.exports = {
  DONDE_SE_COPIA, POR_SU_INTEGRANTE, comoSeLlama, ponerAlDiaElNombre,
};
