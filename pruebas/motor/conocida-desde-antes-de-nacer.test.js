/**
 * NO SE LA PUEDE CONOCER DESDE ANTES DE QUE NACIERA.
 *
 * Medido: una ficha nacida el 15-06-2010 y conocida desde el 01-03-2005 se
 * guardaba sin que nada dijera nada, y quedaba diciendo que a esa señora se la
 * conoce desde hace veintiún años y que tiene dieciséis.
 *
 * Cada fecha se revisaba sola y bien —2030 se rechaza porque todavía no llega,
 * 1890 porque no se anotan fechas tan antiguas—, pero no se comparaban entre
 * sí. Es el error de tecleo de siempre, el año equivocado, y el mecanismo para
 * atajarlo ya estaba en el sistema y se usa en las credenciales, en las
 * cuentas de tesorería, en los cuerpos y en las directivas: a este campo no se
 * le había pedido.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fechas = require('../../server/fechas');
const noMiembros = require('../../server/modules/no_miembros');

const revisar = (datos, existing) => fechas.revisarCoherencia(noMiembros, datos, existing || null);

test('conocida desde antes de nacer, se rechaza', () => {
  const aviso = revisar({ fecha_nacimiento: '2010-06-15', conocido_desde: '2005-03-01' });
  assert.ok(aviso, 'antes se guardaba sin decir nada');
  assert.match(aviso, /"Se le conoce desde" \(01-03-2005\)/);
  assert.match(aviso, /no puede ser anterior a "Fecha de nacimiento" \(15-06-2010\)/,
    'el aviso dice las dos fechas: quien tecleó mal el año necesita ver cuál');
});

test('conocida después de nacer, se guarda', () => {
  assert.equal(revisar({ fecha_nacimiento: '2010-06-15', conocido_desde: '2020-03-01' }), null);
});

test('el mismo día está bien', () => {
  assert.equal(revisar({ fecha_nacimiento: '2010-06-15', conocido_desde: '2010-06-15' }), null,
    'una guagua que llega el día que nace no es un error');
});

test('con una sola de las dos no hay nada que comparar', () => {
  // Hoy esto se sostiene dos veces: por la guardia que salta el campo cuando
  // falta una fecha, y porque comparar texto contra null da NaN y nunca es
  // verdad. Se comprobó rompiendo: quitar sola la guardia no cambia nada,
  // pero comparar con Date en vez de texto —`new Date(null)` es 1970— hace
  // que a la ficha sin nacimiento se le rechace el «se le conoce desde»,
  // y ahí la guardia es lo único que la salva. Por eso está y se prueba.
  assert.equal(revisar({ conocido_desde: '2005-03-01' }), null,
    'la fecha de nacimiento es opcional en este registro, y casi nunca está');
  assert.equal(revisar({ fecha_nacimiento: '2010-06-15' }), null);
});

test('también se mira contra lo que la ficha ya tenía', () => {
  // Se le agrega después la fecha de nacimiento a una ficha que ya decía desde
  // cuándo se la conoce: el choque es el mismo y tiene que salir igual.
  const aviso = revisar({ fecha_nacimiento: '2010-06-15' }, { conocido_desde: '2005-03-01' });
  assert.ok(aviso, 'un guardado que solo trae un campo se compara con el otro que ya estaba');
});

test('el campo lo declara, y apunta a la fecha de nacimiento', () => {
  const campo = noMiembros.fields.find((f) => f.name === 'conocido_desde');
  assert.equal(campo.noAntesDe, 'fecha_nacimiento');
});

test('lo que cada fecha ya revisaba por su cuenta sigue igual', () => {
  const deNacimiento = noMiembros.fields.find((f) => f.name === 'fecha_nacimiento');
  assert.match(fechas.revisar(deNacimiento, '2030-05-05'), /todavía no llega/);
  assert.match(fechas.revisar(deNacimiento, '1890-01-01'), /no se anotan fechas anteriores/);
});
