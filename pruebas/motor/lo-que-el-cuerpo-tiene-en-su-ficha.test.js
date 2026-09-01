/**
 * Lo que la ficha de un cuerpo dice del cuerpo.
 *
 * Se abrió la ficha de un cuerpo con 69 integrantes, dos cajas y 24 actividades
 * en el año, y se contó lo que mostraba contra lo que el sistema sabía de él en
 * ese mismo momento:
 *
 *   la cabecera decía ........... el nombre, «Iglesia Central» y una insignia
 *                                 que decía «Cuerpo»
 *   el resumen .................. vacío
 *   pestañas .................... 7
 *
 * Todo lo demás estaba detrás de esas siete pestañas, y lo que está detrás de
 * una pestaña no se mira: quien abre la ficha de un cuerpo para decidir si
 * conviene fusionarlo, cerrarlo o pedirle su reglamento no las va a recorrer
 * una por una. Es lo mismo que la 1.234.0 le agregó a la ficha de una iglesia.
 *
 * Y al medirlo aparecieron otras dos cosas de la misma cabecera:
 *
 *   · El cumplimiento del cuerpo —lo único que dice si está en regla— se
 *     calculaba y no se pintaba en ninguna parte. No era solo de este módulo:
 *     todo calculado con color y sin enlace se caía por todas las ramas del
 *     dibujo. Seis fichas.
 *   · «Quién lo dirige» salía de la COPIA del nombre y no del enlace, así que
 *     era el último lugar donde un nombre corregido podía seguir viejo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { getModule, allModules } = require('../../server/registry');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

let n = 0;
const marca = () => `${++n}-${process.pid}`;
let rut = 26000000 + (process.pid % 300000) * 3;
const otroRut = () => { const cuerpo = String(++rut); return `${cuerpo}-${digitoVerificador(cuerpo)}`; };

/** Un cuerpo suelto, en su propia iglesia, con todo lo que se le pueda colgar. */
function unCuerpoConVida() {
  const m = marca();
  const iglesia = db
    .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Iglesia del cuerpo ${m}`, `CUV${m}`).lastInsertRowid;
  const id = db
    .prepare("INSERT INTO cuerpos (nombre, tipo, iglesia_id, estado) VALUES (?, 'Cuerpo', ?, 'Activo')")
    .run(`Cuerpo con vida ${m}`, iglesia).lastInsertRowid;

  const miembro = (nombres = 'Alguien', apellidos = `Delcuerpo ${m}`) => db
    .prepare('INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?, ?, ?, ?, ' + "'Activo')")
    .run(nombres, apellidos, otroRut(), iglesia).lastInsertRowid;

  const integrante = (estado, miembroId) => db
    .prepare(`INSERT INTO integrantes_cuerpo (cuerpo_id, persona_tipo, miembro_id, persona, estado, iglesia_id)
              VALUES (?, 'Miembro', ?, 'Quien sea', ?, ?)`)
    .run(id, miembroId || miembro(), estado, iglesia).lastInsertRowid;

  const caja = (saldoInicial) => db
    .prepare(`INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial)
              VALUES (?, 'Cuerpo / Grupo', ?, ?, 'General', 'Activa', ?)`)
    .run(`Caja ${m}-${Math.random()}`, iglesia, id, saldoInicial).lastInsertRowid;

  const movimiento = (cuenta, tipo, monto, fecha) => db
    .prepare(`INSERT INTO tesoreria (fecha, tipo, categoria, concepto, monto, cuenta_id, iglesia_id, cuerpo_id)
              VALUES (?, ?, 'Diezmos', 'Algo', ?, ?, ?, ?)`)
    .run(fecha, tipo, monto, cuenta, iglesia, id);

  const directiva = (estado, periodo, inicio, termino) => db
    .prepare(`INSERT INTO directivas (cuerpo_id, iglesia_id, periodo, fecha_inicio, fecha_termino, estado)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, iglesia, periodo, inicio, termino, estado).lastInsertRowid;

  const actividad = (fecha, cuerpos) => db
    .prepare("INSERT INTO asistencias (nombre, fecha, iglesia_id, tipo_reunion, cuerpos) VALUES (?, ?, ?, 'Culto', ?)")
    .run(`Culto ${m}-${fecha}-${Math.random()}`, fecha, iglesia, JSON.stringify(cuerpos || [id]));

  const acta = (fecha) => db
    .prepare("INSERT INTO actas_reuniones (numero_acta, fecha, iglesia_id, cuerpo_id, estado) VALUES (?, ?, ?, ?, 'Aprobada')")
    .run(`A-${m}-${fecha}`, fecha, iglesia, id);

  const bien = () => db
    .prepare("INSERT INTO inventarios (articulo, ambito, iglesia_id, cuerpo_id, estado) VALUES (?, 'Cuerpo / Grupo', ?, ?, 'Bueno')")
    .run(`Cosa ${m}-${Math.random()}`, iglesia, id);

  return { id, iglesia, m, miembro, integrante, caja, movimiento, directiva, actividad, acta, bien };
}

const resumen = async (api, id) => (await api('GET', `/cuerpos/${id}/resumen`)).json;

// --------------------------------------------------- lo que el cuerpo es ----

test('el resumen cuenta lo de ESE cuerpo y no lo del de al lado', async () => {
  const api = await elSistemaAndando();
  const a = unCuerpoConVida();
  const b = unCuerpoConVida();
  a.integrante('Activo'); a.integrante('Activo'); a.caja(0); a.acta('2026-02-01'); a.bien();
  b.integrante('Activo'); b.caja(0); b.acta('2026-02-01'); b.bien(); b.bien();

  const r = await resumen(api, a.id);
  assert.equal(r.integrantes.activos, 2, 'la gente del otro cuerpo no puede entrar en esta cifra');
  assert.equal(r.tesoreria.cuentas, 1);
  assert.equal(r.actas.total, 1);
  assert.equal(r.inventario.total, 1);
});

test('«pertenecen hoy» es lo mismo acá que en la planilla de cuotas', async () => {
  /*
   * Quien está EN PRUEBA pertenece al cuerpo —se le cobra cuota, se lo convoca,
   * cuenta para su directiva—; quien se retiró, no. Es la misma definición que
   * usan la planilla y el panel de su ficha (VIGENTES, en server/integrantes.js),
   * y por eso se compara contra ella y no contra una lista escrita otra vez acá:
   * dos cifras de lo mismo que se contradigan en la misma pantalla es
   * exactamente lo que le pasó a la primera versión del resumen de una iglesia.
   */
  const { VIGENTES } = require('../../server/integrantes');
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  for (const estado of VIGENTES) c.integrante(estado);
  c.integrante('Retirado');

  const r = await resumen(api, c.id);
  assert.equal(r.integrantes.activos, VIGENTES.length, 'el que está en prueba también es del cuerpo');
  assert.equal(r.integrantes.total, VIGENTES.length + 1, 'y el retirado sigue estando en la ficha');
  assert.equal(r.integrantes.en_prueba, 1, 'para poder apuntar cuántos están a prueba');
});

test('el saldo de sus cajas es lo que YA entró y salió', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  const cuenta = c.caja(20000);
  c.caja(5000);
  c.movimiento(cuenta, 'Ingreso', 7000, '2026-01-10');
  c.movimiento(cuenta, 'Egreso', 2000, '2026-01-20');
  assert.equal((await resumen(api, c.id)).tesoreria.saldo, 30000);

  /*
   * Y lo anotado MÁS ADELANTE no está en la caja todavía: usa la misma
   * condición con que cada cuenta calcula su propio saldo (ver server/saldos.js),
   * para que la cifra de la ficha y la de la cartola no puedan discrepar.
   */
  c.movimiento(cuenta, 'Ingreso', 999000, '2099-12-31');
  assert.equal((await resumen(api, c.id)).tesoreria.saldo, 30000,
    'lo agendado para dentro de setenta años no está en la caja de hoy');
});

test('la directiva que sale es la VIGENTE, y si no hay se dice', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  c.directiva('Finalizada', '2023-2024', '2023-01-01', '2024-12-31');
  assert.equal((await resumen(api, c.id)).directiva.periodo, null,
    'una directiva que terminó no es la directiva del cuerpo');
  assert.equal((await resumen(api, c.id)).directiva.total, 1, 'pero su historial se cuenta igual');

  c.directiva('Vigente', '2026-2027', '2026-01-01', '2027-12-31');
  const r = (await resumen(api, c.id)).directiva;
  assert.equal(r.periodo, '2026-2027');
  assert.equal(r.vence, '2027-12-31', 'hasta cuándo dura es la mitad del dato');
});

test('las actividades del cuerpo se cuentan por la LISTA de convocados', async () => {
  /*
   * A un cuerpo se lo convoca dentro de una lista de cuerpos, no por una
   * columna suya. Preguntado por una columna la cifra habría salido siempre en
   * cero, y una ficha que dice «0 actividades» de un cuerpo que se junta todas
   * las semanas es peor que no decir nada.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  const otro = unCuerpoConVida();
  const anio = new Date().getFullYear();
  c.actividad(`${anio}-01-04`);
  c.actividad(`${anio}-01-11`, [otro.id, c.id]); // convocados los dos
  c.actividad(`${anio - 3}-06-01`);
  c.actividad('2099-01-01'); // agendada: todavía no ocurrió
  otro.actividad(`${anio}-02-02`, [otro.id]);

  const r = (await resumen(api, c.id)).asistencia;
  assert.equal(r.este_ano, 3, 'las de este año, incluida la que está agendada dentro de él');
  assert.equal(r.ultima, `${anio}-01-11`, 'la última es la última que YA pasó, no una de 2099');
  assert.equal((await resumen(api, otro.id)).asistencia.este_ano, 2);
});

test('la última acta es la más nueva', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  c.acta('2026-03-01'); c.acta('2026-05-20'); c.acta('2026-04-02');
  const r = (await resumen(api, c.id)).actas;
  assert.equal(r.total, 3);
  assert.equal(r.ultima, '2026-05-20');
});

// -------------------------------------- cada cifra pide su propio permiso ----

/** Una cuenta acotada a esa iglesia, con los permisos que se le indiquen. */
function unaCuenta(iglesiaId, rol, permisos) {
  const suRut = otroRut();
  return db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, iglesias, iglesia_id, permisos)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(suRut, `Cuenta ${suRut}`, rol, JSON.stringify([iglesiaId]), iglesiaId,
        permisos ? JSON.stringify(permisos) : null).lastInsertRowid;
}

test('la cifra que esa persona no puede ver NO viaja', async () => {
  /*
   * Un resumen es más peligroso que un listado, no menos: entrega la cifra sin
   * que haya que abrir nada. Poder abrir la ficha del cuerpo no convierte lo de
   * adentro en algo que también se pueda ver; es la misma corrección que ya se
   * les hizo a los paneles de esta misma ficha.
   *
   * Lo que se niega hay que NOMBRARLO con una lista vacía: los permisos propios
   * de una cuenta pisan los de su rol módulo por módulo, y lo que no se nombra
   * cae en lo que el rol ya le daba (ver permisosEfectivos en
   * server/permissions.js).
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  c.integrante('Activo'); c.caja(90000); c.acta('2026-01-01'); c.bien();
  c.directiva('Vigente', '2026-2027', '2026-01-01', '2027-12-31');

  const soloCuerpos = comoOtroUsuario(unaCuenta(c.iglesia, 'consulta',
    { cuerpos: ['view'], integrantes_cuerpo: [], cuentas_tesoreria: [], directivas: [],
      asistencias: [], actas_reuniones: [], inventarios: [] }));

  const r = await soloCuerpos('GET', `/cuerpos/${c.id}/resumen`);
  assert.equal(r.estado, 200, 'ver el cuerpo sí puede');
  assert.equal(r.json.integrantes, undefined, 'pero la cifra de su gente no tendría que llegarle');
  assert.equal(r.json.tesoreria, undefined, 'ni la de su plata');
  assert.equal(r.json.directiva, undefined);
  assert.equal(r.json.asistencia, undefined);
  assert.equal(r.json.actas, undefined);
  assert.equal(r.json.inventario, undefined);
});

test('y con permiso de ver a su gente, esa sí y las otras no', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  c.integrante('Activo'); c.integrante('Activo'); c.caja(90000);
  const conIntegrantes = comoOtroUsuario(unaCuenta(c.iglesia, 'consulta',
    { cuerpos: ['view'], integrantes_cuerpo: ['view'], cuentas_tesoreria: [], directivas: [],
      asistencias: [], actas_reuniones: [], inventarios: [] }));

  const r = (await conIntegrantes('GET', `/cuerpos/${c.id}/resumen`)).json;
  assert.equal(r.integrantes.activos, 2);
  assert.equal(r.tesoreria, undefined, 'la plata sigue sin ser suya');
});

test('sin la llave de los montos llegan las cajas pero no lo que hay dentro', async () => {
  /*
   * Un cero inventado sería peor que no decir nada: se lee como que el cuerpo
   * no tiene un peso. Por eso viaja `reservado: true` y el saldo va en nulo
   * (ver server/sensibles.js).
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  c.caja(800000);
  const sinMontos = comoOtroUsuario(unaCuenta(c.iglesia, 'consulta',
    { cuerpos: ['view'], cuentas_tesoreria: ['view'], tesoreria_montos: [] }));

  const r = (await sinMontos('GET', `/cuerpos/${c.id}/resumen`)).json;
  assert.equal(r.tesoreria.cuentas, 1, 'cuántas cajas hay sí se puede saber');
  assert.equal(r.tesoreria.saldo, null, 'cuánto hay en ellas, no');
  assert.equal(r.tesoreria.reservado, true, 'y se dice, para no dibujar un cero que no es');
});

test('el cuerpo de otra iglesia contesta 403, aunque se escriba la dirección a mano', async () => {
  const api = await elSistemaAndando();
  const suyo = unCuerpoConVida();
  const ajeno = unCuerpoConVida();
  ajeno.integrante('Activo');
  const acotada = comoOtroUsuario(unaCuenta(suyo.iglesia, 'admin'));

  assert.equal((await acotada('GET', `/cuerpos/${suyo.id}/resumen`)).estado, 200);
  const fuera = await acotada('GET', `/cuerpos/${ajeno.id}/resumen`);
  assert.equal(fuera.estado, 403, 'la ruta se pide desde una ficha, pero la dirección se puede escribir');
  assert.doesNotMatch(fuera.texto, /activos/, 'y no se escapa ninguna cifra en el aviso');
});

test('y un cuerpo que no existe, 404', async () => {
  const api = await elSistemaAndando();
  assert.equal((await api('GET', '/cuerpos/99999999/resumen')).estado, 404);
});

// ------------------------------------------------------ quién lo dirige ----

test('quién lo dirige sale del ENLACE, no de la copia del nombre', async () => {
  /*
   * El nombre del líder se copia dentro del cuerpo para poder buscarlo. Esa
   * copia se pone al día sola desde la 1.254.0, pero el dato que la ficha
   * MUESTRA no tiene por qué depender de que eso haya corrido: se arma en el
   * momento, desde la ficha a la que apunta. Acá se le cambia el nombre a la
   * persona por detrás, sin pasar por el guardado, justamente para que la copia
   * quede vieja y se vea de dónde sale cada uno.
   */
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  const persona = c.miembro('Ana', `Lidera ${c.m}`);
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = ?, lider = 'ESTE NOMBRE QUEDÓ VIEJO' WHERE id = ?")
    .run(persona, c.id);

  const fila = (await api('GET', `/cuerpos/${c.id}`)).json;
  assert.equal(fila.lider, 'ESTE NOMBRE QUEDÓ VIEJO', 'la copia sigue como estaba');
  assert.equal(fila.dirigido_por.texto, `Ana Lidera ${c.m}`, 'y lo que se muestra es el nombre de verdad');
  assert.equal(fila.dirigido_por.ir, `#/m/miembros/ficha/${persona}`, 'y lleva a su ficha');
});

test('y también cuando quien dirige no está inscrito en la membresía', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  const suRut = otroRut();
  const persona = db
    .prepare("INSERT INTO no_miembros (nombres, apellidos, rut, iglesia_id) VALUES ('Pedro', ?, ?, ?)")
    .run(`Deafuera ${c.m}`, suRut, c.iglesia).lastInsertRowid;
  db.prepare("UPDATE cuerpos SET lider_tipo = 'No miembro', lider_no_miembro_id = ? WHERE id = ?")
    .run(persona, c.id);

  const fila = (await api('GET', `/cuerpos/${c.id}`)).json;
  assert.equal(fila.dirigido_por.texto, `Pedro Deafuera ${c.m}`);
  assert.equal(fila.dirigido_por.ir, `#/m/no_miembros/ficha/${persona}`,
    'la ficha de un no miembro es la suya, no la de un miembro que no existe');
});

test('un cuerpo sin líder no inventa uno', async () => {
  const api = await elSistemaAndando();
  const c = unCuerpoConVida();
  const fila = (await api('GET', `/cuerpos/${c.id}`)).json;
  assert.equal(fila.dirigido_por, '', 'sin nadie apuntado no hay insignia que pintar');

  // Y un enlace que quedó apuntando a una ficha borrada tampoco
  db.prepare("UPDATE cuerpos SET lider_tipo = 'Miembro', lider_id = 99999999 WHERE id = ?").run(c.id);
  assert.equal((await api('GET', `/cuerpos/${c.id}`)).json.dirigido_por, '');
});

test('el listado lo muestra a él y no a la copia', () => {
  const m = getModule('cuerpos');
  assert.ok(m.listFields.includes('dirigido_por'), 'la columna del listado es la que se arma al vuelo');
  assert.ok(!m.listFields.includes('lider'), 'la copia no puede seguir siendo la que se mira');
  assert.ok((m.fields || []).some((f) => f.name === 'lider'),
    'pero el campo sigue existiendo: es lo que hace que se pueda buscar por nombre');
  assert.ok(m.searchFields.includes('lider'));
});

test('y no sale en el papel, porque el papel ya lo dice', () => {
  /*
   * La hoja imprime el líder desde su propio campo. Repetir el mismo dato dos
   * veces en un papel que alguien firma hace dudar de cuál manda: es lo mismo
   * que se le corrigió a la hoja del pastor.
   */
  const insignia = (getModule('cuerpos').computed || []).find((c) => c.name === 'dirigido_por');
  assert.ok(insignia);
  assert.equal(insignia.enElPapel, false);
});

// --------------------------------------------- la cabecera de las fichas ----

test('un calculado con color y sin enlace se pinta', () => {
  /*
   * Se caía por todas las ramas: no es texto suelto —es un objeto—, no lleva
   * `ir`, y no es de tipo dinero. El cumplimiento de un cuerpo se calculaba
   * entero y no aparecía en ninguna parte de su ficha.
   */
  /*
   * Recortada por la rama MISMA y no por la de más arriba: la primera versión
   * de esta comprobación empezaba el recorte en la rama del enlace, que lleva
   * las mismas dos cosas escritas, y pasaba en verde con esta rama dibujando
   * una insignia gris y sin rótulo.
   */
  const desde = app.indexOf('else if (f.computed && v && v.texto) {');
  assert.ok(desde > 0, 'falta la rama del calculado con color y sin enlace');
  const trozo = app.slice(desde, app.indexOf('\n    }', desde));
  assert.match(trozo, /nivelClase\(v\.nivel\)/, 'el color es justamente el dato: verde o rojo');
  assert.match(trozo, /esc\(f\.label\)\} · \$\{esc\(v\.texto\)\}/,
    '«Al día» suelto en una cabecera no dice de qué');
  const conEnlace = app.indexOf('else if (f.computed && v && v.ir)');
  assert.ok(conEnlace > 0 && conEnlace < desde,
    'va DESPUÉS de la del enlace, o «Quién lo dirige» —que trae las dos cosas— dejaría de ser un enlace');
});

test('y son cinco fichas las que estrenan su insignia', () => {
  /*
   * Se cuentan acá para que el día que alguien quite la rama se vea de cuántas
   * pantallas se trata, y no de una.
   *
   * CINCO Y NO SEIS. La 1.256.0 contó también la situación de una credencial y
   * está mal: ese calculado devuelve TEXTO SUELTO, así que caía —y sigue
   * cayendo— por la rama de más arriba, la que pinta cualquier calculado que no
   * sea un objeto. Se pintaba desde antes, sin color y sin rótulo.
   *
   * La diferencia se comprueba LLAMANDO a los dos calculados, no leyendo su
   * código: un primer intento miraba si la palabra «texto» aparecía escrita en
   * la función, y daba por texto suelto a los tres que arman su respuesta en un
   * ayudante aparte. Lo que decide la rama es lo que se DEVUELVE.
   */
  const deCredencial = (getModule('credenciales').computed || []).find((c) => c.name === 'situacion');
  const suRespuesta = deCredencial.calc({ estado: 'Vigente', fecha_vencimiento: '2099-01-01' });
  assert.equal(typeof suRespuesta, 'string',
    'si algún día devolviera un objeto, pasaría a ser una de las de la rama nueva y serían seis');

  const c = unCuerpoConVida();
  const suCumplimiento = (getModule('cuerpos').computed || []).find((x) => x.name === 'cumplimiento');
  const cumple = suCumplimiento.calc({ id: c.id, tipo: 'Cuerpo', estado: 'Activo' }, { db });
  assert.equal(typeof cumple, 'object');
  assert.ok(cumple.texto && !cumple.ir, 'trae texto y no lleva a ninguna parte: es de la rama nueva');

  const insignias = allModules().flatMap((m) =>
    (m.computed || []).filter((x) => x.type === 'badge').map((x) => `${m.name}.${x.name}`));
  for (const cual of ['cuerpos.cumplimiento', 'asistencias.porcentaje', 'tesoreria.respaldo',
                      'deudas.proxima', 'pastores.ficha_miembro']) {
    assert.ok(insignias.includes(cual), `falta ${cual}`);
  }
});

// ------------------------------------------------ lo que se ve en pantalla ----

test('el resumen del cuerpo va ARRIBA, fuera de las pestañas', () => {
  assert.match(app, /renderResumenDeCuerpo\(id, document\.getElementById\('fichaResumen'\)\)/);
  assert.match(app, /<div id="fichaResumen"><\/div>\s*\n\s*<div id="fichaPestanas"><\/div>/,
    'el resumen tiene que quedar antes de la barra de pestañas');
});

test('si el resumen no llega, la ficha se ve igual que siempre', () => {
  /*
   * Se pide aparte y llega después. Un error ahí no puede dejar la ficha del
   * cuerpo sin dibujar: es la misma forma que la de la iglesia.
   */
  const desde = app.indexOf('async function renderResumenDeCuerpo(');
  assert.ok(desde > 0, 'no está el dibujo del resumen del cuerpo');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /await api\('GET', `\/cuerpos\/\$\{id\}\/resumen`\)\.catch\(\(\) => null\)/);
  assert.match(trozo, /if \(!d \|\| !caja\) return;/);
  assert.match(trozo, /if \(!fichas\.length\) return;/,
    'y una persona que no puede ver ninguna cifra no se encuentra una fila vacía');
});

test('cada cifra lleva a la lista que la explica', () => {
  const desde = app.indexOf('async function renderResumenDeCuerpo(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  for (const modulo of ['integrantes_cuerpo', 'cuentas_tesoreria', 'directivas',
                        'asistencias', 'actas_reuniones', 'inventarios']) {
    assert.match(trozo, new RegExp(`#/m/${modulo}\\?f_cuerpo_id=`), `la cifra de ${modulo} no lleva a ninguna parte`);
  }
});

test('el número grande de la gente es el de los que están, no el del total', () => {
  /*
   * Al revés, la cifra que se lee de un vistazo incluiría a los retirados, que
   * no es la que nadie pregunta al abrir un cuerpo.
   */
  const desde = app.indexOf('async function renderResumenDeCuerpo(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /fmtNumero\(g\.activos\), 'Integrantes'/);
  assert.match(trozo, /g\.total > g\.activos \? `\$\{fmtNumero\(g\.total - g\.activos\)\} retirado\(s\)`/);
});
