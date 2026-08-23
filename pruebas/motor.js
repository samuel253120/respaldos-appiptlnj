/**
 * Las pruebas del motor, por dentro.
 *
 * Las otras cuatro suites miran el sistema por fuera: levantan el servidor,
 * entran como un usuario y comprueban lo que se ve. Estas miran las piezas de
 * adentro una por una —el RUT, los nombres, los permisos, el alcance, el
 * texto de las actas, la planilla, los archivos que se aceptan— sin servidor
 * y sin navegador. Son las que atrapan el error fino: ese que no rompe
 * ninguna pantalla y por eso nadie ve hasta que ya pasó algo.
 *
 * Corren contra una **base recién creada y descartable**, nunca contra la del
 * sistema. No es una formalidad: alguna de estas pruebas escribe y borra para
 * comprobar lo suyo, y hacerlo sobre los datos de la iglesia sería
 * imperdonable. Este archivo existe justamente para que eso no pueda pasar
 * por descuido: prepara la carpeta, la usa y la borra.
 *
 *   npm run motor
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'motor-'));

// Se le nombran los archivos uno por uno en vez de darle la carpeta: así se
// sabe exactamente qué corre, y un archivo de apoyo que viva ahí al lado no
// se toma por prueba. Cualquier «algo.test.js» que se agregue entra solo.
const archivos = fs
  .readdirSync(path.join(__dirname, 'motor'))
  .filter((n) => n.endsWith('.test.js'))
  .sort()
  .map((n) => path.join(__dirname, 'motor', n));

if (!archivos.length) {
  console.error('No hay ninguna prueba en pruebas/motor.');
  process.exit(1);
}

const resultado = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', ...archivos],
  {
    stdio: 'inherit',
    env: { ...process.env, DATA_DIR: carpeta, PRUEBAS_DEL_MOTOR: '1' },
  }
);

fs.rmSync(carpeta, { recursive: true, force: true });
process.exit(resultado.status === null ? 1 : resultado.status);
