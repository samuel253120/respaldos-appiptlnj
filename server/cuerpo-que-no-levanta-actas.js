/**
 * Los cuerpos que dejaron de levantar actas.
 *
 * Medido sobre la base de trabajo, antes de esto:
 *
 *   cuerpos formales ............................ 17
 *   con alguna acta anotada ..................... 2
 *   requisitos que el cumplimiento les mide ..... 6, ninguno de actas
 *   tarjetas del panel que lo nombran ........... 0, de 8
 *
 * O sea: el libro de actas era una bodega. Se guardaba mucho y no lo miraba
 * nadie —ni el estado de cumplimiento del cuerpo ni el panel—, y un cuerpo que
 * llevaba dos años sin levantar una no aparecía en ninguna parte.
 *
 * ── LO QUE ESTO NO ES ──
 *
 * NO es un requisito de cumplimiento, y es una decisión tomada, no un olvido:
 * la corporación resolvió que el libro de actas no debe pesar en si un cuerpo
 * aparece «Al día» o «Pendiente». Levantar actas es una práctica que se cuida,
 * no un papel que se exige, y marcar en rojo a un cuerpo por eso lo pondría al
 * lado de no tener reglamento o cobrar cuota sin monto, que son otra cosa.
 *
 * Así que esto avisa y no reprocha: dice quién dejó de anotar y desde cuándo,
 * para que alguien pregunte. Server/modules/cuerpos.js —donde vive el
 * cumplimiento— no sabe que este archivo existe, y así tiene que quedar.
 *
 * ── DE DÓNDE SALE EL CORTE ──
 *
 * De una sola cifra que pone la organización: cuántas actas al año se esperan
 * de un cuerpo. Doce, o sea una al mes. De ahí sale todo lo demás —cada cuánto
 * se espera una, y cuánto silencio es demasiado— en vez de tener un número
 * suelto escrito acá que nadie sabría de dónde salió.
 *
 * El corte es el DOBLE del intervalo esperado: con una al mes, se avisa a los
 * dos meses de silencio. Generoso a propósito: una reunión que se corrió, un
 * mes de vacaciones o un acta que se está redactando no tienen por qué salir en
 * el panel, y un aviso que salta por nada es un aviso que se deja de leer.
 *
 * ── A QUIÉNES SE LES PREGUNTA ──
 *
 * A los CUERPOS que FUNCIONAN, igual que el aviso de las directivas. Un grupo
 * no lleva libro de actas —«agrupación de servicio o ayuda, sin reglamento ni
 * obligaciones formales», lo dice su propio campo— y a un cuerpo marcado
 * inactivo no se le reprocha nada: dejó de funcionar, que es lo que ese estado
 * significa (ver server/cuerpo-inactivo.js).
 */
const { hoy, comoSeLee } = require('./fechas');

/** Cuántas actas al año se esperan de un cuerpo. Lo fija Configuración. */
const esperadasAlAnio = () => require('./ajustes').numero('actas_esperadas_al_anio', 1, 52);

/** Cada cuántos días se espera una, redondeado. Con doce al año, treinta. */
const cadaCuantosDias = (esperadas) => Math.round(365 / esperadas);

/** Días entre dos fechas ISO, en positivo si la segunda es posterior. */
function diasEntre(desde, hasta) {
  const a = Date.parse(`${desde}T12:00:00Z`);
  const b = Date.parse(`${hasta}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** «hace 5 meses», «hace 40 días»: como lo diría alguien, no en días siempre. */
function haceCuanto(dias) {
  if (dias < 60) return `hace ${dias} días`;
  const meses = Math.round(dias / 30);
  if (meses < 24) return `hace ${meses} meses`;
  return `hace ${Math.floor(meses / 12)} años`;
}

/**
 * Qué le pasa a este cuerpo con su libro, o nulo si va al día.
 *
 * Devuelve además CUÁNTAS lleva en el último año, porque el número solo no
 * alcanza para decidir: no es lo mismo un cuerpo que nunca anotó nada que uno
 * que anotó once y paró en septiembre, y la lista tiene que dejar ver los dos.
 */
function loQueLePasaConSuLibro(ultima, enUnAnio, esperadas, cuando) {
  if (!ultima) {
    return { nivel: 'nunca', ultima: null, enUnAnio: 0,
      situacion: 'No tiene ninguna acta anotada.' };
  }
  const dias = diasEntre(ultima, cuando);
  if (dias === null || dias <= cadaCuantosDias(esperadas) * 2) return null;
  return {
    nivel: 'atrasado', ultima, enUnAnio,
    situacion: `Su última acta es del ${comoSeLee(ultima)}, ${haceCuanto(dias)}. `
      + `Lleva ${enUnAnio} en el último año, de ${esperadas} esperadas.`,
  };
}

/**
 * La lista para el panel, acotada a lo que quien pregunta tiene asignado.
 *
 * Primero los que nunca anotaron nada y después los demás, del silencio más
 * largo al más corto: lo que lleva más tiempo parado es lo que más conviene
 * preguntar, y dentro de cada grupo pesa más lo que alcanza a más gente.
 */
function losQueNoLevantanActas(db, usuario, cuando = hoy()) {
  const { VIGENTES } = require('./integrantes');
  const inactivo = require('./cuerpo-inactivo');
  const params = [];
  const suyos = require('./alcance')
    .condiciones(require('./registry').getModule('cuerpos'), usuario, params);
  const marcas = VIGENTES.map(() => '?').join(',');

  /*
   * `cuerpos` como única tabla del FROM, igual que en los otros dos avisos: el
   * trozo de alcance viene con los nombres de columna a secas —«id IN (…)»— y
   * juntarlo con otra tabla que también tenga un `id` dejaría la consulta
   * ambigua. Lo de las actas y el nombre de la iglesia se traen con
   * subconsultas, que además dejan la cuenta en una sola pasada.
   */
  const desdeHaceUnAnio = new Date(Date.parse(`${cuando}T12:00:00Z`) - 365 * 86400000)
    .toISOString().slice(0, 10);
  const cuerpos = db
    .prepare(
      `SELECT id, nombre, tipo, estado,
              (SELECT i.nombre FROM iglesias i WHERE i.id = cuerpos.iglesia_id) AS iglesia,
              (SELECT COUNT(*) FROM integrantes_cuerpo g
                WHERE g.cuerpo_id = cuerpos.id AND g.estado IN (${marcas})) AS integrantes,
              (SELECT MAX(a.fecha) FROM actas_reuniones a WHERE a.cuerpo_id = cuerpos.id) AS ultima,
              (SELECT COUNT(*) FROM actas_reuniones a
                WHERE a.cuerpo_id = cuerpos.id AND a.fecha >= ?) AS en_un_anio
         FROM cuerpos
        WHERE tipo = 'Cuerpo' ${suyos ? `AND ${suyos}` : ''}`
    )
    .all(...VIGENTES, desdeHaceUnAnio, ...params)
    .filter((c) => inactivo.funciona(c));

  const esperadas = esperadasAlAnio();
  const lista = [];
  for (const c of cuerpos) {
    const que = loQueLePasaConSuLibro(c.ultima, c.en_un_anio, esperadas, cuando);
    if (que) lista.push({ id: c.id, nombre: c.nombre, iglesia: c.iglesia, integrantes: c.integrantes, ...que });
  }

  return lista.sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'nunca' ? -1 : 1;
    if (a.nivel === 'nunca') return (b.integrantes || 0) - (a.integrantes || 0);
    if (a.ultima !== b.ultima) return a.ultima < b.ultima ? -1 : 1;
    return (b.integrantes || 0) - (a.integrantes || 0);
  });
}

module.exports = {
  losQueNoLevantanActas, loQueLePasaConSuLibro,
  esperadasAlAnio, cadaCuantosDias, diasEntre, haceCuanto,
};
