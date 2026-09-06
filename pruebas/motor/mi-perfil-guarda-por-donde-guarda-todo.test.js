/**
 * Mi perfil guarda por la misma puerta que la oficina, y con las mismas reglas.
 *
 * Cada persona mantiene sus propios datos desde Mi perfil sin depender de la
 * oficina. Pero esa pantalla no guardaba por donde guarda el resto del sistema:
 * `server/perfil.js` armaba su propio UPDATE y lo corría, así que ninguna de
 * las comprobaciones del motor llegaba a ejecutarse.
 *
 * MEDIDO en la v1.435.0, la misma cosa por las dos puertas:
 *
 *   un nombre en blanco ................  Mi perfil 200 · la oficina 400
 *   un nombre de puros espacios ........  Mi perfil 200 · la oficina 400
 *   nacer en el año 2050 ...............  Mi perfil 200 · la oficina 400
 *   nacer en 1820 ......................  Mi perfil 200 · la oficina 400
 *   una fecha que no es una fecha ......  Mi perfil 200 · la oficina 400
 *   un sexo que no está en la lista ....  Mi perfil 200 · la oficina 400
 *   un estado civil inventado ..........  Mi perfil 200 · la oficina 400
 *   una foto que no está en el disco ...  Mi perfil 200 · la oficina 400
 *   casarse en el año 2200 .............  Mi perfil 200 · la oficina 400
 *
 * Diez de once (hallazgo MP-01). Y el valor malo se quedaba: la fecha de
 * nacimiento entraba a la base como «el martes», la oficina la leía igual y no
 * la podía corregir sola, porque el motor solo revisa lo que ESE guardado está
 * cambiando.
 *
 * ── POR QUÉ ESTA PRUEBA MIRA LA REGLA Y NO LOS CASOS ──
 *
 * Comprobar los diez casos a mano dejaría exactamente el mismo agujero: el
 * problema no fue ninguno de ellos, fue que las dos puertas se separaran. Así
 * que lo que se vigila es que sigan siendo la MISMA lista —una sola función,
 * llamada por las dos— y que ante lo mismo contesten lo mismo. El día que el
 * motor aprenda una regla nueva, Mi perfil la aprende con él y nadie tiene que
 * acordarse de venir a agregarla acá.
 *
 * Y de paso quedan MP-02 (la marca de versión y quién guardó), MP-03 (una
 * pregunta que se puede contestar, en vez de «[object Object]») y MP-04 (todo
 * de una sola vez), que no son arreglos aparte sino lo mismo visto de tres
 * lados: los tres venían de no pasar por el motor.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const perfil = require('../../server/perfil');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let cuantos = 0;
const unRut = () => {
  const n = `${28000000 + (marca * 37 + cuantos++ * 2749) % 900000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`Mi perfil ${marca}`, `MP-${marca}`).lastInsertRowid;

const rutDeElla = unRut();
const miembro = db
  .prepare(
    `INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado, genero, telefono, direccion,
                           enfermedades, tipo_miembro, fecha_nacimiento)
     VALUES (?,?,?,?,'Activo','Femenino','+56 9 1111 2222','Los Aromos 45','Hipertensión','Miembro Nuevo','1985-04-12')`
  ).run('Rosa Elena', `Díaz MP ${marca}`, rutDeElla, iglesia).lastInsertRowid;

const ella = db
  .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, iglesia_id, iglesias, miembro_id) VALUES (?,?,?,1,?,?,?)')
  .run(rutDeElla, `Rosa Elena Díaz MP ${marca}`, 'secretario', iglesia, JSON.stringify([iglesia]), miembro)
  .lastInsertRowid;

const suFicha = () => db.prepare('SELECT * FROM miembros WHERE id = ?').get(miembro);

/** Deja su ficha como estaba, para que un caso no arrastre al siguiente. */
const reponer = () => db
  .prepare(`UPDATE miembros SET nombres='Rosa Elena', apellidos=?, genero='Femenino',
              fecha_nacimiento='1985-04-12', estado_civil=NULL, fecha_matrimonio_civil=NULL,
              foto=NULL, tipo_miembro='Miembro Nuevo' WHERE id = ?`)
  .run(`Díaz MP ${marca}`, miembro);

// ------------------------------------------- la regla ----------------------

test('las dos puertas llaman a la MISMA lista de comprobaciones', () => {
  /*
   * Es lo único que impide que vuelvan a separarse. Si alguien devuelve el
   * UPDATE a mano a server/perfil.js, o le escribe una lista propia, esto se
   * pone rojo aunque los casos de más abajo sigan pasando.
   */
  const motor = require('../../server/crud');
  assert.equal(typeof motor.revisarYEscribir, 'function',
    'el motor tiene que ofrecer su lista de comprobaciones, no guardársela');

  const suyo = fs.readFileSync(path.join(__dirname, '../../server/perfil.js'), 'utf8');
  assert.match(suyo, /revisarYEscribir\(def, \{/,
    'Mi perfil tiene que guardar por el motor, no por su cuenta');
  assert.doesNotMatch(suyo, /db\.prepare\(\s*`?\s*UPDATE/i,
    'Mi perfil volvió a escribir en la base por su cuenta: ahí empezó el hallazgo MP-01');
});

test('lo que la ficha exige, Mi perfil lo dice antes de que la persona guarde', () => {
  // La otra mitad de la misma moneda, y la lección del hallazgo SA-01: el
  // servidor y la pantalla no pueden decir cosas distintas de la misma casilla.
  const def = getModule('miembros');
  const suyos = perfil.leer(ella).campos;
  for (const nombre of perfil.MIOS_EN_MIEMBROS) {
    const enLaFicha = def.fields.find((f) => f.name === nombre);
    const enSuPantalla = suyos.find((f) => f.name === nombre);
    if (!enLaFicha || !enSuPantalla) continue;
    assert.equal(!!enSuPantalla.required, !!enLaFicha.required,
      `«${enLaFicha.label}»: la pantalla y la ficha no dicen lo mismo sobre si es obligatorio`);
  }
  assert.ok(suyos.some((f) => f.required), 'alguno tiene que serlo: si no, esto no vigila nada');
});

// ------------------------------------------- y lo mismo, medido ------------

const CASOS = [
  ['un nombre en blanco',                { nombres: '' }],
  ['un nombre de puros espacios',        { nombres: '   ' }],
  ['nacer en el año 2050',               { fecha_nacimiento: '2050-03-01' }],
  ['nacer en 1820',                      { fecha_nacimiento: '1820-03-01' }],
  ['una fecha que no es una fecha',      { fecha_nacimiento: 'el martes' }],
  ['un sexo que no está en la lista',    { genero: 'Marciano' }],
  ['un estado civil inventado',          { estado_civil: 'Enredado' }],
  ['una foto que no está en el disco',   { foto: `no-existe-${marca}.jpg` }],
  ['casarse en el año 2200',             { fecha_matrimonio_civil: '2200-01-01' }],
];

test('ante lo mismo, las dos puertas contestan lo mismo', async () => {
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(ella);
  const distintas = [];
  for (const [que, cuerpo] of CASOS) {
    reponer();
    const suPuerta = await suya('PUT', '/auth/perfil', cuerpo);
    reponer();
    const laOficina = await api('PUT', `/miembros/${miembro}`, { ...cuerpo, igual_asi: true });
    reponer();
    if (suPuerta.estado !== laOficina.estado) {
      distintas.push(`${que}: Mi perfil ${suPuerta.estado} · la oficina ${laOficina.estado}`);
    }
    assert.equal(suPuerta.estado, 400, `${que}: entró por Mi perfil`);
  }
  assert.deepEqual(distintas, [], `las dos puertas se separaron:\n  ${distintas.join('\n  ')}`);
});

test('y lo que sí es correcto se sigue guardando', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  const r = await suya('PUT', '/auth/perfil', {
    telefono: '+56 9 3333 4444', direccion: `Los Aromos 45, depto 2 · ${marca}`,
    enfermedades: 'Hipertensión controlada',
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const f = suFicha();
  assert.equal(f.telefono, '+56 9 3333 4444');
  assert.match(f.direccion, /depto 2/);
  assert.equal(f.enfermedades, 'Hipertensión controlada',
    'su propia información médica sigue siendo suya: es la excepción escrita en server/sensibles.js');
});

// ------------------------------------------- MP-02 -------------------------

test('guardar desde Mi perfil sube la marca y deja escrito quién fue', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  const antes = suFicha();
  assert.equal((await suya('PUT', '/auth/perfil', { telefono: '+56 9 5555 6666' })).estado, 200);
  const despues = suFicha();
  assert.equal(Number(despues.version), Number(antes.version || 1) + 1,
    'sin esto, la oficina le pisa el cambio sin enterarse');
  assert.equal(Number(despues.updated_by), Number(ella), 'y la ficha dice quién la tocó');
});

test('y por eso la oficina recibe el aviso en vez de borrarle el trabajo', async () => {
  reponer();
  const api = await elSistemaAndando();
  const suya = comoOtroUsuario(ella);

  const abierta = await api('GET', `/miembros/${miembro}`);        // la oficina la abre
  await suya('PUT', '/auth/perfil', { direccion: `El nuevo departamento ${marca}` }); // ella guarda

  const laOficina = await api('PUT', `/miembros/${miembro}`, {
    version: abierta.json.version, direccion: 'La dirección vieja', igual_asi: true,
  });
  assert.equal(laOficina.estado, 409, 'la oficina guardó encima sin que nadie viera nada');
  assert.ok(laOficina.json.conflicto);
  assert.match(suFicha().direccion, /El nuevo departamento/, 'lo que ella escribió sigue ahí');
});

// ------------------------------------------- MP-03 -------------------------

test('una pregunta llega como pregunta, y se puede contestar', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  // Su tipo de miembro es de persona adulta; con esta fecha tendría 11 años, y
  // el módulo pregunta en vez de prohibir.
  const pregunta = await suya('PUT', '/auth/perfil', { fecha_nacimiento: '2015-04-12' });
  assert.equal(pregunta.estado, 400);
  assert.equal(typeof pregunta.json.error, 'string',
    'el aviso llegaba como objeto y la persona leía «[object Object]»');
  assert.match(pregunta.json.error, /Todavía no cumple 18 años/);
  assert.equal(pregunta.json.confirmar, 'tipo_miembro_no_calza_con_la_edad',
    'sin esto la pantalla no tiene con qué armar los dos botones');

  const confirmada = await suya('PUT', '/auth/perfil', { fecha_nacimiento: '2015-04-12', igual_asi: true });
  assert.equal(confirmada.estado, 200, 'y confirmando tiene que poder seguir');
  assert.equal(suFicha().fecha_nacimiento, '2015-04-12');
  reponer();
});

test('la pantalla convierte esa pregunta en dos botones, como en cualquier ficha', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const suForm = app.slice(app.indexOf("await api('PUT', '/auth/perfil'") - 900,
    app.indexOf("await api('PUT', '/auth/perfil'") + 1600);
  assert.match(suForm, /preguntarSiIgualVa/, 'el formulario del perfil no sabe preguntar');
  assert.match(suForm, /igual_asi = true/, 'y no tiene cómo mandar la respuesta');
});

// ------------------------------------------- MP-04 -------------------------

test('el guardado ocurre de una sola vez', () => {
  const suyo = fs.readFileSync(path.join(__dirname, '../../server/perfil.js'), 'utf8');
  const motor = fs.readFileSync(path.join(__dirname, '../../server/crud.js'), 'utf8');
  assert.match(motor, /const escribir = db\.transaction\(/,
    'la escritura del motor dejó de estar dentro de una transacción');
  assert.doesNotMatch(suyo, /db\.prepare\(\s*`?\s*UPDATE/i,
    'Mi perfil escribe por el motor, y por eso hereda su transacción');
});

// ------------------------------------------- lo que ya estaba bien ---------

test('nadie toca la ficha de otro por esta puerta', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  const ajeno = db
    .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
    .run('Otra', `Persona MP ${marca}`, unRut(), iglesia).lastInsertRowid;
  const comoEstaba = db.prepare('SELECT * FROM miembros WHERE id = ?').get(ajeno);

  const r = await suya('PUT', '/auth/perfil', {
    id: ajeno, miembro_id: ajeno, usuario_id: 1, rut: '11111111-1',
    telefono: '+56 9 9999 0000',
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.deepEqual(
    db.prepare('SELECT nombres, apellidos, telefono FROM miembros WHERE id = ?').get(ajeno),
    { nombres: comoEstaba.nombres, apellidos: comoEstaba.apellidos, telefono: comoEstaba.telefono },
    'la ficha de la otra persona se movió'
  );
  assert.equal(suFicha().rut, rutDeElla, 'y su propio RUT no se cambia desde acá');
  assert.equal(suFicha().telefono, '+56 9 9999 0000', 'lo suyo sí se guardó');
});

test('lo que no es suyo se sigue descartando', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  const antes = suFicha();
  const r = await suya('PUT', '/auth/perfil', {
    estado: 'Inactivo', tipo_miembro: 'Miembro Menor de Edad', iglesia_id: 999999,
    fecha_bautismo: '1990-01-01', version: 500,
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  const d = suFicha();
  for (const campo of ['estado', 'tipo_miembro', 'iglesia_id', 'fecha_bautismo']) {
    assert.equal(String(d[campo]), String(antes[campo]), `«${campo}» se coló por Mi perfil`);
  }
});

test('queda constancia de lo que la persona cambia, firmada por ella', async () => {
  reponer();
  const suya = comoOtroUsuario(ella);
  const antes = db.prepare('SELECT COUNT(*) AS n FROM bitacora WHERE miembro_id = ?').get(miembro).n;
  assert.equal((await suya('PUT', '/auth/perfil', { telefono: `+56 9 8888 ${String(marca).slice(-4)}` })).estado, 200);
  const linea = db
    .prepare("SELECT * FROM bitacora WHERE miembro_id = ? ORDER BY id DESC LIMIT 1").get(miembro);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM bitacora WHERE miembro_id = ?').get(miembro).n > antes,
    'no quedó anotado en su historial');
  assert.match(linea.descripcion, /Teléfono:/);
  assert.match(String(linea.registrado_por || ''), /Rosa Elena/, 'y firmada por quien lo hizo');
});

// ------------------------------------------- MP-06 -------------------------

test('la pestaña en la que uno está queda en la dirección', () => {
  /*
   * El panel ya enlazaba a «#/perfil?tab=avisos», así que la dirección sabía
   * decirlo; lo que faltaba era que la escribiera quien cambia de pestaña. Sin
   * eso, recargar o volver atrás devolvía siempre a «Mis datos», y el enlace
   * que uno copiaba no llevaba a lo que estaba mirando.
   *
   * Se REEMPLAZA la entrada del historial en vez de agregar una: cambiar de
   * pestaña no es navegar, y apiladas obligarían a apretar tres veces el botón
   * de volver del teléfono para salir del perfil.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabs = app.slice(app.indexOf("content().querySelectorAll('#perfilTabs button')"),
    app.indexOf('renderSeguridad(document.getElementById'));
  assert.match(tabs, /history\.replaceState/, 'la pestaña no queda en la dirección');
  assert.doesNotMatch(tabs, /history\.pushState/,
    'apiladas, salir del perfil costaría tantos «volver» como pestañas se hayan mirado');
  assert.match(tabs, /perfil\?tab=/, 'y con la misma forma con que el panel ya enlaza');
  assert.match(app, /parts\[0\] === 'cuenta' \|\| parts\[0\] === 'perfil'/,
    'la dirección tiene que seguir sabiendo abrir la pestaña que nombra');
});
