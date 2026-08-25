/**
 * Los ajustes nuevos: que estén ofrecidos, que su valor de fábrica no cambie
 * lo que el sistema ya hacía, y que ninguno pueda dejar el sistema en un modo
 * que no existe.
 *
 * Lo tercero es lo que de verdad se cuida acá. Una opción de lista que admita
 * un valor inventado deja al sistema eligiendo «Servicio Especialx» o una zona
 * horaria que no existe, y eso no da error: da un sistema que se porta raro
 * sin que nadie sepa por qué.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const { TIPOS_DE_ACTIVIDAD } = require('../../server/actividades');
const asistencias = require('../../server/modules/asistencias');

const campoActividad = asistencias.fields.find((f) => f.name === 'tipo_reunion');

// -------------------------------------------------- que estén, y bien puestos

test('todos los ajustes nuevos están ofrecidos y explicados', () => {
  const nuevos = [
    'zona_horaria', 'acceso_espera_minutos', 'avisos_revisar_minutos', 'credencial_aviso_dias',
    'credencial_vigencia_anios', 'documento_pie_texto',
    'asistencia_actividad_defecto', 'asistencia_marca_inicial',
  ];
  for (const clave of nuevos) {
    const o = ajustes.POR_CLAVE[clave];
    assert.ok(o, `${clave} no aparece en la pantalla de configuración`);
    assert.ok(o.label && o.label.length > 5, `${clave} sin nombre legible`);
    assert.ok(o.ayuda && o.ayuda.length > 40, `${clave} no explica para qué sirve`);
  }
});

test('ninguna lista ofrece opciones repetidas ni vacías', () => {
  for (const o of Object.values(ajustes.POR_CLAVE)) {
    if (o.tipo !== 'select') continue;
    const valores = (o.opciones || []).map((x) => x.valor);
    assert.ok(valores.length, `${o.clave} es una lista sin opciones`);
    assert.equal(new Set(valores).size, valores.length, `${o.clave} repite alguna opción`);
    assert.ok(valores.every((v) => String(v).trim() !== ''), `${o.clave} tiene una opción vacía`);
  }
});

test('el valor de fábrica de cada lista es una de sus propias opciones', () => {
  // Si no lo fuera, el desplegable abriría sin nada elegido y guardar dejaría
  // cualquier cosa.
  for (const o of Object.values(ajustes.POR_CLAVE)) {
    if (o.tipo !== 'select') continue;
    assert.ok((o.opciones || []).some((x) => String(x.valor) === String(o.defecto)),
      `el valor de fábrica de ${o.clave} («${o.defecto}») no está entre sus opciones`);
  }
});

// ------------------------------------------- la actividad que viene elegida

test('de fábrica sigue viniendo la actividad de siempre', () => {
  ajustes.guardar('asistencia_actividad_defecto', 'Servicio General');
  assert.equal(campoActividad.default, TIPOS_DE_ACTIVIDAD[0]);
});

test('y se puede cambiar por cualquiera de las que existen', () => {
  for (const cual of TIPOS_DE_ACTIVIDAD) {
    ajustes.guardar('asistencia_actividad_defecto', cual);
    assert.equal(campoActividad.default, cual);
  }
  ajustes.guardar('asistencia_actividad_defecto', 'Servicio General');
});

test('si la guardada ya no existe, se usa una que sí, no una inventada', () => {
  // Puede pasar si un día se saca una actividad de la lista: el ajuste
  // guardado queda apuntando a algo que ya no está.
  ajustes.guardar('asistencia_actividad_defecto', 'Bingo Parroquial');
  assert.ok(TIPOS_DE_ACTIVIDAD.includes(campoActividad.default),
    `quedó «${campoActividad.default}», que el desplegable no ofrece`);
  ajustes.guardar('asistencia_actividad_defecto', 'Servicio General');
});

// ------------------------------------------------- la marca inicial

test('de fábrica, una lista se abre sin marcar a nadie', () => {
  // Es lo que el sistema hacía antes de que esto existiera: cambiarlo sin que
  // nadie lo pida sería marcar presente a gente que nadie miró.
  assert.equal(ajustes.obtener('asistencia_marca_inicial'), 'Sin marcar');
});

test('solo admite las dos formas que existen', () => {
  const o = ajustes.POR_CLAVE['asistencia_marca_inicial'];
  assert.deepEqual(o.opciones.map((x) => x.valor), ['Sin marcar', 'Presente']);
});

// --------------------------------------------- la vigencia de la credencial

test('los años de vigencia tienen tope: una credencial no dura un siglo', () => {
  const o = ajustes.POR_CLAVE['credencial_vigencia_anios'];
  assert.equal(o.min, 1);
  assert.equal(o.max, 20);
  ajustes.guardar('credencial_vigencia_anios', '999');
  assert.ok(ajustes.numero('credencial_vigencia_anios', 1, 20) <= 20);
  ajustes.guardar('credencial_vigencia_anios', '2');
});

test('el pie de los documentos empieza vacío: no se imprime nada que nadie escribió', () => {
  assert.equal(ajustes.POR_CLAVE['documento_pie_texto'].defecto, '');
});
