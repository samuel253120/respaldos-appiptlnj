/**
 * Los próximos cumpleaños de la congregación.
 *
 * Vive en su propio archivo, y no dentro del panel, porque el cálculo tiene
 * más filo del que parece: hay que dar vuelta el año en diciembre, hay que
 * decidir qué día cumple quien nació un 29 de febrero, y hay que desempatar
 * por nombre cuando varias personas cumplen el mismo día. Acá se puede probar
 * pieza por pieza (ver pruebas/motor/cumpleanos.test.js).
 */
const { db } = require('./db');
const alcance = require('./alcance');

/**
 * Los miembros que cumplen años más pronto, ordenados por lo que falta.
 *
 * Se mira solo el mes y el día: el año que viene o este, según corresponda.
 * Quien cumple hoy encabeza la lista. No se incluye a los fallecidos ni a los
 * trasladados, porque ya no son parte de la congregación.
 *
 * `desdeCuando` existe solo para las pruebas: deja pararse en un día
 * cualquiera —un 31 de diciembre, un 28 de febrero de año común— y ver qué
 * contesta. En el sistema nunca se le pasa: se usa el día de hoy.
 */
function proximosCumpleanos(iglesias, cuerpos, cuantos, desdeCuando) {
  const where = ["fecha_nacimiento IS NOT NULL", "fecha_nacimiento != ''", "(estado IS NULL OR estado NOT IN ('Fallecido', 'Trasladado'))"];
  const params = [];
  if (iglesias.length) {
    where.push(`iglesia_id IN (${iglesias.map(() => '?').join(',')})`);
    params.push(...iglesias);
  }
  if (cuerpos.length) {
    const ids = alcance.miembrosDeCuerpos(cuerpos);
    where.push(ids.length ? `id IN (${ids.map(() => '?').join(',')})` : '1 = 0');
    params.push(...ids);
  }
  const hoy = desdeCuando ? new Date(desdeCuando) : new Date();
  hoy.setHours(0, 0, 0, 0);
  const MS_DIA = 24 * 60 * 60 * 1000;
  const cuantosSalen = Math.max(1, Math.min(20, cuantos || 4));

  /**
   * De todas las fichas, solo las que pueden llegar a la lista.
   *
   * Antes se traían TODAS las fichas con fecha de nacimiento, se le armaba una
   * fecha a cada una en JavaScript, se ordenaban las seis mil y se mostraban
   * cinco. Costaba 32 ms de reloj —16 en traerlas y 16 en calcular— y, como
   * SQLite es sincrónico, esos 32 ms se los comía entero el servidor: nadie
   * más avanzaba mientras tanto.
   *
   * Ahora la fecha del próximo cumpleaños la calcula la base, que ya tiene los
   * datos en la mano, y devuelve solo las candidatas. El cálculo fino y el
   * orden definitivo siguen haciéndose acá abajo, igual que siempre: la base
   * solo acota, no decide.
   */
  const anioHoy = hoy.getFullYear();
  const comoTexto = (f) =>
    `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  const hoyTexto = comoTexto(hoy);
  // El 29 de febrero no existe en un año común: `date()` devuelve NULL y ahí
  // se celebra el 28, que es exactamente lo que hace el cálculo de más abajo.
  const enElAnio = (anio) =>
    `COALESCE(date('${anio}' || substr(fecha_nacimiento, 5, 6)),` +
    ` CASE WHEN substr(fecha_nacimiento, 6, 5) = '02-29' THEN '${anio}-02-28' END)`;
  const proximoSql =
    `CASE WHEN ${enElAnio(anioHoy)} >= '${hoyTexto}'` +
    ` THEN ${enElAnio(anioHoy)} ELSE ${enElAnio(anioHoy + 1)} END`;
  // Una fecha tan estropeada que la base no puede leerla queda fuera. No es un
  // caso que pueda darse: tanto al guardar una ficha como al importar una
  // planilla, `server/fechas.js` rechaza cualquier fecha que no exista —el 30
  // de febrero, el mes 13—, así que para llegar acá habría que haberla escrito
  // por debajo, en la base. El cálculo anterior, ante una así, anunciaba el
  // cumpleaños un 31 de diciembre que no era el de nadie.
  const candidatas = `SELECT id, nombres, apellidos, foto, fecha_nacimiento, telefono,
                             ${proximoSql} AS proximo
                        FROM miembros WHERE ${where.join(' AND ')}`;

  /**
   * Hasta qué fecha hay que mirar.
   *
   * No basta con pedirle a la base las primeras cinco: si seis personas cumplen
   * el mismo día, cuál de ellas sale lo decide el orden por nombre de más
   * abajo, no la base. Por eso se pregunta qué fecha ocupa el último lugar y
   * se traen TODAS las de ese día, completas.
   */
  const corte = db
    .prepare(`WITH c AS (${candidatas})
              SELECT proximo FROM c WHERE proximo IS NOT NULL
               ORDER BY proximo LIMIT 1 OFFSET ${cuantosSalen - 1}`)
    .get(...params);

  const filas = db
    .prepare(`WITH c AS (${candidatas})
              SELECT * FROM c
               WHERE proximo IS NOT NULL ${corte ? 'AND proximo <= ?' : ''}
               ORDER BY proximo`)
    .all(...params, ...(corte ? [corte.proximo] : []));

  const conFecha = [];
  for (const m of filas) {
    const partes = String(m.fecha_nacimiento).slice(0, 10).split('-');
    const mes = Number(partes[1]);
    const dia = Number(partes[2]);
    const anioNace = Number(partes[0]);
    if (!mes || !dia || !anioNace) continue;

    // El próximo cumpleaños: este año si aún no pasa, si no el siguiente.
    // El 29 de febrero se celebra el 28 en los años que no son bisiestos.
    const armar = (anio) => {
      const f = new Date(anio, mes - 1, dia);
      if (f.getMonth() !== mes - 1) f.setDate(0); // 29-feb en año común → 28-feb
      f.setHours(0, 0, 0, 0);
      return f;
    };
    let proximo = armar(hoy.getFullYear());
    if (proximo < hoy) proximo = armar(hoy.getFullYear() + 1);

    conFecha.push({
      id: m.id,
      nombre: require('./nombres').paraMostrar(m.nombres, m.apellidos),
      foto: m.foto || null,
      telefono: m.telefono || null,
      fecha: `${proximo.getFullYear()}-${String(proximo.getMonth() + 1).padStart(2, '0')}-${String(proximo.getDate()).padStart(2, '0')}`,
      dia,
      mes,
      dias: Math.round((proximo - hoy) / MS_DIA),
      cumple: proximo.getFullYear() - anioNace, // los años que cumplirá
    });
  }

  conFecha.sort((a, b) => a.dias - b.dias || a.nombre.localeCompare(b.nombre));
  return conFecha.slice(0, cuantosSalen);
}

module.exports = { proximosCumpleanos };
