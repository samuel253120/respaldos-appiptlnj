/**
 * El vigía: lo que hay que avisar todos los días.
 *
 * Los avisos urgentes los genera el sistema en el momento en que pasa la cosa
 * —se le traslada una solicitud y le llega—. Pero hay otros que no ocurren:
 * simplemente llega un día en que ya son verdad. Una credencial no «vence» un
 * martes a las tres; lo que pasa es que amaneció y le quedan cincuenta y nueve
 * días. Para esos está esto.
 *
 * Se asoma cada media hora, igual que el respaldo automático, y hace su pasada
 * UNA vez al día a partir de la hora que diga Configuración. Se guarda qué día
 * la hizo: si el servidor se reinicia tres veces en la mañana, la pasada sigue
 * siendo una sola.
 *
 * Cada persona recibe lo suyo y solo lo suyo: las credenciales de las iglesias
 * que tiene asignadas, los cumpleaños de su gente, las solicitudes que están a
 * su cargo. El alcance se pide a las mismas piezas que usa cada pantalla, no
 * se escribe de nuevo acá.
 *
 * AL FINAL, UN SOLO EMPUJÓN. Lo de rutina no interrumpe uno por uno: si a
 * alguien le tocaron seis avisos, le llega uno que dice que tiene seis. Seis
 * campanazos en el teléfono a las ocho de la mañana es la forma más rápida de
 * que alguien apague los avisos para siempre.
 */
const { db } = require('../db');
const ajustes = require('../ajustes');
const avisos = require('./avisos');

/**
 * Cada cuánto se asoma, en milisegundos. Se lee en cada vuelta y no una sola
 * vez al arrancar: si no, cambiarlo en la configuración no serviría de nada
 * hasta el próximo reinicio, y la pantalla diría una cosa mientras el sistema
 * hace otra.
 */
const cadaCuantoMira = () => ajustes.numero('avisos_revisar_minutos', 5, 180) * 60 * 1000;
const CLAVE_ULTIMA = 'avisos_ultimo_dia';

/** El día de hoy como 2026-08-24, en la hora de acá. */
function hoy(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

const leer = (clave) => {
  const f = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  return f ? f.valor : null;
};
const anotar = (clave, valor) =>
  db.prepare(
    `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now','localtime')`
  ).run(clave, valor);

/** Los usuarios que pueden recibir avisos. */
const losQueEntran = () =>
  db.prepare('SELECT id, nombre, rol, activo, avisos, iglesias, cuerpos, iglesia_id FROM usuarios WHERE activo = 1').all();

// ----------------------------------------------------------- cada revisión --

/** Credenciales por vencer, las de las iglesias que esa persona alcanza. */
function credencialesPorVencer(usuario, dejar) {
  const { getModule } = require('../registry');
  const { can } = require('../permissions');
  if (!can(usuario, 'credenciales', 'view')) return;
  let porVencer = [];
  try {
    porVencer = getModule('credenciales').porVencer(usuario) || [];
  } catch (e) {
    return;
  }
  for (const c of porVencer) {
    const vencida = Number(c.dias) < 0;
    dejar({
      tipo: 'credencial_por_vencer',
      clave: `credencial_vence:${c.id}`,
      titulo: vencida ? `Credencial ${c.serie} vencida` : `Credencial ${c.serie} por vencer`,
      cuerpo: vencida
        ? `Venció hace ${Math.abs(c.dias)} día(s). Emita la nueva.`
        : `Le quedan ${c.dias} día(s).`,
      enlace: `#/m/credenciales/ficha/${c.id}`,
    });
  }
}

/**
 * Solicitudes a su cargo que ya debían estar contestadas.
 *
 * DOS PLAZOS, Y EL COMPROMETIDO MANDA. Si la solicitud dice para cuándo se
 * prometió respuesta, el aviso sale cuando esa fecha pasa: es la que se le dio
 * a quien pidió, y es la única que esa persona está esperando. Si no dice
 * nada, vale el número de días de Configuración, igual para todas.
 *
 * Antes solo existía el segundo, así que una ayuda de urgencia comprometida
 * para el jueves y un trámite que puede esperar un mes avisaban el mismo día.
 */
function solicitudesSinRespuesta(usuario, dejar) {
  const cuantos = ajustes.numero('avisos_solicitud_dias', 1, 120);
  const filas = db
    .prepare(
      `SELECT id, numero, asunto, fecha, estado, fecha_compromiso FROM solicitudes
        WHERE responsable_id = ?
          AND estado NOT IN ('Aprobada','Rechazada','Completada','Anulada')
          AND CASE
                WHEN COALESCE(fecha_compromiso, '') <> ''
                  THEN fecha_compromiso < date('now','localtime')
                ELSE fecha <= date('now','localtime', ?)
              END
        ORDER BY COALESCE(NULLIF(fecha_compromiso, ''), fecha) LIMIT 50`
    )
    .all(usuario.id, `-${cuantos} days`);
  for (const s of filas) {
    const prometida = String(s.fecha_compromiso || '').trim();
    dejar({
      tipo: 'solicitud_sin_respuesta',
      clave: `solicitud_lenta:${s.id}`,
      titulo: prometida
        ? `La solicitud ${s.numero} pasó su plazo`
        : `La solicitud ${s.numero} sigue sin respuesta`,
      cuerpo: prometida
        ? `Se comprometió respuesta para el ${prometida} y sigue «${s.estado}». La tiene usted a cargo.`
        : `Ingresada el ${s.fecha}, está «${s.estado}» y la tiene usted a cargo.`,
      enlace: `#/m/solicitudes/ficha/${s.id}`,
    });
  }
}

/** Los cumpleaños de hoy, de la gente que esa persona alcanza. */
function cumpleanosDeHoy(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'miembros', 'view')) return;
  const alcance = require('../alcance');
  const { proximosCumpleanos } = require('../cumpleanos');
  let lista = [];
  try {
    lista = proximosCumpleanos(alcance.iglesiasDe(usuario), alcance.cuerposDe(usuario), 20) || [];
  } catch (e) {
    return;
  }
  const deHoy = lista.filter((c) => c.dias === 0);
  if (!deHoy.length) return;
  const nombres = deHoy.slice(0, 4).map((c) => c.nombre).join(', ');
  dejar({
    tipo: 'cumpleanos_hoy',
    clave: `cumples:${hoy()}`,
    titulo: deHoy.length === 1 ? `Hoy cumple años ${deHoy[0].nombre}` : `Hoy cumplen años ${deHoy.length} personas`,
    cuerpo: nombres + (deHoy.length > 4 ? ` y ${deHoy.length - 4} más.` : ''),
    enlace: '#/',
  });
}

/**
 * El respaldo sin bajar y el espacio del disco.
 *
 * Le llega a quien tiene la llave del respaldo, que es quien puede hacer algo
 * al respecto. Antes decía «solo si el rol es admin», escrito así: a quien se
 * le concedía «Respaldos del sistema» —para que se bajara la copia una vez al
 * mes sin ser administrador de todo— no le llegaba nunca el aviso de que la
 * copia estaba atrasada. Justo la persona a la que había que avisarle.
 */
function respaldoYDisco(usuario, dejar) {
  if (!require('../permissions').can(usuario, 'sistema_respaldo', 'view')) return;
  const respaldo = require('../respaldo');
  try {
    const bajada = respaldo.estadoDeLaBajada();
    if (!bajada.alDia) {
      dejar({
        tipo: 'respaldo_atrasado',
        clave: bajada.cuando ? `respaldo:${bajada.cuando}` : 'respaldo:nunca',
        titulo: bajada.cuando ? 'Hace mucho que nadie baja el respaldo' : 'No hay ningún respaldo guardado fuera del servidor',
        cuerpo: bajada.cuando
          ? `El último fue hace ${bajada.dias} día(s). Si se pierde el servidor, se pierde todo lo posterior.`
          : 'Mientras no salga una copia de acá, si se pierde el servidor se pierde todo.',
        enlace: '#/config/respaldos',
      });
    }
  } catch (e) { /* si no se puede saber, no se inventa un aviso */ }

  try {
    // Cuánto es «poco espacio» ya lo decide el propio disco, con el umbral que
    // se fija en Configuración: un disco de 500 MB y uno de 50 GB no se
    // aprietan con la misma cifra, y esa cuenta no se repite acá.
    const d = require('../disco').estado();
    if (d.apretado) {
      const mb = d.libre == null ? null : Math.round(d.libre / (1024 * 1024));
      dejar({
        tipo: 'respaldo_atrasado',
        clave: `disco:${hoy()}`,
        titulo: 'Queda poco espacio en el disco',
        cuerpo: `${mb == null ? 'Queda poco' : `Quedan ${mb} MB`} libres. Sin espacio, el sistema deja de poder guardar.`,
        enlace: '#/config/respaldos',
      });
    }
  } catch (e) { /* si no se puede medir el disco, no se inventa un aviso */ }
}

/**
 * Integrantes con cuotas al debe.
 *
 * Se debe una cuota cuando el cuerpo cobra, la persona no está exenta y lleva
 * menos meses pagados que los que ya corrieron del año. Se avisa el total, no
 * la lista: quién es cada uno se ve en la planilla del cuerpo.
 */
function cuotasAtrasadas(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'cuotas_cuerpo', 'view')) return;
  const alcance = require('../alcance');
  const { integrantesDe } = require('../integrantes');

  const params = [];
  const donde = [];
  const iglesias = alcance.iglesiasDe(usuario);
  const cuerpos = alcance.cuerposDe(usuario);
  if (iglesias.length) { donde.push(`iglesia_id IN (${iglesias.map(() => '?').join(',')})`); params.push(...iglesias); }
  if (cuerpos.length) { donde.push(`id IN (${cuerpos.map(() => '?').join(',')})`); params.push(...cuerpos); }
  donde.push("estado = 'Activo'", 'cobra_cuota = 1');

  const anio = new Date().getFullYear();
  const mesesCorridos = new Date().getMonth() + 1;
  for (const cuerpo of db.prepare(`SELECT id, nombre FROM cuerpos WHERE ${donde.join(' AND ')}`).all(...params)) {
    const pagos = db
      .prepare('SELECT integrante_id, COUNT(*) c FROM cuotas_cuerpo WHERE cuerpo_id = ? AND anio = ? GROUP BY integrante_id')
      .all(cuerpo.id, anio);
    const cuantos = new Map(pagos.map((p) => [Number(p.integrante_id), p.c]));
    const alDebe = integrantesDe(db, cuerpo.id)
      .filter((f) => !f.exento_cuota && (cuantos.get(Number(f.id)) || 0) < mesesCorridos).length;
    if (!alDebe) continue;
    dejar({
      tipo: 'cuotas_atrasadas',
      clave: `cuotas:${cuerpo.id}:${anio}-${String(mesesCorridos).padStart(2, '0')}`,
      titulo: `${alDebe} integrante(s) con cuotas al debe en ${cuerpo.nombre}`,
      cuerpo: `Al mes ${mesesCorridos} de ${anio}.`,
      enlace: `#/m/cuerpos/ficha/${cuerpo.id}/cuotas`,
    });
  }
}

/**
 * Solicitudes abiertas cuyo responsable ya no entra al sistema.
 *
 * Al desactivar una cuenta se pregunta qué pasa con lo que lleva, pero se
 * puede confirmar y seguir: cerrarle el acceso a alguien no puede quedar
 * esperando a que otro reparta sus trámites. Lo que no puede pasar es que ahí
 * se acabe la historia: esas solicitudes siguen abiertas, sin que nadie reciba
 * sus avisos y sin aparecer en la bandeja de nadie.
 *
 * Así que se le recuerda a quien puede repartirlas —quien tenga la llave de
 * tramitar las de otros—, en un solo aviso con el total y no uno por
 * solicitud: son de nadie, y una lista de diez avisos idénticos se ignora.
 */
function solicitudesSinResponsableActivo(usuario, dejar) {
  if (!require('../permissions').can(usuario, 'solicitudes_tramitar', 'view')) return;
  const cerrados = require('../modules/solicitudes').CERRADOS;
  const huecos = cerrados.map(() => '?').join(',');
  const params = [];
  const suyas = require('../alcance').condiciones(require('../modules/solicitudes'), usuario, params);
  let filas = [];
  try {
    filas = db
      .prepare(
        `SELECT s.id, s.numero FROM solicitudes s
          WHERE s.estado NOT IN (${huecos})
            AND (s.responsable_id IS NULL
                 OR NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = s.responsable_id AND u.activo = 1))
            ${suyas ? `AND (${suyas})` : ''}
          ORDER BY s.fecha LIMIT 50`
      )
      .all(...cerrados, ...params);
  } catch (e) {
    return;
  }
  if (!filas.length) return;
  dejar({
    tipo: 'solicitud_sin_responsable',
    // La clave lleva la cuenta: si aparece otra, vuelve a avisar; mientras sean
    // las mismas, no repite todos los días
    clave: `solicitudes_huerfanas:${filas.length}`,
    titulo: filas.length === 1
      ? `La solicitud ${filas[0].numero} quedó sin nadie que la lleve`
      : `${filas.length} solicitudes quedaron sin nadie que las lleve`,
    cuerpo: 'Su responsable ya no entra al sistema. Repártalas desde la bandeja.',
    enlace: '#/solicitudes/bandeja?caja=huerfanas',
  });
}

/**
 * QUIEN LLEVA MUCHAS FALTAS SEGUIDAS.
 *
 * Había siete tipos de aviso y ninguno de asistencia, siendo que la asistencia
 * es de lo poco que avisa A TIEMPO de que alguien se está alejando —que es de
 * lo que más le importa a un cuerpo—. Cuando se nota sin ayuda, ya pasaron
 * meses.
 *
 * Un aviso POR CUERPO, no uno por persona: tres avisos idénticos la misma
 * mañana es la forma más rápida de que alguien deje de mirarlos. Cada uno dice
 * a cuántos les pasa, nombra a los primeros y lleva al informe del cuerpo.
 *
 * Cuántas faltas hacen falta lo dice Configuración, como los demás plazos; en
 * 0 no se avisa. Las justificadas van dichas aparte: quien avisa que no puede
 * ir no es el mismo caso que quien desapareció.
 */
function faltasSeguidas(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'asistencias', 'view')) return;
  const faltas = require('../faltas-seguidas');
  const cuantas = faltas.cuantasAvisan();
  if (!cuantas) return;

  const alcance = require('../alcance');
  const params = [];
  const donde = ["estado = 'Activo'"];
  const iglesias = alcance.iglesiasDe(usuario);
  const cuerpos = alcance.cuerposDe(usuario);
  if (iglesias.length) { donde.push(`iglesia_id IN (${iglesias.map(() => '?').join(',')})`); params.push(...iglesias); }
  if (cuerpos.length) { donde.push(`id IN (${cuerpos.map(() => '?').join(',')})`); params.push(...cuerpos); }

  for (const cuerpo of db.prepare(`SELECT id, nombre FROM cuerpos WHERE ${donde.join(' AND ')}`).all(...params)) {
    let alejados = [];
    try {
      alejados = faltas.delCuerpo(cuerpo.id, cuantas);
    } catch (e) {
      continue;
    }
    if (!alejados.length) continue;

    const NOMBRA = 3;
    const nombres = alejados.slice(0, NOMBRA).map((p) => `${p.nombre} (${p.faltas})`).join(', ');
    const resto = alejados.length - NOMBRA;
    const conAviso = alejados.reduce((n, p) => n + (p.justificadas ? 1 : 0), 0);
    dejar({
      tipo: 'faltas_seguidas',
      /*
       * La clave lleva a quiénes y con cuántas: mientras sea la misma gente
       * con la misma cuenta, no vuelve a avisar todos los días; en cuanto
       * alguien suma otra falta o se agrega uno más, sí.
       */
      clave: `faltas:${cuerpo.id}:${alejados.map((p) => `${p.clave}=${p.faltas}`).join(',')}`,
      titulo: alejados.length === 1
        ? `${alejados[0].nombre} lleva ${alejados[0].faltas} faltas seguidas en ${cuerpo.nombre}`
        : `${alejados.length} personas llevan ${cuantas} faltas seguidas o más en ${cuerpo.nombre}`,
      cuerpo: `${nombres}${resto > 0 ? ` y ${resto} más` : ''}.`
        + (conAviso ? ` ${conAviso} de ellas avisó al menos una vez.` : ' Ninguna avisó.'),
      enlace: `#/asistencia/informes?tipo=cuerpo&cuerpo_id=${cuerpo.id}`,
    });
  }
}

const REVISIONES = [credencialesPorVencer, solicitudesSinRespuesta, solicitudesSinResponsableActivo,
  cumpleanosDeHoy, respaldoYDisco, cuotasAtrasadas, faltasSeguidas];

// ------------------------------------------------------------- la pasada ----

/**
 * La pasada del día. Devuelve cuántos avisos dejó, para poder probarla.
 *
 * `paraTodos` deja pasar el reloj: se usa en las pruebas y al arrancar a mano.
 */
function pasada() {
  const navegador = require('./navegador');
  let dejados = 0;

  for (const usuario of losQueEntran()) {
    const suyos = [];
    const dejar = (aviso) => {
      const fila = avisos.crear({ ...aviso, usuario_id: usuario.id });
      if (fila) { suyos.push(fila); dejados++; }
    };
    for (const revisar of REVISIONES) {
      try {
        revisar(usuario, dejar);
      } catch (e) {
        console.error(`⚠️  avisos: fallo revisando ${revisar.name} para ${usuario.nombre}: ${e.message}`);
      }
    }

    // Un solo empujón con el total, y solo si esta persona quiere en el
    // navegador alguno de los tipos que le tocaron.
    const empujables = suyos.filter((f) => avisos.quiere(usuario, f.tipo, 'navegador'));
    if (!empujables.length) continue;
    const titulo = empujables.length === 1
      ? empujables[0].titulo
      : `Tiene ${empujables.length} avisos nuevos`;
    const cuerpo = empujables.length === 1
      ? empujables[0].cuerpo || ''
      : empujables.slice(0, 3).map((f) => f.titulo).join(' · ');
    navegador
      .empujar(usuario.id, { titulo, cuerpo, enlace: '#/', etiqueta: 'resumen' })
      .then(() => {
        const marcar = db.prepare('UPDATE notificaciones SET empujada = 1 WHERE id = ?');
        for (const f of empujables) marcar.run(f.id);
      })
      .catch((e) => console.error(`⚠️  avisos: no se pudo empujar el resumen de ${usuario.nombre}: ${e.message}`));
  }

  const borrados = avisos.limpiarLosViejos(ajustes.numero('avisos_guardar_dias', 7, 730));
  return { dejados, borrados };
}

/** ¿Toca hacer la pasada de hoy? */
function leToca(ahora = new Date()) {
  if (ahora.getHours() < ajustes.numero('avisos_hora', 0, 23)) return false;
  return leer(CLAVE_ULTIMA) !== hoy(ahora);
}

function mirar() {
  try {
    if (!leToca()) return;
    const { dejados, borrados } = pasada();
    anotar(CLAVE_ULTIMA, hoy());
    if (dejados || borrados) {
      console.log(`🔔 avisos: ${dejados} aviso(s) del día${borrados ? ` · ${borrados} leído(s) viejo(s) borrado(s)` : ''}.`);
    }
  } catch (e) {
    console.error(`⚠️  avisos: no se pudo hacer la pasada del día: ${e.message}`);
  }
}

/** Se pone a mirar. Lo llama el arranque del servidor. */
function empezar() {
  setTimeout(mirar, 20 * 1000).unref?.(); // una primera mirada al arrancar, sin apurar el arranque
  // Se reprograma sola en cada vuelta —en vez de un setInterval fijo— para
  // poder tomar el intervalo nuevo si lo cambian en la configuración.
  const otraVuelta = () => {
    const t = setTimeout(() => {
      mirar();
      otraVuelta();
    }, cadaCuantoMira());
    t.unref?.();
  };
  otraVuelta();
}

module.exports = {
  empezar, mirar, pasada, leToca, REVISIONES,
  solicitudesSinRespuesta, solicitudesSinResponsableActivo,
};
