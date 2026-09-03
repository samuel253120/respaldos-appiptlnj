/**
 * Lo que un perfil guarda es lo que el sistema comprueba.
 *
 * El editor de permisos existe para que «lo que se ve ahí sea exactamente lo
 * que el sistema comprueba, sin nada escondido», y la pantalla cumple: solo
 * ofrece los módulos y las llaves que existen, con sus acciones. Lo que no
 * había era nada que revisara lo que LLEGA.
 *
 * MEDIDO EN LA v1.327.0, por la API:
 *
 *   {"modulo_que_no_existe":["view"], "miembros":["volar","view"],
 *    "*":["view","create","edit","delete"]}   →  201, guardado tal cual
 *
 * Los dos primeros son inofensivos: nadie pregunta por un módulo que no existe
 * ni por una acción que no existe. El tercero no lo es tanto. En la tabla de
 * los ROLES «*» significa «todo»; en un perfil no se mira nunca —`can` pregunta
 * por el nombre del módulo y nada más—, así que quien lo escriba creerá que
 * concedió el sistema entero y no habrá concedido nada.
 *
 * Un perfil que miente hacia el lado seguro sigue siendo un perfil que miente:
 * quien lo arma se va tranquilo, y la persona a la que se lo pusieron descubre
 * que no puede hacer su trabajo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { can } = require('../../server/permissions');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const M = `guarda-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 23300000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}
const unNombre = (que) => `${que} ${unRut()} ${M}`;

/** Lo que quedó guardado en la base, ya como objeto. */
const loGuardado = (id) => {
  const fila = db.prepare('SELECT permisos FROM perfiles_permisos WHERE id = ?').get(id);
  try { return JSON.parse(fila.permisos || 'null'); } catch (e) { return fila.permisos; }
};

/* --------------------------------------------------------------------- */

test('LA QUE IMPORTA: el «*» que parece darlo todo no se guarda', async () => {
  /**
   * Es el que engaña. Los otros dos son ruido; este hace que alguien crea que
   * concedió el sistema entero.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil con asterisco'), estado: 'Activo',
    permisos: { '*': ['view', 'create', 'edit', 'delete'], miembros: ['view'] },
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));

  const guardado = loGuardado(r.json.id);
  assert.deepEqual(guardado, { miembros: ['view'] },
    'el «*» tenía que caerse, y lo que sí existe quedarse');
  assert.ok(!('*' in guardado));
});

test('y lo que queda es lo que el sistema mira de verdad', async () => {
  /**
   * La comprobación que cierra el punto: no basta con que la base quede
   * limpia, tiene que quedar limpia de manera que `can` conteste lo mismo que
   * dice la ficha.
   */
  const api = await elSistemaAndando();
  const perfil = (await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil que no engaña'), estado: 'Activo',
    permisos: { '*': ['view', 'create', 'edit', 'delete'] },
  })).json;

  const conEsePerfil = { rol: 'consulta', perfil_id: perfil.id };
  assert.equal(can(conEsePerfil, 'tesoreria', 'delete'), false,
    'el «*» nunca dio nada: ahora tampoco lo aparenta');
  assert.equal(loGuardado(perfil.id), null, 'y el perfil queda vacío, que es lo que es');
});

test('un módulo que no existe tampoco se guarda', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil con módulo inventado'), estado: 'Activo',
    permisos: { modulo_que_no_existe: ['view'], cuerpos: ['view', 'edit'] },
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.deepEqual(loGuardado(r.json.id), { cuerpos: ['view', 'edit'] });
});

test('ni una acción que no existe', async () => {
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil con acción inventada'), estado: 'Activo',
    permisos: { miembros: ['volar', 'view', 'edit'] },
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.deepEqual(loGuardado(r.json.id), { miembros: ['view', 'edit'] });
});

test('ni una acción que ESA llave no admite', async () => {
  /**
   * Las llaves del sistema no tienen las cuatro acciones: la de los datos de
   * salud solo se ve. Guardarle un «eliminar» sería otra vez decir algo que no
   * es.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil con llave de más'), estado: 'Activo',
    permisos: { miembros_salud: ['view', 'delete'] },
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.deepEqual(loGuardado(r.json.id), { miembros_salud: ['view'] });
});

/* --------------------------------------------------------------------- */
/* Las contracaras                                                        */
/* --------------------------------------------------------------------- */

test('LA CONTRACARA: un perfil de verdad se guarda entero, módulos y llaves', async () => {
  /**
   * Sin esta, «limpiar» se cumpliría borrándolo todo. Un perfil corriente
   * mezcla módulos y llaves del sistema, y las dos cosas tienen que quedar.
   */
  const api = await elSistemaAndando();
  const pedido = {
    miembros: ['view', 'edit'],
    tesoreria: ['view', 'create', 'edit', 'delete'],
    miembros_salud: ['view'],
    usuarios_clave: ['view'],
  };
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Tesorero de cuerpo'), estado: 'Activo', permisos: pedido,
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.deepEqual(loGuardado(r.json.id), pedido, 'lo pedido tiene que quedar tal cual');

  const conEsePerfil = { rol: 'consulta', perfil_id: r.json.id };
  assert.equal(can(conEsePerfil, 'tesoreria', 'delete'), true, 'y funcionar de verdad');
  assert.equal(can(conEsePerfil, 'miembros_salud', 'view'), true, 'las llaves también');
});

test('y un módulo con la lista vacía se guarda vacío, que es quitar', async () => {
  /**
   * «Ninguna acción» no es lo mismo que «no dice nada»: un perfil con
   * `miembros: []` le QUITA los miembros a quien lo lleve, aunque su rol se
   * los diera. Es la forma de recortar, y no se puede confundir con basura.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', {
    nombre: unNombre('Perfil que recorta'), estado: 'Activo',
    permisos: { miembros: [], tesoreria: ['view'] },
  });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.deepEqual(loGuardado(r.json.id), { miembros: [], tesoreria: ['view'] });

  const pastorConPerfil = { rol: 'pastor', perfil_id: r.json.id };
  assert.equal(can(pastorConPerfil, 'miembros', 'view'), false, 'el recorte tiene que seguir funcionando');
});

test('y editar un perfil viejo con basura adentro lo limpia, no lo bloquea', async () => {
  /**
   * Por qué se limpia en vez de negarse: los nombres de los módulos cambian
   * con los años. Negarse dejaría un perfil viejo imposible de volver a
   * guardar, y quien lo abriera a corregir un nombre se encontraría con un
   * aviso sobre algo que él no escribió.
   */
  const api = await elSistemaAndando();
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(unNombre('Perfil viejo'), JSON.stringify({ modulo_de_antes: ['view'], miembros: ['view'] })).lastInsertRowid);

  const r = await api('PUT', `/perfiles_permisos/${id}`,
    { ...(await api('GET', `/perfiles_permisos/${id}`)).json, descripcion: 'Se le corrige la descripción' });
  assert.equal(r.estado, 200, `tenía que poder guardarse: ${r.texto.slice(0, 200)}`);
  assert.deepEqual(loGuardado(id), { miembros: ['view'] }, 'y de paso queda limpio');
});

test('y uno cuyos permisos quedaron ilegibles tampoco se bloquea', async () => {
  /**
   * El otro caso del mismo motivo: si en la columna quedó algo que ni siquiera
   * es JSON —un arreglo hecho a mano, una importación a medias—, la ficha
   * tiene que poder seguir abriéndose y guardándose. El sistema ya trata esos
   * permisos como si no dijeran nada (ver `leerTabla` en permissions.js), así
   * que lo peligroso no es dejarlos: es dejar la ficha sin poder corregirse.
   */
  const api = await elSistemaAndando();
  const id = Number(db.prepare(
    "INSERT INTO perfiles_permisos (nombre, estado, permisos) VALUES (?, 'Activo', ?)"
  ).run(unNombre('Perfil ilegible'), 'esto no es json').lastInsertRowid);

  const r = await api('PUT', `/perfiles_permisos/${id}`,
    { ...(await api('GET', `/perfiles_permisos/${id}`)).json, descripcion: 'Se le corrige la descripción' });
  assert.equal(r.estado, 200, `tenía que poder guardarse: ${r.texto.slice(0, 200)}`);

  // Y mandándole de vuelta ese mismo texto ilegible —que es lo que haría una
  // integración vieja o un guardado a mano— tampoco se bloquea
  const tambien = await api('PUT', `/perfiles_permisos/${id}`,
    { ...(await api('GET', `/perfiles_permisos/${id}`)).json, permisos: 'esto tampoco es json' });
  assert.equal(tambien.estado, 200, `tenía que poder guardarse: ${tambien.texto.slice(0, 200)}`);

  // Un perfil ilegible no dice NADA, así que manda el rol: lo que puede esa
  // cuenta tiene que ser exactamente lo que podría sin perfil ninguno.
  const conElPerfil = { rol: 'consulta', perfil_id: id };
  const sinPerfil = { rol: 'consulta' };
  for (const [modulo, accion] of [['miembros', 'view'], ['miembros', 'delete'],
    ['tesoreria', 'view'], ['usuarios', 'view'], ['sistema_configuracion', 'edit']]) {
    assert.equal(can(conElPerfil, modulo, accion), can(sinPerfil, modulo, accion),
      `${modulo}:${accion} tendría que decidirlo el rol, como si no hubiera perfil`);
  }
});

test('un perfil sin permisos sigue pudiendo existir', async () => {
  /**
   * Un perfil recién creado, antes de marcarle nada, no es un error.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/perfiles_permisos', { nombre: unNombre('Perfil en blanco'), estado: 'Activo' });
  assert.equal(r.estado, 201, r.texto.slice(0, 200));
  assert.equal(loGuardado(r.json.id), null);
});
