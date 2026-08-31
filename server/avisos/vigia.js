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
 * Papeles de la carpeta de alguien que están por vencer, o ya vencidos.
 *
 * Es el hermano del aviso de la credencial y se hizo con la misma forma: el
 * módulo sabe cuáles son —`documentos_miembros.porVencer`, acotado a lo que
 * esa persona alcanza— y acá solo se redacta.
 *
 * UN AVISO POR PERSONA Y NO UNO POR PAPEL. La credencial avisa una por una
 * porque cada una es de alguien distinto y hay pocas; los documentos son
 * muchos y de la misma persona pueden vencer tres el mismo mes —el carnet, el
 * certificado y el permiso—. Tres campanazos por la misma señora la misma
 * mañana es la forma más rápida de que alguien apague los avisos.
 *
 * Lo vencido manda sobre lo por vencer en el título: es lo que hay que salir a
 * pedir hoy, no lo que se puede pedir la semana que viene.
 */
function documentosPorVencer(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'documentos_miembros', 'view')) return;
  let papeles = [];
  try {
    papeles = require('../modules/documentos_miembros').porVencer(usuario) || [];
  } catch (e) {
    return;   // una base a medio migrar no puede tumbar la pasada del día
  }
  if (!papeles.length) return;

  const porPersona = new Map();
  for (const d of papeles) {
    const suyos = porPersona.get(d.miembro_id) || [];
    suyos.push(d);
    porPersona.set(d.miembro_id, suyos);
  }

  for (const [miembroId, suyos] of porPersona) {
    const titular = suyos[0].titular || 'Un miembro';
    const vencidos = suyos.filter((d) => Number(d.dias) < 0);
    const elPrimero = suyos[0];
    const comoSeLee = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-');
    const cuenta = (d) => (Number(d.dias) < 0
      ? `venció hace ${Math.abs(Number(d.dias))} día(s)`
      : `le quedan ${Number(d.dias)} día(s)`);

    dejar({
      tipo: 'documento_por_vencer',
      /*
       * La clave lleva a quién y con qué fechas: mientras sean los mismos
       * papeles con el mismo vencimiento no vuelve a avisar todos los días, y
       * en cuanto venza otro o se renueve alguno, sí.
       */
      clave: `documentos_vencen:${miembroId}:${suyos.map((d) => `${d.id}=${d.vence}`).join(',')}`,
      titulo: suyos.length === 1
        ? `${vencidos.length ? 'Venció' : 'Por vencer'}: ${elPrimero.tipo} de ${titular}`
        : `${suyos.length} documentos de ${titular} ${vencidos.length ? 'vencidos o por vencer' : 'por vencer'}`,
      cuerpo: suyos.slice(0, 3)
        .map((d) => `${d.tipo} (${comoSeLee(d.vence)}, ${cuenta(d)})`)
        .join('; ') + (suyos.length > 3 ? `, y ${suyos.length - 3} más.` : '.'),
      enlace: `#/m/miembros/ficha/${miembroId}/documentos`,
    });
  }
}

/**
 * Lo prestado a la iglesia que hay que devolver.
 *
 * Un hermano presta algo para el aniversario y a los dos meses nadie se
 * acuerda: quien lo recibió puede llevar un año sin venir, y el dueño termina
 * teniendo que ir a pedirlo. Es la misma forma que el aviso de un documento por
 * vencer —lo que ya se pasó de la fecha entra con días negativos y sale
 * primero—, porque es el mismo problema: una fecha que llega sola.
 *
 * Lo que está EN DEPÓSITO no avisa, y es a propósito: ahí no hay plazo ni
 * compromiso de devolver nada, la cosa está guardada por voluntad de su dueño y
 * él la retira cuando quiera (ver server/bienes-ajenos.js).
 */
function prestamosPorDevolver(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'inventarios', 'view')) return;
  let prestados = [];
  try {
    prestados = require('../modules/inventarios').porVencer(usuario) || [];
  } catch (e) {
    return;   // una base a medio migrar no puede tumbar la pasada del día
  }
  if (!prestados.length) return;

  const comoSeLee = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-');
  const cuenta = (a) => (Number(a.dias) < 0
    ? `debía devolverse hace ${Math.abs(Number(a.dias))} día(s)`
    : `quedan ${Number(a.dias)} día(s)`);
  const atrasados = prestados.filter((a) => Number(a.dias) < 0);

  dejar({
    tipo: 'prestamo_por_devolver',
    /*
     * La clave lleva cada artículo con su fecha: mientras sean los mismos
     * préstamos con el mismo plazo no vuelve a avisar todos los días, y en
     * cuanto se agregue uno, se devuelva otro o se corra una fecha, sí.
     */
    clave: `prestamos_devolver:${prestados.map((a) => `${a.id}=${a.fecha_devolucion}`).join(',')}`,
    titulo: prestados.length === 1
      ? `${atrasados.length ? 'Hay que devolver' : 'Por devolver'}: ${prestados[0].articulo}`
      : `${prestados.length} artículos prestados ${atrasados.length ? 'atrasados o por devolver' : 'por devolver'}`,
    cuerpo: prestados.slice(0, 3)
      .map((a) => `${a.articulo}, de ${a.dueno || 'su dueño'} (${comoSeLee(a.fecha_devolucion)}, ${cuenta(a)})`)
      .join('; ') + (prestados.length > 3 ? `, y ${prestados.length - 3} más.` : '.'),
    enlace: '#/m/inventarios?f_regimen=Prestado',
  });
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

/**
 * Lo que se pidió y nadie entregó.
 *
 * El sistema avisa de una credencial por vencer, de un documento por vencer, de
 * una solicitud sin respuesta, de cuotas al debe, del respaldo atrasado, de
 * quien lleva muchas faltas seguidas y de quien cumplió dieciocho. De una
 * familia que pidió una caja de mercadería en marzo y sigue esperando, no
 * avisaba nadie: de nueve revisiones, ninguna era de ayudas, y es lo único que
 * este sistema entrega a una persona.
 *
 * UN SOLO AVISO CON TODAS, y no uno por ayuda. Una solicitud tiene responsable
 * y se le avisa a quien la tiene a cargo; una ayuda no tiene dueño, así que
 * quien administra las ayudas recibiría un campanazo por cada una. Lo que sirve
 * en el mostrador es la lista, no el recuento.
 *
 * La clave lleva los números de las ayudas que están esperando: mientras sean
 * las mismas no vuelve a avisar todos los días, y en cuanto entre otra —o se
 * entregue alguna— sí, porque la lista ya es otra.
 *
 * Se cuenta desde la FECHA DE LA AYUDA, que es cuando se pidió, y no desde
 * cuándo se tecleó: una ayuda del 10 de marzo anotada en agosto lleva
 * esperando desde marzo.
 */
function ayudasSinEntregar(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'ayudas_sociales', 'view')) return;

  const cuantos = ajustes.numero('avisos_ayuda_dias', 1, 120);
  const params = [`-${cuantos} days`];
  /*
   * El alcance se pide a la misma pieza que usa el listado: quien no ve una
   * ayuda en pantalla tampoco recibe un aviso sobre ella. Sin alias en la
   * tabla, porque las condiciones vienen con los nombres de columna a secas.
   */
  let suyas = '';
  try {
    const cond = [];
    suyas = require('../alcance').condiciones(
      require('../registry').getModule('ayudas_sociales'), usuario, cond
    );
    params.push(...cond);
  } catch (e) {
    return;   // una base a medio migrar no puede tumbar la pasada del día
  }

  const filas = db
    .prepare(
      `SELECT id, fecha, tipo_ayuda, beneficiario, estado FROM ayudas_sociales
        WHERE estado IN ('Solicitada', 'Aprobada')
          AND fecha <= date('now','localtime', ?)
          ${suyas ? `AND (${suyas})` : ''}
        ORDER BY fecha LIMIT 50`
    )
    .all(...params);
  if (!filas.length) return;

  const comoSeLee = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-');
  const diasDesde = (iso) => {
    const cuando = Date.parse(`${String(iso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(cuando)) return null;
    return Math.max(0, Math.floor((Date.now() - cuando) / 86400000));
  };
  const cuenta = (a) => {
    const d = diasDesde(a.fecha);
    return d === null ? comoSeLee(a.fecha) : `${comoSeLee(a.fecha)}, hace ${d} día(s)`;
  };

  dejar({
    tipo: 'ayuda_sin_entregar',
    clave: `ayudas_esperando:${filas.map((a) => a.id).join(',')}`,
    titulo: filas.length === 1
      ? `Una ayuda pedida sigue sin entregarse`
      : `${filas.length} ayudas pedidas siguen sin entregarse`,
    cuerpo: filas.slice(0, 3)
      .map((a) => `${a.tipo_ayuda || 'Ayuda'} para ${a.beneficiario || 'alguien'} (${cuenta(a)}, «${a.estado}»)`)
      .join('; ') + (filas.length > 3 ? `, y ${filas.length - 3} más.` : '.'),
    // Con una sola, a su ficha; con varias, al listado, que es donde se
    // trabajan: mandar a la ficha de la primera esconde las otras.
    enlace: filas.length === 1
      ? `#/m/ayudas_sociales/ficha/${filas[0].id}`
      : '#/m/ayudas_sociales',
  });
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

/**
 * Menores que ya cumplieron 18 y siguen con el tipo de menor.
 *
 * Es la única contradicción que llega SOLA: nadie toca esas fichas, y el día
 * del cumpleaños el tipo deja de ser cierto sin que nadie guarde nada. La
 * comprobación al guardar no la alcanza nunca, porque no hay guardado.
 *
 * Importa porque de ese campo sale quién compone la directiva de la iglesia
 * (ver server/directiva.js): un tipo viejo es una regla aplicándose sobre un
 * dato que ya no corresponde.
 *
 * No se corrige solo. Cambiarle el tipo a alguien sin que nadie lo mire es
 * meterse en algo que decide la iglesia —¿queda como nuevo, como oyente, como
 * activo?—, y esa respuesta el sistema no la tiene.
 */
function cumplieronLaMayoria(usuario, dejar) {
  const { can } = require('../permissions');
  if (!can(usuario, 'miembros', 'edit')) return;   // avisarle a quien no puede corregirlo no sirve

  const { TIPO_DE_MENOR } = require('../modules/miembros');
  const alcance = require('../alcance');
  const params = [TIPO_DE_MENOR];
  const donde = [
    'tipo_miembro = ?',
    "estado NOT IN ('Fallecido', 'Trasladado')",
    "fecha_nacimiento IS NOT NULL",
    "date(fecha_nacimiento) <= date('now','localtime','-18 years')",
  ];
  const iglesias = alcance.iglesiasDe(usuario);
  if (iglesias.length) {
    donde.push(`iglesia_id IN (${iglesias.map(() => '?').join(',')})`);
    params.push(...iglesias);
  }

  let grandes = [];
  try {
    grandes = db
      .prepare(`SELECT id, nombres, apellidos FROM miembros WHERE ${donde.join(' AND ')} ORDER BY apellidos, nombres`)
      .all(...params);
  } catch (e) {
    return;   // una base a medio migrar no puede tumbar la pasada del día
  }
  if (!grandes.length) return;

  const NOMBRA = 3;
  const nombres = grandes.slice(0, NOMBRA).map((m) => `${m.nombres} ${m.apellidos}`).join(', ');
  const resto = grandes.length - NOMBRA;
  dejar({
    tipo: 'cumplio_la_mayoria',
    // La clave lleva a quiénes son: mientras sean los mismos no se repite el
    // aviso, y en cuanto cumpla otro vuelve a salir
    clave: `mayoria:${grandes.map((m) => m.id).join(',')}`,
    titulo: grandes.length === 1
      ? 'Una ficha sigue como menor de edad'
      : `${grandes.length} fichas siguen como menores de edad`,
    /*
     * `cuerpo` y `enlace`, que son los nombres que entiende `avisos.crear`.
     * Estaban escritos «detalle» y «ruta», y como `crear` toma solo las claves
     * que conoce, los dos se perdían en silencio: este aviso salía con el
     * título solo, sin texto y sin adónde ir. Se vio al escribir el aviso de
     * los documentos por vencer, que se copió de acá.
     */
    cuerpo: `${nombres}${resto > 0 ? ` y ${resto} más` : ''} ya cumplieron 18 años y siguen como `
      + `"${TIPO_DE_MENOR}". De ese tipo sale quién compone la directiva de la iglesia.`,
    enlace: '#/m/miembros?f_tipo_miembro=' + encodeURIComponent(TIPO_DE_MENOR) + '&edad_desde=18',
  });
}

const REVISIONES = [credencialesPorVencer, documentosPorVencer, prestamosPorDevolver,
  solicitudesSinRespuesta, solicitudesSinResponsableActivo, ayudasSinEntregar, cumpleanosDeHoy,
  respaldoYDisco, cuotasAtrasadas, faltasSeguidas, cumplieronLaMayoria];

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
    const soloUno = empujables[0];
    const cuerpo = empujables.length === 1
      // Si viene de alguien, se dice; y se recorta a lo que se alcanza a leer en
      // una pantalla bloqueada. Es la misma regla del empujón de un aviso
      // suelto (ver `avisar` y `paraElTelefono`, en avisos.js)
      ? avisos.paraElTelefono(soloUno.de ? `${soloUno.de}: ${soloUno.cuerpo || ''}` : soloUno.cuerpo)
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
  solicitudesSinRespuesta, solicitudesSinResponsableActivo, cumplieronLaMayoria,
  ayudasSinEntregar,
};
