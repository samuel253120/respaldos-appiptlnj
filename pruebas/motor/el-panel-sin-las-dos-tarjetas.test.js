/**
 * DOS AVISOS QUE EL PANEL YA NO MUESTRA.
 *
 * La corporación pidió sacar del panel de control «Cuotas sin monto definido»
 * y «Cuerpos que no están levantando actas». Con la tarjeta se va el trabajo de
 * armarla: un panel que calcula dos listas que nadie va a mirar las calcula
 * igual en cada visita, y esta prueba existe para que no vuelvan de rebote —ni
 * la pintura, ni el cálculo, ni el viaje entre los dos—.
 *
 * Lo que la cuota sin monto significa NO se fue con la tarjeta: se sigue
 * diciendo en los tres lugares donde se puede hacer algo al respecto, y eso lo
 * cuida `una-cuota-mensual-sin-monto.test.js`. La decisión sobre las actas
 * —que no pesan en el cumplimiento— la cuida
 * `el-libro-de-actas-no-se-le-exige-a-un-cuerpo.test.js`.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '../..');
const index = fs.readFileSync(path.join(raiz, 'server/index.js'), 'utf8');
const app = fs.readFileSync(path.join(raiz, 'public/app.js'), 'utf8');

test('el panel no arma ni manda esas dos listas', () => {
  for (const cual of ['cuerposSinCuota', 'cuerposSinActas', 'losQueCobranSinMonto', 'losQueNoLevantanActas']) {
    assert.ok(!index.includes(cual), `«${cual}» sigue en la ruta del panel`);
  }
});

test('y la pantalla no las pinta', () => {
  for (const cual of ['avisoCuota', 'avisoActas', 'cuerposSinCuota', 'cuerposSinActas',
    'Cuotas sin monto definido', 'no están levantando actas']) {
    assert.ok(!app.includes(cual), `«${cual}» sigue en la pantalla`);
  }
});

test('el módulo que solo servía para ese aviso ya no está', () => {
  assert.ok(!fs.existsSync(path.join(raiz, 'server/cuerpo-que-no-levanta-actas.js')),
    'nadie lo llamaba: dejarlo sería código que no corre nunca');
});

test('pero el panel sigue trayendo los avisos que quedaron', () => {
  for (const cual of ['credencialesPorVencer', 'credencialesSinTitular',
    'cuerposSinDirectiva', 'documentosSinResponder']) {
    assert.ok(index.includes(cual), `«${cual}» tiene que seguir`);
    assert.ok(app.includes(cual), `«${cual}» tiene que seguir pintándose`);
  }
});

test('y lo que la cuota sin monto significa sigue dicho donde se arregla', () => {
  const cuota = fs.readFileSync(path.join(raiz, 'server/cuota-sin-monto.js'), 'utf8');
  assert.ok(cuota.includes('leFaltaElMonto'), 'el estado de cumplimiento lo sigue midiendo');
  assert.ok(cuota.includes('avisoSiCobraSinMonto'), 'y el guardado lo sigue preguntando');
  assert.ok(!/en el panel/i.test(cuota),
    'y ya no manda a mirar el panel, que es mandar a mirar nada');
});
