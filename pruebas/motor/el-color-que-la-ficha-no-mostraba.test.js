/**
 * El color que un campo declara tiene que llegar hasta la pantalla.
 *
 * Un campo de color se guarda VACÍO cuando vale «el del sistema»: así, el día
 * que la institución cambie sus colores, los formatos que nunca eligieron uno
 * se van con ella. Por eso no lleva valor por defecto sino `porDefecto`, que
 * es otra cosa: no es lo que se guarda, es EN QUÉ COLOR ABRE el cuadrito de
 * elegir y qué dice la caja de texto cuando está en blanco.
 *
 * ESTABA MAL, Y NO SE VEÍA POR NINGUNA PARTE. El módulo de Formatos de
 * Certificado declaraba los tres —título #16265c, texto #44403c, marco
 * #e8b52c— y la pantalla estaba escrita para usarlos. En el medio, la
 * descripción del sistema no los mandaba: `porDefecto` no estaba en la lista
 * de lo que viaja. Medido en la v1.309.0, sobre la ficha de «Bautismo» con los
 * tres colores en blanco en la base:
 *
 *     lo que mostraba la ficha        lo que sale impreso
 *     título   #16265c  ✔ calza       #16265c
 *     texto    #16265c  ✘             #44403c
 *     marco    #16265c  ✘             #e8b52c   ← oro, medido rgb(232,181,44)
 *
 * El del título calzaba de casualidad: es el respaldo que la pantalla trae
 * escrito. Y el cuadrito de color no es un cartel, es un CONTROL: quien abría
 * el formato para oscurecer un poco el oro del marco lo encontraba en azul,
 * elegía un tono cerca de ahí y guardaba. El marco oro de todos los
 * certificados de ese tipo quedaba azul, y en la ficha no había nada que
 * dijera que era oro.
 *
 * La prueba de fondo es la última: no comprueba este color sino la regla
 * general de la que este fue el primer caso —toda propiedad que un campo
 * declare tiene que estar clasificada, o viaja a la pantalla o es una regla
 * del guardado—. Es la que habría avisado el día que se escribió.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { LO_QUE_VIAJA, SOLO_DEL_SERVIDOR, comoLoVeLaPantalla, sinLoQueNoDiceNada } =
  require('../../server/meta-liviana');
const { allModules } = require('../../server/registry');
const formatos = require('../../server/modules/formatos_certificado');

const campoDe = (nombre) => formatos.fields.find((f) => f.name === nombre);

/* --------------------------------------------------------------------- */
/* Los tres colores de la hoja                                            */
/* --------------------------------------------------------------------- */

const LOS_TRES = [
  ['color_titulo', '#16265c'],
  ['color_texto', '#44403c'],
  ['color_marco', '#e8b52c'],
];

test('los tres colores de la hoja declaran el suyo de fábrica', () => {
  for (const [nombre, color] of LOS_TRES) {
    const campo = campoDe(nombre);
    assert.ok(campo, `falta el campo ${nombre}`);
    assert.equal(campo.type, 'color');
    assert.equal(campo.porDefecto, color, `${nombre} tiene que declarar ${color}`);
    assert.equal(campo.default, undefined,
      `${nombre} NO lleva valor por defecto: vacío significa «el del sistema» y así se guarda`);
  }
});

test('EL QUE IMPORTA: ese color llega hasta la pantalla', () => {
  /**
   * Es la comprobación que faltaba. Declararlo y que no viaje es exactamente
   * lo que pasaba, y desde los dos lados se veía bien escrito.
   */
  for (const [nombre, color] of LOS_TRES) {
    const comoLoRecibe = sinLoQueNoDiceNada(comoLoVeLaPantalla(campoDe(nombre)));
    assert.equal(comoLoRecibe.porDefecto, color,
      `la pantalla tiene que recibir el color de fábrica de ${nombre}`);
  }
});

test('y no se confunde con un valor por defecto: el campo sigue viajando sin él', () => {
  const comoLoRecibe = sinLoQueNoDiceNada(comoLoVeLaPantalla(campoDe('color_marco')));
  assert.ok(!('default' in comoLoRecibe),
    'si viajara un valor por defecto, la ficha guardaría un color que nadie eligió');
});

test('el color que la hoja imprime es el mismo que declara el campo', () => {
  /**
   * La otra mitad del arreglo. Si la pantalla dibujara la hoja con un color de
   * respaldo distinto del declarado, la ficha volvería a mostrar una cosa y el
   * papel a decir otra, solo que al revés.
   */
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const desde = app.indexOf('const estiloHoja = [');
  assert.ok(desde > 0, 'no se encontró el armado del estilo de la hoja');
  const trozo = app.slice(desde, app.indexOf('].join(', desde));
  for (const [nombre, color] of LOS_TRES) {
    const corto = nombre.replace('color_', '');
    const re = new RegExp(`--cert-color-${corto}:\\$\\{color\\(f\\.${nombre}, '${color}'\\)\\}`);
    assert.match(trozo, re,
      `la hoja tiene que caer al mismo ${color} que declara ${nombre}`);
  }
});

test('la pantalla usa el color declarado para abrir el cuadrito y como pista', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const desde = app.indexOf("case 'color': {", app.indexOf('function fieldHtml'));
  assert.ok(desde > 0, 'no se encontró el control de color del formulario');
  const trozo = app.slice(desde, desde + 1400);
  assert.match(trozo, /class="cc-pico" value="\$\{esc\(puesto \|\| f\.porDefecto/,
    'el cuadrito se abre en el color de fábrica del campo');
  assert.match(trozo, /placeholder="\$\{esc\(f\.porDefecto/,
    'y la caja lo dice cuando está en blanco');
});

/* --------------------------------------------------------------------- */
/* La regla general, que es de lo que este color fue el primer caso       */
/* --------------------------------------------------------------------- */

test('LA DE FONDO: toda propiedad que un campo declare está clasificada', () => {
  /**
   * O viaja a la pantalla, o es una regla del guardado que se queda en el
   * servidor. Una tercera clase —declarada de un lado, esperada del otro y sin
   * pasaje— es el agujero por el que se cayó `porDefecto`, y no lo vio nadie.
   */
  const viajan = new Set(LO_QUE_VIAJA);
  const delServidor = new Set(SOLO_DEL_SERVIDOR);
  const sueltas = new Map();

  for (const m of allModules()) {
    for (const f of m.fields || []) {
      for (const clave of Object.keys(f)) {
        if (viajan.has(clave) || delServidor.has(clave)) continue;
        if (!sueltas.has(clave)) sueltas.set(clave, `${m.name}.${f.name}`);
      }
    }
  }
  assert.deepEqual([...sueltas.keys()], [],
    'propiedades sin clasificar: ' +
    [...sueltas].map(([k, d]) => `«${k}» (${d})`).join(', ') +
    '. Decida si viajan a la pantalla (LO_QUE_VIAJA) o son del guardado (SOLO_DEL_SERVIDOR).');
});

test('y lo que la lista dice que viaja, viaja de verdad', () => {
  /**
   * La lista sola no sirve de nada si el mapeo no la honra: se comprueba
   * pasándole a cada propiedad un valor que se note y mirando que salga.
   */
  const deMentira = {
    name: 'x', label: 'X', type: 'text', required: true, options: ['a'],
    sugerencias: ['s'], ref: 'iglesias', help: 'ayuda', default: 'd',
    porDefecto: '#123456', accept: 'image/*', showIf: { field: 'y', equals: 'z' },
    bloqueadoSi: { field: 'y', salvo: 'z' }, optionsRoute: '/r', readonly: true,
    calcula: { tipo: 'porcentaje', porcentaje: 10 }, mostrarEdad: true,
    seccion: 'S', destacado: true, buscador: false, ancho: 2, recorte: 'c',
    recorta: 'r', min: 1, max: 9, entero: true, sensible: true,
    reservado: null, futuro: true, placeholder: 'p', enElPapel: false,
  };
  const sale = sinLoQueNoDiceNada(comoLoVeLaPantalla(deMentira, { salud: 'salud' }));
  for (const clave of LO_QUE_VIAJA) {
    assert.ok(clave in sale, `«${clave}» dice que viaja y no salió`);
  }
});

test('y las reglas del guardado NO viajan: la pantalla no las necesita', () => {
  const conReglas = {
    name: 'rut', label: 'RUT', type: 'rut',
    unique: true, soloAlCrear: true, noAntesDe: 'otra', companeroDe: 'otro',
    alcanceLoDecideElModulo: true, oculto: true,
  };
  const sale = comoLoVeLaPantalla(conReglas);
  for (const clave of SOLO_DEL_SERVIDOR) {
    assert.ok(!(clave in sale), `«${clave}» es del servidor y salió a la pantalla`);
  }
});
