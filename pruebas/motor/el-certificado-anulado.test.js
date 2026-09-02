/**
 * CE-01 · El certificado anulado que sigue valiendo.
 *
 * Un certificado es la única cosa de este sistema que se firma, se sella y sale
 * del edificio. Tiene dos estados —Emitido y Anulado— y anular está para el
 * caso real: un nombre mal escrito, una fecha equivocada, un papel que se
 * rehace.
 *
 * MEDIDO en la v1.291.0: anular contestaba 200 y la hoja de impresión salía
 * EXACTAMENTE igual que la de uno válido. La misma orla, las mismas dos líneas
 * de firma, el mismo número, y la palabra «anulado» en ninguna parte. En la
 * pantalla el sistema sí lo marcaba —insignia roja en el listado y en la
 * ficha—; en el papel, que es lo que la persona se lleva, no quedaba nada.
 *
 * Es el mismo arreglo que la v1.272.0 le hizo al acta sin firmar: un sello
 * impreso, con borde y no con fondo, y las líneas de firma diciendo que ese
 * papel no vale. Y con él viene la fecha de la anulación, estampada por el
 * sistema como las actas estampan la de su firma: un sello que dice «ANULADO»
 * y no dice cuándo deja la pregunta de vuelta en quien recibe el papel.
 *
 * LO QUE ESTE ARCHIVO NO PUEDE PROBAR es que la hoja se vea: eso se comprueba
 * en el navegador, y la suite del papel (pruebas/papel-certificados.js) lo mira
 * sobre el PDF de verdad. Acá se prueba lo que el motor decide —cuándo se
 * estampa la fecha y cuándo no— y se vigila que la hoja siga llevando el sello
 * en las tres disposiciones.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const hoy = () => require('../../server/fechas').hoy();

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Certificados ${m}`, `CE${m}`.slice(0, 18)).lastInsertRowid;
}

async function unCertificado(api, campos) {
  const r = await api('POST', '/certificados', {
    tipo: 'Bautismo', iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

// ══════════════════════════════ cuándo se estampa la fecha ══

test('anular estampa el día en que se anuló', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);
  assert.equal(cert.fecha_anulacion, null, 'un certificado emitido no tiene fecha de anulación');

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado' });
  assert.equal(r.estado, 200);
  assert.equal(r.json.estado, 'Anulado');
  assert.equal(r.json.fecha_anulacion, hoy(), 'y es el día de hoy en la zona de la institución');
});

test('y volver a emitirlo la borra: un papel que vuelve a valer no dice cuándo se anuló', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);
  await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado' });

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Emitido' });
  assert.equal(r.estado, 200);
  assert.equal(r.json.fecha_anulacion, null);
});

test('volver a guardar uno ya anulado NO re-estampa la fecha', async () => {
  /*
   * La anulación ocurrió el día que ocurrió. Estampándola en cada guardado, el
   * dato se convertiría en «la última vez que alguien tocó esta ficha», que es
   * otra cosa — y la hoja impresa diría una fecha falsa. Es la misma lección
   * que dejó la firma de las actas en la v1.272.0.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);
  await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado' });
  db.prepare('UPDATE certificados SET fecha_anulacion = ? WHERE id = ?').run('2026-01-15', cert.id);

  const r = await api('PUT', `/certificados/${cert.id}`, { notas: 'Se avisó a la familia' });
  assert.equal(r.estado, 200);
  assert.equal(r.json.fecha_anulacion, '2026-01-15', 'la fecha de la anulación no se mueve');
});

test('un certificado que nace anulado también la lleva', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });
  assert.equal(cert.estado, 'Anulado');
  assert.equal(cert.fecha_anulacion, hoy());
});

test('la fecha no se escribe a mano: la pone el sistema', async () => {
  /*
   * Es un campo de solo lectura, y eso lo aplica el motor: lo que llegue en esa
   * casilla se descarta. Si se pudiera escribir, el sello de la hoja diría lo
   * que alguien quisiera que dijera.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado', fecha_anulacion: '2020-01-01' });
  assert.equal(cert.fecha_anulacion, hoy(), 'la que mandaron se descarta');

  const r = await api('PUT', `/certificados/${cert.id}`, { fecha_anulacion: '2019-05-05' });
  assert.equal(r.estado, 200);
  assert.equal(r.json.fecha_anulacion, hoy());
});

test('el campo está declarado como lo que es', () => {
  const def = require('../../server/modules/certificados');
  const f = def.fields.find((x) => x.name === 'fecha_anulacion');
  assert.ok(f, 'el campo existe');
  assert.equal(f.type, 'date');
  assert.equal(f.readonly, true, 'no se escribe a mano');
  assert.deepEqual(f.showIf, { field: 'estado', equals: 'Anulado' },
    'y no se muestra en un certificado que vale');
});

// ═══════════════════════════ y que la hoja lo diga, en las tres ══

test('las tres disposiciones imprimen el sello', () => {
  /*
   * MIRA EL CÓDIGO, y se deja escrito. Que el sello SE VEA se comprueba en el
   * navegador —la suite del papel lo lee del PDF de verdad—; lo que se vigila
   * acá es que las tres hojas lo sigan pintando, porque son tres trozos de
   * código distintos y es fácil arreglar uno y olvidar los otros dos. Fue
   * exactamente lo que pasó con el número de la hoja de presentación.
   */
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('function printCertificado(');
  assert.ok(desde > 0, 'la función existe');
  const cuerpo = app.slice(desde, app.indexOf('\nfunction certDeEjemplo', desde));
  assert.ok(cuerpo.length > 3000, `el recorte mide ${cuerpo.length}`);

  assert.equal((cuerpo.match(/\$\{selloAnulado\}/g) || []).length, 3,
    'el sello va en las tres disposiciones: la clásica, la de niños y la de matrimonio');
  assert.match(cuerpo, /row\.estado === 'Anulado'/, 'y sale del estado del certificado');
  assert.match(cuerpo, /Certificado anulado/, 'las líneas de firma también lo dicen');
});

test('el sello se dibuja con borde y no con fondo, o no saldría impreso', () => {
  /*
   * La trampa de siempre: los navegadores NO imprimen los fondos salvo que la
   * persona marque «gráficos de fondo», y esto es justamente lo que tiene que
   * salir en el papel. Es la misma comprobación que cuida el aviso del acta sin
   * firmar y el recuadro de los huecos del libro de partes.
   */
  const fs = require('fs');
  const path = require('path');
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const regla = css.slice(css.indexOf('.cert-anulado {'), css.indexOf('.cert-anulado b'));
  assert.ok(regla, 'la regla existe');
  assert.match(regla, /border:\s*2px solid #9f1239/, 'lleva borde');
  assert.ok(!/background/.test(regla), 'y NO lleva fondo, que es lo que no se imprimiría');
  assert.match(regla, /color:\s*#9f1239/, 'con su color de letra, que sí se imprime');
  assert.ok(!/var\(--cert-/.test(regla),
    'el color no sale del formato: uno con la letra clara dejaría el sello invisible');
});

test('un certificado válido no lleva ninguna marca', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const desde = app.indexOf('const selloAnulado = ');
  const linea = app.slice(desde, app.indexOf(';', app.indexOf('</div>`', desde)));
  assert.match(linea, /!anulado \? '' :/, 'sin anular, el sello es una cadena vacía');
});
