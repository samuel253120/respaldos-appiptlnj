/**
 * LA CONTRASEÑA QUE UNO ELIGE SE REVISABA. LA QUE EL SISTEMA REPARTE, NO.
 *
 * `revisarClave` es una buena regla: exige el largo configurado y rechaza las
 * contraseñas de siempre, las de un solo carácter repetido, el RUT y el nombre
 * de la persona, y las palabras largas del nombre de la iglesia. Se aplicaba
 * cuando alguien elige la suya y cuando el administrador le escribe una en la
 * ficha. No se aplicaba en el único lugar donde nacen casi todas: la contraseña
 * INICIAL del sistema, que era un ajuste de texto corriente.
 *
 * MEDIDO en la v1.416.0, la misma clave por las dos puertas:
 *
 *                  como contraseña propia            como inicial del sistema
 *   "123456" ....  400 · al menos 8 caracteres       200 · guardada
 *   "clave" .....  400 · al menos 8 caracteres       200 · guardada
 *   "aaaaaaaa" ..  400 · un solo carácter repetido   200 · guardada
 *   "a" .........  400 · al menos 8 caracteres       200 · guardada
 *
 * Y con la inicial puesta en «a», los cinco pasos que siguen se midieron desde
 * fuera sabiendo solo el RUT: entrar con «a» (200), pedir datos (403, «cambie
 * su contraseña»), cambiarla SIN saber la actual (200 — no la pide, porque en
 * ese estado la persona todavía no tiene una suya), entrar con la nueva (200),
 * pedir datos otra vez (200). El dueño, con su inicial: 401. Adivinar la
 * inicial no era entrar a mirar: era apoderarse de la cuenta y dejar afuera a
 * su dueño. Y la ventana dura hasta que la persona entra por primera vez, que
 * en una iglesia pueden ser semanas.
 *
 * DE PASO, EL VALOR DE FÁBRICA NO PASABA SU PROPIA REGLA: «Iglesia2026» lleva
 * dentro «Iglesia», que son siete letras del nombre de la congregación.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const claves = require('../../server/claves');
const ajustes = require('../../server/ajustes');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const LAS_FLOJAS = ['123456', 'clave', 'a', 'aaaaaaaa', '        ', 'iglesia'];

test('la regla rechaza las mismas claves sin que haya una persona detrás', () => {
  /*
   * `revisarClave(clave, null)` es como se la pide la configuración: no hay
   * RUT ni nombre que comparar, y todo lo demás vale igual o más acá.
   */
  for (const floja of LAS_FLOJAS) {
    assert.ok(claves.revisarClave(floja, null), `«${floja}» tendría que rechazarse`);
  }
  assert.equal(claves.revisarClave('Roble.Verde.88', null), null, 'y una buena pasa');
});

test('EL DE FÁBRICA PASA SU PROPIA REGLA', () => {
  /*
   * Es la comprobación que faltaba y la que destapó el cambio de valor: el
   * anterior no la pasaba. Un sistema que reparte una contraseña que él mismo
   * rechazaría no puede pedirle nada a nadie.
   */
  assert.equal(claves.revisarClave(claves.INICIAL_DE_RESERVA, null), null,
    `el valor de fábrica «${claves.INICIAL_DE_RESERVA}» no pasa la regla del propio sistema`);
  assert.ok(claves.revisarClave('Iglesia2026', null),
    'y el que había no la pasaba: lleva siete letras del nombre de la congregación');
});

test('el ajuste declara que se revisa como clave, y su valor de fábrica es el mismo', () => {
  const item = ajustes.POR_CLAVE['password_inicial'];
  assert.ok(item, 'el ajuste existe');
  assert.equal(item.revisaComoClave, true, 'y dice que pasa por la regla');
  assert.equal(item.defecto, claves.INICIAL_DE_RESERVA,
    'el valor de fábrica del ajuste y el de reserva del código tienen que ser el mismo: si se separan, el sistema entrega uno y la pantalla muestra otro');
});

test('guardar una inicial floja se rechaza, y el aviso dice cuál ajuste es', async () => {
  const api = await elSistemaAndando();
  for (const floja of ['123456', 'a', 'clave']) {
    const r = await api('PUT', '/configuracion', { password_inicial: floja });
    assert.equal(r.estado, 400, `«${floja}» se guardó: ${r.texto}`);
    assert.match(r.json.error, /Contraseña inicial:/,
      'el aviso tiene que decir de qué ajuste habla: se guardan varios de una vez');
  }
  assert.equal(claves.inicial(), claves.INICIAL_DE_RESERVA, 'y ninguna quedó puesta');
});

test('se rechaza el guardado ENTERO, no solo esa opción', async () => {
  /*
   * Con una lista que trae un valor inventado el sistema se salta la opción en
   * silencio, y está bien: ahí alguien escribió cualquier cosa por error. Acá
   * no: el administrador creería que dejó puesta una clave que el sistema nunca
   * guardó, y la repartiría por teléfono.
   */
  const api = await elSistemaAndando();
  const antes = ajustes.numero('password_minimo', 8, 40);
  const r = await api('PUT', '/configuracion', { password_inicial: 'a', password_minimo: '12' });
  assert.equal(r.estado, 400, r.texto);
  assert.equal(ajustes.numero('password_minimo', 8, 40), antes,
    'lo demás del mismo guardado tampoco entró');
});

test('una inicial buena sí se guarda, y es la que reciben las cuentas nuevas', async () => {
  const api = await elSistemaAndando();
  const buena = 'Nogal.Alto.77';
  assert.equal(claves.revisarClave(buena, null), null, 'la clave de la prueba tiene que ser buena');
  const r = await api('PUT', '/configuracion', { password_inicial: buena });
  assert.equal(r.estado, 200, r.texto);
  assert.equal(claves.inicial(), buena);
  await api('PUT', '/configuracion', { password_inicial: claves.INICIAL_DE_RESERVA });
});

test('lo que ya estaba escrito se respeta, aunque sea flojo', () => {
  /*
   * El sistema no puede cambiarle en silencio al administrador una clave que ya
   * repartió: la regla se aplica al GUARDARLA, que es donde se puede avisar.
   * Se guarda por debajo, como estaría en una base vieja.
   */
  const { db } = require('../../server/db');
  const comoEstaba = db.prepare("SELECT valor FROM configuracion WHERE clave = 'password_inicial'").get();
  db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('password_inicial', 'floja') "
    + 'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run();
  assert.equal(claves.inicial(), 'floja', 'la que estaba escrita se sigue entregando');
  db.prepare("DELETE FROM configuracion WHERE clave = 'password_inicial'").run();
  if (comoEstaba) {
    db.prepare("INSERT INTO configuracion (clave, valor) VALUES ('password_inicial', ?)").run(comoEstaba.valor);
  }
});

test('el README dice el valor de fábrica que el sistema tiene de verdad', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
  assert.ok(readme.includes(claves.INICIAL_DE_RESERVA),
    'el manual y el código no pueden decir contraseñas iniciales distintas');
});
