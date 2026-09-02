/**
 * Los documentos recibidos a los que se les está pasando el plazo.
 *
 * Es el único plazo de este sistema que NO lo pone la institución. Los demás
 * los fija la corporación en Configuración —cuántos días puede llevar abierta
 * una solicitud, con cuánta anticipación avisar de una credencial— y se pueden
 * discutir. Éste lo pone quien manda el oficio: una municipalidad, el Servicio
 * de Impuestos Internos, un tribunal. Pasarlo tiene consecuencias afuera.
 *
 * MEDIDO en la v1.284.0, con tres documentos recibidos en la base —uno con el
 * plazo pasado hacía siete meses y el trámite sin empezar—:
 *
 *   bloques del panel que lo nombraran ......... 0, de 9
 *   revisiones del vigía que lo miraran ........ 0, de 12
 *
 * El sistema ya sabía hacer esto, y lo hacía para el módulo de al lado: el
 * panel trae «solicitudes pasadas de plazo» en su propia tarjeta y el vigía
 * avisa de una solicitud sin respuesta. Una solicitud de un hermano de la
 * congregación tenía vigilancia de plazos; un oficio de un organismo del
 * Estado, no.
 *
 * ── CUIDADO CON EL NOMBRE ──
 *
 * Una de las revisiones del vigía se llama `documentosPorVencer` y NO es ésta:
 * mira los DOCUMENTOS DE UN MIEMBRO —el carné que caduca, el certificado que
 * hay que renovar—, que es otra cosa. El parecido del nombre es justamente lo
 * que puede hacer creer que el asunto estaba cubierto.
 *
 * ── A CUÁLES SE LES MIRA EL PLAZO ──
 *
 * A los RECIBIDOS que todavía deben una respuesta. Lo emitido no tiene plazo
 * —su campo ni se muestra— y lo interno tampoco. Y de los recibidos quedan
 * fuera los que ya se cerraron: «Respondido», «Despachado» y «Archivado» son
 * las tres maneras que tiene este módulo de decir que el asunto terminó.
 *
 * Un documento sin plazo escrito NO aparece: no se inventa uno. Que el oficio
 * no traiga fecha tope es corriente, y avisar de todos los recibidos abiertos
 * convertiría esto en el listado del módulo.
 */
const { hoy, comoSeLee } = require('./fechas');

/** Los estados en que el documento todavía debe una respuesta. */
const ABIERTOS = ['Ingresado', 'Derivado', 'En trámite'];

/** Con cuántos días de anticipación se avisa. Lo fija Configuración. */
const diasDeAviso = () => require('./ajustes').numero('avisos_plazo_documento_dias', 1, 90);

/** Días entre dos fechas ISO, en positivo si la segunda es posterior. */
function diasEntre(desde, hasta) {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** «hace 3 días», «hace 7 meses»: como lo diría alguien. */
function haceCuanto(dias) {
  if (dias <= 1) return 'ayer';
  if (dias < 60) return `hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 24) return `hace ${meses} meses`;
  return `hace ${Math.floor(meses / 12)} años`;
}

/** «mañana», «en 5 días». */
function enCuanto(dias) {
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

/**
 * Cómo va de plazo este documento, o nulo si todavía no hay nada que decir.
 *
 * Se separan los dos casos —pasado y por pasar— porque piden cosas distintas:
 * uno hay que explicarlo y el otro todavía se alcanza a contestar. El texto
 * dice SIEMPRE cuánto, no solo que sí: «vencido» a secas no distingue entre
 * ayer y hace siete meses, y esa diferencia es toda la diferencia.
 */
function comoVaDePlazo(fila, cuando = hoy(), anticipacion = null) {
  const plazo = String(fila.plazo || '').trim();
  if (!ABIERTOS.includes(String(fila.estado || ''))) return null;

  /*
   * Sin plazo escrito no hay nada que decir, y eso lo resuelve `diasEntre`:
   * una fecha vacía no se puede leer y devuelve nulo. Había además un
   * `if (!plazo) return null` acá arriba, y se quitó al comprobar que romperlo
   * a propósito no ponía roja ninguna prueba — porque no hacía nada—.
   */
  const dias = diasEntre(cuando, plazo);
  if (dias === null) return null;

  const aviso = anticipacion === null ? diasDeAviso() : anticipacion;
  if (dias < 0) {
    return {
      nivel: 'vencido', plazo, dias: -dias,
      situacion: `El plazo era el ${comoSeLee(plazo)}, ${haceCuanto(-dias)}, y sigue «${fila.estado}».`,
    };
  }
  if (dias <= aviso) {
    return {
      nivel: 'porVencer', plazo, dias,
      situacion: `El plazo se cumple ${enCuanto(dias)}, el ${comoSeLee(plazo)}, y sigue «${fila.estado}».`,
    };
  }
  return null;
}

/**
 * La lista para el panel, acotada a lo que quien pregunta tiene asignado.
 *
 * Primero los vencidos, del más viejo al más nuevo —lo que lleva más tiempo
 * pasado es lo que peor está—, y después los que están por vencer, del más
 * cercano al más lejano.
 */
function losQueEsperanRespuesta(db, usuario, cuando = hoy()) {
  const params = [];
  const suyos = require('./alcance')
    .condiciones(require('./registry').getModule('documentos'), usuario, params);
  const marcas = ABIERTOS.map(() => '?').join(',');

  const filas = db
    .prepare(
      `SELECT id, numero, titulo, estado, plazo, remitente, derivado_a, fecha_registro,
              (SELECT i.nombre FROM iglesias i WHERE i.id = documentos.iglesia_id) AS iglesia
         FROM documentos
        WHERE flujo = 'Recibido'
          AND COALESCE(plazo, '') <> ''
          AND estado IN (${marcas})
          ${suyos ? `AND ${suyos}` : ''}`
    )
    .all(...ABIERTOS, ...params);

  const anticipacion = diasDeAviso();
  const lista = [];
  for (const f of filas) {
    const que = comoVaDePlazo(f, cuando, anticipacion);
    if (que) {
      lista.push({
        id: f.id, numero: f.numero, titulo: f.titulo, estado: f.estado,
        remitente: f.remitente, derivado_a: f.derivado_a, iglesia: f.iglesia, ...que,
      });
    }
  }

  return lista.sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'vencido' ? -1 : 1;
    return a.plazo < b.plazo ? -1 : a.plazo > b.plazo ? 1 : 0;
  });
}

module.exports = {
  losQueEsperanRespuesta, comoVaDePlazo, diasDeAviso,
  ABIERTOS, diasEntre, haceCuanto, enCuanto,
};
