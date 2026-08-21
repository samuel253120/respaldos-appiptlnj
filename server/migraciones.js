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
      fila.fecha_constitucion || new Date().toISOString().slice(0, 10),
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
function actividadesConVariosCuerpos() {
  const columnas = db.prepare('PRAGMA table_info("asistencias")').all().map((c) => c.name);
  if (!columnas.includes('cuerpo_id') || !columnas.includes('cuerpos')) return;

  const pendientes = db
    .prepare(`SELECT id, cuerpo_id FROM asistencias
               WHERE cuerpo_id IS NOT NULL AND (cuerpos IS NULL OR cuerpos = '' OR cuerpos = '[]')`)
    .all();
  if (!pendientes.length) return;

  const actualizar = db.prepare('UPDATE asistencias SET cuerpos = ? WHERE id = ?');
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
    ['tipos de documento de los pastores', tiposDeDocumentoDePastores],
    ['tratos permitidos', tratamientosPermitidos],
    ['tipo de miembro de los menores', menoresDeEdadComoTipoDeMiembro],
    ['aviso de "otro documento"', avisoOtroDocumentoDeMiembros],
    ['tipos de actividad', tiposDeActividad],
    ['formas de ingreso', formasDeIngreso],
    ['tipos de servicio', tiposDeServicio],
    ['origen de las contraseñas', origenDeLasContrasenas],
    ['nombre oficial de la iglesia', nombreOficialDeLaIglesia],
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

module.exports = { ejecutarMigraciones };
