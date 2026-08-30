/**
 * A CUÁNTAS PERSONAS DISTINTAS SE HA AYUDADO.
 *
 * Es la primera frase del módulo de No Miembros —«no había forma de saber a
 * cuántas personas distintas se ha ayudado, ni de ver que a la misma señora se
 * le entregó tres veces»— y era, medido, la pregunta que el sistema no sabía
 * contestar: había cómo contar ENTREGAS, que el listado las trae todas, pero
 * no PERSONAS, que no es lo mismo cuando a una se le entregó tres veces.
 *
 * ── CONTAR PERSONAS NO ES CONTAR ENLACES ─────────────────────────────────
 *
 * Una ayuda apunta a un miembro o a un no miembro, nunca a los dos. Lo obvio
 * sería contar cuántos enlaces distintos hay, y estaría mal: cuando una
 * persona se inscribe, sus entregas de antes siguen colgando de su ficha de
 * No Miembro y las de después cuelgan de su ficha de miembro. Contando enlaces
 * esa señora saldría como dos personas, y la cifra —que es justamente la que
 * se lleva a la directiva o a una fundación— se iría inflando sola, una
 * persona de más por cada una que se convierte.
 *
 * Así que a cada ayuda se le saca la persona, no el enlace:
 *
 *   · si apunta a un miembro          → esa persona
 *   · si apunta a un no miembro que
 *     después se inscribió            → la persona en que se convirtió
 *   · si apunta a un no miembro
 *     que sigue sin inscribirse       → esa persona
 *
 * Es el mismo enlace que sigue la ficha para mostrar su historia completa
 * (ver server/modules/ayudas_sociales.js).
 *
 * ── LAS QUE NO APUNTAN A NADIE ───────────────────────────────────────────
 *
 * Antes de que existiera el registro de No Miembros, el beneficiario era un
 * nombre escrito a mano. Esas ayudas no tienen ficha detrás y NO se cuentan
 * entre las personas: dos veces «Juan Pérez» escrito a mano puede ser el mismo
 * señor o dos distintos, y no hay cómo saberlo. Fingir que se sabe sería peor
 * que decirlo. Van aparte, en su propia cifra, para que quien lea el informe
 * sepa cuánto de lo entregado todavía no tiene a quién.
 */

/**
 * Quién recibió esta ayuda, en una sola expresión, para agrupar por persona.
 *
 * Sin alias en la tabla de ayudas: las condiciones de alcance escriben los
 * nombres de columna a secas (ver server/alcance.js). La subconsulta sí lleva
 * el suyo, porque `no_miembros` también tiene una columna `miembro_id` y sin
 * apellido diría dos cosas distintas según dónde se lea.
 */
const QUIEN = `
  CASE
    WHEN miembro_id IS NOT NULL THEN 'M' || miembro_id
    WHEN no_miembro_id IS NOT NULL THEN
      COALESCE(
        (SELECT 'M' || nm.miembro_id FROM no_miembros nm
          WHERE nm.id = no_miembro_id AND nm.miembro_id IS NOT NULL),
        'N' || no_miembro_id)
    ELSE NULL
  END`;

/*
 * «Salió de una cuenta», escrito una sola vez.
 *
 * El texto es el mismo que guarda la ayuda y vive en server/ayuda-tesoreria.js,
 * no repetido acá: escritos por separado, el día que uno cambie el informe
 * empieza a decir cero sin que nada falle. Va pegado a la consulta porque no
 * lleva comillas dentro; si algún día las llevara, esto tiene que pasar a ser
 * un parámetro.
 */
const { DE_UNA_CUENTA } = require('./ayuda-tesoreria');
const DE_UNA_CUENTA_SQL = `salida = '${DE_UNA_CUENTA}'`;

/** Une el recorte que se está mirando con una condición más. */
function y(whereSql, mas) {
  if (!mas) return whereSql;
  return whereSql ? `${whereSql} AND ${mas}` : `WHERE ${mas}`;
}

/**
 * Las cifras de un período: entregas, plata y personas.
 *
 * «Entregas» y «ayudas» no son lo mismo: una solicitada, aprobada o rechazada
 * todavía no es mercadería que salió. Y las personas se cuentan sobre las
 * ayudas ENTREGADAS, porque la pregunta de afuera es a cuántas se ayudó, no a
 * cuántas se les tramitó algo.
 */
function cifrasDe(db, whereSql, params) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS registradas,
              SUM(CASE WHEN estado = 'Entregada' THEN 1 ELSE 0 END) AS entregas,
              SUM(CASE WHEN estado = 'Entregada' THEN COALESCE(valor_estimado, 0) ELSE 0 END) AS entregado,
              /*
               * De lo entregado, cuánto salió de una cuenta y cuánto no.
               *
               * Sin esta división el informe decía «$123.000 entregados» y el
               * balance de Tesorería decía que no había salido nada, y las dos
               * pantallas eran del mismo sistema. Ahora la de acá se puede
               * cuadrar con la de allá: lo que salió de cuentas es exactamente
               * lo que el libro tiene anotado con categoría «Ayuda social».
               *
               * Lo demás no es un error: una caja de mercadería donada vale lo
               * que vale y no salió de ninguna cuenta. Y las ayudas de antes de
               * que la decisión existiera se cuentan aparte, sin inventarles un
               * lado.
               */
              SUM(CASE WHEN estado = 'Entregada' AND ${DE_UNA_CUENTA_SQL}
                       THEN COALESCE(valor_estimado, 0) ELSE 0 END) AS de_cuentas,
              SUM(CASE WHEN estado = 'Entregada' AND salida IS NOT NULL
                            AND NOT (${DE_UNA_CUENTA_SQL})
                       THEN COALESCE(valor_estimado, 0) ELSE 0 END) AS en_especie,
              SUM(CASE WHEN estado = 'Entregada' AND (salida IS NULL OR salida = '')
                       THEN 1 ELSE 0 END) AS sin_decidir,
              SUM(CASE WHEN estado IN ('Solicitada', 'Aprobada') THEN 1 ELSE 0 END) AS en_camino,
              SUM(CASE WHEN estado = 'Rechazada' THEN 1 ELSE 0 END) AS rechazadas,
              SUM(CASE WHEN miembro_id IS NULL AND no_miembro_id IS NULL THEN 1 ELSE 0 END) AS sin_ficha
         FROM ayudas_sociales ${whereSql}`
    )
    .get(...params);

  // Personas distintas, y de ellas cuántas recibieron más de una vez. Las dos
  // salen de la misma agrupación: contarlas por separado es cómo se llega a
  // que el informe diga «20 personas» y «7 repitieron» de dos universos
  // distintos sin que nadie lo note.
  const dentro = y(whereSql, `estado = 'Entregada' AND (${QUIEN}) IS NOT NULL`);
  const p = db
    .prepare(
      `SELECT COUNT(*) AS personas,
              SUM(CASE WHEN veces > 1 THEN 1 ELSE 0 END) AS repitieron
         FROM (SELECT ${QUIEN} AS quien, COUNT(*) AS veces
                 FROM ayudas_sociales ${dentro}
                GROUP BY 1)`
    )
    .get(...params);

  return {
    registradas: r.registradas || 0,
    entregas: r.entregas || 0,
    entregado: r.entregado || 0,
    de_cuentas: r.de_cuentas || 0,
    en_especie: r.en_especie || 0,
    sin_decidir: r.sin_decidir || 0,
    en_camino: r.en_camino || 0,
    rechazadas: r.rechazadas || 0,
    sin_ficha: r.sin_ficha || 0,
    personas: p.personas || 0,
    repitieron: p.repitieron || 0,
  };
}

/**
 * Abre las mismas cifras por una columna: el tipo de ayuda, la iglesia, el mes.
 *
 * Las personas se cuentan DENTRO de cada fila, así que los totales de la
 * columna no suman el total general: la misma señora a la que se le dio
 * mercadería y medicamentos es una persona en cada fila y una sola en el
 * total. Es correcto y confunde, así que la pantalla lo dice.
 */
function abiertoPor(db, columna, whereSql, params, orden) {
  const dentro = y(whereSql, "estado = 'Entregada'");
  return db
    .prepare(
      `SELECT ${columna} AS clave,
              COUNT(*) AS entregas,
              SUM(COALESCE(valor_estimado, 0)) AS entregado,
              COUNT(DISTINCT ${QUIEN}) AS personas
         FROM ayudas_sociales ${dentro}
        GROUP BY 1
        ORDER BY ${orden || 'entregado DESC'}`
    )
    .all(...params);
}

/**
 * A quiénes se les entregó más veces, que es la otra mitad de lo que el módulo
 * dijo venir a contestar: «ver que a la misma señora se le entregó tres veces».
 *
 * El nombre no sale de la ayuda —ahí está congelado el que tenía el día que se
 * guardó— sino de la ficha, que es la que manda. Se resuelve en un segundo
 * paso y no con un JOIN porque son dos tablas distintas según de dónde salga
 * la persona, y porque el alcance escribe los nombres de columna sin apellido.
 */
function masAyudadas(db, whereSql, params, cuantas = 15) {
  const dentro = y(whereSql, `estado = 'Entregada' AND (${QUIEN}) IS NOT NULL`);
  const filas = db
    .prepare(
      `SELECT ${QUIEN} AS quien, COUNT(*) AS veces,
              SUM(COALESCE(valor_estimado, 0)) AS entregado,
              MAX(fecha) AS ultima
         FROM ayudas_sociales ${dentro}
        GROUP BY 1
        HAVING COUNT(*) > 1
        ORDER BY veces DESC, entregado DESC
        LIMIT ${Number(cuantas) || 15}`
    )
    .all(...params);

  const nombreDe = (tabla, id) => {
    const f = db.prepare(`SELECT nombres, apellidos FROM "${tabla}" WHERE id = ?`).get(id);
    return f ? `${f.nombres || ''} ${f.apellidos || ''}`.trim() : null;
  };
  return filas.map((f) => {
    const esMiembro = String(f.quien).startsWith('M');
    const id = Number(String(f.quien).slice(1));
    return {
      ...f,
      tipo: esMiembro ? 'Miembro' : 'No miembro',
      id,
      nombre: nombreDe(esMiembro ? 'miembros' : 'no_miembros', id) || '(ficha eliminada)',
    };
  });
}

/**
 * Lo del mes en curso, que es lo que mira el panel de control.
 *
 * Vive acá y no suelto en el panel para que se pueda comprobar: escrito dentro
 * de la ruta del panel, la única forma de saber si cuenta el mes bueno era
 * mirar la pantalla, y una cifra del panel que se equivoca de mes no se nota
 * nunca —siempre muestra un número razonable—.
 */
const ESTE_MES = "substr(fecha, 1, 7) = strftime('%Y-%m', date('now','localtime'))";

function delMes(db, whereSql, params) {
  return cifrasDe(db, y(whereSql, ESTE_MES), params);
}

module.exports = { QUIEN, ESTE_MES, cifrasDe, abiertoPor, masAyudadas, delMes };
