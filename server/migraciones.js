/**
 * Migraciones de datos (se ejecutan al iniciar y son idempotentes).
 *
 * A diferencia de db.js —que crea tablas y columnas—, aquí se transforma
 * información ya guardada cuando cambia la forma de registrarla.
 */
const { db } = require('./db');
const rut = require('./rut');
const { CARGOS_MINISTERIO, CARGO_GUIA } = require('./tratamiento');

/**
 * Algunas migraciones no se pueden repetir sin dañar los datos (por ejemplo,
 * cuando un campo cambia de significado y ya no se distingue lo viejo de lo
 * nuevo). Para esas se deja constancia de que ya corrieron.
 */
db.exec(`CREATE TABLE IF NOT EXISTS migraciones (
  nombre TEXT PRIMARY KEY,
  aplicada_en TEXT DEFAULT (datetime('now','localtime'))
)`);

function yaAplicada(nombre) {
  return !!db.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(nombre);
}

function marcarAplicada(nombre) {
  db.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(nombre);
}

/**
 * Pasa los valores del antiguo campo "documento_identidad" al nuevo campo
 * "rut" cuando corresponden a un RUT válido. Los que no lo son (pasaporte,
 * documento extranjero) se dejan intactos en su campo, sin perder el dato.
 */
function documentoIdentidadARut(tabla) {
  const columnas = db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name);
  if (!columnas.includes('documento_identidad') || !columnas.includes('rut')) return;

  const pendientes = db
    .prepare(
      `SELECT id, documento_identidad FROM "${tabla}"
       WHERE (rut IS NULL OR rut = '')
         AND documento_identidad IS NOT NULL AND documento_identidad != ''`
    )
    .all();
  if (!pendientes.length) return;

  let migrados = 0;
  const conservados = [];
  for (const fila of pendientes) {
    const valor = fila.documento_identidad;
    if (!rut.validar(valor)) {
      conservados.push(`#${fila.id} (${valor})`);
      continue;
    }
    const canonico = rut.canonico(valor);
    const duplicado = db.prepare(`SELECT id FROM "${tabla}" WHERE rut = ?`).get(canonico);
    if (duplicado) {
      conservados.push(`#${fila.id} (${valor}: ya usado por #${duplicado.id})`);
      continue;
    }
    db.prepare(`UPDATE "${tabla}" SET rut = ?, documento_identidad = NULL WHERE id = ?`).run(canonico, fila.id);
    migrados++;
  }

  if (migrados) console.log(`🔁 ${tabla}: ${migrados} documento(s) convertido(s) a RUT`);
  if (conservados.length) {
    console.log(
      `ℹ️  ${tabla}: ${conservados.length} documento(s) no son RUT válidos y se conservan ` +
        `en "Otro documento": ${conservados.join(', ')}`
    );
  }
}


/**
 * El campo "tipo" de cuerpos/grupos pasó a tener solo dos valores: Cuerpo y
 * Grupo (antes se usaba para el nombre: Damas, Caballeros, Jóvenes…). Los
 * registros anteriores se dejan como "Cuerpo" y se informa cuáles fueron,
 * para que se revisen y ajusten a "Grupo" los que corresponda.
 */
function normalizarTipoCuerpos() {
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  if (!columnas.includes('tipo')) return;

  const antiguos = db
    .prepare(`SELECT id, nombre, tipo FROM cuerpos WHERE tipo IS NOT NULL AND tipo NOT IN ('Cuerpo', 'Grupo')`)
    .all();
  if (!antiguos.length) return;

  const actualizar = db.prepare(`UPDATE cuerpos SET tipo = 'Cuerpo' WHERE id = ?`);
  for (const fila of antiguos) actualizar.run(fila.id);
  console.log(
    `🔁 cuerpos: ${antiguos.length} registro(s) quedaron como "Cuerpo" (antes el tipo guardaba el nombre): ` +
      antiguos.map((f) => `${f.nombre} [era "${f.tipo}"]`).join(', ') +
      '\n   Revise cuáles corresponden a "Grupo" y ajústelos en el módulo Cuerpos / Grupos.'
  );
}


/**
 * La directiva de un cuerpo dejó de guardarse en el propio cuerpo para pasar
 * al módulo "directivas", que guarda el histórico por períodos. Los datos ya
 * cargados se convierten en la primera directiva vigente de cada cuerpo.
 */
function directivaCuerpoAHistorico() {
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  const cargos = ['presidente_id', 'secretario_id', 'tesorero_id'];
  if (!cargos.some((c) => columnas.includes(c))) return;

  const seleccion = ['id', 'nombre', 'iglesia_id', 'fecha_constitucion']
    .concat(cargos.filter((c) => columnas.includes(c)))
    .concat(columnas.includes('periodo_directiva') ? ['periodo_directiva'] : [])
    .join(', ');

  const filas = db.prepare(`SELECT ${seleccion} FROM cuerpos`).all().filter(
    (f) => f.presidente_id || f.secretario_id || f.tesorero_id || f.periodo_directiva
  );
  if (!filas.length) return;

  let migradas = 0;
  for (const fila of filas) {
    const yaTiene = db.prepare('SELECT id FROM directivas WHERE cuerpo_id = ?').get(fila.id);
    if (yaTiene) continue;
    db.prepare(
      `INSERT INTO directivas (cuerpo_id, periodo, fecha_inicio, primer_jefe_id, secretario_id,
                               tesorero_id, iglesia_id, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Vigente', ?)`
    ).run(
      fila.id,
      fila.periodo_directiva || 'Período inicial',
      fila.fecha_constitucion || require('./fechas').hoy(),
      fila.presidente_id || null,
      fila.secretario_id || null,
      fila.tesorero_id || null,
      fila.iglesia_id || null,
      'Directiva registrada antes de llevar el histórico por períodos.'
    );
    // Se limpian los campos antiguos del cuerpo para no duplicar el dato
    for (const c of cargos.filter((c) => columnas.includes(c))) {
      db.prepare(`UPDATE cuerpos SET "${c}" = NULL WHERE id = ?`).run(fila.id);
    }
    migradas++;
  }
  if (migradas) {
    console.log(`🔁 directivas: ${migradas} directiva(s) pasaron al histórico como vigentes.`);
  }
}


/**
 * Los cargos de la directiva pasaron a los que usa la organización:
 * presidente → primer jefe / primera jefa, y vicepresidente → segundo jefe /
 * segunda jefa. Se traspasan los valores ya registrados.
 */
function renombrarCargosDirectiva() {
  const columnas = db.prepare('PRAGMA table_info("directivas")').all().map((c) => c.name);
  const pares = [
    ['presidente_id', 'primer_jefe_id'],
    ['vicepresidente_id', 'segundo_jefe_id'],
  ].filter(([viejo, nuevo]) => columnas.includes(viejo) && columnas.includes(nuevo));
  if (!pares.length) return;

  let movidos = 0;
  for (const [viejo, nuevo] of pares) {
    const info = db
      .prepare(`UPDATE directivas SET "${nuevo}" = "${viejo}", "${viejo}" = NULL
                WHERE "${viejo}" IS NOT NULL AND ("${nuevo}" IS NULL)`)
      .run();
    movidos += info.changes;
  }
  if (movidos) console.log(`🔁 directivas: ${movidos} cargo(s) traspasados a primer/segundo jefe.`);
}

/**
 * El oficial supervisor(a) de un cuerpo dejó de elegirse entre los pastores /
 * guías: es un integrante del cuerpo de oficiales, es decir, un miembro. Los
 * valores ya guardados apuntaban a la tabla "pastores", así que se busca al
 * miembro equivalente (mismo RUT y, si no, mismo nombre) y se apunta a él.
 * Lo que no se puede identificar se deja vacío y se informa, para volver a
 * elegirlo a mano en vez de dejar una referencia equivocada.
 */
function oficialSupervisorAMiembro() {
  const NOMBRE = 'oficial_supervisor_pastores_a_miembros';
  if (yaAplicada(NOMBRE)) return;

  const columnas = db.prepare('PRAGMA table_info("directivas")').all().map((c) => c.name);
  if (!columnas.includes('oficial_supervisor_id')) return;

  const filas = db
    .prepare('SELECT id, cuerpo_id, oficial_supervisor_id FROM directivas WHERE oficial_supervisor_id IS NOT NULL')
    .all();

  let convertidos = 0;
  const sinEquivalente = [];
  for (const fila of filas) {
    const pastor = db.prepare('SELECT * FROM pastores WHERE id = ?').get(fila.oficial_supervisor_id);
    let miembro = null;
    if (pastor) {
      if (pastor.rut) miembro = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(rut.canonico(pastor.rut));
      if (!miembro && pastor.nombres) {
        miembro = db
          .prepare(`SELECT id FROM miembros
                    WHERE lower(nombres) = lower(?) AND lower(COALESCE(apellidos,'')) = lower(?)`)
          .get(pastor.nombres, pastor.apellidos || '');
      }
    }
    if (miembro) {
      db.prepare('UPDATE directivas SET oficial_supervisor_id = ? WHERE id = ?').run(miembro.id, fila.id);
      convertidos++;
    } else {
      db.prepare('UPDATE directivas SET oficial_supervisor_id = NULL WHERE id = ?').run(fila.id);
      sinEquivalente.push(`#${fila.id}${pastor ? ` (${[pastor.nombres, pastor.apellidos].filter(Boolean).join(' ')})` : ''}`);
    }
  }

  marcarAplicada(NOMBRE);
  if (convertidos) {
    console.log(`🔁 directivas: ${convertidos} oficial(es) supervisor(es) ahora apuntan al miembro correspondiente.`);
  }
  if (sinEquivalente.length) {
    console.log(
      `ℹ️  directivas: ${sinEquivalente.length} oficial(es) supervisor(es) quedaron sin asignar porque ` +
        `esa persona no está registrada como miembro: ${sinEquivalente.join(', ')}.\n` +
        '   Regístrela en Miembros, agréguela al cuerpo de oficiales y vuelva a elegirla en la directiva.'
    );
  }
}


/**
 * La tesorería pasó a llevarse por cuentas: la general de la corporación, la
 * general de cada iglesia local y las cuentas de proyecto de cada nivel.
 *
 * Los movimientos ya registrados se asignan a la cuenta general que les
 * corresponde según su iglesia (o a la de la corporación si no tenían una),
 * creándola si hace falta. Nada se pierde ni se mueve de nivel.
 */
function movimientosACuentas() {
  const columnas = db.prepare('PRAGMA table_info("tesoreria")').all().map((c) => c.name);
  if (!columnas.includes('cuenta_id')) return;

  const sinCuenta = db
    .prepare('SELECT id, iglesia_id FROM tesoreria WHERE cuenta_id IS NULL')
    .all();
  if (!sinCuenta.length) return;

  const buscarGeneral = (iglesiaId) =>
    iglesiaId
      ? db.prepare(`SELECT id FROM cuentas_tesoreria WHERE tipo = 'General' AND iglesia_id = ?`).get(iglesiaId)
      : db.prepare(`SELECT id FROM cuentas_tesoreria WHERE tipo = 'General' AND iglesia_id IS NULL`).get();

  const crearGeneral = (iglesiaId) => {
    const nombre = iglesiaId
      ? (db.prepare('SELECT nombre FROM iglesias WHERE id = ?').get(iglesiaId) || {}).nombre
      : null;
    const info = db
      .prepare(
        `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial, descripcion)
         VALUES (?, ?, ?, 'General', 'Activa', 0, ?)`
      )
      .run(
        iglesiaId ? `Tesorería general — ${nombre || 'iglesia #' + iglesiaId}` : 'Tesorería general de la corporación',
        iglesiaId ? 'Iglesia local' : 'Corporación',
        iglesiaId || null,
        'Creada al ordenar la tesorería por cuentas; recibe los movimientos que ya estaban registrados.'
      );
    return { id: info.lastInsertRowid };
  };

  const cache = new Map();
  const generalDe = (iglesiaId) => {
    const clave = iglesiaId || 0;
    if (!cache.has(clave)) cache.set(clave, buscarGeneral(iglesiaId) || crearGeneral(iglesiaId));
    return cache.get(clave);
  };

  const asignar = db.prepare('UPDATE tesoreria SET cuenta_id = ? WHERE id = ?');
  for (const mov of sinCuenta) asignar.run(generalDe(mov.iglesia_id).id, mov.id);

  console.log(
    `🔁 tesorería: ${sinCuenta.length} movimiento(s) asignados a su cuenta general ` +
      `(${cache.size} cuenta(s) involucradas).`
  );
}


/**
 * Cada iglesia local necesita su «Fondo para la corporación»: la cuenta donde
 * aparta lo que le corresponde a la corporación hasta traspasarlo. Se crea
 * para las iglesias que todavía no lo tienen.
 */
function fondoParaLaCorporacion() {
  const hayCuentas = db.prepare('SELECT COUNT(*) AS c FROM cuentas_tesoreria').get().c;
  if (!hayCuentas) return; // instalación nueva: lo crea la semilla

  const sinFondo = db
    .prepare(
      `SELECT i.id, i.nombre FROM iglesias i
        WHERE NOT EXISTS (
          SELECT 1 FROM cuentas_tesoreria c
           WHERE c.iglesia_id = i.id AND c.tipo = 'Fondo para la corporación')`
    )
    .all();
  if (!sinFondo.length) return;

  const crear = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial, descripcion)
     VALUES (?, 'Iglesia local', ?, 'Fondo para la corporación', 'Activa', 0, ?)`
  );
  for (const ig of sinFondo) {
    crear.run(
      `Fondo para la corporación — ${ig.nombre}`,
      ig.id,
      'Donde la iglesia aparta lo que le corresponde a la corporación, hasta traspasarlo.'
    );
  }
  console.log(`🏦 ${sinFondo.length} fondo(s) para la corporación creados: ${sinFondo.map((i) => i.nombre).join(', ')}.`);
}


/**
 * La asistencia pasó a tomarse nominalmente por cuerpo: cada actividad tiene
 * una fila por integrante con su estado. Lo que ya estaba registrado se
 * traspasa: los miembros marcados como presentes quedan con estado
 * "Presente", y el conteo general que se llevaba antes (hombres, mujeres,
 * niños, visitas) se anota en las observaciones para no perderlo.
 */
function asistenciasNominales() {
  const columnas = db.prepare('PRAGMA table_info("asistencias")').all().map((c) => c.name);
  if (!columnas.includes('miembros_presentes')) return;

  const filas = db.prepare('SELECT * FROM asistencias').all();
  let conLista = 0;
  let conConteo = 0;

  const insertar = db.prepare(
    `INSERT INTO asistencia_detalle (asistencia_id, miembro_id, estado, cuerpo_id, fecha, iglesia_id)
     VALUES (?, ?, 'Presente', ?, ?, ?)`
  );
  const yaTiene = db.prepare('SELECT id FROM asistencia_detalle WHERE asistencia_id = ? AND miembro_id = ?');

  for (const fila of filas) {
    let ids = [];
    try {
      ids = JSON.parse(fila.miembros_presentes || '[]').map(Number).filter(Boolean);
    } catch (e) {
      ids = [];
    }
    for (const miembroId of ids) {
      if (yaTiene.get(fila.id, miembroId)) continue;
      const existe = db.prepare('SELECT id FROM miembros WHERE id = ?').get(miembroId);
      if (!existe) continue;
      insertar.run(fila.id, miembroId, fila.cuerpo_id || null, fila.fecha, fila.iglesia_id || null);
      conLista++;
    }

    // El conteo general anterior queda escrito, para no perder el dato
    const partes = [
      ['hombres', fila.total_hombres], ['mujeres', fila.total_mujeres],
      ['niños', fila.total_ninos], ['visitas', fila.total_visitas],
    ].filter(([, n]) => Number(n) > 0).map(([q, n]) => `${n} ${q}`);
    if ((partes.length || Number(fila.total_general) > 0) && !String(fila.observaciones || '').includes('Conteo anterior')) {
      const texto = `Conteo anterior: ${partes.join(', ') || ''}${
        Number(fila.total_general) > 0 ? `${partes.length ? ' — ' : ''}total ${fila.total_general}` : ''
      }.`;
      db.prepare('UPDATE asistencias SET observaciones = ? WHERE id = ?')
        .run(`${fila.observaciones ? fila.observaciones + '\n' : ''}${texto}`, fila.id);
      conConteo++;
    }

    db.prepare('UPDATE asistencias SET miembros_presentes = NULL WHERE id = ?').run(fila.id);
  }

  if (conLista || conConteo) {
    console.log(
      `🔁 asistencias: ${conLista} presencia(s) traspasadas a la lista nominal` +
        (conConteo ? ` y ${conConteo} conteo(s) anteriores anotados en las observaciones` : '') + '.'
    );
  }
}


/**
 * Una actividad puede convocar a varios cuerpos. Las que tenían un solo
 * cuerpo pasan a la lista de convocados con ese mismo cuerpo dentro.
 */
function actividadesConVariosCuerpos(conexion = db) {
  const columnas = conexion.prepare('PRAGMA table_info("asistencias")').all().map((c) => c.name);
  if (!columnas.includes('cuerpo_id') || !columnas.includes('cuerpos')) return;

  const pendientes = conexion
    .prepare(`SELECT id, cuerpo_id FROM asistencias
               WHERE cuerpo_id IS NOT NULL AND (cuerpos IS NULL OR cuerpos = '' OR cuerpos = '[]')`)
    .all();
  if (!pendientes.length) return;

  const actualizar = conexion.prepare('UPDATE asistencias SET cuerpos = ? WHERE id = ?');
  for (const fila of pendientes) actualizar.run(JSON.stringify([fila.cuerpo_id]), fila.id);
  console.log(`🔁 asistencias: ${pendientes.length} actividad(es) pasaron a la lista de cuerpos convocados.`);
}


/**
 * En Pastores / Guías había dos campos de cónyuge —uno hacia otro pastor y
 * otro hacia un miembro— cuando el cónyuge es uno solo. Ahora es un único
 * campo hacia Miembros, porque el pastor y la pastora son también miembros.
 *
 * Lo registrado se traspasa: si apuntaba a otro pastor, se usa la ficha de
 * miembro de ese pastor; si apuntaba a un miembro, se conserva tal cual.
 */
function conyugeUnicoDePastores() {
  const columnas = db.prepare('PRAGMA table_info("pastores")').all().map((c) => c.name);
  if (!columnas.includes('conyuge_miembro_id')) return;

  const filas = db.prepare('SELECT id, conyuge_id, conyuge_miembro_id, rut FROM pastores').all();
  let movidos = 0;
  const sinFicha = [];

  for (const fila of filas) {
    let miembroId = fila.conyuge_miembro_id || null;

    // Lo que apuntaba a otro pastor: se busca la ficha de miembro de ese pastor
    if (!miembroId && fila.conyuge_id) {
      const otro = db.prepare('SELECT id, nombres, apellidos, rut, miembro_id FROM pastores WHERE id = ?').get(fila.conyuge_id);
      if (otro) {
        if (otro.miembro_id) miembroId = otro.miembro_id;
        else if (otro.rut) {
          const m = db.prepare('SELECT id FROM miembros WHERE rut = ?').get(otro.rut);
          if (m) miembroId = m.id;
        }
        if (!miembroId) sinFicha.push(`${otro.nombres} ${otro.apellidos}`);
      }
    }

    if (miembroId && Number(miembroId) !== Number(fila.conyuge_id || 0)) {
      db.prepare('UPDATE pastores SET conyuge_id = ? WHERE id = ?').run(miembroId, fila.id);
      movidos++;
    } else if (!miembroId && fila.conyuge_id) {
      // Apuntaba a un pastor sin ficha de miembro: se suelta para no dejar un
      // enlace que ahora significaría otra cosa
      db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE id = ?').run(fila.id);
    }
    db.prepare('UPDATE pastores SET conyuge_miembro_id = NULL WHERE id = ?').run(fila.id);
  }

  if (movidos) console.log(`🔁 pastores: ${movidos} vínculo(s) de cónyuge quedaron en un solo campo, hacia Miembros.`);
  if (sinFicha.length) {
    console.log(
      `ℹ️  pastores: el cónyuge de ${sinFicha.length} ficha(s) todavía no tiene ficha de miembro ` +
        `(${sinFicha.join(', ')}). Créela desde su ficha y vuelva a indicarlo.`
    );
  }
}


/**
 * Los perfiles de permisos que venían escritos en el programa pasan a ser
 * registros que la iglesia puede crear, editar y eliminar por su cuenta.
 *
 * Se crean solo si no hay ninguno: si alguien ya armó los suyos, no se le
 * agregan estos encima.
 */
function perfilesDePermisos() {
  if (yaAplicada('perfiles_de_permisos')) return;
  const columnas = db.prepare('PRAGMA table_info("perfiles_permisos")').all().map((c) => c.name);
  if (!columnas.includes('permisos')) return;
  marcarAplicada('perfiles_de_permisos');

  const cuantos = db.prepare('SELECT COUNT(*) c FROM perfiles_permisos').get().c;
  if (cuantos) return;

  const DE_FABRICA = [
    {
      nombre: 'Tesorero(a) de cuerpo',
      descripcion: 'Lleva la plata de su cuerpo: sus cuentas, sus movimientos y sus cuotas.',
      permisos: {
        cuerpos: ['view'], integrantes_cuerpo: ['view'], miembros: ['view'],
        cuentas_tesoreria: ['view', 'create', 'edit'],
        tesoreria: ['view', 'create', 'edit'],
        cuotas_cuerpo: ['view', 'create', 'edit', 'delete'],
        actas_reuniones: ['view'], directivas: ['view'], asistencias: ['view'],
      },
    },
    {
      nombre: 'Secretario(a) de cuerpo',
      descripcion: 'Pasa la lista y lleva las actas de su cuerpo. La tesorería la mira, no la toca.',
      permisos: {
        cuerpos: ['view'], integrantes_cuerpo: ['view', 'create', 'edit'], miembros: ['view'],
        asistencias: ['view', 'create', 'edit'], asistencia_detalle: ['view', 'create', 'edit'],
        actas_reuniones: ['view', 'create', 'edit'],
        evaluaciones_integrantes: ['view', 'create', 'edit'],
        directivas: ['view'],
        tesoreria: ['view'], cuentas_tesoreria: ['view'], cuotas_cuerpo: ['view'],
      },
    },
    {
      nombre: 'Líder de cuerpo',
      descripcion: 'Maneja la gente y las actividades de su cuerpo, sin tocar la plata.',
      permisos: {
        cuerpos: ['view', 'edit'], integrantes_cuerpo: ['view', 'create', 'edit'],
        evaluaciones_integrantes: ['view', 'create', 'edit'], miembros: ['view'],
        asistencias: ['view', 'create', 'edit'], asistencia_detalle: ['view', 'create', 'edit'],
        actas_reuniones: ['view', 'create', 'edit'], directivas: ['view'],
        tesoreria: ['view'], cuentas_tesoreria: ['view'], cuotas_cuerpo: ['view'],
      },
    },
  ];

  const crear = db.prepare(
    "INSERT INTO perfiles_permisos (nombre, descripcion, estado, permisos) VALUES (?, ?, 'Activo', ?)"
  );
  for (const p of DE_FABRICA) crear.run(p.nombre, p.descripcion, JSON.stringify(p.permisos));
  console.log(`🔁 permisos: se crearon ${DE_FABRICA.length} perfiles para partir; se editan y se borran como cualquier otro dato.`);
}


/**
 * Quién cobra cuota mensual. Los cuerpos formales sí —tienen deberes y
 * derechos—; los grupos, que son agrupaciones de servicio sin obligaciones
 * formales, no. Cada uno lo cambia después en su ficha.
 *
 * Solo toca a los que todavía no lo tienen decidido, así que se puede repetir
 * sin pisar lo que alguien haya cambiado.
 */
function cuerposQueCobranCuota() {
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  if (!columnas.includes('cobra_cuota')) return;
  const r = db
    .prepare("UPDATE cuerpos SET cobra_cuota = CASE WHEN tipo = 'Cuerpo' THEN 1 ELSE 0 END WHERE cobra_cuota IS NULL")
    .run();
  if (r.changes) {
    console.log(`🔁 cuerpos: ${r.changes} cuerpo(s) quedaron con la cuota mensual según su tipo (los grupos no cobran).`);
  }
}


/**
 * Cada cuerpo lleva sus dos cuentas: su tesorería general y la de las cuotas
 * de sus integrantes, que se manejan aparte. Las demás —las de trabajos
 * específicos— las abre cada cuerpo cuando las necesita.
 *
 * No lleva marca de aplicada a propósito: revisa cuerpo por cuerpo cuáles le
 * faltan, así que también le sirve a los que se creen después de una
 * restauración o de un traspaso.
 */
function tesoreriaDeCadaCuerpo() {
  const columnas = db.prepare('PRAGMA table_info("cuentas_tesoreria")').all().map((c) => c.name);
  if (!columnas.includes('cuerpo_id')) return;

  const { crearLasQueFalten } = require('./cuentas-de-cuerpos');
  let cuentas = 0;
  for (const c of db.prepare('SELECT id, nombre, iglesia_id FROM cuerpos').all()) {
    cuentas += crearLasQueFalten(db, c);
  }
  if (cuentas) console.log(`🔁 cuerpos: se crearon ${cuentas} cuenta(s) de tesorería que faltaban.`);

  // Las cuotas que hubieran entrado a la tesorería general se pasan a la
  // cuenta de cuotas, que es donde corresponde que estén.
  const mudadas = db.prepare(
    `UPDATE tesoreria
        SET cuenta_id = (SELECT id FROM cuentas_tesoreria
                          WHERE cuerpo_id = tesoreria.cuerpo_id AND tipo = 'Cuotas de integrantes')
      WHERE id IN (SELECT movimiento_id FROM cuotas_cuerpo WHERE movimiento_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM cuentas_tesoreria
                     WHERE cuerpo_id = tesoreria.cuerpo_id AND tipo = 'Cuotas de integrantes')`
  ).run();
  if (mudadas.changes) {
    console.log(`🔁 cuotas: ${mudadas.changes} pago(s) pasaron a la cuenta de cuotas de su cuerpo.`);
  }
}


/**
 * El desarrollo y los acuerdos de un acta pasaron a ser texto con formato. Lo
 * que ya estaba escrito era texto pelado: se envuelve en párrafos para que se
 * siga leyendo igual —con sus saltos de línea— y no aparezca todo corrido.
 */
function actasConTextoConFormato() {
  if (yaAplicada('actas_texto_con_formato')) return;
  marcarAplicada('actas_texto_con_formato');

  const escapar = (t) => String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const enParrafos = (texto) => String(texto)
    .split(/\n{2,}/)
    .map((bloque) => `<p>${escapar(bloque.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const guardar = db.prepare('UPDATE actas_reuniones SET desarrollo = ?, acuerdos = ? WHERE id = ?');
  let convertidas = 0;
  for (const acta of db.prepare('SELECT id, desarrollo, acuerdos FROM actas_reuniones').all()) {
    const yaTieneFormato = (t) => /<(p|ul|ol|h3|h4|br|b|i|u)\b/i.test(String(t || ''));
    const arreglar = (t) => (!t || !String(t).trim() || yaTieneFormato(t) ? t : enParrafos(t));
    const desarrollo = arreglar(acta.desarrollo);
    const acuerdos = arreglar(acta.acuerdos);
    if (desarrollo === acta.desarrollo && acuerdos === acta.acuerdos) continue;
    guardar.run(desarrollo, acuerdos, acta.id);
    convertidas++;
  }
  if (convertidas) console.log(`🔁 actas: ${convertidas} acta(s) quedaron con su texto en párrafos.`);
}


/**
 * La pertenencia a un cuerpo era una lista de números guardada dentro del
 * propio cuerpo: se sabía quién estaba, y nada más. Ahora cada pertenencia es
 * una ficha con su estado, su fecha de ingreso y su período de prueba.
 *
 * Los que ya estaban pasan a "Activo": llevan tiempo en su cuerpo y no
 * corresponde mandarlos a un período de prueba que ya cumplieron. Sin fecha
 * de ingreso, porque no la tenemos y no se inventa.
 */
function integrantesConSuPropiaFicha() {
  if (yaAplicada('integrantes_con_ficha')) return;
  const columnas = db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name);
  if (!columnas.includes('integrantes')) return;   // nada que traspasar
  marcarAplicada('integrantes_con_ficha');

  const nueva = db.prepare(
    `INSERT INTO integrantes_cuerpo (cuerpo_id, miembro_id, estado, iglesia_id, observaciones)
     VALUES (?, ?, 'Activo', ?, ?)`
  );
  const yaEsta = db.prepare('SELECT id FROM integrantes_cuerpo WHERE cuerpo_id = ? AND miembro_id = ?');
  const existe = db.prepare('SELECT id FROM miembros WHERE id = ?');

  let fichas = 0;
  let perdidos = 0;
  for (const cuerpo of db.prepare('SELECT id, iglesia_id, integrantes FROM cuerpos').all()) {
    let ids = [];
    try { ids = JSON.parse(cuerpo.integrantes || '[]'); } catch (e) { ids = []; }
    for (const suelto of ids) {
      const miembroId = Number(suelto);
      if (!miembroId) continue;
      if (!existe.get(miembroId)) { perdidos++; continue; }   // el miembro ya no está
      if (yaEsta.get(cuerpo.id, miembroId)) continue;
      nueva.run(cuerpo.id, miembroId, cuerpo.iglesia_id, 'Venía de la lista anterior del cuerpo.');
      fichas++;
    }
  }

  if (fichas) {
    console.log(`🔁 cuerpos: ${fichas} pertenencia(s) pasaron a tener su propia ficha, como integrantes activos.`);
  }
  if (perdidos) {
    console.log(`ℹ️  cuerpos: ${perdidos} pertenencia(s) apuntaban a miembros que ya no existen y se descartaron.`);
  }
}


/**
 * La ofrenda de un servicio entraba a la tesorería de la iglesia ya
 * descontado el aporte para la corporación: de una ofrenda de cien mil se
 * anotaban noventa mil, y los diez mil aparecían en el fondo sin que se
 * viera de dónde habían salido.
 *
 * Ahora entra completa y el aporte sale como egreso de esa misma cuenta, con
 * su ingreso al otro lado. El saldo queda igual; lo que cambia es que se ve
 * lo que entró y lo que salió, cada cosa por su nombre.
 *
 * Los servicios ya registrados se rehacen con la misma regla. Si el registro
 * en tesorería está apagado no se toca nada: se deja para cuando se
 * encienda, porque rehacerlos ahí significaría borrar movimientos.
 */
function ofrendaEntraCompleta() {
  if (yaAplicada('ofrenda_entra_completa')) return;
  const ajustes = require('./ajustes');
  if (!ajustes.activo('ofrenda_registra_tesoreria')) return;

  const columnas = db.prepare('PRAGMA table_info("servicios")').all().map((c) => c.name);
  if (!columnas.includes('movimiento_aporte_id')) return;
  marcarAplicada('ofrenda_entra_completa');

  // Solo los que apartaron algo: los servicios traídos del sistema anterior
  // no apartaban nada, y su movimiento se deja tal como se importó.
  const { sincronizarOfrenda } = require('./ofrenda-tesoreria');
  const servicios = db
    .prepare(
      `SELECT * FROM servicios
        WHERE ofrenda_fondo > 0 AND (movimiento_iglesia_id IS NOT NULL OR movimiento_fondo_id IS NOT NULL)`
    )
    .all();
  for (const servicio of servicios) sincronizarOfrenda(servicio, db);

  if (servicios.length) {
    console.log(
      `🔁 ofrendas: ${servicios.length} servicio(s) quedaron con la ofrenda completa en la cuenta de la ` +
        'iglesia y el aporte a la corporación anotado como egreso.'
    );
  }
}


/**
 * Un cargo se escribe como se escribe un cargo: con mayúscula en cada
 * palabra. Antes se guardaban a media asta —«Pastor presidente»—; acá quedan
 * como corresponde, tanto en las fichas de Pastores / Guías como en los
 * tratos que alguien haya fijado a mano.
 */
function cargosConMayuscula() {
  const comoSeEscribe = new Map(CARGOS_MINISTERIO.map((c) => [c.toLowerCase(), c]));

  let fichas = 0;
  const enPastores = db.prepare('UPDATE pastores SET cargo = ? WHERE id = ?');
  for (const fila of db.prepare('SELECT id, cargo FROM pastores').all()) {
    const debido = comoSeEscribe.get(String(fila.cargo || '').toLowerCase());
    if (!debido || debido === fila.cargo) continue;
    enPastores.run(debido, fila.id);
    fichas++;
  }

  let tratos = 0;
  const columnas = db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name);
  if (columnas.includes('tratamiento_personalizado')) {
    const enMiembros = db.prepare('UPDATE miembros SET tratamiento_personalizado = ? WHERE id = ?');
    const filas = db
      .prepare(
        `SELECT id, tratamiento_personalizado AS trato FROM miembros
          WHERE tratamiento_personalizado IS NOT NULL AND tratamiento_personalizado != ''`
      )
      .all();
    for (const fila of filas) {
      if (fila.trato === CARGO_GUIA) continue;
      if (String(fila.trato).toLowerCase() !== CARGO_GUIA.toLowerCase()) continue;
      enMiembros.run(CARGO_GUIA, fila.id);
      tratos++;
    }
  }

  if (fichas || tratos) {
    console.log(
      `🔁 cargos: ${fichas} ficha(s) de Pastores / Guías y ${tratos} trato(s) fijados a mano ` +
        'quedaron escritos con la mayúscula que corresponde.'
    );
  }
}


/**
 * Los cargos del ministerio pasaron a la escala de la organización: Guía de
 * Obra, Pastor Probando, Pastor Diácono, Pastor Presbítero y Pastor
 * Presidente. "Guía" calza con "Guía de Obra"; los demás cargos antiguos se
 * conservan tal cual y se informan, para que se les ponga el que corresponde.
 */
function cargosDePastores() {
  const filas = db.prepare('SELECT id, nombres, apellidos, cargo FROM pastores').all();
  const porRevisar = [];
  let renombrados = 0;

  for (const fila of filas) {
    if (!fila.cargo || CARGOS_MINISTERIO.includes(fila.cargo)) continue;
    if (fila.cargo === 'Guía') {
      db.prepare('UPDATE pastores SET cargo = ? WHERE id = ?').run(CARGO_GUIA, fila.id);
      renombrados++;
      continue;
    }
    porRevisar.push(`${fila.nombres} ${fila.apellidos} (${fila.cargo})`);
  }

  if (renombrados) console.log(`🔁 pastores: ${renombrados} "Guía" pasaron a "${CARGO_GUIA}".`);
  if (porRevisar.length) {
    console.log(
      `ℹ️  pastores: ${porRevisar.length} ficha(s) tienen un cargo de la lista anterior y se conservan como estaban ` +
        `(${porRevisar.join(', ')}).\n   Ábralas y elija el cargo que corresponde en la escala nueva.`
    );
  }
}


/**
 * El administrador general de la organización.
 *
 * Es quien responde por todo el sistema y no lo acota nada: alcanza todas las
 * iglesias, todos los cuerpos y todas las acciones. En esta organización ese
 * lugar lo ocupa el RUT de más abajo.
 *
 * Si esa cuenta todavía no existe, se crea con la contraseña inicial del
 * sistema y con la obligación de cambiarla al entrar, igual que cualquier
 * cuenta nueva. Si ya existe, no se le toca la contraseña: solo se le quita
 * lo que la estuviera acotando —las iglesias y los cuerpos asignados, su
 * perfil de permisos y sus excepciones— y se le deja el rol de administrador.
 *
 * El nombre se toma de su ficha de miembro o de su ficha de Pastores / Guías,
 * si la tiene, y la cuenta queda enlazada a ella.
 *
 * Se hace una sola vez: de ahí en adelante los usuarios se administran desde
 * el propio sistema, como corresponde. La cuenta de fábrica no se toca, para
 * no quedarse sin puerta de entrada antes de comprobar que la nueva funciona.
 */
const ADMINISTRADOR_GENERAL = '3231140-7';

function administradorGeneral() {
  if (yaAplicada('administrador_general')) return;
  const columnas = new Set(db.prepare('PRAGMA table_info("usuarios")').all().map((c) => c.name));
  if (!columnas.has('rut') || !columnas.has('rol')) return;
  marcarAplicada('administrador_general');

  const nombres = require('./nombres');
  const ficha = db.prepare('SELECT id, nombres, apellidos FROM miembros WHERE rut = ?').get(ADMINISTRADOR_GENERAL);
  const pastor = ficha
    ? null
    : db.prepare('SELECT nombres, apellidos FROM pastores WHERE rut = ?').get(ADMINISTRADOR_GENERAL);
  const comoSeLlama = ficha
    ? nombres.paraMostrar(ficha.nombres, ficha.apellidos)
    : pastor
      ? nombres.paraMostrar(pastor.nombres, pastor.apellidos)
      : 'Administrador General';

  let cuenta = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(ADMINISTRADOR_GENERAL);
  if (!cuenta) {
    const bcrypt = require('bcryptjs');
    const inicial = require('./claves').inicial();
    db.prepare(
      `INSERT INTO usuarios (rut, nombre, password, rol, activo, password_origen, debe_cambiar_password)
       VALUES (?, ?, ?, 'admin', 1, 'inicial', 1)`
    ).run(ADMINISTRADOR_GENERAL, comoSeLlama, bcrypt.hashSync(inicial, 10));
    cuenta = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(ADMINISTRADOR_GENERAL);
    console.log(
      `👤 Administrador general creado: RUT ${ADMINISTRADOR_GENERAL} / ${inicial} ` +
        '(al entrar se le pedirá cambiarla).'
    );
  }

  // Se le quita todo lo que lo acote y se le deja el rol que corresponde
  const deja = [];
  const valores = [];
  const poner = (columna, valor) => {
    if (!columnas.has(columna)) return;
    if ((cuenta[columna] || null) === (valor || null)) return;
    deja.push(`"${columna}" = ?`);
    valores.push(valor);
  };
  poner('rol', 'admin');
  poner('iglesias', '[]');
  poner('cuerpos', '[]');
  poner('iglesia_id', null);
  poner('iglesias_trabajando', '[]');
  poner('perfil_id', null);
  poner('permisos', null);
  poner('activo', 1);
  if (ficha && columnas.has('miembro_id') && !cuenta.miembro_id) poner('miembro_id', ficha.id);
  if (comoSeLlama !== 'Administrador General') poner('nombre', comoSeLlama);

  if (deja.length) {
    db.prepare(`UPDATE usuarios SET ${deja.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(...valores, cuenta.id);
  }
  console.log(
    `👑 Administrador general: ${comoSeLlama} (RUT ${ADMINISTRADOR_GENERAL}) queda con acceso a todo, ` +
      'sin iglesias ni cuerpos que lo acoten.\n' +
      '   La cuenta de fábrica sigue como estaba: desactívela usted cuando compruebe que entra con esta.'
  );
}


/**
 * «Iglesia principal» decía dos cosas a la vez, y una no le correspondía.
 *
 * Su ayuda siempre dijo lo que es: con cuál trabaja por omisión, la que se
 * propone al crear registros. Quien decide **qué ve** cada persona es la otra
 * casilla, «Iglesias que administra». Pero el código sumaba la principal a lo
 * asignado, así que a quien solo tenía puesta la principal el sistema lo
 * encerraba en esa iglesia sin que el formulario lo dijera —y de paso le
 * escondía el botón para elegir con cuál trabajar, porque le quedaba una
 * sola—.
 *
 * Antes de cambiar la regla se copia esa iglesia a «Iglesias que administra»,
 * de modo que **nadie gane ni pierda acceso**: quien estaba acotado a una
 * sigue acotado a esa, pero ahora se ve escrito donde corresponde y se puede
 * cambiar. Se hace una sola vez.
 */
function iglesiaPrincipalNoEsAsignacion() {
  if (yaAplicada('principal_no_es_asignacion')) return;
  const columnas = db.prepare('PRAGMA table_info("usuarios")').all().map((c) => c.name);
  if (!columnas.includes('iglesias') || !columnas.includes('iglesia_id')) return;

  const acotados = db
    .prepare(
      `SELECT id, nombre, iglesia_id FROM usuarios
        WHERE iglesia_id IS NOT NULL
          AND (iglesias IS NULL OR iglesias = '' OR iglesias = '[]')`
    )
    .all();
  marcarAplicada('principal_no_es_asignacion');
  if (!acotados.length) return;

  const poner = db.prepare('UPDATE usuarios SET iglesias = ? WHERE id = ?');
  for (const u of acotados) poner.run(JSON.stringify([Number(u.iglesia_id)]), u.id);
  console.log(
    `🔁 usuarios: a ${acotados.length} cuenta(s) que solo tenían puesta la iglesia principal se les copió esa ` +
      `iglesia en "Iglesias que administra" (${acotados.map((u) => u.nombre).join(', ')}).\n` +
      '   Ven exactamente lo mismo que antes; ahora queda escrito donde se administra y se puede cambiar.'
  );
}


/**
 * Las categorías de tesorería salieron del programa y pasaron a ser datos que
 * la iglesia mantiene: se pueden crear, editar y desactivar desde el sistema.
 *
 * Se siembra la tabla con las que venían escritas —repartidas entre las que se
 * usan al recibir y las que se usan al gastar— y, además, con cualquier otra
 * que ya estuviera en uso en algún movimiento, deduciendo de qué tipo es por
 * cómo se ha usado. Ningún movimiento se toca: siguen guardando el nombre de
 * su categoría, igual que antes.
 *
 * Se puede repetir sin daño: solo agrega las que falten.
 */
function categoriasDeTesoreria() {
  const columnas = db.prepare('PRAGMA table_info("categorias_tesoreria")').all().map((c) => c.name);
  if (!columnas.includes('nombre')) return;

  const deFabrica = [
    ['Diezmos', 'Ingreso'], ['Ofrendas', 'Ingreso'], ['Primicias', 'Ingreso'],
    ['Pro-Templo', 'Ingreso'], ['Donaciones', 'Ingreso'],
    ['Servicios públicos', 'Egreso'], ['Calefacción', 'Egreso'], ['Mantenimiento', 'Egreso'],
    ['Compras', 'Egreso'], ['Útiles de aseo', 'Egreso'], ['Ayuda social', 'Egreso'],
    ['Honorarios', 'Egreso'], ['Viáticos', 'Egreso'],
    // «Aportes» va en los dos: la iglesia local recibe aportes y también los
    // entrega —el diez por ciento de cada ofrenda sale con esa categoría—.
    ['Aportes', 'Ambos'], ['Actividades', 'Ambos'], ['Traspaso', 'Ambos'], ['Otro', 'Ambos'],
  ];

  // Las que ya estaban en uso y no figuran arriba: el tipo se deduce de cómo
  // se han usado, que es más fiable que suponerlo.
  const enUso = db
    .prepare(
      `SELECT categoria AS nombre,
              SUM(CASE WHEN tipo = 'Ingreso' THEN 1 ELSE 0 END) AS ingresos,
              SUM(CASE WHEN tipo = 'Egreso' THEN 1 ELSE 0 END) AS egresos
         FROM tesoreria WHERE categoria IS NOT NULL AND categoria != ''
        GROUP BY categoria`
    )
    .all();
  const conocidas = new Set(deFabrica.map(([n]) => n.toLowerCase()));
  for (const c of enUso) {
    if (conocidas.has(String(c.nombre).toLowerCase())) continue;
    deFabrica.push([c.nombre, c.ingresos && c.egresos ? 'Ambos' : c.egresos ? 'Egreso' : 'Ingreso']);
  }

  const existe = db.prepare('SELECT id FROM categorias_tesoreria WHERE lower(nombre) = lower(?)');
  const agregar = db.prepare('INSERT INTO categorias_tesoreria (nombre, tipo, activo) VALUES (?, ?, 1)');
  let nuevas = 0;
  for (const [nombre, tipo] of deFabrica) {
    if (existe.get(nombre)) continue;
    agregar.run(nombre, tipo);
    nuevas++;
  }
  if (nuevas) {
    console.log(
      `🏷️  tesorería: ${nuevas} categoría(s) quedaron guardadas como datos y ya se pueden crear, ` +
        'editar y desactivar desde el sistema.'
    );
  }
}


/**
 * Las categorías con que se anotan las deudas.
 *
 * Los movimientos que deja una deuda —la plata que se recibe al contraerla y
 * cada cuota que se paga— tienen que caer en una categoría, y ninguna de las
 * dieciocho que traía el sistema hablaba de deudas: las más cercanas eran
 * «Aportes», «Donaciones» y «Otro», y las tres dicen algo distinto. Con ellas,
 * en el papel que se archiva, un préstamo quedaba escrito al lado de los
 * diezmos.
 *
 * Va aparte de la siembra de las otras diecisiete porque aquélla ya corrió en
 * las bases que existen. Se puede repetir sin daño: solo agrega las que falten,
 * comparando sin distinguir mayúsculas, para no pisar una que la iglesia haya
 * creado a mano con ese mismo nombre.
 *
 * Y SE REPITE EN CADA ARRANQUE, como la otra. Estaba marcada para correr una
 * sola vez, y eso dejaba un hueco: hasta la v1.342.0 estas cuatro se podían
 * borrar de un clic —lo que se midió en la revisión del módulo— y una base a la
 * que se las hubieran borrado no las recuperaba nunca, porque la siembra ya
 * figuraba aplicada. Desde ahora la guardia impide borrarlas y esto repone las
 * que falten en las bases donde ya se perdieron.
 */
function categoriasDeLasDeudas() {
  const columnas = db.prepare('PRAGMA table_info("categorias_tesoreria")').all().map((c) => c.name);
  if (!columnas.includes('nombre')) return;

  const { CATEGORIA } = require('./categorias-del-sistema');
  const cuales = [
    [CATEGORIA.DESEMBOLSO, 'Ingreso'],
    [CATEGORIA.PAGO, 'Egreso'],
    [CATEGORIA.PRESTADO, 'Egreso'],
    [CATEGORIA.COBRO, 'Ingreso'],
  ];
  const existe = db.prepare('SELECT id FROM categorias_tesoreria WHERE lower(nombre) = lower(?)');
  const agregar = db.prepare('INSERT INTO categorias_tesoreria (nombre, tipo, activo) VALUES (?, ?, 1)');
  let nuevas = 0;
  for (const [nombre, tipo] of cuales) {
    if (existe.get(nombre)) continue;
    agregar.run(nombre, tipo);
    nuevas += 1;
  }
  if (nuevas) {
    console.log(`🏷️  deudas: ${nuevas} categoría(s) de tesorería nuevas para los préstamos y sus pagos.`);
  }
}


/**
 * Los tipos de actividad y los motivos de ausencia salieron del programa y
 * pasaron a ser datos que la iglesia mantiene, como ya había pasado con las
 * categorías de tesorería.
 *
 * Se siembra cada lista con lo que venía escrito y, además, con cualquier otro
 * valor que ya estuviera en uso: una iglesia que importó datos del sistema
 * anterior puede tener tipos que nunca estuvieron en la lista de fábrica, y
 * desaparecerían del desplegable justo cuando se vuelven administrables.
 * Ninguna actividad ni marca se toca: siguen guardando su nombre, igual que
 * antes.
 *
 * Se puede repetir sin daño: solo agrega lo que falte.
 */
function listasDeAsistenciaComoDatos() {
  // PRAGMA no admite parámetros: se pregunta por el catálogo, que sí.
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

  let nuevos = 0;

  // ── Tipos de actividad ──
  if (hayTabla('tipos_actividad')) {
    const deFabrica = require('./actividades').TIPOS_DE_ACTIVIDAD.slice();
    const enUso = db
      .prepare("SELECT DISTINCT tipo_reunion AS nombre FROM asistencias WHERE tipo_reunion IS NOT NULL AND tipo_reunion != ''")
      .all().map((r) => r.nombre);
    const conocidos = new Set(deFabrica.map((n) => n.toLowerCase()));
    for (const n of enUso) if (!conocidos.has(String(n).toLowerCase())) deFabrica.push(n);

    const existe = db.prepare('SELECT id FROM tipos_actividad WHERE lower(nombre) = lower(?)');
    const agregar = db.prepare('INSERT INTO tipos_actividad (nombre, activo) VALUES (?, 1)');
    for (const nombre of deFabrica) {
      if (existe.get(nombre)) continue;
      agregar.run(nombre);
      nuevos++;
    }
  }

  // ── Motivos de ausencia ──
  if (hayTabla('motivos_ausencia')) {
    /*
     * Cuáles piden explicación es lo que decía el código: «Emergencia», «Otra
     * actividad de la iglesia» y «Otro motivo». Los que aparezcan por haberse
     * usado y no estén en esa lista se siembran SIN pedirla, que es lo que
     * venían haciendo: cambiarles la regla al migrar sería empezar a exigir
     * algo que antes no se exigía.
     */
    const conDetalle = new Set(
      require('./modules/asistencia_detalle').MOTIVOS_CON_DETALLE.map((m) => m.toLowerCase())
    );
    const deFabrica = ['Trabajo', 'Enfermedad', 'Emergencia', 'Otra actividad de la iglesia', 'Otro motivo'];
    const enUso = db
      .prepare("SELECT DISTINCT motivo AS nombre FROM asistencia_detalle WHERE motivo IS NOT NULL AND motivo != ''")
      .all().map((r) => r.nombre);
    const conocidos = new Set(deFabrica.map((n) => n.toLowerCase()));
    for (const n of enUso) if (!conocidos.has(String(n).toLowerCase())) deFabrica.push(n);

    const existe = db.prepare('SELECT id FROM motivos_ausencia WHERE lower(nombre) = lower(?)');
    const agregar = db.prepare('INSERT INTO motivos_ausencia (nombre, pide_detalle, activo) VALUES (?, ?, 1)');
    for (const nombre of deFabrica) {
      if (existe.get(nombre)) continue;
      agregar.run(nombre, conDetalle.has(String(nombre).toLowerCase()) ? 1 : 0);
      nuevos++;
    }
  }

  if (nuevos) {
    console.log(
      `🗓️  asistencia: ${nuevos} tipo(s) de actividad y motivo(s) de ausencia quedaron guardados como ` +
        'datos y ya se pueden crear, editar y desactivar desde el sistema.'
    );
  }
}


/**
 * Los tipos de documento de un pastor o guía pasaron a los ocho que pide la
 * iglesia: carnet, antecedentes, inhabilidades, los dos certificados de
 * matrimonio, el nombramiento, la carta de renuncia y "Otro Documento".
 *
 * Los que significan lo mismo se renombran solos —incluidos los que solo
 * cambiaban de mayúsculas—, y de los demás no queda ningún nombre antiguo
 * dando vueltas: pasan a "Otro Documento", que es el cajón de la lista, y
 * quedan anotados en el arranque para que se les ponga el que corresponde.
 *
 * Ningún documento se borra ni pierde su archivo: lo único que cambia es el
 * tipo con que está clasificado.
 */
function tiposDeDocumentoDePastores() {
  const columnas = db.prepare('PRAGMA table_info("documentos_pastores")').all().map((c) => c.name);
  if (!columnas.includes('tipo')) return;

  const modulo = require('./modules/documentos_pastores');
  const nuevos = modulo.fields.find((f) => f.name === 'tipo').options;
  const cajon = 'Otro Documento';
  const equivalencias = {
    'Carnet de identidad': 'Carnet de Identidad',
    'Certificado de antecedentes': 'Certificado de Antecedentes',
    'Certificado de matrimonio': 'Certificado de Matrimonio Civil',
    'Certificado de matrimonio civil': 'Certificado de Matrimonio Civil',
    'Certificado de matrimonio por la iglesia': 'Certificado de Matrimonio Iglesia',
    'Certificado de ordenación': 'Certificado de Nombramiento (Ordenacion)',
    'Nombramiento': 'Certificado de Nombramiento (Ordenacion)',
    'Otro': cajon,
    'Otros documentos': cajon,
  };

  let renombrados = 0;
  const renombrar = db.prepare('UPDATE documentos_pastores SET tipo = ? WHERE tipo = ?');
  for (const [antes, despues] of Object.entries(equivalencias)) {
    const cuantos = db.prepare('SELECT COUNT(*) AS n FROM documentos_pastores WHERE tipo = ?').get(antes).n;
    if (!cuantos) continue;
    renombrar.run(despues, antes);
    renombrados += cuantos;
  }
  if (renombrados) {
    console.log(`🔁 documentos de pastores: ${renombrados} documento(s) pasaron a los tipos nuevos.`);
  }

  const marcas = nuevos.map(() => '?').join(',');
  const sobran = db
    .prepare(
      `SELECT tipo, COUNT(*) AS n FROM documentos_pastores
        WHERE tipo IS NOT NULL AND tipo != '' AND tipo NOT IN (${marcas})
        GROUP BY tipo`
    )
    .all(...nuevos);
  if (sobran.length) {
    db.prepare(`UPDATE documentos_pastores SET tipo = ? WHERE tipo NOT IN (${marcas})`).run(cajon, ...nuevos);
    console.log(
      `🔁 documentos de pastores: ${sobran.reduce((t, f) => t + f.n, 0)} documento(s) tenían un tipo que ya no ` +
        `está en la lista y quedaron como "${cajon}" (${sobran.map((f) => `${f.tipo}: ${f.n}`).join(', ')}).\n` +
      '   Ábralos y elija el que corresponde.'
    );
  }
}


/**
 * Los tratos son los que usa la iglesia: hermano, hermana, oficial, guía de
 * obra, pastor y pastora. Si alguna ficha quedó con otro fijado a mano, se
 * deja en blanco para que el sistema vuelva a calcularlo, y se informa de
 * quiénes se trata.
 */
function tratamientosPermitidos() {
  const columnas = db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name);
  if (!columnas.includes('tratamiento_personalizado')) return;

  const { TRATAMIENTOS: permitidos } = require('./tratamiento');
  const marcas = permitidos.map(() => '?').join(',');
  const fuera = db
    .prepare(
      `SELECT id, nombres, apellidos, tratamiento_personalizado AS trato FROM miembros
        WHERE tratamiento_personalizado IS NOT NULL AND tratamiento_personalizado != ''
          AND tratamiento_personalizado NOT IN (${marcas})`
    )
    .all(...permitidos);
  if (!fuera.length) return;

  const limpiar = db.prepare('UPDATE miembros SET tratamiento_personalizado = NULL WHERE id = ?');
  for (const f of fuera) limpiar.run(f.id);
  console.log(
    `🔁 miembros: ${fuera.length} trato(s) fijados a mano no están entre los que se usan y se dejaron en ` +
      `blanco, para que el sistema los calcule: ${fuera.map((f) => `${f.nombres} ${f.apellidos} (era "${f.trato}")`).join(', ')}.`
  );
}


/**
 * Marca como "Miembro Menor de Edad" a quienes todavía no cumplen 18 años y
 * no tienen tipo de miembro registrado. Es lo único que se puede deducir sin
 * suponer nada: el resto de los tipos (nuevo, oyente, activo, líder) los
 * decide la iglesia, así que quedan en blanco a la espera.
 */
function menoresDeEdadComoTipoDeMiembro() {
  if (yaAplicada('tipo_miembro_menores')) return; // se completa una sola vez
  const columnas = db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name);
  if (!columnas.includes('tipo_miembro') || !columnas.includes('fecha_nacimiento')) return;

  const menores = db
    .prepare(
      `SELECT id FROM miembros
        WHERE (tipo_miembro IS NULL OR tipo_miembro = '')
          AND fecha_nacimiento IS NOT NULL AND fecha_nacimiento != ''
          AND date(fecha_nacimiento) > date('now','localtime','-18 years')`
    )
    .all();
  marcarAplicada('tipo_miembro_menores');
  if (!menores.length) return;

  const marcar = db.prepare(`UPDATE miembros SET tipo_miembro = 'Miembro Menor de Edad' WHERE id = ?`);
  for (const m of menores) marcar.run(m.id);
  console.log(
    `🔁 miembros: ${menores.length} menor(es) de 18 años quedaron como "Miembro Menor de Edad". ` +
      'El tipo de los demás queda en blanco: lo decide la iglesia.'
  );
}


/**
 * La ficha del miembro ya no pide "Otro documento (pasaporte / extranjero)".
 * La columna se conserva —nada de lo escrito se borra—, pero deja de verse,
 * así que se avisa una vez de cuántas fichas traían algo ahí.
 */
function avisoOtroDocumentoDeMiembros() {
  if (yaAplicada('aviso_otro_documento_miembros')) return;
  const columnas = db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name);
  if (!columnas.includes('documento_identidad')) return;

  const conDato = db
    .prepare(`SELECT nombres, apellidos, documento_identidad AS doc FROM miembros
               WHERE documento_identidad IS NOT NULL AND documento_identidad != ''`)
    .all();
  marcarAplicada('aviso_otro_documento_miembros');
  if (!conDato.length) return;
  console.log(
    `ℹ️  miembros: ${conDato.length} ficha(s) tenían algo escrito en "Otro documento", campo que ya no se usa ` +
      `(${conDato.map((f) => `${f.nombres} ${f.apellidos}: ${f.doc}`).join(', ')}).\n` +
      '   El dato sigue guardado en la base de datos, solo dejó de mostrarse.'
  );
}


/**
 * Las actividades a las que se toma asistencia pasaron a la lista que usa la
 * iglesia. Las que tienen el mismo sentido se renombran solas; de las demás
 * no queda ningún nombre antiguo dando vueltas: pasan a "Otros", que es lo
 * que la lista ofrece para lo que no calza en ninguna.
 *
 * No se borra ninguna actividad ni ninguna asistencia: solo cambia el nombre
 * con que están clasificadas, y queda anotado cuáles fueron por si alguien
 * quiere ponerles después la que corresponde.
 */
function tiposDeActividad() {
  const columnas = db.prepare('PRAGMA table_info("asistencias")').all().map((c) => c.name);
  if (!columnas.includes('tipo_reunion')) return;

  const equivalencias = {
    'Culto general': 'Servicio General',
    'Culto de oración': 'Oración',
    'Estudio bíblico': 'Estudio Bíblico',
    'Vigilia': 'Servicio Vigilia',
    'Otra': 'Otros',
  };
  const nuevos = [
    'Servicio General', 'Servicio Especial', 'Servicio Vigilia', 'Clase de Dorcas',
    'Estudio Bíblico', 'Oración', 'Ensayo', 'Salida a Visitar', 'Salida a Gira',
    'Reunión Administrativa', 'Reunión Directivas', 'Otros',
  ];

  const renombrar = db.prepare('UPDATE asistencias SET tipo_reunion = ? WHERE tipo_reunion = ?');
  let renombradas = 0;
  for (const [antes, despues] of Object.entries(equivalencias)) {
    const cuantas = db.prepare('SELECT COUNT(*) AS n FROM asistencias WHERE tipo_reunion = ?').get(antes).n;
    if (!cuantas) continue;
    renombrar.run(despues, antes);
    renombradas += cuantas;
  }
  if (renombradas) console.log(`🔁 asistencias: ${renombradas} actividad(es) pasaron a los nombres nuevos.`);

  const marcas = nuevos.map(() => '?').join(',');
  const sobran = db
    .prepare(
      `SELECT tipo_reunion AS tipo, COUNT(*) AS n FROM asistencias
        WHERE tipo_reunion IS NOT NULL AND tipo_reunion != '' AND tipo_reunion NOT IN (${marcas})
        GROUP BY tipo_reunion`
    )
    .all(...nuevos);
  if (sobran.length) {
    db.prepare(`UPDATE asistencias SET tipo_reunion = 'Otros' WHERE tipo_reunion NOT IN (${marcas})`).run(...nuevos);
    console.log(
      `🔁 asistencias: ${sobran.reduce((t, f) => t + f.n, 0)} actividad(es) tenían un tipo que ya no está en la lista ` +
        `y quedaron como "Otros" (${sobran.map((f) => `${f.tipo}: ${f.n}`).join(', ')}).\n` +
        '   Sus asistencias no se tocaron; si alguna corresponde a otra actividad, ábrala y elíjala.'
    );
  }
}


/**
 * Corre todas las migraciones, cada una por su cuenta.
 *
 * Si alguna falla —una base con datos inesperados, el disco lleno—, se anota
 * en el registro y se sigue con las demás: **el sistema tiene que levantar
 * igual**. Que no se pueda transformar un dato viejo no es razón para dejar a
 * la iglesia sin poder entrar; los datos quedan como estaban y el aviso dice
 * qué revisar.
 */
/**
 * La forma de ingreso pasó a la lista que usa la iglesia. Las que significan
 * lo mismo se renombran solas y las demás quedan como "Otro": no se deja
 * ningún nombre antiguo dando vueltas. Nadie pierde su ficha: solo cambia el
 * nombre con que está clasificada.
 */
function formasDeIngreso() {
  const columnas = db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name);
  if (!columnas.includes('forma_ingreso')) return;

  const equivalencias = {
    'Traslado de otra iglesia': 'Traslado de Iglesia',
    'Nacido(a) en la iglesia': 'Nacido en la Iglesia',
  };
  const nuevas = [
    'Servicio General', 'Redes Sociales', 'Traslado de Iglesia', 'Nacido en la Iglesia',
    'Campaña Evangelística', 'Invitación de Hermano(a)', 'Otro',
  ];

  let renombradas = 0;
  const renombrar = db.prepare('UPDATE miembros SET forma_ingreso = ? WHERE forma_ingreso = ?');
  for (const [antes, despues] of Object.entries(equivalencias)) {
    const cuantas = db.prepare('SELECT COUNT(*) AS n FROM miembros WHERE forma_ingreso = ?').get(antes).n;
    if (!cuantas) continue;
    renombrar.run(despues, antes);
    renombradas += cuantas;
  }
  if (renombradas) console.log(`🔁 miembros: ${renombradas} forma(s) de ingreso pasaron a los nombres nuevos.`);

  const marcas = nuevas.map(() => '?').join(',');
  const sobran = db
    .prepare(
      `SELECT forma_ingreso AS forma, COUNT(*) AS n FROM miembros
        WHERE forma_ingreso IS NOT NULL AND forma_ingreso != '' AND forma_ingreso NOT IN (${marcas})
        GROUP BY forma_ingreso`
    )
    .all(...nuevas);
  if (sobran.length) {
    db.prepare(`UPDATE miembros SET forma_ingreso = 'Otro' WHERE forma_ingreso NOT IN (${marcas})`).run(...nuevas);
    console.log(
      `🔁 miembros: ${sobran.reduce((t, f) => t + f.n, 0)} ficha(s) tenían una forma de ingreso que ya no está en la ` +
        `lista y quedaron como "Otro" (${sobran.map((f) => `${f.forma}: ${f.n}`).join(', ')}).`
    );
  }
}


/**
 * Los tipos de servicio pasaron a los que celebra la iglesia. Los que
 * significan lo mismo se renombran solos y los demás quedan como "Otro": no
 * se deja ningún nombre antiguo dando vueltas. Ningún servicio se borra, ni
 * lo que tenga registrado.
 */
function tiposDeServicio() {
  const columnas = db.prepare('PRAGMA table_info("servicios")').all().map((c) => c.name);
  if (!columnas.includes('tipo')) return;

  const equivalencias = {
    'Culto general': 'Servicio General',
    'Vigilia': 'Servicio Vigilia',
    'Servicio especial': 'Servicio Especial',
  };
  const nuevos = ['Servicio General', 'Clase de Dorcas', 'Servicio Especial', 'Servicio Vigilia', 'Otro'];

  let renombrados = 0;
  const renombrar = db.prepare('UPDATE servicios SET tipo = ? WHERE tipo = ?');
  for (const [antes, despues] of Object.entries(equivalencias)) {
    const cuantos = db.prepare('SELECT COUNT(*) AS n FROM servicios WHERE tipo = ?').get(antes).n;
    if (!cuantos) continue;
    renombrar.run(despues, antes);
    renombrados += cuantos;
  }
  if (renombrados) console.log(`🔁 servicios: ${renombrados} servicio(s) pasaron a los nombres nuevos.`);

  const marcas = nuevos.map(() => '?').join(',');
  const sobran = db
    .prepare(
      `SELECT tipo, COUNT(*) AS n FROM servicios
        WHERE tipo IS NOT NULL AND tipo != '' AND tipo NOT IN (${marcas})
        GROUP BY tipo`
    )
    .all(...nuevos);
  if (sobran.length) {
    db.prepare(`UPDATE servicios SET tipo = 'Otro' WHERE tipo NOT IN (${marcas})`).run(...nuevos);
    console.log(
      `🔁 servicios: ${sobran.reduce((t, f) => t + f.n, 0)} servicio(s) tenían un tipo que ya no está en la lista ` +
        `y quedaron como "Otro" (${sobran.map((f) => `${f.tipo}: ${f.n}`).join(', ')}).`
    );
  }
}


/**
 * El nombre oficial de la institución es «Iglesia Pentecostal Triunfante La
 * Nueva Jerusalén», todo junto: «La Nueva Jerusalén» no es un lema, es parte
 * del nombre. Antes venían separados, con el segundo puesto como lema.
 *
 * Solo se cambia lo que quedó de aquella separación: si alguien ya escribió
 * otro nombre o su propio lema, se respeta.
 */
function nombreOficialDeLaIglesia() {
  if (yaAplicada('nombre_oficial_iglesia')) return;
  const NOMBRE = 'Iglesia Pentecostal Triunfante La Nueva Jerusalén';
  const ANTES = 'Iglesia Pentecostal Triunfante';
  const LEMA_ANTES = '«La Nueva Jerusalén»';

  const valor = (clave) => {
    const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
    return fila ? fila.valor : null;
  };
  const guardar = (clave, nuevo) =>
    db.prepare(
      `INSERT INTO configuracion (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now','localtime')`
    ).run(clave, nuevo);

  marcarAplicada('nombre_oficial_iglesia');

  const nombre = valor('iglesia_nombre');
  const lema = valor('iglesia_lema');
  let cambios = 0;
  if (nombre === null || nombre.trim() === '' || nombre.trim() === ANTES) {
    guardar('iglesia_nombre', NOMBRE);
    cambios++;
  }
  if (lema !== null && lema.trim() === LEMA_ANTES) {
    guardar('iglesia_lema', '');
    cambios++;
  }
  if (cambios) console.log(`🔁 identidad: el nombre oficial quedó como "${NOMBRE}".`);
}

/**
 * Las cuentas que ya existían no saben de dónde salió su contraseña. Se
 * marcan como elegidas por su dueño —que es lo más probable: llevan tiempo
 * usándose— para no obligar a nadie a cambiarla de golpe. La única excepción
 * es el administrador de fábrica, que si sigue con "admin123" debe cambiarla.
 */
function origenDeLasContrasenas() {
  if (yaAplicada('origen_contrasenas')) return;
  const columnas = db.prepare('PRAGMA table_info("usuarios")').all().map((c) => c.name);
  if (!columnas.includes('password_origen')) return;

  const bcrypt = require('bcryptjs');
  const cuentas = db.prepare('SELECT id, rut, password FROM usuarios WHERE password_origen IS NULL').all();
  marcarAplicada('origen_contrasenas');
  if (!cuentas.length) return;

  const propia = db.prepare(`UPDATE usuarios SET password_origen = 'usuario', debe_cambiar_password = 0 WHERE id = ?`);
  const deFabrica = db.prepare(`UPDATE usuarios SET password_origen = 'inicial', debe_cambiar_password = 1 WHERE id = ?`);
  let pendientes = 0;
  for (const cuenta of cuentas) {
    const esDeFabrica = cuenta.password && bcrypt.compareSync('admin123', cuenta.password);
    if (esDeFabrica) {
      deFabrica.run(cuenta.id);
      pendientes++;
    } else {
      propia.run(cuenta.id);
    }
  }
  console.log(
    `🔁 usuarios: ${cuentas.length} cuenta(s) revisadas. ` +
      (pendientes
        ? `${pendientes} sigue(n) con la contraseña de fábrica y tendrá(n) que cambiarla al entrar.`
        : 'Ninguna con la contraseña de fábrica.')
  );
}


/**
 * El cuerpo de cada movimiento sale de su cuenta.
 *
 * Hasta ahora era un campo suelto que se escribía a mano: un movimiento podía
 * estar en la cuenta del cuerpo Dorcas y no decirlo, o decir que era de otro.
 * El panel de la ficha del cuerpo filtra por ese campo, así que la tesorería
 * que mostraba estaba incompleta —faltaban los movimientos que nadie marcó—.
 *
 * Desde ahora se toma de la cuenta al guardar. Acá se pone al día lo de antes:
 * cada movimiento queda con el cuerpo de su cuenta, y los que están en una
 * cuenta que no es de ningún cuerpo quedan sin cuerpo, como corresponde.
 */
function movimientosConElCuerpoDeSuCuenta() {
  const columnas = db.prepare('PRAGMA table_info(tesoreria)').all().map((c) => c.name);
  if (!columnas.includes('cuerpo_id') || !columnas.includes('cuenta_id')) return;

  const descuadrados = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM tesoreria t LEFT JOIN cuentas_tesoreria k ON k.id = t.cuenta_id
        WHERE IFNULL(t.cuerpo_id, 0) <> IFNULL(k.cuerpo_id, 0)`
    )
    .get().c;
  if (!descuadrados) return;

  db.prepare(
    `UPDATE tesoreria
        SET cuerpo_id = (SELECT k.cuerpo_id FROM cuentas_tesoreria k WHERE k.id = tesoreria.cuenta_id)
      WHERE IFNULL(cuerpo_id, 0) <> IFNULL(
              (SELECT IFNULL(k.cuerpo_id, 0) FROM cuentas_tesoreria k WHERE k.id = tesoreria.cuenta_id), 0)`
  ).run();

  console.log(
    `🔁 tesorería: ${descuadrados} movimiento(s) quedaron con el cuerpo de su cuenta. ` +
      'Antes ese dato se escribía a mano y podía no coincidir; ahora sale de la cuenta.'
  );
}


/**
 * Credenciales: partir de cero, una sola vez.
 *
 * La especificación del módulo de credenciales pide borrar las que había y
 * empezar el correlativo desde el principio (punto 13.1), porque las que
 * existían venían del sistema anterior, sin número de serie ni dígito
 * verificador, y no corresponden al documento que se emite ahora.
 *
 * Es la única migración de todo el sistema que borra datos, así que:
 *
 *   · corre UNA sola vez y deja la marca puesta. Si mañana se emiten
 *     credenciales nuevas, un despliegue no vuelve a borrarlas;
 *   · anota en el Registro de Cambios cuántas borró, con fecha y hora, para
 *     que quede constancia de qué había antes;
 *   · y no toca ninguna otra tabla.
 *
 * IMPORTANTE PARA QUIEN PUBLIQUE ESTA VERSIÓN: bajar el respaldo completo
 * desde Configuración ANTES de publicar. Esto no se puede deshacer desde el
 * sistema; se deshace restaurando ese respaldo.
 */
function credencialesDesdeCero() {
  const columnas = db.prepare('PRAGMA table_info(credenciales)').all().map((c) => c.name);
  if (!columnas.length) return; // la tabla se crea al arrancar; nada que limpiar

  const hecho = db.prepare("SELECT valor FROM configuracion WHERE clave = 'credenciales_desde_cero'").get();
  if (hecho && hecho.valor) return; // ya se hizo: no se vuelve a borrar nunca

  const cuantas = db.prepare('SELECT COUNT(*) AS c FROM credenciales').get().c;

  db.transaction(() => {
    if (cuantas) {
      db.prepare(
        `INSERT INTO registro_cambios (fecha, hora, modulo, accion, registro, detalle, usuario)
         VALUES (date('now','localtime'), strftime('%H:%M','now','localtime'),
                 'Credenciales', 'Eliminación', 'Limpieza inicial del módulo', ?, 'Sistema')`
      ).run(
        `Se eliminaron ${cuantas} credencial(es) anteriores al implementar la credencial pastoral, ` +
        'según el punto 13.1 de la especificación. El correlativo parte desde el comienzo.'
      );
      db.prepare('DELETE FROM credenciales').run();
    }
    db.prepare(
      `INSERT INTO configuracion (clave, valor) VALUES ('credenciales_desde_cero', datetime('now','localtime'))
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`
    ).run();
  }).immediate();

  // El contador vuelve a cero: el primer número que se entregue será el 001
  try { require('./credenciales/serie').fijarContador(0); } catch (e) { /* aún no existe: se crea en cero */ }

  console.log(
    cuantas
      ? `🔁 credenciales: se eliminaron ${cuantas} anteriores y el correlativo parte desde el comienzo (punto 13.1). Queda constancia en el Registro de Cambios.`
      : '🔁 credenciales: no había ninguna cargada; el correlativo parte desde el comienzo.'
  );
}

/**
 * Y si alguna vez el contador quedara por debajo de lo ya emitido, se sube.
 *
 * No debería pasar —el contador solo sube—, pero si se restaura un respaldo
 * viejo junto a credenciales nuevas, el próximo número repetiría uno ya
 * impreso. Acá se comprueba y se corrige hacia arriba, nunca hacia abajo.
 */
function contadorDeCredencialesAlDia() {
  // Se pregunta siempre, aunque no haya credenciales: así el contador queda
  // creado desde el primer arranque y no en medio de la primera emisión.
  const serie = require('./credenciales/serie');
  const yaVa = serie.cuantasSeHanGenerado();
  const columnas = db.prepare('PRAGMA table_info(credenciales)').all().map((c) => c.name);
  if (!columnas.includes('correlativo')) return;
  const mayor = db.prepare('SELECT MAX(correlativo) AS n FROM credenciales').get().n || 0;
  if (mayor > yaVa) {
    serie.fijarContador(mayor);
    console.log(`🔁 credenciales: el contador se puso al día en ${mayor}, para no repetir un número ya emitido.`);
  }
}


/**
 * Vuelve a pasar el filtro por el texto con formato que ya estaba guardado.
 *
 * POR QUÉ HACE FALTA. Hasta la 1.96.1, el filtro de server/textorico.js
 * reconocía una etiqueta por su «>» de cierre, así que una etiqueta SIN CERRAR
 * —`<img src=x onerror=…` — pasaba entera y quedaba guardada tal cual. Suelta
 * no hacía nada; envuelta en el `<div class="dato-rico">…</div>` con que se
 * pinta el acta, el «</div>» le prestaba el «>» que le faltaba y ahí nacía un
 * elemento de verdad, con su manejador de evento puesto.
 *
 * El filtro ya quedó arreglado, pero eso solo vale para lo que se guarde de
 * ahora en adelante. Lo que se guardó antes sigue como estaba, y es
 * justamente lo que se muestra e imprime. Por eso hay que volver a pasarlo.
 *
 * SE PUEDE VOLVER A PASAR SIN MIEDO. Todo lo que hay guardado salió de este
 * mismo filtro, y el filtro es punto fijo: limpiar algo ya limpio lo deja
 * igual. Así que esta migración no puede alterar el contenido de un acta
 * legítima; solo toca las filas que traen el agujero. Y para que eso no
 * dependa de una promesa, se comprueba fila por fila: si lo que sale es
 * idéntico a lo que había, no se escribe nada.
 *
 * Nada se borra. Un texto que quedara vacío después de limpiarlo se deja como
 * estaba: en un acta, perder el desarrollo sería peor que dejar una etiqueta
 * escrita como texto.
 */
function textoConFormatoSaneadoDeNuevo() {
  if (yaAplicada('texto_rico_saneado_1_96_1')) return;
  marcarAplicada('texto_rico_saneado_1_96_1');

  const { limpiar } = require('./textorico');

  /** Dónde vive el texto con formato: tabla y columnas. */
  const DONDE = [
    ['actas_reuniones', ['desarrollo', 'acuerdos']],
    ['evaluaciones_integrantes', ['informe']],
  ];

  let arregladas = 0;
  for (const [tabla, columnas] of DONDE) {
    let existentes;
    try {
      existentes = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
    } catch (e) {
      continue; // la tabla todavía no existe: no hay nada que sanear
    }
    const suyas = columnas.filter((c) => existentes.has(c));
    if (!suyas.length) continue;

    const guardar = db.prepare(
      `UPDATE "${tabla}" SET ${suyas.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`
    );
    const filas = db.prepare(`SELECT id, ${suyas.map((c) => `"${c}"`).join(', ')} FROM "${tabla}"`).all();
    for (const fila of filas) {
      const nuevos = suyas.map((c) => {
        const antes = fila[c];
        if (antes == null || !String(antes).trim()) return antes;
        const despues = limpiar(antes);
        // Si al limpiarlo no queda nada, se deja lo que había: en un acta,
        // quedarse sin desarrollo es peor que una etiqueta escrita como texto.
        return despues == null ? antes : despues;
      });
      if (nuevos.every((v, i) => v === fila[suyas[i]])) continue;
      guardar.run(...nuevos, fila.id);
      arregladas++;
    }
  }

  if (arregladas) {
    console.log(
      `🔁 texto con formato: ${arregladas} registro(s) traían una etiqueta sin cerrar y quedaron saneados.`
    );
  }
}

/**
 * Marca cuál cuerpo es la directiva, en las iglesias que ya tenían uno.
 *
 * Desde ahora los miembros líderes entran y salen solos de la directiva de su
 * iglesia (ver server/directiva.js), y para eso el cuerpo tiene que decir de
 * sí mismo que lo es. Una iglesia que ya llevaba su directiva registrada como
 * un cuerpo más no tiene por qué ir a marcarla: se deduce del nombre UNA vez,
 * acá, y de ahí en adelante manda la marca.
 *
 * Se deduce del nombre solo en la migración y nunca en la regla del día a día.
 * Es la diferencia entre adivinar una vez, con el resultado a la vista y
 * corregible, y adivinar en cada guardado: lo segundo se rompe en silencio el
 * día que alguien renombra el cuerpo.
 *
 * Se reconocen «Directiva», «Directivas» y lo que empiece por ahí —«Directiva
 * General», «Directiva de la Iglesia»— sin distinguir mayúsculas ni tildes. Si
 * en una iglesia calzan varios, se marca el de nombre más corto: entre
 * «Directiva» y «Directiva de Damas», la directiva de la iglesia es la
 * primera. Y NO se mete a nadie: solo se pone la marca. A los líderes los
 * hace entrar la regla la próxima vez que se guarde su ficha, o el barrido de
 * abajo si el cuerpo se marca a mano.
 */
function directivaDeCadaIglesia() {
  const NOMBRE = 'directiva de cada iglesia';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('cuerpos')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name));
  if (!columnas.has('reune_lideres')) return; // la columna se crea al arrancar; se intentará de nuevo

  const sinTildes = (t) =>
    String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  const marcados = [];
  db.transaction(() => {
    const iglesias = db.prepare('SELECT id, nombre FROM iglesias').all();
    const marcar = db.prepare('UPDATE cuerpos SET reune_lideres = 1 WHERE id = ?');
    for (const ig of iglesias) {
      const yaMarcado = db
        .prepare('SELECT id FROM cuerpos WHERE iglesia_id = ? AND reune_lideres = 1')
        .get(ig.id);
      if (yaMarcado) continue;

      const candidatos = db
        .prepare('SELECT id, nombre FROM cuerpos WHERE iglesia_id = ?')
        .all(ig.id)
        .filter((c) => sinTildes(c.nombre).startsWith('directiva'))
        .sort((a, b) => String(a.nombre).length - String(b.nombre).length);
      if (!candidatos.length) continue;

      marcar.run(candidatos[0].id);
      marcados.push(`${candidatos[0].nombre} (${ig.nombre})`);
    }
  }).immediate();

  if (marcados.length) {
    console.log(
      `🏛️  directiva: ${marcados.length} cuerpo(s) quedaron marcados como la directiva de su iglesia ` +
        `— ${marcados.slice(0, 3).join(', ')}${marcados.length > 3 ? '…' : ''}. ` +
        'Los miembros líderes entran y salen de ahí solos.'
    );
  }
  marcarAplicada(NOMBRE);
}

/**
 * Devuelve a su cuerpo a quienes la regla de la directiva sacó por error.
 *
 * La primera versión de esa regla (1.107.0) trataba la directiva como
 * EXACTAMENTE el conjunto de los miembros líderes, así que al guardar la ficha
 * de cualquier integrante que no lo fuera —el secretario, la tesorera,
 * cualquiera que la iglesia hubiera puesto a mano— lo retiraba del cuerpo. En
 * silencio y de a uno, a medida que se iban guardando fichas por otros
 * motivos: un cuerpo de veintisiete quedó en tres sin que nada lo dijera, y se
 * notó al ir a pasar la lista.
 *
 * POR QUÉ ESTA ES LA SEGUNDA VERSIÓN. La primera reparación (1.107.1) no
 * devolvió a nadie. Pedía que la ficha tuviera fecha de ingreso y que fuera
 * anterior al retiro, creyendo que así distinguía al que ya estaba en el
 * cuerpo del que la regla había metido y sacado el mismo día. Pero las fichas
 * de los integrantes que venían de antes las creó la migración «integrantes
 * con su ficha», que NO les puso fecha de ingreso: quedó en nulo. O sea que la
 * condición dejaba fuera justo a toda la gente que había que devolver. La
 * reparación corrió, no encontró a nadie, se dio por aplicada, y el cuerpo
 * siguió mostrando tres integrantes.
 *
 * A QUIÉNES SE DEVUELVE. A los que cumplen las cuatro cosas a la vez:
 *
 *   · Están retirados con EXACTAMENTE el motivo que escribía esa regla.
 *   · Su ficha no lleva la marca de automática, o sea que no la puso la regla
 *     —a los que metió ella y después sacó por dejar de ser líderes se los
 *     retiró con razón, y esos se quedan afuera—.
 *   · Están en un cuerpo marcado como directiva, que es el único lugar donde
 *     la regla llegó a meter mano.
 *   · Se los retiró DESPUÉS del día en que la regla empezó a existir en este
 *     servidor. Esa fecha no se adivina: la deja anotada la migración que
 *     marcó los cuerpos de directiva. Así, una salida que una persona escribió
 *     con esas mismas palabras antes de todo esto no se toca.
 *
 * EN QUÉ ESTADO VUELVE. En el que tenía. Si le quedó una fecha de fin de
 * prueba por delante, estaba en prueba; si no, era integrante activo. Se puede
 * reconstruir porque la regla solo cambió el estado y el retiro, y no tocó
 * nada más de la ficha —ni la fecha de ingreso, que sigue siendo la suya—.
 *
 * Y se anota en la bitácora de cada persona, porque la salida también quedó
 * anotada: sin esto, su historial diría que salió del cuerpo y nunca volvió.
 */
function devolverLosQueLaDirectivaSaco() {
  // Nombre nuevo a propósito: en los servidores donde ya corrió la reparación
  // equivocada, aquella quedó marcada como aplicada y no volvería a correr
  const NOMBRE = 'devolver los que la directiva sacó (corregida)';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('integrantes_cuerpo') || !hayTabla('cuerpos')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info("integrantes_cuerpo")').all().map((c) => c.name));
  if (!columnas.has('automatico')) return; // la columna se crea al arrancar; se intentará de nuevo
  const deCuerpos = new Set(db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name));
  if (!deCuerpos.has('reune_lideres')) return;

  const MOTIVO = require('./directiva').MOTIVO_DE_FABRICA;
  const bitacora = require('./bitacora');

  /**
   * Desde cuándo pudo la regla haber retirado a alguien: desde que se marcaron
   * los cuerpos de directiva en este servidor. Si por lo que sea no está
   * anotado, se usa el día en que salió la versión que trajo la regla, que es
   * un piso igual de seguro.
   */
  const marca = db
    .prepare("SELECT date(aplicada_en) AS dia FROM migraciones WHERE nombre = 'directiva de cada iglesia'")
    .get();
  const desde = (marca && marca.dia) || '2026-08-25';

  const echados = db
    .prepare(
      `SELECT i.id, i.miembro_id, i.cuerpo_id, i.iglesia_id, i.fecha_fin_prueba, c.nombre AS cuerpo
         FROM integrantes_cuerpo i
         JOIN cuerpos c ON c.id = i.cuerpo_id
        WHERE i.estado = 'Retirado'
          AND i.motivo_retiro = ?
          AND (i.automatico IS NULL OR i.automatico = 0)
          AND c.reune_lideres = 1
          AND i.fecha_retiro IS NOT NULL
          AND i.fecha_retiro >= ?`
    )
    .all(MOTIVO, desde);

  if (!echados.length) return marcarAplicada(NOMBRE);

  const hoy = require('./fechas').hoy();
  db.transaction(() => {
    const devolver = db.prepare(
      `UPDATE integrantes_cuerpo
          SET estado = ?, fecha_retiro = NULL, motivo_retiro = NULL,
              updated_at = datetime('now','localtime')
        WHERE id = ?`
    );
    for (const e of echados) {
      // El que tenía prueba por delante vuelve a prueba; el resto, activo
      const enPrueba = e.fecha_fin_prueba && e.fecha_fin_prueba > hoy;
      devolver.run(enPrueba ? 'En prueba' : 'Activo', e.id);
    }
  }).immediate();

  // Las anotaciones van fuera de la transacción: si una fallara, no puede
  // deshacer la devolución, que es lo que de verdad importa
  for (const e of echados) {
    bitacora.anotar({
      miembroId: e.miembro_id, tipo: 'Ingreso a cuerpo', iglesiaId: e.iglesia_id, usuario: null,
      descripcion: `Vuelve a "${e.cuerpo || 'su cuerpo'}": el sistema lo había retirado por error ` +
        'al agregar la regla de la directiva, y no correspondía porque no había entrado por ella.',
    });
  }

  console.log(
    `🔁 directiva: ${echados.length} integrante(s) volvieron a su cuerpo. ` +
      'La regla los había retirado por error; ahora solo saca a los que ella misma metió.'
  );
  marcarAplicada(NOMBRE);
}

/**
 * Las marcas de asistencia que quedaron sin cuerpo.
 *
 * La asistencia se lleva por cuerpo: cada marca dice de qué cuerpo es, y quien
 * pertenece a dos tiene una marca en cada uno. Pero hay marcas viejas que
 * quedaron con el cuerpo en nulo —de cuando la actividad guardaba un solo
 * cuerpo en su propia ficha, y de casos en que el sistema no supo cuál poner—.
 *
 * Sin cuerpo, esas marcas no aparecen en el informe de ningún cuerpo y la
 * pantalla no sabe a qué fila corresponden: la persona figura sin marcar y, al
 * pasar lista de nuevo, se le vuelve a preguntar algo que ya estaba contestado.
 *
 * Se les pone el cuerpo que se puede deducir con certeza, y solo ése: el de la
 * actividad, si la actividad tiene uno solo; o el único de los cuerpos
 * convocados al que esa persona pertenece. Donde hay más de una respuesta
 * posible no se inventa ninguna: se deja la marca como está.
 *
 * ESTA MIGRACIÓN NUNCA CORRIÓ, EN NINGUNA BASE, DESDE QUE SE ESCRIBIÓ. Pedía
 * `a.cuerpo_id`, y `asistencias` había perdido esa columna un poco antes,
 * cuando una actividad pasó a convocar VARIOS cuerpos y el campo se volvió
 * `cuerpos`, que es una lista. Así que reventaba en cada arranque con «no such
 * column: a.cuerpo_id», el error quedaba atrapado y escrito en la consola, y
 * —lo peor— no se marcaba aplicada, de modo que volvía a intentarlo y a
 * fallar la vez siguiente, para siempre.
 *
 * El respaldo que leía esa columna no se le pone un guardia: se quita, porque
 * está muerto incluso en una base vieja que todavía la tenga. La migración
 * «actividades con varios cuerpos» corre ANTES que ésta en la misma lista y
 * copia cualquier cuerpo_id suelto dentro de `cuerpos`, así que cuando ésta
 * mira, `cuerpos` ya está lleno. La prueba lo comprueba sobre una base a la
 * que se le devuelve la columna a propósito.
 */
function marcasDeAsistenciaConSuCuerpo(conexion = db) {
  const NOMBRE = 'marcas de asistencia con su cuerpo';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('asistencia_detalle') || !hayTabla('asistencias')) return marcar();

  const sueltas = conexion
    .prepare(
      `SELECT d.id, d.miembro_id, d.no_miembro_id, d.asistencia_id, a.cuerpos
         FROM asistencia_detalle d
         JOIN asistencias a ON a.id = d.asistencia_id
        WHERE d.cuerpo_id IS NULL`
    )
    .all();
  if (!sueltas.length) return marcar();

  /*
   * Las dos clases de persona que se marcan. A un cuerpo también lo integra
   * gente que no está en la membresía —desde que los grupos admiten a los no
   * inscritos—, y sin esta segunda consulta sus marcas se quedaban sin
   * resolver aunque el cuerpo fuera deducible con certeza, que es justamente
   * lo que esta migración existe para evitar.
   */
  const integraElCuerpo = {
    miembro: conexion.prepare(
      `SELECT 1 FROM integrantes_cuerpo
        WHERE cuerpo_id = ? AND miembro_id = ? AND estado <> 'Retirado'`
    ),
    no_miembro: conexion.prepare(
      `SELECT 1 FROM integrantes_cuerpo
        WHERE cuerpo_id = ? AND no_miembro_id = ? AND estado <> 'Retirado'`
    ),
  };
  const poner = conexion.prepare('UPDATE asistencia_detalle SET cuerpo_id = ? WHERE id = ?');

  let puestas = 0;
  let sinResolver = 0;
  conexion.transaction(() => {
    for (const m of sueltas) {
      let convocados = [];
      try { convocados = JSON.parse(m.cuerpos || '[]').map(Number).filter(Boolean); } catch (e) { convocados = []; }

      // Quién es: un miembro, alguien no inscrito, o —marca huérfana— nadie
      const cual = m.miembro_id ? 'miembro' : m.no_miembro_id ? 'no_miembro' : null;
      const quien = m.miembro_id || m.no_miembro_id;
      const suyos = cual
        ? convocados.filter((c) => integraElCuerpo[cual].get(c, quien))
        : [];
      // Con uno solo no hay duda; con varios —o con ninguno— sí, y no se toca
      if (suyos.length === 1) { poner.run(suyos[0], m.id); puestas++; }
      else if (convocados.length === 1) { poner.run(convocados[0], m.id); puestas++; }
      else sinResolver++;
    }
  }).immediate();

  if (puestas) {
    console.log(`🔁 asistencia: ${puestas} marca(s) que estaban sin cuerpo quedaron con el suyo.`);
  }
  if (sinResolver) {
    console.log(
      `ℹ️  asistencia: ${sinResolver} marca(s) sin cuerpo no se pudieron resolver ` +
        '(la persona pertenece a varios de los cuerpos convocados, o a ninguno). Se dejaron como estaban.'
    );
  }
  marcar();
}

/**
 * Los formatos de certificado que traía el sistema, ahora administrables.
 *
 * Los ocho tipos y sus textos estaban escritos dentro del programa —los tipos
 * en una lista fija del módulo, los textos en el navegador—, así que cambiar
 * una redacción era publicar una versión. Ahora son fichas que la iglesia
 * edita, y esta migración los pasa tal cual: los mismos ocho nombres y los
 * mismos textos, para que nada cambie de aspecto el día que se actualiza.
 *
 * Los que no tenían texto propio —«Buena conducta», «Reconocimiento», «Otro»—
 * llevan el texto genérico que armaba el sistema para ellos.
 *
 * Se siembra UNA vez y solo si la tabla está vacía: si la iglesia ya creó sus
 * formatos, no se le mete nada encima.
 */
function formatosDeCertificadoQueTraiaElSistema() {
  const NOMBRE = 'formatos de certificado';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('formatos_certificado')) return;   // se crea al arrancar; se intentará de nuevo

  if (db.prepare('SELECT COUNT(*) c FROM formatos_certificado').get().c) return marcarAplicada(NOMBRE);

  /* Los mismos textos que armaba el navegador, con los datos entre llaves. */
  const traidos = [
    ['Bautismo', 10,
      'Certifica que fue bautizado(a) en las aguas, en obediencia al mandato de nuestro Señor Jesucristo, ' +
      'el día {fecha_evento}, en {iglesia}.'],
    ['Presentación de niños', 20,
      'Certifica que fue presentado(a) al Señor el día {fecha_evento}, en {iglesia}, conforme a la ' +
      'enseñanza de las Sagradas Escrituras.'],
    ['Matrimonio', 30,
      'Certifica la celebración del matrimonio efectuado el día {fecha_evento}, en {iglesia}, delante de ' +
      'Dios y de los testigos presentes.'],
    ['Membresía', 40, 'Certifica que es miembro en plena comunión de {iglesia}.'],
    ['Traslado', 50,
      'Certifica que ha sido miembro en plena comunión de {iglesia} y se extiende la presente para los ' +
      'fines de traslado a la congregación que lo(a) reciba.'],
    ['Buena conducta', 60,
      'Se extiende el presente certificado de buena conducta en constancia de lo actuado en {iglesia}.'],
    ['Reconocimiento', 70,
      'Se extiende el presente certificado de reconocimiento en constancia de lo actuado en {iglesia}.'],
    ['Otro', 80, 'Se extiende el presente certificado en constancia de lo actuado en {iglesia}.'],
  ];

  const nuevo = db.prepare(
    `INSERT INTO formatos_certificado
       (nombre, activo, orden, texto, notas,
        muestra_logo, muestra_institucion, muestra_iglesia, muestra_numero, muestra_firmas,
        muestra_fecha, muestra_pie,
        disposicion, tamano_hoja, orientacion, fondo_opacidad, tipografia_titulo, tipografia_texto,
        tamano_titulo, tamano_texto, margen, marco, grosor_marco)
     VALUES (?, 1, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 'Clásica', 'Carta', 'Vertical', 100,
             'Con serifa (Georgia)', 'Sin serifa', 34, 15, 18, 'Doble línea', 3)`
  );

  db.transaction(() => {
    for (const [nombre, orden, texto] of traidos) {
      nuevo.run(nombre, orden, texto, 'Venía con el sistema. Se puede editar o sacar de uso.');
    }
  }).immediate();

  console.log(
    `📜 certificados: se crearon ${traidos.length} formato(s) con los textos que traía el sistema. ` +
      'Ahora se editan desde «Formatos de Certificado».'
  );
  marcarAplicada(NOMBRE);
}

/**
 * Los documentos que ya estaban, puestos en el libro que les corresponde.
 *
 * El módulo era un archivo documental suelto: un título, un tipo y un archivo
 * adjunto. Ahora es la oficina de partes, y cada documento dice si entró, si
 * salió o si solo se guarda. Lo que ya estaba no se toca más de lo necesario:
 *
 *   · lo que decía «Correspondencia recibida» pasa a Recibido;
 *   · lo que decía «Correspondencia enviada» pasa a Emitido;
 *   · TODO lo demás queda como «Interno o de archivo».
 *
 * Esa última línea es la importante. Una escritura de propiedad o un contrato
 * no entraron ni salieron por la oficina: ponerlos en el libro con un
 * correlativo diría que un día llegaron, y no llegaron. Quedan donde estaban,
 * visibles y sin número, y la iglesia reclasifica a mano lo que corresponda.
 *
 * A los que sí van al libro se les da su correlativo POR IGLESIA Y POR AÑO, en
 * el orden de su fecha: es el único orden que se puede reconstruir, y es el
 * que un libro de partes tiene de todas maneras. Los que no tienen fecha van
 * al final, por su orden de creación.
 *
 * No se toca ninguno que ya tenga número: si la iglesia venía numerando a
 * mano, ese número es el bueno.
 */
function documentosALaOficinaDePartes() {
  const NOMBRE = 'documentos a la oficina de partes';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('documentos')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info("documentos")').all().map((c) => c.name));
  for (const necesaria of ['flujo', 'numero', 'fecha_registro']) {
    if (!columnas.has(necesaria)) return; // se crean al arrancar; se intentará de nuevo
  }

  const ajustes = require('./ajustes');
  const anioDe = (f) => {
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(f || ''));
    return m ? m[1] : String(new Date().getFullYear());
  };

  const todos = db
    .prepare('SELECT id, tipo, fecha, iglesia_id, numero, flujo FROM documentos ORDER BY fecha, id')
    .all();
  if (!todos.length) return marcarAplicada(NOMBRE);

  const ponerFlujo = db.prepare('UPDATE documentos SET flujo = ? WHERE id = ?');
  const ponerNumero = db.prepare(
    'UPDATE documentos SET numero = ?, fecha_registro = COALESCE(fecha_registro, fecha), tipo = ? WHERE id = ?'
  );

  // Un contador por iglesia, año y libro
  const contadores = new Map();
  const siguiente = (iglesia, anio, flujo) => {
    const clave = `${iglesia}|${anio}|${flujo}`;
    const n = (contadores.get(clave) || 0) + 1;
    contadores.set(clave, n);
    return n;
  };

  const cuenta = { Recibido: 0, Emitido: 0, 'Interno o de archivo': 0 };

  db.transaction(() => {
    for (const d of todos) {
      if (d.flujo) continue; // ya clasificado

      const flujo = d.tipo === 'Correspondencia recibida' ? 'Recibido'
        : d.tipo === 'Correspondencia enviada' ? 'Emitido'
          : 'Interno o de archivo';
      ponerFlujo.run(flujo, d.id);
      cuenta[flujo]++;

      if (flujo === 'Interno o de archivo') continue;
      if (String(d.numero || '').trim()) continue;   // ya venía numerado a mano

      const anio = anioDe(d.fecha);
      const prefijo = String(
        ajustes.obtener(flujo === 'Emitido' ? 'documento_emitido_prefijo' : 'documento_recibido_prefijo') || ''
      ).trim();
      const n = siguiente(d.iglesia_id || 0, anio, flujo);
      // El tipo viejo decía el flujo, no la clase de documento: pasa a «Carta»,
      // que es lo que casi siempre es, y se corrige en la ficha si no lo era
      ponerNumero.run(`${prefijo}${String(n).padStart(3, '0')}-${anio}`, 'Carta', d.id);
    }
  }).immediate();

  const total = cuenta.Recibido + cuenta.Emitido + cuenta['Interno o de archivo'];
  if (total) {
    console.log(
      `📬 documentos: ${cuenta.Recibido} quedaron como recibidos, ${cuenta.Emitido} como emitidos y ` +
        `${cuenta['Interno o de archivo']} como archivo interno (sin número, porque no pasaron por la oficina).`
    );
  }
  marcarAplicada(NOMBRE);
}

/**
 * El nombre de la persona queda escrito en su ficha de integrante.
 *
 * Hasta ahora la ficha solo guardaba el número del miembro, y el nombre se iba
 * a buscar cada vez. Con los dos registros —miembros y no miembros— eso ya no
 * alcanza: la lista de integrantes tiene que poder decir de quién es cada
 * ficha sin ir a preguntar a dos tablas distintas, y los buscadores tienen que
 * encontrar por nombre.
 *
 * Se copia el nombre de donde corresponda y se deja escrito de qué registro
 * sale. Todas las fichas que existen hoy son de miembros: los grupos con gente
 * no inscrita empiezan a partir de esta versión.
 */
function fichasDeIntegranteConSuNombre() {
  const NOMBRE = 'fichas de integrante con su nombre';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('integrantes_cuerpo') || !hayTabla('miembros')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info("integrantes_cuerpo")').all().map((c) => c.name));
  if (!columnas.has('persona') || !columnas.has('persona_tipo')) return marcarAplicada(NOMBRE);

  let escritas = 0;
  db.transaction(() => {
    // Lo que ya existe es de miembros, sin excepción
    db.prepare("UPDATE integrantes_cuerpo SET persona_tipo = 'Miembro' WHERE persona_tipo IS NULL OR persona_tipo = ''").run();
    escritas = db
      .prepare(
        `UPDATE integrantes_cuerpo
            SET persona = TRIM(COALESCE(
                  (SELECT (COALESCE(m.nombres, '') || ' ' || COALESCE(m.apellidos, ''))
                     FROM miembros m WHERE m.id = integrantes_cuerpo.miembro_id), ''))
          WHERE (persona IS NULL OR persona = '') AND miembro_id IS NOT NULL`
      )
      .run().changes;
  }).immediate();

  /*
   * Lo mismo con el líder de cada cuerpo. A un GRUPO lo puede dirigir alguien
   * que no está inscrito, así que la ficha del cuerpo dice de qué registro
   * sale su encargado y lleva su nombre escrito. Los que ya existen dirigen
   * miembros, sin excepción.
   */
  if (hayTabla('cuerpos')) {
    const suyas = new Set(db.prepare('PRAGMA table_info("cuerpos")').all().map((c) => c.name));
    if (suyas.has('lider_tipo') && suyas.has('lider')) {
      db.transaction(() => {
        db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro' WHERE lider_tipo IS NULL OR lider_tipo = ''").run();
        db.prepare(
          `UPDATE cuerpos
              SET lider = TRIM(COALESCE(
                    (SELECT (COALESCE(m.nombres, '') || ' ' || COALESCE(m.apellidos, ''))
                       FROM miembros m WHERE m.id = cuerpos.lider_id), ''))
            WHERE (lider IS NULL OR lider = '') AND lider_id IS NOT NULL`
        ).run();
      }).immediate();
    }
  }

  // Y las cuotas ya cobradas, que también dicen a nombre de quién se pagaron
  if (hayTabla('cuotas_cuerpo')
      && db.prepare('PRAGMA table_info("cuotas_cuerpo")').all().some((c) => c.name === 'persona')) {
    db.prepare(
      `UPDATE cuotas_cuerpo
          SET persona = (SELECT i.persona FROM integrantes_cuerpo i WHERE i.id = cuotas_cuerpo.integrante_id)
        WHERE persona IS NULL OR persona = ''`
    ).run();
  }

  if (escritas) console.log(`🧑‍🤝‍🧑 Integrantes: ${escritas} ficha(s) quedaron con el nombre de su persona escrito.`);
  marcarAplicada(NOMBRE);
}

/**
 * Las marcas de asistencia que ya existen son de miembros.
 *
 * La columna nueva —de qué registro sale la persona— nace vacía en las filas
 * que ya estaban, y una marca sin registro no se sabe leer: el informe la
 * agruparía por su cuenta y la planilla no la encontraría. Se deja escrito lo
 * que todas ellas son.
 */
function marcasDeAsistenciaConSuRegistro() {
  const NOMBRE = 'marcas de asistencia con su registro';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('asistencia_detalle')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info("asistencia_detalle")').all().map((c) => c.name));
  if (!columnas.has('persona_tipo')) return marcarAplicada(NOMBRE);

  const puestas = db
    .prepare("UPDATE asistencia_detalle SET persona_tipo = 'Miembro' WHERE persona_tipo IS NULL OR persona_tipo = ''")
    .run().changes;
  if (puestas) console.log(`✔️ Asistencia: ${puestas} marca(s) quedaron anotadas como de miembros inscritos.`);
  marcarAplicada(NOMBRE);
}

/**
 * Las hojas de presentación de niños y de matrimonio, como las usa la iglesia.
 *
 * Los ocho formatos que traía el sistema eran todos «un título, un nombre y un
 * párrafo». Dos de ellos no son así en papel y nunca lo fueron: el de
 * PRESENTACIÓN DE NIÑOS dice cuándo nació el niño, quién lo presentó, sus
 * padres y sus dos parejas de padrinos; el de MATRIMONIO nombra a los dos
 * cónyuges en una frase corrida, con el versículo al pie. Se les pone su
 * disposición, su versículo y el texto con los espacios en blanco.
 *
 * SOLO SE TOCAN LOS QUE SIGUEN COMO VINIERON. Si la iglesia ya editó el texto
 * de uno de los dos, ese texto es suyo y no se pisa: se le deja la disposición
 * clásica y lo cambia desde la ficha del formato cuando quiera. Cambiar un
 * formato cambia cómo se imprimen TAMBIÉN los certificados ya emitidos, así
 * que no es algo que una actualización pueda hacer por encima de una decisión.
 */
function hojasDePresentacionYMatrimonio() {
  const NOMBRE = 'hojas de presentación y matrimonio';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('formatos_certificado')) return; // se crea al arrancar; se intenta de nuevo

  const columnas = new Set(db.prepare('PRAGMA table_info("formatos_certificado")').all().map((c) => c.name));
  if (!columnas.has('disposicion') || !columnas.has('epigrafe')) return marcarAplicada(NOMBRE);

  /* El texto exacto con que se sembraron: si sigue igual, nadie lo editó. */
  const COMO_VINO = {
    'Presentación de niños':
      'Certifica que fue presentado(a) al Señor el día {fecha_evento}, en {iglesia}, conforme a la ' +
      'enseñanza de las Sagradas Escrituras.',
    Matrimonio:
      'Certifica la celebración del matrimonio efectuado el día {fecha_evento}, en {iglesia}, delante de ' +
      'Dios y de los testigos presentes.',
  };

  const HOJAS = {
    'Presentación de niños': {
      disposicion: 'Presentación de niños',
      orientacion: 'Horizontal',
      titulo: 'Certificado de Presentación de Niños',
      rotulo_titular: 'SE CERTIFICA QUE EL NIÑO(A):',
      epigrafe: '«Dejad a los niños venir a mí, y no se lo impidáis;\nporque de los tales es el reino de Dios.»',
      epigrafe_cita: 'San Marcos 10:14',
      texto:
        'Nacido(a) el {nac_dia} de {nac_mes} del año {nac_anio}. Fue presentado(a) al Señor en un acto ' +
        'solemne y público, conforme a las Sagradas Escrituras y a los estatutos de nuestra Iglesia, ' +
        'por el Pastor: {oficiante} con fecha: {ev_dia} de {ev_mes} del año {ev_anio}.',
      texto_fecha: 'FECHA DE EMISIÓN: {ciudad}, {em_dia} de {em_mes} del año {em_anio}',
      firma_izquierda: 'Firma Pastor',
      firma_derecha: 'Timbre Iglesia',
      muestra_institucion: 0,
      muestra_iglesia: 0,
      color_titulo: '#002060',
      color_texto: '#3f3f46',
      color_marco: '#f2a015',
      tipografia_titulo: 'Sin serifa',
      tipografia_texto: 'Sin serifa',
      tamano_titulo: 40,
      tamano_texto: 15,
      margen: 10,
      marco: 'Doble línea',
      grosor_marco: 7,
    },
    Matrimonio: {
      disposicion: 'Matrimonio',
      orientacion: 'Horizontal',
      titulo: 'Matrimonio',
      rotulo_titular: 'Certificado de',
      epigrafe: 'Por tanto, dejará el hombre a su padre y a su madre, y se unirá a su mujer, y serán una sola carne',
      epigrafe_cita: 'Génesis 2:24',
      texto:
        'Certifico que {titular} y {conyuge} recibieron la bendición de Dios y se unieron en el Santo ' +
        'estado de matrimonio, según el libro de Génesis 2:24, el día {ev_dia} de {ev_mes} de {ev_anio}, ' +
        'en libre voluntad, delante de Dios, de sus testigos, y del ministro de Dios, el Pastor: {oficiante}.',
      texto_fecha: 'Certificado entregado en {ciudad} el {em_dia} de {em_mes} de {em_anio}',
      firma_izquierda: 'Sello Iglesia',
      firma_derecha: 'Firma Pastor',
      muestra_institucion: 1,
      muestra_iglesia: 1,
      color_titulo: '#1f3864',
      color_texto: '#3f3f46',
      color_marco: '#9db3d6',
      tipografia_titulo: 'Con serifa (Georgia)',
      tipografia_texto: 'Sin serifa',
      tamano_titulo: 44,
      tamano_texto: 15,
      margen: 8,
      marco: 'Línea simple',
      grosor_marco: 1,
    },
  };

  let puestas = 0;
  const respetados = [];
  db.transaction(() => {
    /*
     * Los formatos que ya existían nacieron sin decir qué forma tienen: la
     * columna es nueva. Todos son la de siempre, y dejarlo escrito es lo que
     * hace que la ficha lo muestre y que se pueda filtrar por eso.
     */
    db.prepare("UPDATE formatos_certificado SET disposicion = 'Clásica' WHERE disposicion IS NULL OR disposicion = ''").run();
    if (columnas.has('grosor_marco')) {
      db.prepare('UPDATE formatos_certificado SET grosor_marco = 3 WHERE grosor_marco IS NULL').run();
    }
    // Y en qué papel se imprimen: los que ya existían, en la hoja de siempre
    if (columnas.has('tamano_hoja')) {
      db.prepare("UPDATE formatos_certificado SET tamano_hoja = 'Carta' WHERE tamano_hoja IS NULL OR tamano_hoja = ''").run();
    }

    for (const [nombre, campos] of Object.entries(HOJAS)) {
      const suyo = db.prepare('SELECT * FROM formatos_certificado WHERE nombre = ?').get(nombre);
      if (!suyo) continue;
      const intacto = String(suyo.texto || '').trim() === COMO_VINO[nombre];
      if (!intacto) { respetados.push(nombre); continue; }

      const claves = Object.keys(campos).filter((c) => columnas.has(c));
      db.prepare(
        `UPDATE formatos_certificado SET ${claves.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`
      ).run(...claves.map((c) => campos[c]), suyo.id);
      puestas++;
    }
  }).immediate();

  if (puestas) {
    console.log(
      `📜 certificados: ${puestas} formato(s) quedaron con la hoja que la iglesia usa en papel ` +
        '(presentación de niños y matrimonio).'
    );
  }
  if (respetados.length) {
    console.log(
      `📜 certificados: no se tocó «${respetados.join('», «')}» porque su texto ya estaba editado. ` +
        'La disposición se puede elegir en la ficha del formato.'
    );
  }
  marcarAplicada(NOMBRE);
}

/**
 * Los certificados que la iglesia hace a lo ancho.
 *
 * La presentación de niños, el bautismo y el matrimonio se imprimen SIEMPRE
 * apaisados: así son las hojas que la iglesia usa en papel. Las dos primeras
 * ya lo traen por su disposición —están hechas a lo ancho y el sistema no
 * ofrece la otra—, pero el BAUTISMO conserva la hoja clásica, que de fábrica
 * viene de pie, y con eso salía distinto de los otros dos.
 *
 * Se corre una sola vez. Si algún día la iglesia decide ponerlo de pie desde
 * su ficha, la actualización no se lo vuelve a dar vuelta.
 */
function certificadosApaisados() {
  const NOMBRE = 'certificados apaisados';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('formatos_certificado')) return; // se crea al arrancar; se intenta de nuevo

  const columnas = new Set(db.prepare('PRAGMA table_info("formatos_certificado")').all().map((c) => c.name));
  if (!columnas.has('orientacion') || !columnas.has('disposicion')) return marcarAplicada(NOMBRE);

  const { SIEMPRE_APAISADAS } = require('./modules/formatos_certificado');
  const marcas = SIEMPRE_APAISADAS.map(() => '?').join(',');

  const puestos = db.transaction(() => {
    // Las dos que están hechas a lo ancho, por si alguna quedó de pie
    const porSuHoja = db
      .prepare(`UPDATE formatos_certificado SET orientacion = 'Horizontal'
                 WHERE disposicion IN (${marcas}) AND orientacion <> 'Horizontal'`)
      .run(...SIEMPRE_APAISADAS).changes;
    // Y el bautismo, que lleva la hoja clásica pero se imprime igual que ellas
    const elBautismo = db
      .prepare(`UPDATE formatos_certificado SET orientacion = 'Horizontal'
                 WHERE nombre = 'Bautismo' AND orientacion <> 'Horizontal'`)
      .run().changes;
    return porSuHoja + elBautismo;
  }).immediate();

  if (puestos) {
    console.log(`📜 certificados: ${puestos} formato(s) pasaron a imprimirse a lo ancho, como en papel.`);
  }
  marcarAplicada(NOMBRE);
}

/**
 * Cada iglesia con su código, y sin repetirse.
 *
 * El código era un campo suelto y opcional: servía para buscar y para verse en
 * el listado. Desde que el número de cada solicitud lo lleva adentro —para
 * decir de qué iglesia es—, tiene que estar y tiene que ser único, o el número
 * deja de nombrar una sola cosa.
 *
 * A las que no tenían se les propone uno sacado de su nombre: de «Iglesia
 * Central» sale CENTRAL. A las que tenían se les deja el mismo, normalizado
 * —mayúsculas, sin tildes ni espacios—, que es como se va a poder escribir en
 * un acta o dictar por teléfono. Y si al normalizar dos quedaran iguales, a la
 * segunda se le suma un número. Todo esto se ve y se corrige en la ficha de
 * cada iglesia.
 */
function cadaIglesiaConSuCodigo() {
  const NOMBRE = 'cada_iglesia_con_su_codigo';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
  if (!hayTabla('iglesias')) return;

  const codigos = require('./codigo-iglesia');
  const filas = db.prepare('SELECT id, nombre, codigo FROM iglesias ORDER BY id').all();
  const guardar = db.prepare('UPDATE iglesias SET codigo = ? WHERE id = ?');
  let puestos = 0, arreglados = 0;

  db.transaction(() => {
    for (const ig of filas) {
      const tenia = String(ig.codigo || '').trim();
      // Acá sí se recorta: es un código que ya estaba guardado sin ninguna
      // regla de largo, y lo que salga se ve y se corrige en su ficha
      const quiere = codigos.recortar(tenia) || codigos.deSuNombre(ig.nombre, ig.id);
      const queda = codigos.libre(db, quiere, ig.id);
      if (queda === tenia) continue;
      guardar.run(queda, ig.id);
      tenia ? arreglados++ : puestos++;
    }
  }).immediate();

  marcarAplicada(NOMBRE);
  if (puestos || arreglados) {
    console.log(
      `⛪ Códigos de iglesia: ${puestos} puesto(s) desde su nombre · ${arreglados} normalizado(s). ` +
        'Se ven y se corrigen en la ficha de cada iglesia.'
    );
  }
}

/**
 * El correlativo de las solicitudes pasa a llevarse por iglesia.
 *
 * Era de todo el sistema: la primera solicitud de una iglesia recién creada
 * salía con el 0004 porque heredaba el correlativo de las otras, y decir «la
 * 12 de este año» no significaba nada mientras hubiera más de una
 * congregación. Los certificados y la oficina de partes ya numeraban por
 * iglesia; solicitudes se había quedado atrás.
 *
 * LO YA EMITIDO NO SE TOCA. Una solicitud está nombrada por su número en actas
 * y correos, así que las que existen conservan el suyo —`0001-2026`, sin
 * iglesia—. Lo que se hace acá es dejar el contador de cada iglesia donde
 * llegó SU numeración, para que la siguiente siga de largo en vez de empezar
 * de nuevo en el 0001 y quedar al lado de una que ya se llama así.
 *
 * El contador viejo, que era uno por año para todo el sistema, queda sin uso:
 * lo que contaba ya está dicho en los números que se emitieron.
 */
function solicitudesNumeradasPorIglesia() {
  const NOMBRE = 'solicitudes_numeradas_por_iglesia';
  if (yaAplicada(NOMBRE)) return;
  const hayTabla = (t) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
  if (!hayTabla('solicitudes')) return;

  const numero = require('./solicitudes/numero');
  const filas = db.prepare('SELECT iglesia_id, numero FROM solicitudes WHERE numero IS NOT NULL').all();

  // Hasta dónde llegó cada libro: la iglesia y el año de cada número que ya
  // se emitió, en el formato que sea
  const hasta = new Map();
  for (const s of filas) {
    const p = numero.partesDe(s.numero);
    if (!p) continue;
    const libro = `${Number(s.iglesia_id) || 0}:${p.anio}`;
    if (p.correlativo > (hasta.get(libro) || 0)) hasta.set(libro, p.correlativo);
  }

  db.transaction(() => {
    for (const [libro, cuanto] of hasta) {
      const [deQuien, anio] = libro.split(':');
      numero.alMenos(Number(deQuien), Number(anio), cuanto);
    }
  }).immediate();

  marcarAplicada(NOMBRE);
  if (hasta.size) {
    console.log(
      `📨 Solicitudes: el correlativo pasa a llevarse por iglesia (${hasta.size} libro(s) al día). ` +
        'Las que ya tienen número lo conservan; las nuevas salen como SOL-CENTRAL-0001-2026.'
    );
  }
}

/**
 * LAS MARCAS QUE YA ESTABAN, CON LA FECHA EN QUE SE MARCARON.
 *
 * Guardar una lista borra y vuelve a insertar la marca de cada persona, así
 * que `created_at` es la de la ÚLTIMA escritura, no la del día en que se tomó
 * la lista. Desde la 1.126.0 eso se guarda aparte —`tomada_en` y
 * `tomada_por`—, y se arrastra al reinsertar.
 *
 * A lo que ya estaba guardado no se le puede devolver un dato que nunca se
 * anotó, pero sí se le puede poner el mejor que hay: la fecha y el autor de su
 * última escritura. Para toda marca que nadie corrigió —la enorme mayoría— esa
 * ES la de la toma, exactamente. Para las que sí se corrigieron queda la de la
 * corrección, que es lo único que quedó de ellas.
 *
 * Dejarlas en nulo sería peor que aproximarlas: una lista vieja a la que
 * después se le agrega UNA marca nueva se leería como «tomada hoy por quien
 * agregó esa marca», que sí es falso.
 */
function marcasDeAsistenciaConSuFechaDeToma() {
  const NOMBRE = 'marcas de asistencia con su fecha de toma';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('asistencia_detalle')) return marcarAplicada(NOMBRE);

  const columnas = new Set(db.prepare('PRAGMA table_info(asistencia_detalle)').all().map((c) => c.name));
  if (!columnas.has('tomada_en') || !columnas.has('tomada_por')) return marcarAplicada(NOMBRE);

  const cuantas = db
    .prepare('SELECT COUNT(*) AS n FROM asistencia_detalle WHERE tomada_en IS NULL')
    .get().n;
  if (!cuantas) return marcarAplicada(NOMBRE);

  db.prepare(
    `UPDATE asistencia_detalle
        SET tomada_en  = COALESCE(created_at, updated_at, fecha),
            tomada_por = created_by
      WHERE tomada_en IS NULL`
  ).run();
  console.log(`🖊️  ${cuantas} marca(s) de asistencia quedaron con la fecha en que se marcaron.`);
  marcarAplicada(NOMBRE);
}

/**
 * Los que ya no están salen de sus cuerpos.
 *
 * La regla que retira de sus cuerpos a quien queda como Fallecido o
 * Trasladado se agregó en la 1.132.0 (ver server/ya-no-esta.js), y de ahí en
 * adelante corre sola en cada guardado. Las bases que ya venían andando
 * arrastran a los que se dieron de baja antes: siguen figurando como
 * integrantes vigentes, así que la pantalla de asistencia los sigue
 * convocando, la planilla del mes les sigue abriendo su columna y el aviso de
 * faltas seguidas los va a nombrar.
 *
 * Se les escribe el mismo motivo que escribe la regla, así que si alguno
 * estaba mal marcado, corregirle el estado en su ficha lo devuelve solo a sus
 * cuerpos —la vuelta atrás también es parte de la regla—.
 *
 * La fecha de retiro es la de hoy y no la del día en que se fue, que nadie
 * guardó: inventarla sería peor que dejarla en el día en que el sistema se dio
 * cuenta.
 */
function losQueYaNoEstanSalenDeSusCuerpos() {
  const NOMBRE = 'los que ya no están salen de sus cuerpos';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('integrantes_cuerpo') || !hayTabla('miembros')) return marcarAplicada(NOMBRE);

  const { MOTIVO, YA_NO_ESTA } = require('./ya-no-esta');
  const hoy = require('./fechas').hoy();
  let cuantas = 0;

  for (const estado of YA_NO_ESTA) {
    const info = db
      .prepare(
        `UPDATE integrantes_cuerpo
            SET estado = 'Retirado', fecha_retiro = ?, motivo_retiro = ?,
                updated_at = datetime('now','localtime')
          WHERE estado IN ('En prueba', 'Activo')
            AND miembro_id IN (SELECT id FROM miembros WHERE estado = ?)`
      )
      .run(hoy, MOTIVO[estado], estado);
    cuantas += info.changes;
  }

  if (cuantas) {
    console.log(`👋 ${cuantas} ficha(s) de integrante quedaron retiradas: su persona ya no está en la iglesia.`);
  }
  marcarAplicada(NOMBRE);
}

/**
 * Rescata el conteo de leídos de los mensajes que ya estaban mandados.
 *
 * Hasta ahora ese número no se guardaba: se contaba mirando los avisos que
 * seguían en la campanita de cada persona. Y los avisos leídos se borran solos
 * a los noventa días, así que la constancia se deshacía sola —«40 de 40 leídos»
 * pasaba a decir «0 de 40»— sin avisar de nada.
 *
 * Ahora el número vive en el mensaje. Esta migración lo llena una vez con lo
 * que todavía se puede saber: los avisos que aún no se han borrado. Lo que el
 * borrado ya se llevó no vuelve —no hay de dónde sacarlo—, y por eso esto corre
 * cuanto antes: cada día que pasa es un día de avisos que se limpian.
 */
function elConteoDeLeidosSeGuarda() {
  const NOMBRE = 'el conteo de leídos se guarda en el mensaje';
  if (yaAplicada(NOMBRE)) return;

  // Que la tabla y la columna existan no depende del orden en que se carguen
  // los módulos: se pide el que las crea
  require('./avisos/mensajes');
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('mensajes_enviados') || !hayTabla('notificaciones')) return marcarAplicada(NOMBRE);

  const info = db
    .prepare(
      `UPDATE mensajes_enviados
          SET leidos = (SELECT COUNT(*) FROM notificaciones
                         WHERE notificaciones.clave = 'mensaje:' || mensajes_enviados.id
                           AND notificaciones.leida = 1)
        WHERE leidos = 0`
    )
    .run();

  const conLecturas = db.prepare('SELECT COUNT(*) c FROM mensajes_enviados WHERE leidos > 0').get().c;
  if (info.changes) {
    console.log(`📖 Conteo de leídos rescatado en ${info.changes} mensaje(s); ${conLecturas} tiene(n) lecturas anotadas.`);
  }
  marcarAplicada(NOMBRE);
}

/**
 * Les pone la firma a los avisos de mensajes que ya estaban en las campanitas.
 *
 * Un mensaje escrito a mano viaja con el nombre de quien lo mandó; sin eso se
 * lee como si lo dijera «el sistema», y el sistema no cambia la hora de una
 * reunión: la cambia una persona a la que uno le puede preguntar. Los que ya
 * estaban repartidos no lo llevaban, y el nombre se puede recuperar: cada aviso
 * dice de qué mensaje es, y el mensaje dice quién lo mandó.
 */
function elAvisoDiceDeQuienViene() {
  const NOMBRE = 'los avisos de un mensaje dicen de quién vienen';
  if (yaAplicada(NOMBRE)) return;

  // Que las tablas y las columnas existan no depende del orden de carga
  require('./avisos/avisos');
  require('./avisos/mensajes');
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('notificaciones') || !hayTabla('mensajes_enviados')) return marcarAplicada(NOMBRE);

  const info = db
    .prepare(
      `UPDATE notificaciones
          SET de = (SELECT u.nombre
                      FROM mensajes_enviados m LEFT JOIN usuarios u ON u.id = m.enviado_por
                     WHERE 'mensaje:' || m.id = notificaciones.clave)
        WHERE tipo = 'mensaje' AND de IS NULL AND clave LIKE 'mensaje:%'`
    )
    .run();

  if (info.changes) console.log(`✍️  ${info.changes} aviso(s) de mensajes quedaron diciendo de quién vienen.`);
  marcarAplicada(NOMBRE);
}

/**
 * Rescata a quiénes fue cada mensaje ya mandado.
 *
 * El registro decía cuántos eran y no cuáles. Lo que todavía se puede saber
 * está en los avisos que llevan la clave del mensaje: se copian con el nombre
 * de la cuenta, para que la constancia siga diciendo a quién se le escribió
 * aunque después la cuenta se borre.
 *
 * Lo que ya se llevó el borrado de los noventa días —o un retiro— no vuelve; por
 * eso esto corre cuanto antes y de ahora en adelante se anota al mandar.
 */
function losDestinatariosQuedanAnotados() {
  const NOMBRE = 'a quiénes fue cada mensaje queda anotado';
  if (yaAplicada(NOMBRE)) return;

  require('./avisos/mensajes');
  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('mensajes_destinatarios') || !hayTabla('notificaciones')) return marcarAplicada(NOMBRE);

  const info = db
    .prepare(
      `INSERT INTO mensajes_destinatarios (mensaje_id, usuario_id, nombre)
       SELECT m.id, n.usuario_id, u.nombre
         FROM mensajes_enviados m
         JOIN notificaciones n ON n.clave = 'mensaje:' || m.id
         LEFT JOIN usuarios u ON u.id = n.usuario_id
        WHERE NOT EXISTS (SELECT 1 FROM mensajes_destinatarios d WHERE d.mensaje_id = m.id)`
    )
    .run();

  if (info.changes) console.log(`📇 ${info.changes} destinatario(s) de mensajes ya mandados quedaron anotados.`);
  marcarAplicada(NOMBRE);
}

/**
 * Le anota a cada servicio ya registrado el porcentaje con que se calculó su
 * aporte a la corporación.
 *
 * Antes ese porcentaje no se guardaba: el aporte se recalculaba en cada guardado
 * con el que rigiera ese día, así que corregirle la hora a un servicio de marzo
 * le cambiaba cuánto había aportado. Ahora el porcentaje vive con el servicio.
 *
 * El de los que ya estaban se puede RECUPERAR de los números mismos: el aporte
 * dividido por la ofrenda es exactamente el porcentaje que se usó. Donde no hay
 * ofrenda no hay de dónde sacarlo, y ahí se pone el que rige hoy, que es lo que
 * se habría usado igual.
 */
function elPorcentajeDelAporteQuedaConSuServicio() {
  const NOMBRE = 'el porcentaje del aporte queda con su servicio';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('servicios')) return marcarAplicada(NOMBRE);
  const columnas = db.prepare('PRAGMA table_info(servicios)').all().map((c) => c.name);
  if (!columnas.includes('ofrenda_porcentaje')) return; // todavía no se declaró: se corre en el próximo arranque

  const deHoy = require('./ajustes').numero('ofrenda_porcentaje_fondo', 0, 100);
  const info = db
    .prepare(
      `UPDATE servicios
          SET ofrenda_porcentaje = CASE
                WHEN ofrenda_total > 0 THEN ROUND(COALESCE(ofrenda_fondo, 0) * 100.0 / ofrenda_total, 2)
                ELSE ?
              END
        WHERE ofrenda_porcentaje IS NULL`
    )
    .run(deHoy);

  if (info.changes) {
    const rescatados = db
      .prepare('SELECT COUNT(*) c FROM servicios WHERE ofrenda_total > 0')
      .get().c;
    console.log(
      `🕊️  ${info.changes} servicio(s) quedaron con su porcentaje de aporte anotado `
      + `(${rescatados} recuperado(s) de su propia ofrenda; el resto con el ${deHoy}% que rige hoy).`
    );
  }
  marcarAplicada(NOMBRE);
}

/**
 * Los traslados entre cuentas quedan marcados como lo que son.
 *
 * Desde la 1.161.0, los dos lados de un traspaso y los dos del aporte que una
 * ofrenda pasa al fondo llevan una marca: no son plata que entre ni salga de la
 * organización, es la misma cambiando de cuenta. El resumen la cuenta aparte
 * (ver server/entre-cuentas.js).
 *
 * Los movimientos que ya estaban escritos no la tienen, y sin ella el resumen
 * de los meses pasados seguiría diciendo que entró más de lo que entró. Acá se
 * les pone, sin tocar ni un peso: se reconocen porque llevan su traspaso_id, o
 * porque son los dos movimientos que el servicio anotó como aporte —los que
 * apuntan sus columnas movimiento_aporte_id y movimiento_fondo_id—. Los
 * ingresos de la ofrenda propiamente tal no se tocan: ésos sí entraron.
 */
function losTrasladosQuedanMarcados() {
  const NOMBRE = 'los traslados entre cuentas quedan marcados';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('tesoreria')) return marcarAplicada(NOMBRE);
  const columnas = db.prepare('PRAGMA table_info(tesoreria)').all().map((c) => c.name);
  if (!columnas.includes('entre_cuentas')) return; // todavía no se declaró: se corre en el próximo arranque

  let marcados = 0;
  marcados += db
    .prepare("UPDATE tesoreria SET entre_cuentas = 1 WHERE traspaso_id IS NOT NULL AND COALESCE(entre_cuentas, 0) <> 1")
    .run().changes;

  if (hayTabla('servicios')) {
    const deServicios = db.prepare('PRAGMA table_info(servicios)').all().map((c) => c.name);
    if (deServicios.includes('movimiento_aporte_id') && deServicios.includes('movimiento_fondo_id')) {
      marcados += db
        .prepare(
          `UPDATE tesoreria SET entre_cuentas = 1
            WHERE COALESCE(entre_cuentas, 0) <> 1
              AND id IN (SELECT movimiento_aporte_id FROM servicios WHERE movimiento_aporte_id IS NOT NULL
                         UNION
                         SELECT movimiento_fondo_id  FROM servicios WHERE movimiento_fondo_id  IS NOT NULL)`
        )
        .run().changes;
    }
  }

  // Y lo demás queda dicho también: un movimiento escrito a mano no es un traslado
  db.prepare('UPDATE tesoreria SET entre_cuentas = 0 WHERE entre_cuentas IS NULL').run();

  if (marcados) {
    console.log(`💱 ${marcados} movimiento(s) quedaron marcados como traslado entre cuentas: ya no se cuentan como plata que entró.`);
  }
  marcarAplicada(NOMBRE);
}

/**
 * Le quita la fecha de cierre a las cuentas que están abiertas.
 *
 * El campo se llenaba al cerrar y no se limpiaba al volver a abrir, así que
 * quedaban cuentas diciendo «Activa» con una fecha de cierre puesta. Y como el
 * campo solo se muestra cuando el estado es «Cerrada», desde la pantalla no
 * había forma de borrarlo: para verlo había que cerrar la cuenta de nuevo. Las
 * que ya quedaron así no se arreglan solas, porque nadie puede llegar a ellas.
 *
 * Desde la 1.217.0 el guardado la limpia; esto es para lo que ya estaba escrito.
 */
function cuentasAbiertasSinFechaDeCierre() {
  const NOMBRE = 'las cuentas abiertas no llevan fecha de cierre';
  if (yaAplicada(NOMBRE)) return;

  const hayTabla = (t) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('cuentas_tesoreria')) return marcarAplicada(NOMBRE);
  const columnas = db.prepare('PRAGMA table_info(cuentas_tesoreria)').all().map((c) => c.name);
  if (!columnas.includes('fecha_cierre') || !columnas.includes('estado')) return marcarAplicada(NOMBRE);

  const limpiadas = db
    .prepare("UPDATE cuentas_tesoreria SET fecha_cierre = NULL WHERE estado <> 'Cerrada' AND fecha_cierre IS NOT NULL")
    .run().changes;

  if (limpiadas) {
    console.log(`🏦 ${limpiadas} cuenta(s) abiertas tenían puesta una fecha de cierre de cuando estuvieron cerradas: se les quitó.`);
  }
  marcarAplicada(NOMBRE);
}

/**
 * Los nombres de iglesia con espacios de más.
 *
 * Desde la 1.238.0 el nombre se guarda sin ellos. Esto es para los que ya
 * estaban: « iglesia  Central » salía tal cual en los desplegables —que es lo
 * único que muestran—, se ordenaba antes que todos los demás por el espacio de
 * adelante, y parecía otra iglesia distinta de la que se llama igual sin ellos.
 *
 * Es la normalización más chica que existe: no cambia ninguna palabra ni ningún
 * acento, solo junta los espacios repetidos y saca los de las puntas. Nadie
 * decide tener dos espacios entre dos palabras.
 */
function losNombresDeIglesiaSinEspaciosDeMas(conexion = db) {
  const NOMBRE = 'los nombres de iglesia sin espacios de más';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('iglesias')) return marcar();

  let arregladas = 0;
  const poner = conexion.prepare('UPDATE iglesias SET nombre = ? WHERE id = ?');
  for (const i of conexion.prepare('SELECT id, nombre FROM iglesias').all()) {
    const parejo = String(i.nombre || '').replace(/\s+/g, ' ').trim();
    if (parejo && parejo !== i.nombre) {
      poner.run(parejo, i.id);
      arregladas++;
    }
  }
  if (arregladas) console.log(`⛪ ${arregladas} nombre(s) de iglesia sin espacios de más.`);
  marcar();
}

/**
 * Las cajas que se quedaron con el nombre viejo de su iglesia.
 *
 * Al crear una iglesia, el sistema le abre sus dos cuentas y les escribe el
 * nombre de la iglesia adentro; ese nombre se copiaba una vez y no se volvía a
 * mirar, así que una congregación renombrada quedaba con dos cajas diciendo
 * otra cosa —en el listado, en el desplegable de un movimiento, en el título de
 * la cartola y en la cartola impresa que se compara con la del banco—.
 *
 * Desde la 1.236.0 las cuentas siguen al nombre cuando se lo cambian. Esto es
 * para las que ya quedaron atrás. Quién califica y por qué está explicado en
 * server/el-nombre-de-la-iglesia.js: llevan la plantilla exacta del sistema y
 * nadie las ha editado nunca. Una cuenta que alguien renombró a mano lleva su
 * marca y no se toca.
 *
 * No se marca como aplicada si la tabla todavía no tiene sus columnas: se
 * intenta de nuevo al arrancar, como las demás.
 */
function lasCajasConElNombreViejoDeSuIglesia(conexion = db) {
  const NOMBRE = 'las cajas con el nombre viejo de su iglesia';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('cuentas_tesoreria') || !hayTabla('iglesias')) return marcar();
  const columnas = conexion.prepare('PRAGMA table_info(cuentas_tesoreria)').all().map((c) => c.name);
  if (!columnas.includes('updated_by') || !columnas.includes('tipo')) return;

  const arregladas = require('./el-nombre-de-la-iglesia').lasQueQuedaronAtras(conexion);
  if (arregladas) {
    console.log(`🏦 ${arregladas} caja(s) estrenan el nombre actual de su iglesia.`);
  }
  marcar();
}

/**
 * El nivel y el régimen de cada artículo de inventario que ya estaba anotado.
 *
 * Hasta la 1.228 el nivel no era un campo: se deducía de si «Cuerpo / Grupo»
 * venía vacío o lleno. Desde la 1.229 se elige, con las mismas tres opciones
 * que una cuenta de tesorería, y eso permite por fin anotar un bien de la
 * corporación —antes «Iglesia» era obligatorio y no había cómo—.
 *
 * Lo que ya estaba anotado no se arregla solo: la columna nace vacía, y un
 * artículo sin nivel no se puede guardar ni aparece con el filtro puesto. Así
 * que se le pone el que tenía de hecho, que está escrito en sus propias
 * columnas y no hay que adivinarlo:
 *
 *   tiene cuerpo ......... es del cuerpo
 *   solo iglesia ......... es de la iglesia
 *   ninguna de las dos ... es de la corporación
 *
 * Ese último caso no debería existir —«Iglesia» era obligatorio—, pero una
 * fila puede haber entrado por la pantalla de Importar o de un respaldo viejo,
 * y dejarla sin nivel sería dejarla sin poder abrirse.
 */
function elNivelDeCadaArticuloDeInventario(conexion = db) {
  const NOMBRE = 'el nivel de cada artículo de inventario';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('inventarios')) return marcar();
  const columnas = conexion.prepare('PRAGMA table_info(inventarios)').all().map((c) => c.name);
  // La columna se crea al arrancar; si aún no está, se intenta de nuevo
  if (!columnas.includes('ambito')) return;

  const [CORPORACION, IGLESIA, CUERPO] = require('./modules/inventarios').NIVELES;
  const poner = (nivel, donde) => conexion
    .prepare(`UPDATE inventarios SET ambito = ? WHERE (ambito IS NULL OR ambito = '') AND ${donde}`)
    .run(nivel).changes;

  const deCuerpo = poner(CUERPO, 'cuerpo_id IS NOT NULL');
  const deIglesia = poner(IGLESIA, 'iglesia_id IS NOT NULL');
  const deLaCorporacion = poner(CORPORACION, '1 = 1');

  /*
   * Y su régimen: todo lo que ya estaba anotado es PROPIO.
   *
   * No es una suposición: hasta acá el módulo no admitía otra cosa —no había
   * dónde decir que algo es prestado o está en depósito—, así que un artículo
   * anotado antes de esta versión es, por construcción, de la organización.
   * Lo ajeno que alguien haya escrito en «Notas» sigue ahí, palabra por
   * palabra, para que se pueda revisar y reclasificar a mano.
   */
  let conRegimen = 0;
  if (columnas.includes('regimen')) {
    const [PROPIO] = require('./bienes-ajenos').REGIMENES;
    conRegimen = conexion
      .prepare("UPDATE inventarios SET regimen = ? WHERE regimen IS NULL OR regimen = ''")
      .run(PROPIO).changes;
  }

  if (deCuerpo || deIglesia || deLaCorporacion || conRegimen) {
    console.log(
      `📦 Inventarios: ${deCuerpo + deIglesia + deLaCorporacion} artículo(s) estrenaron su nivel · ` +
        `${deLaCorporacion} de la corporación, ${deIglesia} de una iglesia, ${deCuerpo} de un cuerpo` +
        (conRegimen ? ` · ${conRegimen} quedaron como bien propio, que es lo único que se podía anotar antes.` : '.')
    );
  }
  marcar();
}

/**
 * Lo que se quedó en la iglesia anterior cuando un cuerpo se cambió de iglesia.
 *
 * La iglesia de una cuenta, de una ficha de integrante y de un movimiento se
 * COPIA del cuerpo al guardarse, y esa copia se hacía una vez y no se volvía a
 * mirar: un cuerpo que se cambiaba de iglesia dejaba atrás su caja, su gente y
 * su plata. Desde la 1.220 lo suyo se va con él (ver
 * server/lo-que-sigue-al-cuerpo.js), pero eso vale de ahí en adelante: lo que
 * ya se quedó atrás sigue atrás, y no es un rótulo desactualizado —es quién
 * tiene acceso a esa plata y a esa gente—.
 *
 * Así que se pasa una vez por todos los cuerpos y se le da a lo suyo la
 * iglesia que el cuerpo tiene hoy. Es la MISMA regla, la de ese archivo, no
 * una copia: si mañana una tabla más sigue al cuerpo, esto no se toca.
 *
 * Los cuerpos sin iglesia se saltan: son los de la corporación, que no es una
 * iglesia, y darles la suya sería dejarles la columna en blanco.
 *
 * Recibe la conexión porque esto toca TODOS los cuerpos, y las pruebas del
 * motor comparten una sola base entre procesos: correrla ahí le cambiaría los
 * datos a los demás archivos mientras están mirándolos. Se la prueba sobre una
 * copia, que es también como corre de verdad —sobre una base sola, al arrancar—.
 */
function loQueSeQuedoEnLaIglesiaAnterior(conexion = db) {
  const NOMBRE = 'lo del cuerpo sigue al cuerpo cuando cambia de iglesia';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('cuerpos')) return marcar();

  const sigue = require('./lo-que-sigue-al-cuerpo');
  const cuerpos = conexion.prepare('SELECT id, nombre, iglesia_id FROM cuerpos WHERE iglesia_id IS NOT NULL').all();

  const total = new Map();
  let cuantos = 0;
  for (const cuerpo of cuerpos) {
    const movidas = sigue.mudarLoSuyo(cuerpo.id, cuerpo.iglesia_id, conexion);
    if (!movidas.length) continue;
    cuantos += 1;
    for (const m of movidas) total.set(m.que, (total.get(m.que) || 0) + m.cuantas);
  }

  if (cuantos) {
    const detalle = [...total.entries()].map(([que, c]) => `${c} ${que}`).join(', ');
    console.log(
      `🏛️  ${cuantos} cuerpo(s) tenían cosas suyas en una iglesia que ya no era la suya: se movieron ${detalle}.`
    );
  }
  marcar();
}

/**
 * El estado de cada cuerpo, escrito.
 *
 * El campo trae «Activo» de fábrica, pero un valor de fábrica solo se aplica
 * cuando alguien abre el formulario: los cuerpos que ya existían tenían el
 * estado VACÍO. Medido antes de esto, doce de dieciséis, y no era inofensivo
 * —el cumplimiento los castigaba por eso: el «Cuerpo de prueba 1», con 49
 * integrantes activos, salía «Pendiente (4)» y uno de los cuatro reproches era
 * «Cuerpo activo ✗ Sin estado»—.
 *
 * Ahora además el estado decide algo (ver server/cuerpo-inactivo.js), así que
 * el vacío tenía que quedar dicho antes de que la regla empezara a mirarlo.
 * Y se escribe «Activo» y no otra cosa porque es lo que significa: si un cuerpo
 * hubiera dejado de funcionar, alguien lo habría marcado.
 *
 * Es la misma vuelta que la 1.229.0 le dio al nivel de cada artículo de
 * inventario, y por el mismo motivo: un dato que empieza a mandar no puede
 * quedar en blanco en las tres cuartas partes de las filas.
 *
 * Recibe la conexión porque esto toca TODOS los cuerpos, y las pruebas del
 * motor comparten una sola base entre procesos: correrla ahí le cambiaría los
 * datos a los demás archivos mientras están mirándolos. Se la prueba sobre una
 * copia, que es también como corre de verdad —sobre una base sola, al arrancar—.
 */
function elEstadoDeCadaCuerpo(conexion = db) {
  const NOMBRE = 'el estado de cada cuerpo, escrito';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('cuerpos')) return marcar();
  const columnas = conexion.prepare('PRAGMA table_info(cuerpos)').all().map((c) => c.name);
  // La columna se crea al arrancar; si aún no está, se intenta de nuevo
  if (!columnas.includes('estado')) return;

  const puestos = conexion
    .prepare("UPDATE cuerpos SET estado = 'Activo' WHERE estado IS NULL OR estado = ''")
    .run().changes;

  if (puestos) {
    console.log(
      `👥 Cuerpos / Grupos: ${puestos} estrenaron su estado «Activo», que es lo que el vacío ` +
        'significaba. Desde ahora el estado decide si el cuerpo recibe cosas nuevas.'
    );
  }
  marcar();
}

/**
 * Los nombres copiados que quedaron viejos.
 *
 * Seis registros del sistema guardan el nombre de una persona en una columna
 * propia, copiada de su ficha al guardar. Hasta la 1.254.0 solo UNA de las
 * seis volvía a mirarla cuando la ficha se corregía; las otras cinco quedaron
 * con el nombre del día que se guardaron (ver server/el-nombre-copiado.js).
 *
 * Desde ahora siguen a la ficha, pero eso vale de aquí en adelante: lo que ya
 * quedó viejo sigue viejo, y no es un rótulo cualquiera —es el nombre por el
 * que se busca a esa persona en el listado, el que titula cada registro y el
 * que sale impreso—.
 *
 * NO SE ADIVINA NADA: se le pide a la misma regla que corre de aquí en
 * adelante que ponga al día a cada persona, una por una. Así el resultado es
 * exactamente el que habría si la regla hubiera existido siempre, y no una
 * segunda versión de ella escrita acá que un día diga otra cosa.
 *
 * Las filas que llevan un nombre escrito a mano y no apuntan a ninguna ficha
 * no se tocan: la regla solo mira las que sí apuntan a una.
 *
 * Recibe la conexión porque esto pasa por TODAS las personas, y las pruebas
 * del motor comparten una sola base entre procesos: correrla ahí le cambiaría
 * los datos a los demás archivos mientras están mirándolos. Se la prueba sobre
 * una copia, que es también como corre de verdad —sobre una base sola, al
 * arrancar—.
 */
function losNombresCopiadosQueQuedaronViejos(conexion = db) {
  const NOMBRE = 'los nombres copiados que quedaron viejos';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return;

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('miembros') || !hayTabla('no_miembros')) return marcar();

  const { ponerAlDiaElNombre } = require('./el-nombre-copiado');
  let puestas = 0;
  let personas = 0;
  for (const deDonde of ['miembros', 'no_miembros']) {
    for (const f of conexion.prepare(`SELECT id FROM "${deDonde}"`).all()) {
      const cuantas = ponerAlDiaElNombre(conexion, deDonde, f.id);
      if (cuantas) { puestas += cuantas; personas++; }
    }
  }

  if (puestas) {
    console.log(
      `📝 ${puestas} registro(s) de ${personas} persona(s) tenían copiado un nombre viejo y ` +
        'quedaron al día: lo que muestran el listado, el título y lo impreso vuelve a decir lo que ' +
        'dice su ficha.'
    );
  }
  marcar();
}

/**
 * La categoría «CENTRAL» de las credenciales pasa a llamarse «MATRIZ».
 *
 * La categoría reservada al Pastor Presidente es la IGLESIA MATRIZ (punto 5.1
 * de las modificaciones). El registro de Iglesias siempre la llamó así —su
 * campo «tipo» dice «Iglesia Matriz» desde antes—; era la credencial la que la
 * rebautizaba «CENTRAL» al imprimir. Cambiada esa correspondencia, las
 * credenciales YA EMITIDAS conservan en su copia congelada la palabra vieja, y
 * hay que ponerlas al día para que no queden dos nombres para lo mismo.
 *
 * LO QUE ESTA MIGRACIÓN NO TOCA, Y ES LO MÁS IMPORTANTE DE ELLA: una iglesia
 * que se LLAME «Iglesia Central», o que tenga «CENTRAL» como código corto, no
 * se toca. Eso es un nombre propio que alguien escribió y no es una categoría.
 * Medido antes de escribir esto, en esta base había 69 valores con la palabra
 * «central» y NINGUNO era la categoría: eran el nombre de una congregación, su
 * código, sus cuentas de tesorería y el historial de cambios. Confundir las dos
 * cosas habría renombrado datos que nadie pidió tocar (punto 17.7).
 *
 * Y LA ADVERTENCIA DEL PUNTO 5.6. Al cambiar la categoría guardada cambia lo
 * que la página pública vuelve a firmar, así que una credencial impresa EN
 * MODO EN LÍNEA de esa categoría deja de validar: su código de autenticidad
 * ya no calza. (En modo sin conexión no pasa: el código lleva su contenido
 * adentro y se comprueba contra sí mismo, aunque la tarjeta quedaría diciendo
 * una palabra que el registro ya no usa.) Por eso las emitidas que se vean
 * afectadas quedan nombradas UNA POR UNA en el registro y en la consola, con
 * su número de serie: emitir el reemplazo es un acto con fecha, número nuevo y
 * una firma detrás, y no es algo que deba hacer solo el servidor al arrancar
 * —la misma razón por la que tampoco revoca solo—. La reemplaza una persona,
 * y al emitir la nueva el sistema deja la anterior como REEMPLAZADA.
 */
function laCategoriaCentralAhoraEsMatriz(conexion = db) {
  const NOMBRE = 'la categoría central de las credenciales ahora es matriz';
  const yaEsta = () => !!conexion.prepare('SELECT nombre FROM migraciones WHERE nombre = ?').get(NOMBRE);
  const marcar = () => conexion.prepare('INSERT OR IGNORE INTO migraciones (nombre) VALUES (?)').run(NOMBRE);
  if (yaEsta()) return { migradas: 0, emitidas: [] };

  const hayTabla = (t) =>
    !!conexion.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!hayTabla('credenciales')) { marcar(); return { migradas: 0, emitidas: [] }; }

  const ANTES = require('./credenciales/datos').CATEGORIA_ANTERIOR;
  const AHORA = require('./credenciales/datos').CATEGORIAS['Iglesia Matriz'];

  const afectadas = conexion
    .prepare(
      `SELECT id, serie, serie_dv, estado, snap_nombres, snap_apellidos
         FROM credenciales
        WHERE UPPER(TRIM(COALESCE(snap_categoria, ''))) = ?`
    )
    .all(ANTES);

  // Las que ya salieron en papel: son las del punto 5.6
  const emitidas = afectadas.filter((c) => (c.estado || 'Borrador') !== 'Borrador' && c.serie);

  const hecho = conexion.transaction(() => {
    const r = conexion
      .prepare(
        `UPDATE credenciales SET snap_categoria = ?
          WHERE UPPER(TRIM(COALESCE(snap_categoria, ''))) = ?`
      )
      .run(AHORA, ANTES);
    marcar();
    return r.changes;
  }).immediate();

  if (hecho) {
    console.log(
      `🏛️  Categoría de credencial: ${hecho} registro(s) pasaron de ${ANTES} a ${AHORA}.`
    );
    if (emitidas.length) {
      const cuales = emitidas
        .map((c) => `N.º ${c.serie}${c.serie_dv ? '-' + c.serie_dv : ''} (${c.snap_apellidos} ${c.snap_nombres})`)
        .join(', ');
      console.log(
        `⚠️  ${emitidas.length} de ellas YA ESTABAN EMITIDAS: ${cuales}.\n` +
          '   Si el código QR se emite en modo EN LÍNEA, esas tarjetas impresas dejan de validar,\n' +
          '   porque su código de autenticidad se calcula sobre la categoría. Hay que emitirles una\n' +
          '   credencial nueva; al hacerlo, la anterior queda como REEMPLAZADA y se conserva.'
      );
    }
    /**
     * Y que quede constancia, una línea por credencial (punto 5.3).
     *
     * Se escribe derecho en el Registro de Cambios en vez de pasar por
     * bitacora.anotarCambio, que necesita la definición del módulo: esto corre
     * al arrancar, antes de que los módulos estén montados. La línea nombra a
     * cada una por su número de serie, que es con lo que se la va a buscar
     * después para reemplazarla.
     */
    try {
      const anotar = conexion.prepare(
        `INSERT INTO registro_cambios
           (fecha, hora, modulo, accion, registro, registro_id, detalle, usuario, iglesia_id, created_by)
         VALUES (date('now','localtime'), strftime('%H:%M','now','localtime'),
                 'Credenciales', 'Migración', ?, ?, ?, 'Sistema', NULL, NULL)`
      );
      for (const c of afectadas) {
        const suNumero = c.serie ? `N.º ${c.serie}${c.serie_dv ? '-' + c.serie_dv : ''}` : 'sin número';
        const quien = `${c.snap_apellidos || ''} ${c.snap_nombres || ''}`.trim();
        anotar.run(
          `${suNumero} · ${quien}`.slice(0, 120),
          c.id,
          `La categoría de la iglesia pasó de «${ANTES}» a «${AHORA}».` +
            ((c.estado || 'Borrador') !== 'Borrador' && c.serie
              ? ' Esta credencial YA ESTABA EMITIDA: si su código QR se emitió en modo en línea, la' +
                ' tarjeta impresa deja de validar, porque el código de autenticidad se calcula sobre' +
                ' la categoría. Hay que emitirle una credencial nueva; la anterior quedará como' +
                ' Reemplazada y se conserva.'
              : ' Todavía no estaba emitida, así que no hay ninguna tarjeta impresa afectada.')
        );
      }
    } catch (e) {
      // Que no quede constancia es malo, pero peor sería no migrar por eso
      console.error(`   (no se pudo anotar en el registro de cambios: ${e.message})`);
    }
  }
  return { migradas: hecho, emitidas };
}

function ejecutarMigraciones() {
  const pasos = [
    ['RUT de los miembros', () => documentoIdentidadARut('miembros')],
    ['RUT de los pastores', () => documentoIdentidadARut('pastores')],
    ['tipo de los cuerpos', normalizarTipoCuerpos],
    ['directivas al histórico', directivaCuerpoAHistorico],
    ['cargos de las directivas', renombrarCargosDirectiva],
    ['oficial supervisor', oficialSupervisorAMiembro],
    ['movimientos a cuentas', movimientosACuentas],
    ['fondo para la corporación', fondoParaLaCorporacion],
    ['asistencias nominales', asistenciasNominales],
    ['actividades con varios cuerpos', actividadesConVariosCuerpos],
    ['cónyuge de los pastores', conyugeUnicoDePastores],
    ['integrantes con su ficha', integrantesConSuPropiaFicha],
    ['perfiles de permisos', perfilesDePermisos],
    ['quién cobra cuota', cuerposQueCobranCuota],
    ['tesorería de cada cuerpo', tesoreriaDeCadaCuerpo],
    ['actas con texto con formato', actasConTextoConFormato],
    ['la ofrenda entra completa', ofrendaEntraCompleta],
    ['mayúsculas de los cargos', cargosConMayuscula],
    ['cargos de los pastores', cargosDePastores],
    ['la iglesia principal no es una asignación', iglesiaPrincipalNoEsAsignacion],
    ['administrador general', administradorGeneral],
    ['categorías de tesorería', categoriasDeTesoreria],
    ['categorías de las deudas', categoriasDeLasDeudas],
    ['tipos de actividad y motivos de ausencia', listasDeAsistenciaComoDatos],
    ['directiva de cada iglesia', directivaDeCadaIglesia],
    ['devolver los que la directiva sacó (corregida)', devolverLosQueLaDirectivaSaco],
    ['marcas de asistencia con su cuerpo', marcasDeAsistenciaConSuCuerpo],
    ['formatos de certificado', formatosDeCertificadoQueTraiaElSistema],
    ['documentos a la oficina de partes', documentosALaOficinaDePartes],
    ['fichas de integrante con su nombre', fichasDeIntegranteConSuNombre],
    ['marcas de asistencia con su registro', marcasDeAsistenciaConSuRegistro],
    ['hojas de presentación y matrimonio', hojasDePresentacionYMatrimonio],
    ['certificados apaisados', certificadosApaisados],
    ['tipos de documento de los pastores', tiposDeDocumentoDePastores],
    ['tratos permitidos', tratamientosPermitidos],
    ['tipo de miembro de los menores', menoresDeEdadComoTipoDeMiembro],
    ['aviso de "otro documento"', avisoOtroDocumentoDeMiembros],
    ['tipos de actividad', tiposDeActividad],
    ['formas de ingreso', formasDeIngreso],
    ['tipos de servicio', tiposDeServicio],
    ['origen de las contraseñas', origenDeLasContrasenas],
    ['nombre oficial de la iglesia', nombreOficialDeLaIglesia],
    ['el cuerpo de cada movimiento', movimientosConElCuerpoDeSuCuenta],
    ['credenciales desde cero', credencialesDesdeCero],
    ['contador de credenciales al día', contadorDeCredencialesAlDia],
    ['ficha del beneficiario de cada ayuda', ayudasConFichaDelBeneficiario],
    ['cada iglesia con su código', cadaIglesiaConSuCodigo],
    ['seguimiento de las solicitudes', solicitudesConSeguimiento],
    ['solicitudes numeradas por iglesia', solicitudesNumeradasPorIglesia],
    ['texto con formato saneado de nuevo', textoConFormatoSaneadoDeNuevo],
    ['marcas de asistencia con su fecha de toma', marcasDeAsistenciaConSuFechaDeToma],
    ['los que ya no están salen de sus cuerpos', losQueYaNoEstanSalenDeSusCuerpos],
    ['el conteo de leídos se guarda en el mensaje', elConteoDeLeidosSeGuarda],
    ['los avisos de un mensaje dicen de quién vienen', elAvisoDiceDeQuienViene],
    ['a quiénes fue cada mensaje queda anotado', losDestinatariosQuedanAnotados],
    ['el porcentaje del aporte queda con su servicio', elPorcentajeDelAporteQuedaConSuServicio],
    ['los traslados entre cuentas quedan marcados', losTrasladosQuedanMarcados],
    ['las cuentas abiertas no llevan fecha de cierre', cuentasAbiertasSinFechaDeCierre],
    ['lo del cuerpo sigue al cuerpo cuando cambia de iglesia', loQueSeQuedoEnLaIglesiaAnterior],
    ['el nivel de cada artículo de inventario', elNivelDeCadaArticuloDeInventario],
    ['las cajas con el nombre viejo de su iglesia', lasCajasConElNombreViejoDeSuIglesia],
    ['los nombres de iglesia sin espacios de más', losNombresDeIglesiaSinEspaciosDeMas],
    ['el estado de cada cuerpo, escrito', elEstadoDeCadaCuerpo],
    ['los nombres copiados que quedaron viejos', losNombresCopiadosQueQuedaronViejos],
    ['la categoría central de las credenciales ahora es matriz', laCategoriaCentralAhoraEsMatriz],
  ];

  for (const [nombre, paso] of pasos) {
    try {
      paso();
    } catch (e) {
      console.error(
        `⚠️  No se pudo aplicar la migración "${nombre}": ${e.message}\n` +
          '   Los datos quedan como estaban y el sistema sigue funcionando.'
      );
    }
  }
}

/**
 * Le da ficha propia a los beneficiarios de las ayudas que ya estaban
 * registradas.
 *
 * Hasta ahora el beneficiario de una ayuda era un nombre escrito a mano, y
 * aparte un enlace opcional a un miembro. Al pasar a elegir explícitamente si
 * es miembro o no, esas ayudas quedarían sin decir de cuál de los dos se
 * trata. Así que se resuelve mirando lo que ya hay:
 *
 *   · la que apunta a un miembro queda marcada como «Miembro»
 *   · la que solo tiene un nombre escrito se convierte en una ficha de No
 *     Miembro con ese mismo nombre, y la ayuda queda enlazada a ella
 *
 * El mismo nombre repetido en varias ayudas da UNA sola ficha, con todas sus
 * ayudas colgando: eso es justamente lo que antes no se podía ver. La
 * comparación ignora mayúsculas y espacios de sobra, y se hace dentro de cada
 * iglesia, porque dos iglesias distintas pueden atender a dos personas que se
 * llaman igual y no son la misma.
 *
 * El nombre se guarda entero en «nombres» y no se parte en nombre y apellido:
 * partirlo sería adivinar dónde termina uno y empieza el otro, y en un
 * registro que existe para constancia vale más el nombre tal como se escribió.
 */
function ayudasConFichaDelBeneficiario() {
  const NOMBRE = 'ayudas_con_ficha_del_beneficiario';
  if (yaAplicada(NOMBRE)) return;

  const columnas = db.prepare('PRAGMA table_info("ayudas_sociales")').all().map((c) => c.name);
  if (!columnas.includes('beneficiario_tipo') || !columnas.includes('no_miembro_id')) return;

  let comoMiembro = 0;
  let fichasNuevas = 0;
  let comoNoMiembro = 0;
  let sinNombre = 0;

  db.transaction(() => {
    // 1) Las que ya apuntaban a un miembro
    comoMiembro = db
      .prepare(
        `UPDATE ayudas_sociales SET beneficiario_tipo = 'Miembro'
          WHERE (beneficiario_tipo IS NULL OR beneficiario_tipo = '')
            AND miembro_id IS NOT NULL`
      )
      .run().changes;

    // 2) Las que solo traían un nombre escrito a mano
    const sueltas = db
      .prepare(
        `SELECT id, iglesia_id, beneficiario FROM ayudas_sociales
          WHERE (beneficiario_tipo IS NULL OR beneficiario_tipo = '')
            AND miembro_id IS NULL`
      )
      .all();

    const nuevaFicha = db.prepare(
      `INSERT INTO no_miembros (iglesia_id, nombres, notas)
       VALUES (?, ?, 'Ficha creada automáticamente al pasar las ayudas sociales a llevar registro de las personas.')`
    );
    const enlazar = db.prepare(
      `UPDATE ayudas_sociales SET beneficiario_tipo = 'No miembro', no_miembro_id = ? WHERE id = ?`
    );

    /** Una ficha por nombre y por iglesia, no una por ayuda. */
    const yaCreadas = new Map();
    for (const ayuda of sueltas) {
      const nombre = String(ayuda.beneficiario || '').trim();
      if (!nombre) { sinNombre++; continue; }
      const clave = `${ayuda.iglesia_id}|${nombre.toLowerCase().replace(/\s+/g, ' ')}`;
      let ficha = yaCreadas.get(clave);
      if (!ficha) {
        ficha = nuevaFicha.run(ayuda.iglesia_id, nombre).lastInsertRowid;
        yaCreadas.set(clave, ficha);
        fichasNuevas++;
      }
      enlazar.run(ficha, ayuda.id);
      comoNoMiembro++;
    }
  }).immediate();

  if (comoMiembro || comoNoMiembro || sinNombre) {
    console.log(
      `🤝 Ayudas sociales: ${comoMiembro} a nombre de un miembro, ` +
        `${comoNoMiembro} pasadas a ${fichasNuevas} ficha(s) nueva(s) de No Miembros` +
        (sinNombre ? `, ${sinNombre} sin nombre que quedaron como estaban` : '') + '.'
    );
  }
  marcarAplicada(NOMBRE);
}

/**
 * Pone al día las solicitudes que ya estaban ingresadas.
 *
 * El módulo pasó de ser una ficha que se llena y se archiva a un trámite con
 * seguimiento, y las solicitudes de antes se quedarían sin lo nuevo: sin
 * número con el que nombrarlas, sin ficha de quién las presentó y con su
 * historial en blanco. Se resuelve mirando lo que ya hay:
 *
 *   · SU NÚMERO. Se numeran por orden de fecha, dentro de cada año, y el
 *     contador de cada año queda donde corresponde: la próxima solicitud de
 *     2026 sigue después de la última de 2026, no repite el 0001.
 *
 *   · QUIÉN LA PRESENTÓ. La que ya apuntaba a un miembro queda marcada como
 *     «Miembro». La que solo traía un nombre escrito se convierte en una ficha
 *     de No Miembro con ese mismo nombre —una por persona y por iglesia, no
 *     una por solicitud—, igual que se hizo con las ayudas sociales.
 *
 *   · SU ADJUNTO. El archivo que colgaba del campo `adjunto` pasa a ser un
 *     documento de la solicitud, que es donde viven ahora. La columna vieja no
 *     se toca: el archivo queda referido en los dos sitios y no se pierde.
 *
 *   · SU HISTORIAL. Se le deja la primera anotación, con la fecha en que
 *     entró, y si figuraba atendida por alguien, eso también queda dicho.
 */
function solicitudesConSeguimiento() {
  const NOMBRE = 'solicitudes_con_seguimiento';
  if (yaAplicada(NOMBRE)) return;

  const columnas = db.prepare('PRAGMA table_info("solicitudes")').all().map((c) => c.name);
  if (!columnas.includes('numero') || !columnas.includes('solicitante_tipo')) return;

  /**
   * `adjunto` y `atendida_por` son columnas del módulo VIEJO.
   *
   * En una iglesia que ya venía usando el sistema están, porque las columnas no
   * se borran nunca. En una instalación nueva no existen: el módulo ya no las
   * declara y nadie las creó. Pedirlas sin mirar hacía fallar la migración
   * entera en cada arranque de un sistema recién instalado.
   */
  const traeAdjunto = columnas.includes('adjunto');
  const traeAtendida = columnas.includes('atendida_por');

  const numero = require('./solicitudes/numero');
  const seguimiento = require('./solicitudes/seguimiento');

  let numeradas = 0, comoMiembro = 0, fichasNuevas = 0, comoNoMiembro = 0, adjuntos = 0;

  db.transaction(() => {
    /*
     * 1) El número, por orden de fecha, dentro de cada iglesia y cada año.
     *
     * Estas solicitudes vienen de antes de que el módulo llevara número, así
     * que no hay ninguna referencia que respetar: se numeran directamente con
     * el formato de hoy —`SOL-CENTRAL-0001-2026`—, que dice de qué iglesia es
     * cada una. Las que ya traían número no se tocan.
     */
    const sinNumero = db
      .prepare(`SELECT id, fecha, iglesia_id, solicitante, miembro_id, estado
                     ${traeAdjunto ? ', adjunto' : ''}${traeAtendida ? ', atendida_por' : ''}
                  FROM solicitudes WHERE numero IS NULL OR numero = ''
                 ORDER BY fecha, id`)
      .all();
    const porLibro = new Map();
    const ponerNumero = db.prepare('UPDATE solicitudes SET numero = ? WHERE id = ?');
    for (const s of sinNumero) {
      const anio = Number(String(s.fecha || '').slice(0, 4)) || new Date().getFullYear();
      const deQuien = Number(s.iglesia_id) || 0;
      const libro = `${deQuien}:${anio}`;
      const cuantas = (porLibro.get(libro) || 0) + 1;
      porLibro.set(libro, cuantas);
      ponerNumero.run(
        numero.comoSeEscribe(cuantas, anio, require('./codigo-iglesia').deLaIglesia(db, deQuien)),
        s.id
      );
      numeradas++;
    }
    // El contador de cada libro queda donde llegó su numeración
    for (const [libro, cuantas] of porLibro) {
      const [deQuien, anio] = libro.split(':');
      numero.alMenos(Number(deQuien), Number(anio), cuantas);
    }

    // 2) Quién la presentó
    const nuevaFicha = db.prepare(
      `INSERT INTO no_miembros (iglesia_id, nombres, notas)
       VALUES (?, ?, 'Ficha creada automáticamente al pasar las solicitudes a llevar seguimiento.')`
    );
    const comoMiembroSql = db.prepare("UPDATE solicitudes SET solicitante_tipo = 'Miembro' WHERE id = ?");
    const comoNoMiembroSql = db.prepare("UPDATE solicitudes SET solicitante_tipo = 'No miembro', no_miembro_id = ? WHERE id = ?");
    const yaCreadas = new Map();
    for (const s of sinNumero) {
      if (s.miembro_id) { comoMiembroSql.run(s.id); comoMiembro++; continue; }
      const nombre = String(s.solicitante || '').trim();
      if (!nombre) continue;
      const clave = `${s.iglesia_id}|${nombre.toLowerCase().replace(/\s+/g, ' ')}`;
      let ficha = yaCreadas.get(clave);
      if (!ficha) {
        ficha = nuevaFicha.run(s.iglesia_id, nombre).lastInsertRowid;
        yaCreadas.set(clave, ficha);
        fichasNuevas++;
      }
      comoNoMiembroSql.run(ficha, s.id);
      comoNoMiembro++;
    }

    // 3) El adjunto que colgaba del formulario pasa a ser un documento
    const nuevoDoc = db.prepare(
      `INSERT INTO documentos_solicitudes (solicitud_id, tipo, nombre, archivo, fecha, iglesia_id)
       VALUES (?, 'Antecedente', 'Documento adjunto al ingresar', ?, ?, ?)`
    );
    for (const s of sinNumero) {
      if (!s.adjunto) continue;
      nuevoDoc.run(s.id, s.adjunto, s.fecha, s.iglesia_id);
      adjuntos++;
    }

    // 4) La primera anotación del historial
    for (const s of sinNumero) {
      const suNumero = db.prepare('SELECT numero FROM solicitudes WHERE id = ?').get(s.id).numero;
      seguimiento.anotar(db, s.id, {
        tipo: 'Ingreso',
        fecha: s.fecha,
        descripcion: `Solicitud ${suNumero} ingresada a nombre de ${s.solicitante || 'quien corresponda'}.` +
          (s.atendida_por ? ` Figuraba atendida por ${s.atendida_por}.` : '') +
          ' (Anotación creada al pasar el módulo a llevar seguimiento; lo anterior no quedaba registrado.)',
        user: null,
      });
    }
  }).immediate();

  if (numeradas) {
    console.log(
      `📨 Solicitudes: ${numeradas} numerada(s) · ${comoMiembro} a nombre de un miembro, ` +
        `${comoNoMiembro} pasadas a ${fichasNuevas} ficha(s) de No Miembros` +
        (adjuntos ? ` · ${adjuntos} adjunto(s) pasados a documentos` : '') + '.'
    );
  }
  marcarAplicada(NOMBRE);
}

// Estas dos se exponen aparte para poder probarlas solas: son las únicas que
// crean fichas nuevas a partir de datos escritos a mano, y equivocarse ahí
// significa duplicar personas, perder ayudas o repetir un número de solicitud.
module.exports = {
  ejecutarMigraciones, categoriasDeTesoreria, categoriasDeLasDeudas, ayudasConFichaDelBeneficiario, solicitudesConSeguimiento,
  cadaIglesiaConSuCodigo, solicitudesNumeradasPorIglesia,
  devolverLosQueLaDirectivaSaco, marcasDeAsistenciaConSuCuerpo, actividadesConVariosCuerpos,
  elConteoDeLeidosSeGuarda,
  elAvisoDiceDeQuienViene, losDestinatariosQuedanAnotados, elPorcentajeDelAporteQuedaConSuServicio,
  losTrasladosQuedanMarcados, cuentasAbiertasSinFechaDeCierre,
  loQueSeQuedoEnLaIglesiaAnterior,
  formatosDeCertificadoQueTraiaElSistema, documentosALaOficinaDePartes,
  fichasDeIntegranteConSuNombre, marcasDeAsistenciaConSuRegistro,
  hojasDePresentacionYMatrimonio, certificadosApaisados,
  elNivelDeCadaArticuloDeInventario,
  lasCajasConElNombreViejoDeSuIglesia,
  losNombresDeIglesiaSinEspaciosDeMas,
  elEstadoDeCadaCuerpo,
  losNombresCopiadosQueQuedaronViejos,
  laCategoriaCentralAhoraEsMatriz,
};
