/**
 * Las dos tesorerías: la de la iglesia y la de los cuerpos.
 *
 * La organización lleva dos libros distintos y hasta ahora eran el mismo
 * permiso. Dar «Tesorería» daba los dos, así que para que la tesorera de un
 * cuerpo llevara la plata de su cuerpo había que abrirle también el libro de
 * la iglesia; y al tesorero general no había manera de dejarlo fuera de la
 * plata interna de los cuerpos.
 *
 * Lo que se comprueba acá es de dónde sale el nivel de cada fila y qué
 * condición se arma para el listado. Y una cosa que costó ver: **el nivel lo
 * decide la CUENTA, no el campo suelto**. El campo `cuerpo_id` de un
 * movimiento se escribía a mano, así que podía decir que era del cuerpo A
 * estando en la cuenta del cuerpo B, o no decir nada estándolo —en la base de
 * pruebas había seis así—. Desde ahora se toma de la cuenta al guardar y hay
 * una migración que puso al día lo de antes.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const tesorerias = require('../../server/tesorerias');
const permisos = require('../../server/permissions');
const { GENERAL, CUERPO } = tesorerias;

const CUENTAS = { name: 'cuentas_tesoreria', fields: [{ name: 'cuerpo_id' }] };
const MOVIMIENTOS = { name: 'tesoreria', fields: [{ name: 'cuerpo_id' }, { name: 'cuenta_id' }] };
const CUOTAS = { name: 'cuotas_cuerpo', fields: [{ name: 'cuerpo_id' }] };
const TRASPASOS = { name: 'traspasos', fields: [{ name: 'cuenta_origen_id' }, { name: 'cuenta_destino_id' }] };
const SERVICIOS = { name: 'servicios', fields: [{ name: 'fecha' }] };

const sinNivel = (llave) => ({ rol: 'tesorero', permisos: JSON.stringify({ [llave]: [] }) });

// -------------------------------------------------- de fábrica, las dos ----

test('las dos llaves vienen dadas a todos los roles', () => {
  // Son de las que están para poder QUITARSE: si alguna llegara apagada, a
  // alguien se le cerraría en silencio un libro que venía llevando.
  for (const llave of [GENERAL, CUERPO]) {
    for (const rol of ['admin', 'pastor', 'secretario', 'tesorero', 'consulta']) {
      assert.equal(permisos.can({ rol }, llave, 'view'), true, `${rol} tendría que traer ${llave}`);
    }
  }
});

test('con las dos no se filtra nada: la consulta queda como estaba', () => {
  const tesorera = { rol: 'tesorero' };
  for (const def of [CUENTAS, MOVIMIENTOS, CUOTAS, TRASPASOS]) {
    assert.equal(tesorerias.condicion(def, tesorera), null, `${def.name} no debería agregar condición`);
  }
});

test('un módulo que no lleva plata no se ve afectado', () => {
  assert.equal(tesorerias.esLibro(SERVICIOS), false);
  assert.equal(tesorerias.condicion(SERVICIOS, sinNivel(CUERPO)), null);
  assert.equal(tesorerias.alcanza(SERVICIOS, { id: 1 }, sinNivel(CUERPO)), true);
});

// ------------------------------------------------------- el nivel de cada fila ----

test('una cuenta es del cuerpo cuando tiene cuerpo; si no, es general', () => {
  assert.equal(tesorerias.nivelDe(CUENTAS, { id: 1, cuerpo_id: 7 }), CUERPO);
  assert.equal(tesorerias.nivelDe(CUENTAS, { id: 2, cuerpo_id: null }), GENERAL);
});

test('las cuotas son siempre del cuerpo, sin mirar nada', () => {
  // No existen cuotas de integrantes a nivel de iglesia: es lo único que se
  // resuelve sin consultar, y por eso su condición es un sí o un no seco.
  assert.equal(tesorerias.nivelDe(CUOTAS, { id: 1 }), CUERPO);
  assert.equal(tesorerias.condicion(CUOTAS, sinNivel(CUERPO)), '1 = 0');
  assert.equal(tesorerias.condicion(CUOTAS, sinNivel(GENERAL)), null, 'no las toca quitar lo general');
});

// -------------------------------------------------- lo que se le quita a quién ----

test('a quien no alcanza los cuerpos se le dejan fuera sus cuentas y sus movimientos', () => {
  const soloGeneral = sinNivel(CUERPO);

  const deCuentas = tesorerias.condicion(CUENTAS, soloGeneral);
  assert.match(deCuentas, /cuerpo_id" IS NULL/, `condición inesperada: ${deCuentas}`);

  const deMovimientos = tesorerias.condicion(MOVIMIENTOS, soloGeneral);
  assert.match(deMovimientos, /cuerpo_id" IS NULL/);
  // Y además por la cuenta: el campo propio solo vale porque se toma de ahí,
  // pero la cuenta es la que manda y se comprueba igual
  assert.match(deMovimientos, /NOT EXISTS.*cuentas_tesoreria.*cuerpo_id IS NOT NULL/s);

  assert.equal(tesorerias.alcanza(CUENTAS, { id: 1, cuerpo_id: 7 }, soloGeneral), false);
  assert.equal(tesorerias.alcanza(CUENTAS, { id: 2, cuerpo_id: null }, soloGeneral), true);
});

test('y al revés: a quien solo lleva los cuerpos se le deja fuera lo de la iglesia', () => {
  const soloCuerpos = sinNivel(GENERAL);

  const deCuentas = tesorerias.condicion(CUENTAS, soloCuerpos);
  assert.match(deCuentas, /cuerpo_id" IS NOT NULL/, `condición inesperada: ${deCuentas}`);

  assert.equal(tesorerias.alcanza(CUENTAS, { id: 1, cuerpo_id: 7 }, soloCuerpos), true);
  assert.equal(tesorerias.alcanza(CUENTAS, { id: 2, cuerpo_id: null }, soloCuerpos), false);
  assert.equal(tesorerias.alcanza(CUOTAS, { id: 3 }, soloCuerpos), true, 'las cuotas sí');
});

test('quien no alcanza ninguna no ve ni una fila de ningún libro', () => {
  const ninguna = { rol: 'consulta', permisos: JSON.stringify({ [GENERAL]: [], [CUERPO]: [] }) };
  assert.equal(tesorerias.alcanza(CUENTAS, { id: 1, cuerpo_id: 7 }, ninguna), false);
  assert.equal(tesorerias.alcanza(CUENTAS, { id: 2, cuerpo_id: null }, ninguna), false);
  assert.equal(tesorerias.alcanza(CUOTAS, { id: 3 }, ninguna), false);
  assert.deepEqual(tesorerias.fuera(ninguna).sort(), [CUERPO, GENERAL].sort());
});

// ----------------------------------------------------------------- traspasos ----

test('un traspaso se mide por las dos cuentas que toca', () => {
  // Uno que saca plata de un cuerpo es del cuerpo, aunque el otro lado sea de
  // la iglesia: si no se mirara, sería la puerta por donde el movimiento se
  // vería igual, contado desde el otro lado.
  const conCuentas = (deCuerpo) => ({
    prepare: () => ({ get: (id) => ({ cuerpo_id: deCuerpo.includes(id) ? 9 : null }) }),
  });

  const fila = { id: 1, cuenta_origen_id: 10, cuenta_destino_id: 20 };
  const soloGeneral = sinNivel(CUERPO);

  // Las dos generales: la ve
  assert.equal(tesorerias.alcanza(TRASPASOS, fila, soloGeneral, conCuentas([])), true);
  // Una del cuerpo: no la ve
  assert.equal(tesorerias.alcanza(TRASPASOS, fila, soloGeneral, conCuentas([20])), false);
  assert.equal(tesorerias.alcanza(TRASPASOS, fila, soloGeneral, conCuentas([10])), false);

  // Y a quien solo lleva los cuerpos le pasa lo mismo del otro lado
  const soloCuerpos = sinNivel(GENERAL);
  assert.equal(tesorerias.alcanza(TRASPASOS, fila, soloCuerpos, conCuentas([10, 20])), true);
  assert.equal(tesorerias.alcanza(TRASPASOS, fila, soloCuerpos, conCuentas([10])), false,
    'la otra punta es de la iglesia y no la alcanza');
});

test('la condición de un traspaso mira las dos cuentas', () => {
  const c = tesorerias.condicion(TRASPASOS, sinNivel(CUERPO));
  assert.match(c, /cuenta_origen_id/);
  assert.match(c, /cuenta_destino_id/);
  assert.match(c, /cuerpo_id IS NOT NULL/);
});

// ------------------------------------------------------------------ al guardar ----

test('no se le deja registrar un movimiento en un libro que no ve', () => {
  // Sin esto bastaba con escribir la cuenta a mano: se anotaba el movimiento y
  // después no aparecía en ninguna parte para quien lo anotó.
  const soloGeneral = sinNivel(CUERPO);
  const aviso = tesorerias.alGuardar(MOVIMIENTOS, { cuerpo_id: 7, cuenta_id: 3 }, soloGeneral);
  assert.match(aviso, /tesorería de los cuerpos/);
  assert.equal(tesorerias.alGuardar(MOVIMIENTOS, { cuerpo_id: null, cuenta_id: 1 }, soloGeneral), null);

  const soloCuerpos = sinNivel(GENERAL);
  assert.match(
    tesorerias.alGuardar(MOVIMIENTOS, { cuerpo_id: null, cuenta_id: 1 }, soloCuerpos),
    /iglesia y la corporación/
  );
});
