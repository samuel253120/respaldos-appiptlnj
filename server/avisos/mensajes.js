/**
 * Mensajes escritos a mano, de una persona a las que usan el sistema.
 *
 * Todo lo que avisa el sistema hasta acá lo escribe el sistema mirando los
 * datos: una credencial que vence, una solicitud sin responder, alguien que
 * lleva cuatro faltas. Nada de eso sirve para lo que una oficina necesita todas
 * las semanas: «la reunión de mañana se cambió a las 8», «desde el lunes las
 * solicitudes se ingresan por acá», «gracias por el trabajo de la campaña».
 *
 * Eso se hacía por fuera —un grupo de WhatsApp, un papel en la pared— donde no
 * queda constancia de quién dijo qué ni de si llegó. Ahora se manda desde el
 * sistema: llega a la campanita de cada persona y, si lo tiene encendido,
 * también a su teléfono.
 *
 * ── A QUIÉN SE PUEDE ESCRIBIR ──
 *
 * Solo a quien uno YA ALCANZA en Usuarios. No es una comodidad: la llave de
 * enviar mensajes no puede convertirse en una manera de averiguar qué cuentas
 * existen en otra iglesia. Por eso el alcance no se calcula acá con reglas
 * propias, sino que se le pide al mismo `alcance.condiciones` que usa el
 * listado de Usuarios: si un día cambia el alcance, cambia en los dos lugares
 * a la vez y no se pueden separar.
 *
 * ── LO QUE NO HACE ──
 *
 * No manda a los cuerpos. La gente de un cuerpo son MIEMBROS y los miembros no
 * tienen cuenta: mandarle un mensaje a «Damas» alcanzaría a la secretaria y a
 * nadie más, y quien lo mandó creería que le habló a las cuarenta. Cuando haya
 * que avisarle a la congregación, eso es otra cosa y hay que hacerla aparte.
 */
const { db } = require('../db');
const avisos = require('./avisos');

/** Lo que cabe en un mensaje. El título va a la pantalla bloqueada de un teléfono. */
const LARGO = { titulo: 120, cuerpo: 2000 };

/**
 * A cuántas personas se le puede mandar de una vez.
 *
 * No es un límite de la máquina —son unas decenas de cuentas— sino un freno a
 * la equivocación: elegir «todos» creyendo que es un cuerpo y despertar
 * doscientos teléfonos no se puede deshacer.
 */
const TOPE_DE_UN_ENVIO = 500;

db.exec(`
  CREATE TABLE IF NOT EXISTS mensajes_enviados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    cuerpo TEXT NOT NULL,
    urgente INTEGER NOT NULL DEFAULT 0,
    enlace TEXT,
    destino TEXT NOT NULL,
    destino_id INTEGER,
    destino_dice TEXT,
    cuantos INTEGER NOT NULL DEFAULT 0,
    leidos INTEGER NOT NULL DEFAULT 0,
    enviado_por INTEGER,
    iglesia_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS ix_mensajes_enviados_fecha ON mensajes_enviados (id DESC);
  CREATE INDEX IF NOT EXISTS ix_mensajes_enviados_quien ON mensajes_enviados (enviado_por);
`);

/*
 * Esta tabla es de las hechas a mano —no la arma el motor a partir de un módulo
 * declarado— así que las columnas nuevas hay que agregarlas acá: en una base que
 * ya venía andando, «CREATE TABLE IF NOT EXISTS» no toca nada y la columna no
 * aparecería nunca.
 */
for (const [columna, tipo] of [['leidos', 'INTEGER NOT NULL DEFAULT 0']]) {
  const tiene = db.prepare('PRAGMA table_info(mensajes_enviados)').all().some((c) => c.name === columna);
  if (!tiene) db.exec(`ALTER TABLE mensajes_enviados ADD COLUMN ${columna} ${tipo}`);
}

/**
 * Las maneras de elegir a quién.
 *
 * Cada una dice cómo se convierte en una lista de cuentas. El alcance de quien
 * manda se agrega SIEMPRE encima, en `aQuienesAlcanza`: acá solo se acota más.
 */
const DESTINOS = {
  todos: {
    label: 'A todas las personas que alcanzo',
    donde: () => ({ sql: null, params: [] }),
    dice: () => 'A todas las personas que alcanza',
  },
  iglesia: {
    label: 'A toda una iglesia',
    pide: 'iglesias',
    donde: (id) => ({ sql: 'usuarios.iglesia_id = ?', params: [Number(id) || 0] }),
    dice: (id) => {
      const i = db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(Number(id) || 0);
      return `A la iglesia ${i ? i.nombre : `n.º ${id}`}`;
    },
  },
  perfil: {
    label: 'A quienes tienen un perfil de permisos',
    pide: 'perfiles_permisos',
    donde: (id) => ({ sql: 'usuarios.perfil_id = ?', params: [Number(id) || 0] }),
    dice: (id) => {
      const p = db.prepare('SELECT nombre FROM perfiles_permisos WHERE id = ?').get(Number(id) || 0);
      return `A quienes tienen el perfil ${p ? p.nombre : `n.º ${id}`}`;
    },
  },
  personas: {
    label: 'A las personas que yo elija',
    pide: 'usuarios',
    donde: (ids) => {
      const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
      if (!lista.length) return { sql: '1 = 0', params: [] };
      return { sql: `usuarios.id IN (${lista.map(() => '?').join(',')})`, params: lista };
    },
    dice: (ids) => {
      const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
      return lista.length === 1 ? 'A una persona' : `A ${lista.length} personas elegidas`;
    },
  },
};

/**
 * Las cuentas que esta persona alcanza, ya acotadas por el destino elegido.
 *
 * Se pide el alcance al mismo lugar que el listado de Usuarios y se le suma lo
 * del destino. Quien manda queda FUERA: mandarse un mensaje a uno mismo no le
 * dice nada a nadie, y al elegir «todos» sería siempre un aviso de más.
 */
function aQuienesAlcanza(quienManda, destino, valor) {
  const def = DESTINOS[destino];
  if (!def) return [];

  const alcance = require('../alcance');

  const params = [];
  const donde = ['usuarios.activo = 1', 'usuarios.id != ?'];
  params.push(quienManda.id);

  /*
   * El MISMO alcance del listado de Usuarios, pedido al lugar que lo escribe:
   * la llave de enviar mensajes no puede ampliar a quién se ve.
   *
   * La tabla va SIN ALIAS a propósito. Esas condiciones nombran sus columnas
   * como «usuarios.id» —no como columnas sueltas, que es lo que hacen las de
   * los demás módulos— así que ponerle un alias las deja apuntando a una tabla
   * que no existe. Costó un 500 en la prueba de aislamiento averiguarlo, y está
   * escrito también en server/alcance.js, arriba de `condicionesDeUsuarios`.
   */
  const suyo = alcance.condicionesDeUsuarios(quienManda, params);
  if (suyo) donde.push(`(${suyo})`);

  const acotado = def.donde(valor);
  if (acotado.sql) {
    donde.push(acotado.sql);
    params.push(...acotado.params);
  }

  return db
    .prepare(
      `SELECT usuarios.id, usuarios.nombre, usuarios.rol, usuarios.iglesia_id
         FROM usuarios WHERE ${donde.join(' AND ')} ORDER BY usuarios.nombre`
    )
    .all(...params);
}

/** Lo que la pantalla necesita para ofrecer los destinos. */
function aQuienPuedeEscribir(quienManda) {
  const alcanzables = aQuienesAlcanza(quienManda, 'todos');
  const suyos = new Set(alcanzables.map((u) => u.iglesia_id).filter(Boolean));
  const perfilesUsados = new Set(
    db.prepare('SELECT DISTINCT perfil_id FROM usuarios WHERE perfil_id IS NOT NULL').all()
      .map((r) => r.perfil_id)
  );

  const iglesias = suyos.size
    ? db.prepare(`SELECT id, nombre FROM iglesias WHERE id IN (${[...suyos].map(() => '?').join(',')}) ORDER BY nombre`)
      .all(...suyos)
    : [];

  let perfiles = [];
  try {
    perfiles = db.prepare('SELECT id, nombre FROM perfiles_permisos ORDER BY nombre').all()
      .filter((p) => perfilesUsados.has(p.id));
  } catch (e) {
    perfiles = []; // sin la tabla todavía, ese destino simplemente no se ofrece
  }

  return {
    destinos: Object.entries(DESTINOS).map(([clave, d]) => ({ clave, label: d.label, pide: d.pide || null })),
    // Cuántos alcanza en total, para que el «a todos» diga a cuántos de verdad
    cuantosEnTotal: alcanzables.length,
    iglesias,
    perfiles,
    personas: alcanzables.map((u) => ({ id: u.id, nombre: u.nombre, iglesia_id: u.iglesia_id })),
    largo: LARGO,
    tope: TOPE_DE_UN_ENVIO,
  };
}

/** El enlace de un mensaje, si es que trae uno usable. */
function enlaceLimpio(enlace) {
  const t = String(enlace || '').trim();
  if (!t) return null;
  /*
   * Solo pantallas de este sistema.
   *
   * Un aviso puede terminar en la pantalla bloqueada de un teléfono y se toca
   * sin pensarlo. Dejar escribir cualquier dirección convertiría los mensajes
   * en una manera cómoda de mandar a la gente a donde sea, con la cara del
   * sistema puesta. Adentro no hay a dónde llevar a nadie que no pueda ver.
   */
  return /^#\/[A-Za-z0-9\-_/?=&.,%:]*$/.test(t) ? t : null;
}

/** Lo que está mal escrito, o null si el mensaje se puede mandar. */
function loQueFalta({ titulo, cuerpo, destino, valor }) {
  if (!String(titulo || '').trim()) return 'El mensaje necesita un título: es lo que se lee en la campanita.';
  if (String(titulo).trim().length > LARGO.titulo) {
    return `El título no puede pasar de ${LARGO.titulo} caracteres: es lo que cabe en la pantalla de un teléfono.`;
  }
  if (!String(cuerpo || '').trim()) return 'El mensaje está en blanco.';
  if (String(cuerpo).trim().length > LARGO.cuerpo) {
    return `El mensaje no puede pasar de ${LARGO.cuerpo} caracteres. Para algo más largo, mándelo con un enlace.`;
  }
  if (!DESTINOS[destino]) return 'Hay que decir a quién va el mensaje.';
  if (DESTINOS[destino].pide && !valor) return 'Falta elegir a quién va el mensaje.';
  return null;
}

/**
 * Manda el mensaje. Devuelve a cuántos llegó, o un texto si no se pudo.
 *
 * El envío entero va en una transacción: o quedan todos los avisos y la
 * constancia, o no queda nada. A medias sería lo peor de los dos mundos —parte
 * de la gente enterada y el registro diciendo otra cosa—.
 */
function enviar(quienManda, { titulo, cuerpo, urgente, enlace, destino, valor }) {
  const problema = loQueFalta({ titulo, cuerpo, destino, valor });
  if (problema) return { error: problema };

  const gente = aQuienesAlcanza(quienManda, destino, valor);
  if (!gente.length) {
    return { error: 'No hay ninguna cuenta activa que reciba este mensaje. Revise a quién lo está mandando.' };
  }
  if (gente.length > TOPE_DE_UN_ENVIO) {
    return { error: `Son ${gente.length} personas y de una vez se puede mandar a ${TOPE_DE_UN_ENVIO}. Acote a quién va.` };
  }

  const elTitulo = String(titulo).trim();
  const elCuerpo = String(cuerpo).trim();
  const elEnlace = enlaceLimpio(enlace);
  const interrumpe = !!urgente;

  const escribir = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO mensajes_enviados (titulo, cuerpo, urgente, enlace, destino, destino_id, destino_dice,
                                        cuantos, enviado_por, iglesia_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        elTitulo, elCuerpo, interrumpe ? 1 : 0, elEnlace, destino,
        destino === 'personas' ? null : Number(valor) || null,
        DESTINOS[destino].dice(valor),
        quienManda.id, quienManda.iglesia_id || null
      );
    const mensajeId = info.lastInsertRowid;

    /*
     * La clave ata cada aviso a SU mensaje, y para eso hace falta el número:
     * con una clave suelta, dos mensajes distintos del mismo día se pisarían
     * —el segundo no se crearía mientras el primero siguiera sin leer— y
     * después no habría cómo contar quiénes leyeron cuál.
     */
    let llegaron = 0;
    for (const quien of gente) {
      const dejado = avisos.avisar({
        usuario_id: quien.id,
        tipo: 'mensaje',
        clave: `mensaje:${mensajeId}`,
        titulo: elTitulo,
        cuerpo: elCuerpo,
        enlace: elEnlace,
        iglesia_id: quien.iglesia_id || null,
        urgente: interrumpe,
      });
      if (dejado) llegaron++;
    }

    db.prepare('UPDATE mensajes_enviados SET cuantos = ? WHERE id = ?').run(llegaron, mensajeId);
    return { id: mensajeId, cuantos: llegaron };
  });

  const salida = escribir.immediate();

  /*
   * Y queda en el Registro de Cambios, como todo lo que alguien hace y otro
   * puede tener que revisar después.
   *
   * El `display` no es un adorno: la bitácora arma con él el nombre de lo que
   * se tocó, y sin declararlo reventaba adentro —y el `catch` de más abajo se
   * comía el error—. El envío salía igual y la constancia no quedaba en
   * ninguna parte. La prueba de acá al lado es la que lo destapó.
   */
  try {
    require('../bitacora').anotarCambio({
      def: { name: 'mensajes', label: 'Mensajes', display: '{titulo}' },
      accion: 'Envío',
      fila: { id: salida.id, titulo: elTitulo, iglesia_id: quienManda.iglesia_id || null },
      detalle: `«${elTitulo}» · ${DESTINOS[destino].dice(valor)} · ${salida.cuantos} persona(s)`
        + (interrumpe ? ' · urgente' : ''),
      usuario: quienManda,
    });
  } catch (e) {
    // El mensaje ya salió: que falle la anotación no puede deshacerlo
  }

  return salida;
}

/**
 * Alguien abrió su aviso: queda anotado en el mensaje.
 *
 * ── POR QUÉ SE GUARDA Y NO SE CUENTA ──
 *
 * El conteo salía de mirar los avisos que seguían en la campanita de cada
 * persona. Y los avisos leídos se borran solos: el vigía lo hace todos los días
 * con el plazo de Configuración, noventa días de fábrica. Así que la constancia
 * se deshacía sola, y no quedaba a medias ni decía «ya no se puede saber»:
 * «40 de 40 leídos» pasaba a decir «0 de 40».
 *
 * Es peor que perder el dato, porque afirma lo contrario. Quien revisara en
 * marzo qué pasó con el aviso de diciembre iba a leer que no lo abrió nadie.
 *
 * Por eso el número se guarda en el momento de leerlo, como ya se guardaba a
 * cuántos llegó, y sobrevive al borrado de los avisos.
 *
 * Lo llama `avisos.marcarLeida` y `avisos.marcarTodasLeidas`, que son las dos
 * únicas puertas por donde un aviso pasa a leído. Solo suma cuando el aviso
 * cambió de verdad de no leído a leído: volver a marcar el mismo no cuenta dos
 * veces.
 */
function anotarLectura(claves) {
  const mios = (Array.isArray(claves) ? claves : [claves])
    .map((c) => /^mensaje:(\d+)$/.exec(String(c || '')))
    .filter(Boolean)
    .map((coincide) => Number(coincide[1]));
  if (!mios.length) return 0;

  const subir = db.prepare('UPDATE mensajes_enviados SET leidos = leidos + 1 WHERE id = ?');
  let anotadas = 0;
  for (const id of mios) anotadas += subir.run(id).changes;
  return anotadas;
}

/**
 * Lo que se ha mandado, con cuántos lo leyeron.
 *
 * El conteo de leídos es la contraparte de que la campanita no se pueda
 * apagar: si el aviso llega sí o sí, quien lo mandó tiene derecho a saber
 * cuántos lo abrieron. No dice QUIÉNES: eso sería vigilar a la gente por dentro
 * del sistema, y para saber si alguien se enteró está preguntarle. El número
 * viene guardado —ver `anotarLectura`, acá arriba—, no de contar avisos que se
 * borran solos a los noventa días.
 *
 * ── DE QUIÉN ES CADA MENSAJE ──
 *
 * Se ve lo que mandó la gente que uno ve. Es exactamente el mismo alcance con
 * el que se decide a quién se le puede escribir, y por la misma razón: la llave
 * de enviar mensajes no puede convertirse en una manera de leer la
 * correspondencia de otra iglesia. Uno siempre se ve a sí mismo, así que lo
 * propio nunca se esconde, y quien administra toda la organización lo sigue
 * viendo todo.
 *
 * Esta lista NO estaba acotada, y esa es la primera versión del módulo: traía
 * los últimos treinta envíos del sistema entero, con su texto completo. La
 * administradora de una iglesia leía lo que la de la otra le había escrito a su
 * gente. El módulo entero se escribió alrededor de que eso no pasara —a quién
 * se le puede escribir se le pregunta al listado de Usuarios— y la puerta quedó
 * abierta justo en la otra dirección: no en escribir, en leer. La prueba de
 * aislamiento tampoco lo miraba; ahora sí.
 */
function loQueSeHaMandado(quienManda, cuantos = 30) {
  const alcance = require('../alcance');
  const params = [];
  /*
   * La tabla de la subconsulta va SIN ALIAS: estas condiciones nombran sus
   * columnas como «usuarios.id» y con un alias apuntarían a una tabla que no
   * existe. Está explicado en server/alcance.js, arriba de
   * `condicionesDeUsuarios`, y también en `aQuienesAlcanza`, más arriba.
   */
  const suyo = alcance.condicionesDeUsuarios(quienManda, params);
  const donde = suyo
    ? `WHERE m.enviado_por IN (SELECT usuarios.id FROM usuarios WHERE ${suyo})`
    : '';
  params.push(Math.min(Number(cuantos) || 30, 200));

  const filas = db
    .prepare(
      `SELECT m.*, u.nombre AS quien
         FROM mensajes_enviados m LEFT JOIN usuarios u ON u.id = m.enviado_por
        ${donde}
        ORDER BY m.id DESC LIMIT ?`
    )
    .all(...params);

  return filas.map((m) => ({
    id: m.id,
    titulo: m.titulo,
    cuerpo: m.cuerpo,
    urgente: !!m.urgente,
    enlace: m.enlace,
    destino_dice: m.destino_dice,
    cuantos: m.cuantos,
    leidos: m.leidos,
    quien: m.quien,
    created_at: m.created_at,
  }));
}

module.exports = {
  DESTINOS, LARGO, TOPE_DE_UN_ENVIO,
  aQuienPuedeEscribir, aQuienesAlcanza, enviar, loQueSeHaMandado, loQueFalta, enlaceLimpio,
  anotarLectura,
};
