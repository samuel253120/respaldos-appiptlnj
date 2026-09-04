/**
 * EL DÍA DE LA SEMANA, DELANTE DE LA FECHA: «Sáb. 29-08-2026».
 *
 * Un servicio se recuerda por el día antes que por la fecha —«el culto del
 * sábado»— y el listado ordena por fecha, así que el día no se deduce de un
 * vistazo. Lo pide el módulo campo por campo, con `mostrarDia`, igual que
 * `mostrarEdad` pide la edad al lado de una fecha de nacimiento.
 *
 * Lo que hay que cuidar acá es la trampa del huso horario. Una fecha del
 * sistema es un día del calendario y no un instante: `new Date('2026-08-29')`
 * es medianoche UTC, y leerla con `getDay()` en Chile —al oeste de Greenwich—
 * devuelve el día ANTERIOR. Sin cuidado, todos los sábados dirían «Vie.».
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { getModule } = require('../../server/registry');
const { comoLoVeLaPantalla, LO_QUE_VIAJA } = require('../../server/meta-liviana');

const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
function delArchivo(nombre) {
  const desde = app.indexOf('const DIAS_ABREVIADOS');
  const hasta = app.indexOf('/**\n * QUIÉN PASÓ ESTA LISTA');
  assert.ok(desde > 0 && hasta > desde, 'no se encontró el trozo del día abreviado');
  return new Function(`${app.slice(desde, hasta)}; return ${nombre};`)();
}
const diaAbreviado = delArchivo('diaAbreviado');

test('cada día de la semana se dice con su abreviatura', () => {
  // Una semana entera de 2026, del domingo al sábado
  assert.equal(diaAbreviado('2026-08-23'), 'Dom.');
  assert.equal(diaAbreviado('2026-08-24'), 'Lun.');
  assert.equal(diaAbreviado('2026-08-25'), 'Mar.');
  assert.equal(diaAbreviado('2026-08-26'), 'Mié.');
  assert.equal(diaAbreviado('2026-08-27'), 'Jue.');
  assert.equal(diaAbreviado('2026-08-28'), 'Vie.');
  assert.equal(diaAbreviado('2026-08-29'), 'Sáb.');
});

/**
 * El huso se prueba en OTRO proceso, con la zona horaria puesta de verdad.
 *
 * Cambiar `process.env.TZ` a mitad de camino no vale: el motor de JavaScript ya
 * resolvió la zona y sigue con la que tenía, así que la prueba pasaría sin
 * comprobar nada. Se lanza un node con la zona en el ambiente y se le pregunta
 * allá, que es la única manera de que la respuesta sea la de esa zona.
 */
function enLaZona(zona, fecha) {
  const { execFileSync } = require('child_process');
  const desde = app.indexOf('const DIAS_ABREVIADOS');
  const hasta = app.indexOf('/**\n * QUIÉN PASÓ ESTA LISTA');
  const codigo = `${app.slice(desde, hasta)}\nprocess.stdout.write(diaAbreviado(${JSON.stringify(fecha)}));`;
  return execFileSync(process.execPath, ['-e', codigo], {
    env: { ...process.env, TZ: zona }, encoding: 'utf8',
  });
}

test('y no se corre un día en un huso al oeste, que es la trampa', () => {
  assert.equal(enLaZona('America/Santiago', '2026-08-29'), 'Sáb.',
    'en Chile el sábado no puede leerse como viernes');
  assert.equal(enLaZona('Pacific/Kiritimati', '2026-08-29'), 'Sáb.',
    'y en el otro extremo, +14, tampoco como domingo');
  assert.equal(enLaZona('UTC', '2026-08-29'), 'Sáb.');
});

test('una fecha que no es una fecha no inventa ningún día', () => {
  for (const nada of ['', null, undefined, 'cualquier cosa', '2026-13-45']) {
    assert.equal(typeof diaAbreviado(nada), 'string');
  }
  assert.equal(diaAbreviado(''), '');
  assert.equal(diaAbreviado('cualquier cosa'), '');
});

test('el listado lo pone delante solo donde el módulo lo pide', () => {
  assert.match(app, /f\.mostrarDia \? diaAbreviado\(v\) : ''/,
    'la celda del listado tiene que preguntarle al campo');
  const fecha = getModule('servicios').fields.find((f) => f.name === 'fecha');
  assert.equal(fecha.mostrarDia, true, 'el Registro de Servicios lo pide');
  const otra = getModule('tesoreria').fields.find((f) => f.name === 'fecha');
  assert.ok(!otra.mostrarDia, 'y donde no se pide, la fecha se ve como siempre');
});

test('la propiedad viaja a la pantalla, o no serviría de nada', () => {
  assert.ok(LO_QUE_VIAJA.includes('mostrarDia'));
  const fecha = getModule('servicios').fields.find((f) => f.name === 'fecha');
  assert.equal(comoLoVeLaPantalla(fecha).mostrarDia, true);
  assert.equal(comoLoVeLaPantalla({ name: 'x', label: 'X', type: 'date' }).mostrarDia, false);
});
