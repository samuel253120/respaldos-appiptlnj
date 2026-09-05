/**
 * Cifrar contraseñas sin dejar frenado a todo el mundo.
 *
 * EL PROBLEMA, MEDIDO
 *
 * Comprobar una contraseña cuesta unos 85 milisegundos de puro cálculo. Eso es
 * a propósito y no se toca: una contraseña que se comprueba rápido también se
 * adivina rápido. El problema es otro: el servidor atiende de a una cosa, así
 * que mientras hace ese cálculo NO ATIENDE A NADIE MÁS.
 *
 * En el sistema estaba escrito que eso ya se había resuelto usando la forma
 * «asíncrona» de bcryptjs. No era cierto, y se midió:
 *
 *     hashSync (de corrido) ......... el bucle quedó trabado 97 ms
 *     hash (la forma asíncrona) ..... el bucle quedó trabado 82 ms
 *     compare (la del ingreso) ...... el bucle quedó trabado 82 ms
 *
 * bcryptjs está escrito en JavaScript puro: su forma asíncrona devuelve una
 * promesa, pero el cálculo lo hace igual en el mismo hilo. Un domingo con
 * veinte personas entrando a la vez, el sistema quedaba trabado casi dos
 * segundos para todos, incluidos los que ya estaban trabajando adentro.
 *
 * CÓMO SE RESUELVE
 *
 * El cálculo se manda a un HILO APARTE. El hilo principal —el que atiende a
 * todo el mundo— queda libre mientras tanto, y solo recibe la respuesta cuando
 * está lista. Es un solo hilo y se crea una vez: cifrar no es algo que pase
 * cien veces por segundo.
 *
 * Y SI EL HILO NO ARRANCA
 *
 * Se cifra en el hilo principal, como antes. Se pierde la soltura, no la
 * seguridad: la contraseña queda igual de bien cifrada. Un sistema que no deja
 * entrar a nadie porque no pudo crear un hilo sería mucho peor que uno lento.
 */
const path = require('path');

const CUANTAS_VUELTAS = 10; // el costo de bcrypt: 2^10. No bajarlo.

/** null = todavía no se intenta · false = se intentó y no se puede · Worker = listo */
let obrero = null;
let siguiente = 1;
const esperando = new Map();
let yaSeAviso = false;

/** El hilo aparte, creado la primera vez que hace falta. */
function elObrero() {
  if (obrero !== null) return obrero;
  try {
    const { Worker } = require('worker_threads');
    obrero = new Worker(path.join(__dirname, 'cifrado-obrero.js'));
    obrero.on('message', ({ id, valor, error }) => {
      const quien = esperando.get(id);
      if (!quien) return;
      esperando.delete(id);
      sujetarSiHayAlgoPendiente();
      error ? quien.mal(new Error(error)) : quien.bien(valor);
    });
    obrero.on('error', (e) => caerse(e));
    obrero.on('exit', (codigo) => { if (codigo !== 0) caerse(new Error(`el hilo terminó con código ${codigo}`)); });
    /**
     * El hilo no impide cerrar el programa... salvo mientras esté calculando.
     *
     * `unref` le dice a Node que este hilo no cuenta para decidir si el
     * programa tiene algo que hacer. Sin eso, un servidor que termina se
     * quedaría colgado esperando a un hilo que no espera nada.
     *
     * Pero si se deja siempre suelto, un programa cuya única tarea pendiente
     * sea una contraseña en camino se cierra ANTES de recibir la respuesta, y
     * la promesa no se resuelve nunca. Pasó al medirlo: el programa terminaba
     * en silencio a mitad del cálculo. Así que se sujeta mientras haya algo
     * pendiente y se suelta al quedar en nada.
     */
    obrero.unref();
  } catch (e) {
    caerse(e);
  }
  return obrero;
}

/**
 * El hilo se cayó: se avisa una vez, se despierta a quien estaba esperando y
 * de ahí en adelante se cifra en el hilo principal.
 */
function caerse(e) {
  if (!yaSeAviso) {
    yaSeAviso = true;
    console.error(
      `⚠️  El hilo que cifra las contraseñas no está disponible (${e.message}).\n` +
      '   Se sigue cifrando igual de bien, pero en el hilo principal: mientras lo hace,\n' +
      '   el sistema no atiende a nadie más. Se nota si entran muchas personas a la vez.'
    );
  }
  obrero = false;
  for (const [id, quien] of esperando) {
    esperando.delete(id);
    quien.aMano();
  }
}

/** Sujeta el hilo mientras haya cuentas en camino, y lo suelta al terminarlas. */
function sujetarSiHayAlgoPendiente() {
  if (!obrero) return;
  esperando.size ? obrero.ref() : obrero.unref();
}

/** Le pide al hilo que haga una cuenta, o la hace acá si no hay hilo. */
function pedir(que, argumentos, aMano) {
  const hilo = elObrero();
  if (!hilo) return Promise.resolve(aMano());
  return new Promise((bien, mal) => {
    const id = siguiente++;
    esperando.set(id, { bien, mal, aMano: () => bien(aMano()) });
    sujetarSiHayAlgoPendiente();
    try {
      hilo.postMessage({ id, que, argumentos });
    } catch (e) {
      esperando.delete(id);
      caerse(e);
      bien(aMano());
    }
  });
}

/**
 * UNA HUELLA DE RELLENO, PARA GASTAR EL MISMO RATO CUANDO NO HAY CONTRA QUÉ
 * COMPARAR.
 *
 * La entrada se cuida de contestar lo mismo exista o no la cuenta. Pero cuando
 * el RUT no existe no hay contraseña que comprobar, así que la respuesta salía
 * de inmediato, y cuando existe hay que gastar los 82 milisegundos de bcrypt.
 * El aviso callaba y el cronómetro hablaba. MEDIDO en la v1.416.0, un intento
 * por RUT con la misma clave equivocada: 81, 81, 83 ms los que tenían cuenta;
 * 2, 2, 3 ms los que no.
 *
 * Con esto la entrada compara siempre contra algo —la huella de verdad si la
 * hay, ésta si no— y el rato es el mismo. Se calcula una vez al arrancar: son
 * los mismos 85 ms, pero en el arranque no le hacen esperar a nadie.
 *
 * El texto no es un secreto ni tiene por qué serlo: nadie va a poder entrar
 * escribiéndolo, porque cuando se usa esta huella es justamente porque no hay
 * cuenta con la que entrar.
 */
const HUELLA_DE_RELLENO = require('bcryptjs').hashSync('sin-cuenta-que-comparar', CUANTAS_VUELTAS);

/** La huella de una contraseña, para guardarla. */
function cifrar(texto) {
  const bcrypt = require('bcryptjs');
  return pedir('cifrar', [String(texto)], () => bcrypt.hashSync(String(texto), CUANTAS_VUELTAS));
}

/** ¿Esta contraseña corresponde a esta huella? */
function coincide(texto, huella) {
  const bcrypt = require('bcryptjs');
  if (!huella) return Promise.resolve(false);
  return pedir('coincide', [String(texto), String(huella)],
    () => bcrypt.compareSync(String(texto), String(huella)));
}

module.exports = { cifrar, coincide, CUANTAS_VUELTAS, HUELLA_DE_RELLENO };
