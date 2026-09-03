/**
 * A quién se ofrece ponerle un perfil.
 *
 * La ficha de un perfil muestra dos listas: quiénes lo llevan puesto y a
 * quiénes se les puede poner. La segunda es la que se usa para decidir, y hasta
 * la v1.327.0 traía también las cuentas dadas de baja.
 *
 * MEDIDO: desactivada una cuenta, seguía apareciendo entre las disponibles para
 * asignarle el perfil.
 *
 * No abre nada —una cuenta desactivada no entra al sistema, y eso está probado
 * desde la v1.323.0— pero es ruido en una lista que se usa para decidir, y
 * contradice el criterio del resto del sistema: la lista de responsables de una
 * solicitud, por ejemplo, solo trae las activas.
 *
 * La lista de quienes YA lo llevan es otra cosa y no se toca: ahí las
 * desactivadas tienen que salir, con su estado, porque es donde se les saca el
 * perfil y donde se ve quién lo tiene.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `ofrecer-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 23500000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

function unPerfil() {
  const nombre = `Perfil que se ofrece ${unRut()} ${M}`;
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(nombre, JSON.stringify({ miembros: ['view'] })).lastInsertRowid);
  return { id, nombre };
}

function unaCuenta({ rol = 'consulta', activo = 1, perfil = null, nombre = null } = {}) {
  const rut = unRut();
  const id = Number(db.prepare(
    'INSERT INTO usuarios (rut, nombre, rol, activo, perfil_id) VALUES (?, ?, ?, ?, ?)'
  ).run(rut, nombre || `Cuenta ${rut} ${M}`, rol, activo, perfil).lastInsertRowid);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

const laFichaDelPerfil = async (api, perfil) => {
  const r = await api('GET', `/perfiles_permisos/${perfil.id}/usuarios`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  return r.json;
};

/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: una cuenta desactivada no se ofrece para ponerle el perfil', async () => {
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const deBaja = unaCuenta({ activo: 0, nombre: `Ya no entra ${M}` });

  const { disponibles } = await laFichaDelPerfil(api, perfil);
  assert.ok(!disponibles.some((u) => u.id === deBaja.id),
    'antes salía entre las disponibles: darle permisos a quien ya no entra es ruido');
});

test('LA CONTRACARA: la que sigue activa sí se ofrece', async () => {
  /**
   * Sin esta, «no ofrecer las desactivadas» se cumpliría no ofreciendo a
   * nadie, y la pantalla quedaría inservible.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const activa = unaCuenta({ nombre: `Sigue trabajando ${M}` });

  const { disponibles } = await laFichaDelPerfil(api, perfil);
  assert.ok(disponibles.some((u) => u.id === activa.id));
});

test('y la lista de quienes YA lo llevan sí trae a las desactivadas, con su estado', async () => {
  /**
   * Es la otra lista y es de otra cosa: ahí se ve quién tiene el perfil y se
   * le saca. Esconder a una cuenta dada de baja que lo lleva puesto sería
   * dejar un permiso sin que nadie pueda quitárselo.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const deBaja = unaCuenta({ activo: 0, perfil: perfil.id, nombre: `Lo lleva y no entra ${M}` });

  const { usuarios } = await laFichaDelPerfil(api, perfil);
  const suya = usuarios.find((u) => u.id === deBaja.id);
  assert.ok(suya, 'tiene que salir entre quienes lo llevan');
  assert.equal(suya.activo, 0, 'y decir que está desactivada');

  const sacar = await api('DELETE', `/perfiles_permisos/${perfil.id}/usuarios/${deBaja.id}`);
  assert.equal(sacar.estado, 200, `y tiene que poder sacársele: ${sacar.texto.slice(0, 200)}`);
});

test('ponérselo a una cuenta desactivada por su número se sigue pudiendo', async () => {
  /**
   * A propósito. Preparar la cuenta de alguien que empieza el lunes y
   * activarla ese día es un caso de verdad; lo que no corresponde es
   * ofrecerla entre las que hay para elegir.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const deBaja = unaCuenta({ activo: 0, nombre: `Empieza el lunes ${M}` });

  const r = await api('POST', `/perfiles_permisos/${perfil.id}/usuarios`, { usuarios: [deBaja.id] });
  assert.equal(r.estado, 200, `tenía que poder: ${r.texto.slice(0, 200)}`);
  assert.equal(r.json.puestos, 1);
  assert.equal(Number(db.prepare('SELECT perfil_id FROM usuarios WHERE id = ?').get(deBaja.id).perfil_id), perfil.id);
});

test('y las tres condiciones de la lista se siguen cumpliendo juntas', async () => {
  /**
   * Las que ya estaban —no tener ese perfil, no ser administrador— y la nueva.
   * Se comprueban de una vez para que arreglar una no borre otra.
   */
  const api = await elSistemaAndando();
  const perfil = unPerfil();
  const conElPerfil = unaCuenta({ perfil: perfil.id, nombre: `Ya lo tiene ${M}` });
  const jefe = unaCuenta({ rol: 'admin', nombre: `Administrador ${M}` });
  const deBaja = unaCuenta({ activo: 0, nombre: `De baja ${M}` });
  const libre = unaCuenta({ nombre: `Libre y activa ${M}` });

  const { disponibles } = await laFichaDelPerfil(api, perfil);
  const ids = disponibles.map((u) => u.id);
  assert.ok(!ids.includes(conElPerfil.id), 'quien ya lo tiene, no');
  assert.ok(!ids.includes(jefe.id), 'un administrador, no');
  assert.ok(!ids.includes(deBaja.id), 'una cuenta desactivada, no');
  assert.ok(ids.includes(libre.id), 'y la que está libre y activa, sí');
});
