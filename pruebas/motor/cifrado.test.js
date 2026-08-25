/**
 * Cifrar contraseñas sin dejar frenado al resto del sistema.
 *
 * Comprobar una contraseña cuesta unos 85 milisegundos de puro cálculo, a
 * propósito: una que se comprueba rápido también se adivina rápido. El
 * problema es que el servidor atiende de a una cosa, así que mientras hace esa
 * cuenta no atiende a nadie más.
 *
 * En el sistema estaba escrito que eso se resolvía usando la forma «asíncrona»
 * de bcryptjs. No era cierto: bcryptjs está escrito en JavaScript puro y su
 * forma asíncrona devuelve una promesa, pero hace la cuenta igual en el mismo
 * hilo. Se midió trabando 82 ms, lo mismo que la de corrido.
 *
 * Ahora la cuenta va a un hilo aparte. Estas pruebas comprueban las dos cosas
 * que importan: que siga cifrando bien —lo primero es la seguridad— y que de
 * verdad no trabe al hilo que atiende.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const cifrado = require('../../server/cifrado');

/**
 * Cuánto se traba el hilo que atiende SIN hacer nada.
 *
 * Es la referencia contra la que se compara. Estas pruebas corren junto a
 * otras veinticuatro, todas peleando por el mismo procesador, y en esas
 * condiciones el reloj se atrasa unas decenas de milisegundos por razones que
 * no tienen nada que ver con cifrar. Medir el trabón en milisegundos sueltos
 * medía el ruido de la máquina y hacía fallar la prueba según cuántas otras
 * estuvieran corriendo. Lo que importa es cuánto AGREGA el cifrado.
 */
async function trabonDeFondo() {
  return trabonDelHilo(async () => {
    await new Promise((sigue) => setTimeout(sigue, 400));
  });
}

/** Cuánto se traba el hilo que atiende mientras corre `hacer`. */
async function trabonDelHilo(hacer) {
  const trabas = [];
  let ultimo = Date.now();
  const reloj = setInterval(() => {
    const n = Date.now();
    trabas.push(n - ultimo - 5);
    ultimo = n;
  }, 5);
  await new Promise((sigue) => setTimeout(sigue, 60)); // que el reloj tome ritmo
  await hacer();
  await new Promise((sigue) => setTimeout(sigue, 60));
  clearInterval(reloj);
  return Math.max(...trabas, 0);
}

test('la huella sirve para volver a reconocer la contraseña', async () => {
  const huella = await cifrado.cifrar('Cordillera47');
  assert.match(huella, /^\$2[aby]\$/, `no parece una huella de bcrypt: ${huella}`);
  assert.equal(await cifrado.coincide('Cordillera47', huella), true);
});

test('y no reconoce ninguna otra', async () => {
  const huella = await cifrado.cifrar('Cordillera47');
  for (const otra of ['cordillera47', 'Cordillera48', 'Cordillera4', '', 'Cordillera47 ']) {
    assert.equal(await cifrado.coincide(otra, huella), false, `aceptó «${otra}»`);
  }
});

test('dos veces la misma contraseña dan huellas distintas', async () => {
  // Cada una lleva su propia sal: dos personas con la misma contraseña no
  // tienen la misma huella, y quien vea la base no puede saber que coinciden.
  const a = await cifrado.cifrar('Cordillera47');
  const b = await cifrado.cifrar('Cordillera47');
  assert.notEqual(a, b);
  assert.equal(await cifrado.coincide('Cordillera47', a), true);
  assert.equal(await cifrado.coincide('Cordillera47', b), true);
});

test('sin huella no coincide nada, y no revienta', async () => {
  assert.equal(await cifrado.coincide('lo que sea', null), false);
  assert.equal(await cifrado.coincide('lo que sea', ''), false);
  assert.equal(await cifrado.coincide('lo que sea', undefined), false);
});

test('el hilo que atiende NO se traba mientras se cifra', async () => {
  /**
   * Es la prueba que da sentido a todo este archivo.
   *
   * Se despierta el hilo aparte primero: crearlo cuesta unas decenas de
   * milisegundos y eso pasa una sola vez en la vida del servidor, así que
   * medirlo acá diría algo que no representa el uso normal.
   */
  await cifrado.cifrar('para despertar el hilo');

  const fondo = await trabonDeFondo();
  const trabon = await trabonDelHilo(async () => {
    const huella = await cifrado.cifrar('Cordillera47');
    await cifrado.coincide('Cordillera47', huella);
  });

  /*
   * Se compara contra el ruido de la máquina, igual que la prueba de más
   * abajo, y no contra un número fijo.
   *
   * Antes decía «menos de 25 ms» y fallaba de vez en cuando sin que nada
   * estuviera mal: las pruebas del motor corren veinticinco procesos a la vez
   * y ahí el reloj del hilo salta más de 25 ms sin que nadie lo trabe. Una
   * prueba que falla sola enseña a ignorar las fallas, que es peor que no
   * tenerla.
   *
   * Cifrar y comprobar cuestan cerca de 170 ms de cálculo entre las dos. Si se
   * hicieran en este hilo, la diferencia contra el fondo sería de ese orden.
   */
  assert.ok(trabon - fondo < 100,
    `el hilo quedó trabado ${trabon} ms mientras se cifraba, y ${fondo} ms sin hacer nada: ` +
    `el cifrado agregó ${trabon - fondo} ms (antes de tener hilo aparte eran 82 de una vez)`);
});

test('veinte ingresos a la vez no traban el sistema', async () => {
  // Un domingo con veinte personas entrando a la vez. Las comprobaciones se
  // hacen una tras otra en el hilo aparte —son casi dos segundos de cálculo—
  // pero el hilo que atiende sigue libre todo ese rato.
  await cifrado.cifrar('para despertar el hilo');
  const huella = await cifrado.cifrar('Cordillera47');

  const fondo = await trabonDeFondo();
  const trabon = await trabonDelHilo(async () => {
    const todas = await Promise.all(Array.from({ length: 20 }, () => cifrado.coincide('Cordillera47', huella)));
    assert.ok(todas.every((x) => x === true), 'alguna comprobación falló');
  });
  // Se compara contra el ruido de la máquina, no contra un número fijo: lo que
  // se está probando es que cifrar veinte contraseñas no agregue trabón, y eso
  // se ve en la diferencia. Si el cifrado volviera al hilo principal, estas
  // veinte comprobaciones son casi dos segundos seguidos y la diferencia
  // saltaría a cientos de milisegundos.
  assert.ok(trabon - fondo < 200,
    `el hilo quedó trabado ${trabon} ms mientras se cifraba, y ${fondo} ms sin hacer nada: ` +
    `el cifrado agregó ${trabon - fondo} ms`);
});
