/**
 * LA PLATA DEJABA RASTRO; LAS LLAVES, CASI NINGUNO.
 *
 * El Registro de Cambios existe para poder preguntar quién tocó algo, y la
 * v1.410.0 se ocupó de que hasta el cobro de una cuota por la planilla dejara
 * su línea. Las contraseñas se cambian con un UPDATE directo desde
 * server/claves.js, que no pasa por el motor y no anotaba nada.
 *
 * MEDIDO en la v1.416.0, líneas en el Registro de Cambios por cada operación:
 *
 *   el administrador RESTABLECE la contraseña de alguien ...  0
 *   la persona CAMBIA la suya .............................  0
 *   alguien la RECUPERA con la pregunta secreta ...........  0
 *   cinco INTENTOS FALLIDOS seguidos ......................  0
 *   el administrador ESCRIBE una contraseña en la ficha ...  1
 *
 * Esa única línea decía «Origen de la contraseña: inicial → definida», y
 * apareció de refilón porque cambió esa columna: sobre una cuenta que ya
 * tuviera origen «definida» no habría aparecido ninguna.
 *
 * Restablecerle la contraseña a otra persona es la manera limpia de apoderarse
 * de su cuenta desde dentro, y era justamente la que no dejaba nada escrito.
 *
 * Y MIDIENDO ESTO APARECIÓ ALGO MÁS GRANDE. El camino de la ficha —el
 * administrador escribiendo una contraseña en el formulario del usuario— lo
 * cifra el propio módulo, así que no pasa por `establecer` y se saltaba también
 * lo OTRO que aquélla hace: cerrar las sesiones abiertas. Medido, esperando un
 * segundo y medio para que el corte no cayera en el mismo segundo:
 *
 *   restablecer desde el botón .....  401  la sesión se cerró
 *   escribirla en la ficha .........  200  la sesión siguió abierta
 *
 * La cabecera de claves.js dice que cerrar las sesiones «vale para los tres
 * orígenes, a propósito». Valía para dos.
 *
 * LO QUE NO SE ANOTA, a propósito: los intentos fallidos. Un barrido de cuentas
 * llenaría el Registro de miles de líneas y taparía justamente lo que se va a
 * buscar. Para eso está el portero, que los cuenta y cierra la puerta.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const claves = require('../../server/claves');
const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

let siguiente = 0;
function unaCuenta(nombre) {
  const n = `${26900000 + (process.pid % 700) * 100 + (siguiente++ % 100)}`;
  const rut = `${n}-${digitoVerificador(n)}`;
  const id = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'consulta', 1)"
  ).run(rut, `${nombre} ${process.pid}`).lastInsertRowid;
  return { id, rut };
}

const susLineas = (id) => db.prepare(
  "SELECT * FROM registro_cambios WHERE modulo = 'Usuarios' AND accion = 'Contraseña' AND registro_id = ? ORDER BY id"
).all(id);

test('el administrador le restablece la contraseña a alguien: queda escrito quién y sobre quién', async () => {
  const cuenta = unaCuenta('Quien La Perdió');
  const admin = { id: 999000 + (process.pid % 900), nombre: `La Administradora ${process.pid}` };
  await claves.restablecer(cuenta.id, admin);

  const lineas = susLineas(cuenta.id);
  assert.equal(lineas.length, 1, 'antes de esto no dejaba ninguna');
  assert.match(lineas[0].detalle, /restableció la contraseña a la inicial/);
  assert.equal(lineas[0].usuario, admin.nombre, 'quién lo hizo');
  // Sobre quién: por el número de la ficha, que es lo que no se puede confundir.
  // El nombre escrito sale del `display` del módulo, que lo acorta a propósito.
  assert.equal(lineas[0].registro_id, cuenta.id, 'y sobre quién');
  assert.ok(String(lineas[0].registro || '').trim(), 'con su nombre escrito, para poder leerlo');
});

test('la persona cambia la suya: se distingue de que se la cambien', async () => {
  const cuenta = unaCuenta('Quien La Cambia');
  const ella = { id: cuenta.id, nombre: `Quien La Cambia ${process.pid}` };
  await claves.establecer(cuenta.id, 'LaMia.Propia.2026', 'usuario', ella);

  const lineas = susLineas(cuenta.id);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0].detalle, /Cambió su propia contraseña/,
    'no es lo mismo que se la cambien a que la cambie ella');
});

test('recuperarla con la pregunta secreta se anota como lo que es', async () => {
  const cuenta = unaCuenta('Quien La Recupera');
  const ella = { id: cuenta.id, nombre: `Quien La Recupera ${process.pid}` };
  await claves.establecer(cuenta.id, 'Recuperada.2026.X', 'usuario', ella, true);

  const lineas = susLineas(cuenta.id);
  assert.equal(lineas.length, 1);
  assert.match(lineas[0].detalle, /pregunta secreta/,
    'llegó sin sesión, contestando la pregunta: es un camino distinto y se lee distinto');
});

test('NO SE ANOTA LA CONTRASEÑA, ni la vieja ni la nueva', () => {
  const cuenta = unaCuenta('Quien Tiene Clave');
  const admin = { id: 1, nombre: 'Administrador' };
  return claves.establecer(cuenta.id, 'UnaClaveMuyDistinta.77', 'definida', admin).then(() => {
    const lineas = susLineas(cuenta.id);
    const todo = JSON.stringify(lineas);
    assert.ok(!todo.includes('UnaClaveMuyDistinta.77'), 'la contraseña no puede aparecer escrita');
    assert.ok(!/\$2[aby]\$/.test(todo), 'ni su huella');
  });
});

test('escribirle la contraseña en la ficha deja su línea Y cierra sus sesiones', async () => {
  /*
   * El tercer camino, el que se saltaba las dos cosas. Se comprueba por la
   * ruta de verdad porque lo que faltaba estaba justamente en el gancho del
   * módulo, no en `claves`.
   */
  const api = await elSistemaAndando();
  const cuenta = unaCuenta('Quien Sigue Adentro');
  await claves.establecer(cuenta.id, 'SuClaveDeAntes.2026', 'usuario', null);
  // El corte se deja en un momento CONOCIDO del pasado: comparando contra el de
  // recién, un `>=` se cumpliría también si nadie lo tocara.
  const haceUnRato = Math.floor(Date.now() / 1000) - 3600;
  db.prepare('UPDATE usuarios SET sesiones_desde = ? WHERE id = ?').run(haceUnRato, cuenta.id);
  const antes = db.prepare('SELECT sesiones_desde, password FROM usuarios WHERE id = ?').get(cuenta.id);

  const r = await api('PUT', `/usuarios/${cuenta.id}`, {
    nombre: `Quien Sigue Adentro ${process.pid}`, rut: cuenta.rut, rol: 'consulta', activo: 1,
    password: 'EscritaEnLaFicha.99',
  });
  assert.equal(r.estado, 200, r.texto);

  const despues = db.prepare('SELECT sesiones_desde, password FROM usuarios WHERE id = ?').get(cuenta.id);
  assert.notEqual(despues.password, antes.password, 'la contraseña cambió de verdad');
  assert.ok(Number(despues.sesiones_desde) > Number(antes.sesiones_desde),
    `el corte de sesiones tiene que MOVERSE: quedó en ${despues.sesiones_desde} y estaba en ${antes.sesiones_desde}. `
    + 'Antes este camino no lo tocaba y la sesión seguía abierta.');

  const lineas = susLineas(cuenta.id);
  assert.ok(lineas.some((l) => /escribió una contraseña nueva/.test(l.detalle)),
    `este camino tiene que dejar su línea: ${JSON.stringify(lineas.map((l) => l.detalle))}`);
});

test('guardar la ficha SIN tocar la contraseña no anota nada ni cierra nada', async () => {
  const api = await elSistemaAndando();
  const cuenta = unaCuenta('Quien Solo Cambia El Nombre');
  await claves.establecer(cuenta.id, 'SuClave.2026.Igual', 'usuario', null);
  const antes = db.prepare('SELECT sesiones_desde FROM usuarios WHERE id = ?').get(cuenta.id);
  const cuantas = susLineas(cuenta.id).length;

  const r = await api('PUT', `/usuarios/${cuenta.id}`, {
    nombre: `Con Otro Nombre ${process.pid}`, rut: cuenta.rut, rol: 'consulta', activo: 1,
  });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(susLineas(cuenta.id).length, cuantas, 'corregir un nombre no es tocar la contraseña');
  assert.equal(
    db.prepare('SELECT sesiones_desde FROM usuarios WHERE id = ?').get(cuenta.id).sesiones_desde,
    antes.sesiones_desde,
    'ni puede echar de la sesión a quien esté trabajando'
  );
});

test('los intentos fallidos NO se anotan, y es a propósito', () => {
  /*
   * Un barrido de cuentas llenaría el Registro de miles de líneas y taparía
   * justamente lo que se va a buscar. Para eso está el portero, que los cuenta
   * y cierra la puerta. Queda escrito para que no se agregue sin pensarlo.
   */
  const auth = fs.readFileSync(path.join(__dirname, '../../server/auth.js'), 'utf8');
  const login = auth.slice(auth.indexOf("router.post('/login'"), auth.indexOf("router.post('/salir'"));
  assert.ok(!/anotarCambio|registrarGuardado/.test(login),
    'la entrada no escribe en el Registro de Cambios');
});

test('la constancia se arma en UN solo sitio, y los tres caminos la piden', () => {
  const clavesJs = fs.readFileSync(path.join(__dirname, '../../server/claves.js'), 'utf8');
  const usuarios = fs.readFileSync(path.join(__dirname, '../../server/modules/usuarios.js'), 'utf8');
  assert.match(clavesJs, /function dejarConstanciaDeLaClave/, 'la constancia vive en un solo lugar');
  assert.match(clavesJs, /dejarConstanciaDeLaClave\(usuarioId, origen, quien, porLaPregunta\)/,
    'y `establecer` la pide, que es por donde pasan dos de los tres caminos');
  assert.match(clavesJs, /function laEscribioElMotor/, 'y hay una puerta para el tercero');
  assert.match(usuarios, /require\('\.\.\/claves'\)\.laEscribioElMotor\(/, 'que el módulo pide');
  assert.ok(!/anotarCambio/.test(usuarios),
    'el módulo no se arma su propia constancia: sería una segunda manera de contar lo mismo');
});
