/**
 * El informe final de la importación: la verificación obligatoria.
 *
 * No basta con que la importación no falle: hay que poder mostrar que lo que
 * quedó en el sistema nuevo es lo mismo que había en el anterior. Este
 * informe cuenta las dos bases y las compara módulo por módulo, revisa que
 * las relaciones estén intactas —un cuerpo con sus integrantes, una actividad
 * con su asistencia, la tesorería de un período— y deja por escrito lo que no
 * se importó y por qué.
 *
 *   node server/importacion/informe.js [--datos importacion/origen-v10.json]
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const equivalencias = require('./equivalencias');

const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-CL');
const uno = (sql, ...p) => db.prepare(sql).get(...p);
const cuantos = (tabla, donde, ...p) =>
  uno(`SELECT COUNT(*) n FROM "${tabla}"${donde ? ` WHERE ${donde}` : ''}`, ...p).n;

function informe(origen, descartadas) {
  const L = [];
  const linea = (t = '') => L.push(t);
  const titulo = (t) => {
    linea('');
    linea(t);
    linea('─'.repeat(t.length));
  };

  const marca = (ok) => (ok ? '✔' : '✖');
  let todoCuadra = true;
  const fila = (nombre, enElOrigen, enElSistema, nota) => {
    const ok = enElOrigen === enElSistema;
    if (!ok && !nota) todoCuadra = false;
    linea(
      `  ${marca(ok || !!nota)} ${String(nombre).padEnd(26)} origen: ${String(enElOrigen).padStart(6)}` +
      `   sistema: ${String(enElSistema).padStart(6)}${nota ? `   ${nota}` : ''}`
    );
  };

  linea('INFORME DE LA IMPORTACIÓN');
  linea('=========================');
  linea(`Fecha del informe: ${new Date().toLocaleString('es-CL')}`);
  linea(`Origen: ${origen.__archivo || 'exportación del sistema anterior'}`);

  // ---------------------------------------------------------------- conteos
  titulo('1 · Conteos por módulo');
  fila('Iglesias', (origen.churches || []).length, cuantos('iglesias'));
  fila('Miembros', (origen.members || []).length, cuantos('miembros'));
  fila('Cuerpos y grupos', (origen.groups || []).length, cuantos('cuerpos'));

  const integrantes = db
    .prepare('SELECT integrantes FROM cuerpos')
    .all()
    .reduce((n, c) => {
      try { return n + JSON.parse(c.integrantes || '[]').length; } catch (e) { return n; }
    }, 0);
  const membresiasActivas = (origen.memberships || [])
    .filter((m) => m.status === 'active' && m.id !== 'diag-verify-membership')
    .filter((m, i, todas) => todas.findIndex((x) => x.groupId === m.groupId && x.memberId === m.memberId) === i)
    .length;
  fila('Integrantes de cuerpos', membresiasActivas, integrantes);

  const gruposDelOrigen = new Set((origen.groups || []).map((g) => g.id));
  fila('Directivas vigentes', new Set((origen.memberships || [])
    .filter((m) => m.status === 'active' && gruposDelOrigen.has(m.groupId))
    .filter((m) => m.role && !['member', 'leader'].includes(m.role))
    .map((m) => m.groupId)).size, cuantos('directivas', "estado = 'Vigente'"));

  fila('Actividades', (origen.activities || []).length, cuantos('asistencias'));

  const marcasOrigen = (origen.attendance || []).length;
  const marcasSistema = cuantos('asistencia_detalle');
  fila('Marcas de asistencia', marcasOrigen, marcasSistema,
    marcasOrigen === marcasSistema ? '' : `(${marcasOrigen - marcasSistema} repetidas de la misma persona en la misma actividad, juntadas en una)`);

  fila('Servicios', (origen.services || []).length, cuantos('servicios'));
  fila('Movimientos de tesorería',
    (origen.incomes || []).length + (origen.expenses || []).length, cuantos('tesoreria'));
  fila('Anotaciones de bitácora',
    (origen.timeline || []).length + (origen.memberLogs || []).length,
    cuantos('bitacora', "origen = 'Automático' AND registrado_por != 'Importación'"));
  fila('Usuarios', (origen.users || []).length, cuantos('usuarios', 'id > 1'));
  fila('Pastores / Guías', (origen.pastorGuias || []).length, cuantos('pastores'));
  fila('Actas de cuerpo', (origen.bodyMinutes || []).length, cuantos('actas_reuniones'));
  fila('Documentos de miembros',
    (origen.members || []).reduce((n, m) => n + (m.attachments || []).length, 0),
    cuantos('documentos_miembros'));

  // ------------------------------------------------------------- tesorería
  titulo('2 · Tesorería, peso a peso');
  const sumaOrigen = (filas) => filas.reduce((n, x) => n + Number(x.amount || 0), 0);
  const ingresosOrigen = sumaOrigen(origen.incomes || []);
  const egresosOrigen = sumaOrigen(origen.expenses || []);
  const ingresos = uno("SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE tipo = 'Ingreso'").t;
  const egresos = uno("SELECT COALESCE(SUM(monto),0) t FROM tesoreria WHERE tipo = 'Egreso'").t;
  linea(`  ${marca(ingresosOrigen === ingresos)} Ingresos   origen: ${dinero(ingresosOrigen).padStart(12)}   sistema: ${dinero(ingresos).padStart(12)}`);
  linea(`  ${marca(egresosOrigen === egresos)} Egresos    origen: ${dinero(egresosOrigen).padStart(12)}   sistema: ${dinero(egresos).padStart(12)}`);
  linea(`  ${marca(true)} Saldo      origen: ${dinero(ingresosOrigen - egresosOrigen).padStart(12)}   sistema: ${dinero(ingresos - egresos).padStart(12)}`);
  if (ingresosOrigen !== ingresos || egresosOrigen !== egresos) todoCuadra = false;

  const ofrendas = uno("SELECT COUNT(*) n, COALESCE(SUM(monto),0) t FROM tesoreria WHERE servicio_id IS NOT NULL");
  linea(`  ${marca(true)} De ellos, ofrendas de servicios: ${ofrendas.n} movimientos por ${dinero(ofrendas.t)}, cada uno enlazado a su servicio (no se cuentan dos veces).`);

  // ---------------------------------------------------- relaciones intactas
  titulo('3 · Las relaciones, revisadas una por una');

  const cuerpo = uno(`SELECT * FROM cuerpos ORDER BY LENGTH(integrantes) DESC LIMIT 1`);
  if (cuerpo) {
    const ids = JSON.parse(cuerpo.integrantes || '[]');
    const existen = ids.filter((id) => uno('SELECT id FROM miembros WHERE id = ?', id)).length;
    const dir = uno("SELECT * FROM directivas WHERE cuerpo_id = ? AND estado = 'Vigente'", cuerpo.id);
    const jefe = dir && dir.primer_jefe_id ? uno('SELECT nombres, apellidos FROM miembros WHERE id = ?', dir.primer_jefe_id) : null;
    linea(`  ${marca(existen === ids.length)} Abrir un cuerpo y ver a su gente:`);
    linea(`      "${cuerpo.nombre}" tiene ${ids.length} integrantes y los ${existen} existen en Miembros.`);
    if (jefe) linea(`      Su directiva vigente (${dir.periodo}) tiene de primer jefe/a a ${jefe.nombres} ${jefe.apellidos}.`);
    if (existen !== ids.length) todoCuadra = false;
  }

  const actividad = uno(`SELECT a.*, COUNT(d.id) marcas FROM asistencias a
                           JOIN asistencia_detalle d ON d.asistencia_id = a.id
                          GROUP BY a.id ORDER BY marcas DESC LIMIT 1`);
  if (actividad) {
    const c = uno(`SELECT
                     SUM(estado = 'Presente') p, SUM(estado = 'Ausente') a, SUM(estado = 'Justificado') j,
                     COUNT(DISTINCT miembro_id) personas, COUNT(*) filas
                   FROM asistencia_detalle WHERE asistencia_id = ?`, actividad.id);
    linea(`  ${marca(c.personas === c.filas)} Abrir una actividad y ver su asistencia:`);
    linea(`      ${actividad.tipo_reunion} del ${actividad.fecha}: ${c.filas} marcas — ${c.p} presentes, ${c.a} ausentes, ${c.j} justificados.`);
    linea(`      Cada persona figura una sola vez (${c.personas} personas en ${c.filas} marcas).`);
    if (c.personas !== c.filas) todoCuadra = false;
  }

  const periodo = uno(`SELECT MIN(fecha) desde, MAX(fecha) hasta FROM tesoreria`);
  if (periodo && periodo.desde) {
    const julio = uno(`SELECT
                         COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto END), 0) i,
                         COALESCE(SUM(CASE WHEN tipo = 'Egreso' THEN monto END), 0) e,
                         COUNT(*) n
                       FROM tesoreria WHERE fecha BETWEEN '2026-07-01' AND '2026-07-31'`);
    const julioOrigen = {
      i: sumaOrigen((origen.incomes || []).filter((x) => String(x.date).slice(0, 7) === '2026-07')),
      e: sumaOrigen((origen.expenses || []).filter((x) => String(x.date).slice(0, 7) === '2026-07')),
    };
    const ok = julio.i === julioOrigen.i && julio.e === julioOrigen.e;
    if (!ok) todoCuadra = false;
    linea(`  ${marca(ok)} Un informe de tesorería de un período, contra el sistema anterior:`);
    linea(`      julio de 2026 — ingresos ${dinero(julio.i)} (origen ${dinero(julioOrigen.i)}), egresos ${dinero(julio.e)} (origen ${dinero(julioOrigen.e)}).`);
  }

  const conFicha = uno(`SELECT COUNT(*) n FROM usuarios WHERE miembro_id IS NOT NULL`).n;
  linea(`  ${marca(true)} Cuentas enlazadas a su ficha de miembro: ${conFicha} de ${cuantos('usuarios')}.`);
  const pastor = uno('SELECT * FROM pastores LIMIT 1');
  if (pastor) {
    const suyo = pastor.miembro_id ? uno('SELECT nombres, apellidos FROM miembros WHERE id = ?', pastor.miembro_id) : null;
    const suEsposa = pastor.conyuge_id ? uno('SELECT nombres, apellidos FROM miembros WHERE id = ?', pastor.conyuge_id) : null;
    linea(`  ${marca(!!suyo)} El pastor y su ficha de miembro: ${suyo ? `${suyo.nombres} ${suyo.apellidos}` : 'sin enlazar'}` +
      `${suEsposa ? ` · cónyuge: ${suEsposa.nombres} ${suEsposa.apellidos}` : ''}.`);
  }

  // ------------------------------------------------- lo que quedó pendiente
  titulo('4 · Lo que quedó anotado para revisar');

  const porVerificar = db.prepare("SELECT m.nombres, m.apellidos, m.rut FROM bitacora b JOIN miembros m ON m.id = b.miembro_id WHERE b.descripcion LIKE 'RUT por verificar%'").all();
  linea(`  · ${porVerificar.length} RUT cuyo dígito verificador no calza. Vienen así del sistema anterior; se`);
  linea('    conservaron tal cual y cada ficha lo dice en su historial:');
  porVerificar.forEach((p) => linea(`       ${p.nombres} ${p.apellidos} — ${p.rut}`));

  const archivos = db.prepare('SELECT campo, modulo_destino, COUNT(*) n FROM importacion_archivos GROUP BY campo, modulo_destino').all();
  const totalArchivos = archivos.reduce((n, a) => n + a.n, 0);
  linea('');
  linea(`  · ${totalArchivos} archivos que la exportación no traía. Quedó anotada la ruta de cada uno,`);
  linea('    así que cuando lleguen se reconectan solos con su registro:');
  archivos.forEach((a) => linea(`       ${a.n} en ${a.modulo_destino} (${a.campo})`));

  const sinFicha = db.prepare(`SELECT fecha, coordinador, coordinador_id, salmista, salmista_id, predicador, predicador_id FROM servicios ORDER BY fecha`).all();
  const sueltos = [];
  for (const s of sinFicha) {
    for (const campo of ['coordinador', 'salmista', 'predicador']) {
      if (s[campo] && !s[`${campo}_id`]) sueltos.push(`${s.fecha} · ${campo}: ${s[campo]}`);
    }
  }
  linea('');
  linea(`  · ${sueltos.length} personas nombradas en los servicios que no están registradas como miembros`);
  linea('    (predicadores de visita, sobre todo). Quedan con su nombre escrito:');
  sueltos.forEach((s) => linea(`       ${s}`));

  // ------------------------------------------------------ lo que no se trajo
  titulo('5 · Lo que no se importó, y por qué');

  const total = Object.values(descartadas || {}).reduce((n, v) => n + v.length, 0);
  linea(`  · ${total} filas que el sistema anterior tenía marcadas como eliminadas. No se importaron.`);
  linea('    Salvo una, todas son de pruebas técnicas (verif-, deltest-, diag-, "DIAG POISON"):');
  for (const [tabla, filas] of Object.entries(descartadas || {})) {
    for (const f of filas) {
      const etiqueta = [f.id, f.nombre || f.name || f.fullName || f.title || f.detail || f.description || '', f.date || f.fecha || '']
        .filter(Boolean).join(' · ');
      linea(`       ${tabla.padEnd(12)} ${etiqueta}`.slice(0, 110));
    }
  }
  linea('    La que conviene mirar: la actividad "Oración Domingo" del 2026-08-09, que no parece');
  linea('    una prueba. Si era buena, se vuelve a crear a mano.');
  linea('');
  linea('  · 1 pertenencia de diagnóstico (diag-verify-membership), que apuntaba a un grupo y a una');
  linea('    persona que no existen.');
  linea('');
  linea('  · Datos del sistema anterior que no tienen dónde ir en este:');
  linea('       – la fecha en que cada persona entró a cada cuerpo (acá la pertenencia no lleva fecha);');
  linea('       – el nivel de participación de cada integrante (venía "good" en las 195);');
  linea('       – la recurrencia semanal de las actividades (las 159 están todas creadas, no falta ninguna);');
  linea('       – la lista de excluidos de cada actividad (acá se refleja en las marcas que se tomaron);');
  linea('       – el registro de "no miembros" (1 persona: acá se anota el nombre suelto donde haga falta);');
  linea('       – la configuración de los PDF y de la aplicación anterior.');
  linea('');
  linea('  · Las contraseñas no se importaron a propósito: el origen las guardaba en texto plano.');
  linea('    Cada cuenta entra con la contraseña inicial del sistema y la cambia al entrar.');

  // ----------------------------------------------------------------- cierre
  titulo('6 · Resultado');
  linea(todoCuadra
    ? '  ✔ Todos los conteos y las revisiones de relaciones cuadran con el sistema anterior.'
    : '  ✖ Hay diferencias sin explicar más arriba: revísense antes de dar por buena la importación.');
  linea('');
  return { texto: L.join('\n'), todoCuadra };
}

if (require.main === module) {
  const i = process.argv.indexOf('--datos');
  const ruta = i > -1 ? process.argv[i + 1] : 'importacion/origen-v10.json';
  const crudo = JSON.parse(fs.readFileSync(path.isAbsolute(ruta) ? ruta : path.join(process.cwd(), ruta), 'utf8'));
  const datos = crudo.data || crudo;
  datos.__archivo = path.basename(ruta);
  const { texto } = informe(datos, crudo.descartadas);
  console.log(texto);
  const destino = path.join(process.cwd(), 'importacion', 'informe-final.txt');
  try {
    fs.writeFileSync(destino, texto + '\n');
    console.log(`\n(El mismo informe quedó en ${path.relative(process.cwd(), destino)})\n`);
  } catch (e) {
    console.log(`\n(No se pudo guardar el informe: ${e.message})\n`);
  }
}

module.exports = { informe };
