/**
 * Los miembros líderes forman la directiva de su iglesia.
 *
 * Es una regla de la organización, no una lista que alguien mantenga a mano:
 * quien está en la categoría «Miembro Líder» ES parte del cuerpo de la
 * directiva de su iglesia, y quien deja esa categoría deja de serlo. Llevarlo
 * a mano significaba acordarse dos veces por cada cambio —una en la ficha de
 * la persona y otra en la del cuerpo— y bastaba olvidar una para que la lista
 * de la directiva dejara de decir la verdad.
 *
 * CUÁL ES EL CUERPO DE LA DIRECTIVA. No se adivina por el nombre cada vez: se
 * marca una vez en la ficha del cuerpo, con la casilla «Reúne a los miembros
 * líderes de su iglesia». Buscar por nombre parecía más simple, pero se rompe
 * el día que alguien lo escribe «Directiva General», o crea «Directiva de
 * Damas», o le cambia el nombre: la regla dejaría de correr sin avisar. Con la
 * marca, el cuerpo dice de sí mismo lo que es. A las iglesias que ya tenían su
 * cuerpo de directiva se la pone sola la migración (ver server/migraciones.js),
 * así que no hay nada que configurar.
 *
 * QUIÉN CUENTA. Los de categoría «Miembro Líder» que además siguen estando: a
 * quien figura como fallecido o trasladado se le retira igual, porque la
 * directiva es de quienes la componen hoy. Es la misma regla con que el panel
 * decide a quién saludar por su cumpleaños (ver server/cumpleanos.js).
 *
 * QUÉ SE ESCRIBE. Una ficha de integrante como cualquier otra —con su fecha de
 * ingreso y su estado— para que la persona aparezca en las listas de
 * asistencia, en las cuotas y en todo lo demás sin ninguna excepción. Al salir
 * NO se borra: se marca «Retirado» con su motivo y su fecha, que es como el
 * sistema conserva el recorrido de cada persona. Y las dos cosas quedan
 * anotadas en su bitácora, diciendo que fueron automáticas.
 *
 * A QUIÉN SACA, Y A QUIÉN NO. A los líderes, y a nadie más. Un cuerpo de
 * directiva tiene también gente puesta a mano que NO es líder —el secretario,
 * la tesorera, alguien que la iglesia decidió que estuviera— y esa gente no
 * está ahí por su categoría: está porque alguien la puso. La regla no manda
 * sobre ellos y no les toca la ficha nunca.
 *
 * A quien sí es líder, en cambio, la regla lo maneja aunque lo hubieran
 * anotado a mano: le adopta la ficha la primera vez que pasa por ahí. Si no,
 * quedaría a medias justo en las iglesias que ya tenían su directiva armada
 * desde antes —a quien dejara de ser líder no lo sacaría nadie: ni la regla,
 * porque no lo metió ella, ni la persona, porque cree que el sistema lo hace—.
 *
 * La primera versión de esta regla no hacía esa distinción: trataba la
 * directiva como EXACTAMENTE el conjunto de los miembros líderes, así que al
 * guardar la ficha de cualquier integrante que no lo fuera, lo retiraba. Y lo
 * hacía en silencio, de a uno, a medida que se iban guardando fichas por otros
 * motivos: un cuerpo de veintisiete quedó en tres sin que nada lo dijera. Por
 * eso las fichas que pone la regla van marcadas («automatico»), y las que no
 * llevan esa marca no se tocan nunca.
 */
const bitacora = require('./bitacora');
const { fichaDeIntegrante } = require('./integrantes');

/** La categoría que da entrada a la directiva. */
const CATEGORIA_LIDER = 'Miembro Líder';

/** Estados en los que una persona ya no compone la directiva. */
const YA_NO_ESTA = ['Fallecido', 'Trasladado'];

/** El motivo con que se retira a quien deja de ser líder. */
const MOTIVO_SALIDA = 'Dejó de ser Miembro Líder';

const hoy = () => new Date().toISOString().slice(0, 10);

/** ¿Esta ficha compone hoy la directiva de su iglesia? */
function componeLaDirectiva(miembro) {
  if (!miembro || !miembro.iglesia_id) return false;
  if (miembro.tipo_miembro !== CATEGORIA_LIDER) return false;
  return !YA_NO_ESTA.includes(miembro.estado);
}

/** Los cuerpos marcados como directiva en una iglesia (normalmente uno). */
function cuerposDeDirectiva(db, iglesiaId) {
  if (!iglesiaId) return [];
  try {
    return db
      .prepare("SELECT id, nombre, iglesia_id FROM cuerpos WHERE reune_lideres = 1 AND iglesia_id = ?")
      .all(iglesiaId);
  } catch (e) {
    return []; // la columna se crea al arrancar; si aún no está, no hay regla que correr
  }
}

/**
 * Mete a alguien en un cuerpo, o lo devuelve si estaba retirado.
 *
 * Devolver la ficha vieja en vez de crear otra no es un ahorro: el propio
 * módulo prohíbe dos fichas de la misma persona en el mismo cuerpo, y además
 * así el historial de esa persona en ese cuerpo queda en un solo lugar, con su
 * primera fecha de ingreso intacta.
 */
function entra(db, cuerpo, miembroId, usuario) {
  const ficha = fichaDeIntegrante(db, cuerpo.id, miembroId);
  if (ficha && ficha.estado !== 'Retirado') {
    /**
     * Ya estaba: nadie se mueve. Pero si lo habían puesto a mano, la regla
     * ADOPTA su ficha, porque esta persona SÍ es líder y la regla manda sobre
     * los líderes. Sin esto la regla quedaría a medias justo donde más se
     * espera que ande: en las iglesias que ya tenían su directiva armada, a
     * quien dejara de ser líder no lo sacaría nadie —ni la regla, porque no lo
     * metió ella, ni la persona, porque cree que el sistema lo hace—.
     *
     * Adoptar solo alcanza a quien es líder hoy. Al que no lo es no se le
     * toca la ficha nunca, que es lo que hay que cuidar acá.
     */
    if (!ficha.automatico) {
      db.prepare("UPDATE integrantes_cuerpo SET automatico = 1 WHERE id = ?").run(ficha.id);
    }
    return false;
  }

  if (ficha) {
    /**
     * Se le devuelve la marca de automática solo si ya la tenía.
     *
     * Una ficha puesta a mano que en algún momento se retiró —la persona se
     * fue del cuerpo y alguien lo anotó— y que ahora vuelve por ser líder,
     * vuelve COMO AUTOMÁTICA: entró por la regla, así que la regla puede
     * sacarla. Pero una que sigue vigente no se toca, y ese es el caso que
     * importa: la gente que la iglesia puso a mano se queda como está.
     */
    db.prepare(
      `UPDATE integrantes_cuerpo
          SET estado = 'Activo', fecha_retiro = NULL, motivo_retiro = NULL, automatico = 1,
              updated_at = datetime('now','localtime')
        WHERE id = ?`
    ).run(ficha.id);
  } else {
    db.prepare(
      `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado, fecha_ingreso, fecha_oficial, iglesia_id, automatico)
       VALUES (?, ?, 'Activo', ?, ?, ?, 1)`
    ).run(cuerpo.id, miembroId, hoy(), hoy(), cuerpo.iglesia_id);
  }

  bitacora.anotar({
    miembroId, tipo: 'Ingreso a cuerpo', iglesiaId: cuerpo.iglesia_id, usuario,
    descripcion: `Entra a "${cuerpo.nombre}" por pasar a ${CATEGORIA_LIDER}.`,
  });
  return true;
}

/**
 * Retira de un cuerpo a alguien que la regla había metido, conservando su
 * ficha. A quien lo pusieron a mano no se le toca: ver el encabezado.
 */
function sale(db, cuerpo, miembroId, usuario, motivo) {
  const ficha = fichaDeIntegrante(db, cuerpo.id, miembroId);
  if (!ficha || ficha.estado === 'Retirado') return false; // ya no estaba
  if (!ficha.automatico) return false;                     // lo puso una persona

  db.prepare(
    `UPDATE integrantes_cuerpo
        SET estado = 'Retirado', fecha_retiro = ?, motivo_retiro = ?,
            updated_at = datetime('now','localtime')
      WHERE id = ?`
  ).run(hoy(), motivo, ficha.id);

  bitacora.anotar({
    miembroId, tipo: 'Salida de cuerpo', iglesiaId: cuerpo.iglesia_id, usuario,
    descripcion: `Sale de "${cuerpo.nombre}" (${motivo}).`,
  });
  return true;
}

/**
 * La regla, corrida para una persona: entra donde corresponde y sale de donde
 * ya no.
 *
 * Se mira TODA la directiva y no solo la de su iglesia de hoy: alguien que se
 * cambió de congregación tiene que salir de la directiva de la que dejó y
 * entrar a la de la que llegó, y las dos cosas pasan en el mismo guardado.
 */
function alGuardarUnMiembro(db, miembro, usuario) {
  if (!miembro || !miembro.id) return { entro: [], salio: [] };
  const entro = [];
  const salio = [];

  const suyos = componeLaDirectiva(miembro) ? cuerposDeDirectiva(db, miembro.iglesia_id) : [];
  const suyosIds = new Set(suyos.map((c) => c.id));
  for (const cuerpo of suyos) if (entra(db, cuerpo, miembro.id, usuario)) entro.push(cuerpo.nombre);

  // Y de cualquier otra directiva donde figure, se retira
  let todas = [];
  try {
    todas = db.prepare('SELECT id, nombre, iglesia_id FROM cuerpos WHERE reune_lideres = 1').all();
  } catch (e) {
    todas = [];
  }
  for (const cuerpo of todas) {
    if (suyosIds.has(cuerpo.id)) continue;
    const motivo = miembro.iglesia_id && Number(cuerpo.iglesia_id) !== Number(miembro.iglesia_id)
      ? 'Cambió de iglesia'
      : YA_NO_ESTA.includes(miembro.estado)
        ? `Figura como ${String(miembro.estado).toLowerCase()}`
        : MOTIVO_SALIDA;
    if (sale(db, cuerpo, miembro.id, usuario, motivo)) salio.push(cuerpo.nombre);
  }
  return { entro, salio };
}

/**
 * La regla, corrida para un cuerpo entero.
 *
 * Se usa cuando a un cuerpo se le marca la casilla: desde ese momento reúne a
 * los líderes de su iglesia, y los que ya lo eran tienen que entrar sin que
 * nadie los agregue uno por uno. Devuelve a cuántos alcanzó.
 */
function alMarcarUnCuerpo(db, cuerpo, usuario) {
  if (!cuerpo || !cuerpo.id || !cuerpo.iglesia_id) return 0;
  const lideres = db
    .prepare(
      `SELECT id FROM miembros
        WHERE iglesia_id = ? AND tipo_miembro = ?
          AND (estado IS NULL OR estado NOT IN (${YA_NO_ESTA.map(() => '?').join(',')}))`
    )
    .all(cuerpo.iglesia_id, CATEGORIA_LIDER, ...YA_NO_ESTA);
  let cuantos = 0;
  for (const l of lideres) if (entra(db, cuerpo, l.id, usuario)) cuantos++;
  return cuantos;
}

module.exports = {
  CATEGORIA_LIDER, MOTIVO_SALIDA, YA_NO_ESTA,
  componeLaDirectiva, cuerposDeDirectiva, alGuardarUnMiembro, alMarcarUnCuerpo,
};
