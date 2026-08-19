/**
 * Migraciones de datos (se ejecutan al iniciar y son idempotentes).
 *
 * A diferencia de db.js —que crea tablas y columnas—, aquí se transforma
 * información ya guardada cuando cambia la forma de registrarla.
 */
const { db } = require('./db');
const rut = require('./rut');

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


function ejecutarMigraciones() {
  documentoIdentidadARut('miembros');
  documentoIdentidadARut('pastores');
  normalizarTipoCuerpos();
  directivaCuerpoAHistorico();
  renombrarCargosDirectiva();
  oficialSupervisorAMiembro();
  movimientosACuentas();
  fondoParaLaCorporacion();
  asistenciasNominales();
  actividadesConVariosCuerpos();
}

module.exports = { ejecutarMigraciones };
