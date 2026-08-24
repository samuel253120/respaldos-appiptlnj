/**
 * El hilo que cifra. No hace nada más.
 *
 * Vive aparte del que atiende a la gente justamente para eso: acá se puede
 * estar ochenta milisegundos calculando sin que nadie lo note (ver el porqué
 * en server/cifrado.js).
 */
const { parentPort } = require('worker_threads');
const bcrypt = require('bcryptjs');

const CUANTAS_VUELTAS = 10;

parentPort.on('message', ({ id, que, argumentos }) => {
  try {
    const valor = que === 'cifrar'
      ? bcrypt.hashSync(argumentos[0], CUANTAS_VUELTAS)
      : bcrypt.compareSync(argumentos[0], argumentos[1]);
    parentPort.postMessage({ id, valor });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
