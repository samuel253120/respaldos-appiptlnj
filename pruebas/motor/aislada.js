/**
 * El seguro: estas pruebas escriben en la base, así que se niegan a correr
 * si no están sobre una descartable.
 *
 * Se corren con `npm run motor`, que prepara una carpeta nueva y la borra al
 * terminar. Llamarlas a mano sobre los datos del sistema borraría cosas.
 */
const path = require('path');

function exigirBaseDescartable() {
  const carpeta = process.env.DATA_DIR || '';
  const esDelCorredor = process.env.PRUEBAS_DEL_MOTOR === '1' && path.basename(carpeta).startsWith('motor-');
  if (!esDelCorredor) {
    throw new Error(
      'Estas pruebas escriben en la base y solo corren sobre una descartable.\n' +
        'Use «npm run motor», que prepara una carpeta nueva y la borra al terminar.\n' +
        `(DATA_DIR apunta a «${carpeta || 'la carpeta de siempre'}»)`
    );
  }
}

module.exports = { exigirBaseDescartable };
