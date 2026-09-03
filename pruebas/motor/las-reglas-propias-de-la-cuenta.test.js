/**
 * Las reglas propias de la cuenta de usuario, andando de verdad.
 *
 * El módulo de Usuarios lleva ocho reglas escritas a mano en sus ganchos, y en
 * la revisión de la v1.316.0 ninguna tenía una prueba. Se comprobó de la única
 * manera que sirve: borrando la línea de cada regla y volviendo a correr la
 * suite entera —motor, seguridad y aislamiento—. Las ocho salieron verdes con
 * la regla borrada.
 *
 * Eso no quiere decir que estuvieran mal escritas: se comprobaron a mano una
 * por una y las ocho hacían lo suyo. Quiere decir que nadie se iba a enterar el
 * día que se rompieran. Y son las reglas del módulo donde el dato ES el
 * permiso: la que impide borrar la propia cuenta, la que evita que dos personas
 * queden colgando de la misma ficha, la que mantiene el RUT igual en los dos
 * lados.
 *
 * ACÁ SE PRUEBAN CONTRA EL SISTEMA ANDANDO, con peticiones HTTP como las del
 * navegador, y no llamando al gancho a mano. Es la diferencia entre «la regla
 * está escrita» y «el motor la corre»: una regla escrita y desconectada pasa
 * todas las pruebas que la llaman directo (ver la cabecera de andando.js).
 *
 * Cada una va con su contracara: al lado de lo que la regla tiene que impedir,
 * lo que tiene que seguir dejando pasar. Una regla sin contracara se «arregla»
 * negándolo todo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/usuarios');
const { digitoVerificador } = require('../../server/rut');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

/*
 * Los archivos del motor corren en paralelo sobre una sola base, así que todo
 * lo que se cree acá lleva la marca de este proceso y ninguna prueba cuenta
 * «los que haya».
 */
const M = `cuenta-${process.pid}`;
let siguiente = 0;
function unRut() {
  const n = 21500000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/** Una iglesia de esta prueba, con su cuerpo dentro si se pide. */
async function unaIglesia(api, comoSeLlama) {
  const r = await api('POST', '/iglesias', {
    nombre: `Iglesia ${comoSeLlama} ${M}`,
    codigo: `${comoSeLlama.slice(0, 3).toUpperCase()}${process.pid}${siguiente++}`,
    estado: 'Activa',
  });
  assert.equal(r.estado, 201, `guardia: la iglesia tiene que entrar: ${r.texto.slice(0, 200)}`);
  return r.json;
}

async function unCuerpo(api, iglesia, comoSeLlama) {
  const r = await api('POST', '/cuerpos', {
    nombre: `${comoSeLlama} ${M}`, tipo: 'Cuerpo', iglesia_id: iglesia.id, estado: 'Activo',
  });
  assert.equal(r.estado, 201, `guardia: el cuerpo tiene que entrar: ${r.texto.slice(0, 200)}`);
  return r.json;
}

async function unMiembro(api, iglesia, { nombres, apellidos, rut = null }) {
  const r = await api('POST', '/miembros', {
    nombres, apellidos: `${apellidos} ${M}`, iglesia_id: iglesia.id, estado: 'Activo', rut,
  });
  assert.equal(r.estado, 201, `guardia: la ficha tiene que entrar: ${r.texto.slice(0, 200)}`);
  return r.json;
}

async function unaCuenta(api, datos) {
  const r = await api('POST', '/usuarios', { rut: unRut(), rol: 'consulta', ...datos });
  assert.equal(r.estado, 201, `guardia: la cuenta tiene que entrar: ${r.texto.slice(0, 300)}`);
  return r.json;
}

/* --------------------------------------------------------------------- */
/* 1 · No puede eliminar su propio usuario                                */
/* --------------------------------------------------------------------- */

/**
 * Es la promesa más vieja de la cabecera del módulo, y la que más se parece a
 * un accidente de verdad: quien administra las cuentas está borrando las de
 * quienes se fueron, y una de las de la lista es la suya.
 *
 * Sin la regla no queda un aviso ni una manera de deshacerlo: la sesión sigue
 * abierta con un pase firmado para un usuario que ya no existe, y al cerrarla
 * no se puede volver a entrar.
 */
test('LA QUE IMPORTA: nadie borra su propia cuenta', async () => {
  const api = await elSistemaAndando();
  const ella = await unaCuenta(api, {
    nombre: `Quien administra ${M}`, rol: 'admin', email: `propia.${process.pid}@ipt.cl`,
  });
  /*
   * La cuenta recién creada arrastra «debe cambiar la contraseña», y con eso el
   * sistema le contesta 403 a TODO hasta que la cambie —lo comprobó esta misma
   * prueba al escribirse: el primer intento recibió «Antes de seguir, cambie su
   * contraseña por una suya»—. Acá se está probando otra cosa, así que se le da
   * por cambiada y se sigue.
   */
  db.prepare('UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?').run(ella.id);
  const suya = comoOtroUsuario(ella.id);

  const r = await suya('DELETE', `/usuarios/${ella.id}`);
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /su propio usuario/);

  assert.equal((await api('GET', `/usuarios/${ella.id}`)).estado, 200, 'la cuenta tiene que seguir ahí');
});

test('y la de otro sí, que para eso está el permiso', async () => {
  const api = await elSistemaAndando();
  const quienSeVa = await unaCuenta(api, { nombre: `Quien se va ${M}` });
  const r = await api('DELETE', `/usuarios/${quienSeVa.id}`);
  assert.equal(r.estado, 200, `la contracara: borrar otra cuenta tiene que poder: ${r.texto.slice(0, 200)}`);
  assert.equal((await api('GET', `/usuarios/${quienSeVa.id}`)).estado, 404);
});

/* --------------------------------------------------------------------- */
/* 2 · La iglesia principal, entre las que administra                     */
/* --------------------------------------------------------------------- */

/**
 * La principal es «con cuál trabaja por omisión»: la que se propone al crear
 * registros. Puesta fuera de las asignadas, la persona escribiría cada registro
 * nuevo en una iglesia que no alcanza, y al guardarlo el alcance se lo negaría
 * sin que se entienda por qué.
 */
test('la iglesia principal tiene que ser una de las que administra', async () => {
  const api = await elSistemaAndando();
  const suya = await unaIglesia(api, 'Central');
  const ajena = await unaIglesia(api, 'Vecina');

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Principal ajena ${M}`, rol: 'secretario',
    iglesias: [suya.id], iglesia_id: ajena.id,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /iglesia principal/);
  assert.match(r.json.error, new RegExp(`Iglesia Vecina ${M}`), 'y dice cuál es la que sobra');
});

test('y estando entre ellas, entra', async () => {
  const api = await elSistemaAndando();
  const una = await unaIglesia(api, 'Norte');
  const otra = await unaIglesia(api, 'Sur');
  const cuenta = await unaCuenta(api, {
    nombre: `Principal buena ${M}`, rol: 'secretario', iglesias: [una.id, otra.id], iglesia_id: otra.id,
  });
  assert.equal(Number(cuenta.iglesia_id), otra.id);
});

test('con una sola iglesia asignada, esa queda de principal sin repetirla', async () => {
  /**
   * La comodidad que hace que la regla de arriba no moleste: el caso normal
   * —una persona, una iglesia— no obliga a decir dos veces lo mismo.
   */
  const api = await elSistemaAndando();
  const unica = await unaIglesia(api, 'Unica');
  const cuenta = await unaCuenta(api, {
    nombre: `Una sola ${M}`, rol: 'secretario', iglesias: [unica.id],
  });
  assert.equal(Number(cuenta.iglesia_id), unica.id, 'la única asignada tiene que haber quedado de principal');
});

/* --------------------------------------------------------------------- */
/* 3 · Los cuerpos, de sus iglesias                                       */
/* --------------------------------------------------------------------- */

/**
 * Marcar cuerpos ACHICA lo que la persona ve: dentro de sus iglesias, solo lo
 * de esos cuerpos. Un cuerpo de otra iglesia no le abre nada —el alcance mira
 * primero la iglesia— pero deja la ficha diciendo algo que no es cierto, y al
 * agregarle después esa iglesia sí se lo abriría sin que nadie lo decidiera.
 */
test('un cuerpo de otra iglesia no se le puede asignar', async () => {
  const api = await elSistemaAndando();
  const suya = await unaIglesia(api, 'Propia');
  const ajena = await unaIglesia(api, 'Ajena');
  const deAfuera = await unCuerpo(api, ajena, 'Coro de afuera');

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Cuerpo ajeno ${M}`, rol: 'secretario',
    iglesias: [suya.id], cuerpos: [deAfuera.id],
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, new RegExp(`Coro de afuera ${M}`), 'y dice cuál cuerpo es');
  assert.match(r.json.error, /no pertenece a las iglesias/);
});

test('y uno de las suyas sí', async () => {
  const api = await elSistemaAndando();
  const suya = await unaIglesia(api, 'Dentro');
  const dedentro = await unCuerpo(api, suya, 'Damas de dentro');
  const cuenta = await unaCuenta(api, {
    nombre: `Cuerpo propio ${M}`, rol: 'secretario', iglesias: [suya.id], cuerpos: [dedentro.id],
  });
  const guardados = db.prepare('SELECT cuerpos FROM usuarios WHERE id = ?').get(cuenta.id).cuerpos;
  assert.deepEqual(JSON.parse(guardados || '[]').map(Number), [dedentro.id]);
});

/* --------------------------------------------------------------------- */
/* 4 · El RUT y la ficha de miembro                                       */
/* --------------------------------------------------------------------- */

/**
 * Enlazadas las dos fichas, el sistema las trata como una sola persona: el RUT,
 * el correo, el teléfono y la foto se mantienen iguales en los dos lados. Si al
 * enlazar los RUT no coinciden, entonces no son la misma persona, y dejarlo
 * pasar significa que el primer guardado le pisa el RUT a alguien.
 */
test('no se enlaza una cuenta con la ficha de otra persona', async () => {
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'Enlace');
  const rutDeElla = unRut();
  const ella = await unMiembro(api, igl, { nombres: 'Fernanda', apellidos: 'Riquelme', rut: rutDeElla });

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `RUT distinto ${M}`, rol: 'consulta', miembro_id: ella.id,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /no coincide con el de su ficha de miembro/);
  assert.match(r.json.error, new RegExp(rutDeElla), 'y muestra el RUT de la ficha, para saber cuál corregir');

  const suRut = db.prepare('SELECT rut FROM miembros WHERE id = ?').get(ella.id).rut;
  assert.equal(suRut, rutDeElla, 'y el de la ficha no se tocó');
});

test('con el mismo RUT sí, y el nombre lo pone la ficha de miembro', async () => {
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'Mismo');
  const rut = unRut();
  await unMiembro(api, igl, { nombres: 'Ana María', apellidos: 'Cortés', rut });

  const cuenta = await unaCuenta(api, { rut, nombre: 'Como sea que se llame', rol: 'consulta' });
  assert.equal(cuenta.nombre, `Ana María Cortés ${M}`,
    'el nombre se escribe en Miembros, que es donde va separado en nombres y apellidos');
  assert.ok(cuenta.miembro_id, 'y con el mismo RUT el sistema reconoce la ficha sola, sin que se lo digan');
});

test('la ficha que no existe no entra, y el motor lo dice antes de llegar a la regla', async () => {
  /*
   * Acá contesta el motor y no el gancho: `miembro_id` es una referencia, y las
   * referencias rotas se revisan antes de los ganchos del módulo. La regla del
   * módulo —«La ficha de miembro indicada no existe»— queda de segunda barrera
   * para cuando se llame al gancho por fuera del motor. Lo que importa para
   * quien usa el sistema es que no entre, y no entra.
   */
  const api = await elSistemaAndando();
  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Ficha fantasma ${M}`, rol: 'consulta', miembro_id: 99000000,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /no existe/i);

  const fantasmas = db.prepare('SELECT COUNT(*) AS c FROM usuarios WHERE nombre = ?')
    .get(`Ficha fantasma ${M}`).c;
  assert.equal(fantasmas, 0);
});

/* --------------------------------------------------------------------- */
/* 5 · Una ficha de miembro, una cuenta                                   */
/* --------------------------------------------------------------------- */

/**
 * Dos cuentas colgando de la misma ficha es el peor de los enredos silenciosos
 * de este módulo: las dos le escriben el RUT y el correo a la misma persona, la
 * última en guardar gana, y la ficha termina con los datos de contacto de
 * cualquiera de las dos sin que nada lo diga.
 */
test('una ficha de miembro no puede tener dos cuentas', async () => {
  /*
   * PARA LLEGAR A ESTA REGLA HAY QUE PASAR PRIMERO POR LA DE ARRIBA, y eso se
   * descubrió acá: con la ficha teniendo RUT, la segunda cuenta nunca alcanza
   * esta comprobación —contesta antes «el RUT no coincide», porque en Usuarios
   * el RUT no se repite y la segunda tiene por fuerza otro—. La ficha queda con
   * RUT sola: al enlazar la primera cuenta, el enlace se lo copia.
   *
   * Así que el caso que sí llega es el de una ficha SIN RUT, que es además el
   * que se ve: fichas viejas cargadas antes de que el RUT se pidiera, y fichas
   * a las que alguien se lo borró.
   */
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'Doble');
  const persona = await unMiembro(api, igl, { nombres: 'Rodrigo', apellidos: 'Peña' });

  const primera = await unaCuenta(api, { nombre: `Primera ${M}`, rol: 'consulta', miembro_id: persona.id });
  assert.equal(Number(primera.miembro_id), persona.id, 'guardia: la primera quedó enlazada');
  db.prepare('UPDATE miembros SET rut = NULL WHERE id = ?').run(persona.id);

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Segunda ${M}`, rol: 'consulta', miembro_id: persona.id,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /ya está enlazada al usuario/);
  assert.match(r.json.error, new RegExp(`Rodrigo Peña ${M}`), 'y dice a cuál, para ir a buscarla');
});

test('pero la que ya está enlazada se puede volver a guardar', async () => {
  /**
   * La contracara que hace falta: la regla mira «otra cuenta que no sea esta»,
   * y sin ese detalle nadie podría corregirle el teléfono a una cuenta
   * enlazada, porque se chocaría consigo misma.
   */
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'Regrabada');
  const rut = unRut();
  await unMiembro(api, igl, { nombres: 'Sofía', apellidos: 'Alarcón', rut });
  const cuenta = await unaCuenta(api, { rut, nombre: `Regrabada ${M}`, rol: 'consulta' });

  const r = await api('PUT', `/usuarios/${cuenta.id}`, { ...cuenta, telefono: '+56922223333' });
  assert.equal(r.estado, 200, `guardarla de nuevo tiene que poder: ${r.texto.slice(0, 200)}`);
  assert.equal(r.json.telefono, '+56922223333');
});

/* --------------------------------------------------------------------- */
/* 6 · El correo, uno por cuenta                                          */
/* --------------------------------------------------------------------- */

/**
 * El correo es dato de contacto y no la llave de entrada —esa es el RUT—, pero
 * es por donde salen los avisos y por donde se responde. Repetido en dos
 * cuentas, los avisos de las dos llegan al mismo buzón y quien lo abre no sabe
 * de cuál de las dos son.
 */
test('dos cuentas no pueden tener el mismo correo', async () => {
  const api = await elSistemaAndando();
  const correo = `repetido.${process.pid}@ipt.cl`;
  await unaCuenta(api, { nombre: `Primera del correo ${M}`, email: correo });

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Segunda del correo ${M}`, rol: 'consulta', email: correo,
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /correo electrónico/);
});

test('ni escribiéndolo en mayúsculas: el correo se guarda a la baja', async () => {
  /**
   * Sin esto la regla se rodea sin querer. Nadie escribe «PEDRO@…» a propósito
   * para colarse: el teclado del teléfono pone la primera letra en mayúscula
   * solo, y el sistema tendría dos cuentas con el mismo correo.
   */
  const api = await elSistemaAndando();
  const correo = `mayusculas.${process.pid}@ipt.cl`;
  const primera = await unaCuenta(api, { nombre: `Minúsculas ${M}`, email: `  ${correo.toUpperCase()}  ` });
  assert.equal(primera.email, correo, 'se guarda recortado y en minúsculas');

  const r = await api('POST', '/usuarios', {
    rut: unRut(), nombre: `Mayúsculas ${M}`, rol: 'consulta', email: correo.toUpperCase(),
  });
  assert.equal(r.estado, 400, `se esperaba un aviso y llegó ${r.estado}: ${r.texto.slice(0, 200)}`);
  assert.match(r.json.error, /correo electrónico/);
});

test('y dos cuentas sin correo conviven, que es lo normal', async () => {
  const api = await elSistemaAndando();
  const una = await unaCuenta(api, { nombre: `Sin correo A ${M}` });
  const otra = await unaCuenta(api, { nombre: `Sin correo B ${M}` });
  assert.ok(una.id && otra.id && una.id !== otra.id);
});

/* --------------------------------------------------------------------- */
/* 7 · Lo que cambia acá, cambia en su ficha de miembro                   */
/* --------------------------------------------------------------------- */

/**
 * La otra mitad del enlace. Sin esta regla el enlace sería un adorno: se
 * corrige el correo en la cuenta, la ficha de miembro sigue con el viejo, y el
 * día que alguien mande una carta desde Miembros la manda al que ya no sirve.
 */
test('corregido el correo y el teléfono en la cuenta, la ficha de miembro los tiene', async () => {
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'Reflejo');
  const rut = unRut();
  const persona = await unMiembro(api, igl, { nombres: 'Elena', apellidos: 'Muñoz', rut });
  const cuenta = await unaCuenta(api, { rut, nombre: `Reflejo ${M}`, rol: 'consulta' });

  const antes = db.prepare('SELECT email, telefono FROM miembros WHERE id = ?').get(persona.id);
  assert.ok(!antes.email, 'guardia: la ficha parte sin correo');

  const r = await api('PUT', `/usuarios/${cuenta.id}`, {
    ...cuenta, email: `elena.${process.pid}@ipt.cl`, telefono: '+56933334444',
  });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  const ahora = db.prepare('SELECT email, telefono FROM miembros WHERE id = ?').get(persona.id);
  assert.equal(ahora.email, `elena.${process.pid}@ipt.cl`);
  assert.equal(ahora.telefono, '+56933334444');
});

test('y el RUT corregido en la cuenta también le llega a su ficha', async () => {
  const api = await elSistemaAndando();
  const igl = await unaIglesia(api, 'RutReflejo');
  const rut = unRut();
  const persona = await unMiembro(api, igl, { nombres: 'Camilo', apellidos: 'Bravo', rut });
  const cuenta = await unaCuenta(api, { rut, nombre: `Rut reflejo ${M}`, rol: 'consulta' });

  const corregido = unRut();
  const r = await api('PUT', `/usuarios/${cuenta.id}`, { ...cuenta, rut: corregido });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(db.prepare('SELECT rut FROM miembros WHERE id = ?').get(persona.id).rut, corregido);
});

test('la foto también, que es el otro dato que comparten', () => {
  /*
   * Esta va contra el gancho y no contra el sistema andando por una razón
   * concreta: `foto` es un archivo, y el motor comprueba que el archivo exista
   * antes de guardar. Subir una foto de verdad para comprobar una copia de un
   * campo sería probar otra cosa. Las tres de arriba ya dejan demostrado que el
   * motor corre este gancho; acá se comprueba que la lista de datos que copia
   * incluye la foto.
   */
  const igl = db.prepare('SELECT id FROM iglesias LIMIT 1').get();
  const persona = Number(db.prepare(
    "INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')"
  ).run('Retrato', `Copiado ${M}`, igl ? igl.id : null).lastInsertRowid);

  def.hooks.afterSave({ id: 0, miembro_id: persona, foto: 'retrato-de-prueba.jpg' }, { db });
  assert.equal(db.prepare('SELECT foto FROM miembros WHERE id = ?').get(persona).foto, 'retrato-de-prueba.jpg');

  db.prepare('DELETE FROM miembros WHERE id = ?').run(persona);
});

test('y una cuenta sin ficha enlazada no le escribe a nadie', async () => {
  /**
   * La contracara: la mayoría de las cuentas del sistema no están enlazadas a
   * ninguna ficha, y guardarlas no tiene que tocar la tabla de Miembros.
   */
  const api = await elSistemaAndando();
  const cuenta = await unaCuenta(api, { nombre: `Suelta ${M}` });
  assert.ok(!cuenta.miembro_id, 'guardia: esta no está enlazada');

  const cuantos = () => db.prepare('SELECT COUNT(*) AS c FROM miembros WHERE email = ?')
    .get(`suelta.${process.pid}@ipt.cl`).c;
  assert.equal(cuantos(), 0);
  const r = await api('PUT', `/usuarios/${cuenta.id}`, { ...cuenta, email: `suelta.${process.pid}@ipt.cl` });
  assert.equal(r.estado, 200, r.texto.slice(0, 200));
  assert.equal(cuantos(), 0, 'no hay ninguna ficha a la que copiárselo');
});
