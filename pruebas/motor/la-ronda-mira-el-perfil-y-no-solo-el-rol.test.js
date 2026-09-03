/**
 * LA PASADA DEL DÍA DECIDÍA POR EL ROL.
 *
 * El vigía arma su lista de a quién avisarle con una consulta a `usuarios`, y
 * ese objeto es el que reciben las trece revisiones. Todas preguntan
 * `can(usuario, …)`, y `can()` resuelve en tres escalones: las excepciones de
 * esa persona, después su perfil, y solo al final su rol. La consulta traía
 * «id, nombre, rol, activo, avisos, iglesias, cuerpos, iglesia_id» y nada más,
 * así que los dos primeros escalones no existían: contestaba siempre el rol.
 *
 * Medido antes de esto, en las dos direcciones:
 *
 *   consulta + perfil que le DA ayudas .... can() decía false · lo correcto era true
 *   pastor  + perfil que le QUITA fichas .. can() decía true  · lo correcto era false
 *
 * Que se traduce en: la encargada de las ayudas no se entera de la caja de
 * mercadería que una familia pidió hace tres meses, y el pastor al que se le
 * cerraron las fichas igual recibe nombres y apellidos en el teléfono.
 *
 * POR QUÉ NINGUNA PRUEBA LO VIO. Las nueve que llaman al vigía le pasan un
 * usuario ESCRITO A MANO, completo por casualidad. La única que pasa por
 * `pasada()` entera crea una cuenta de rol `admin`, y un administrador tiene
 * '*': ALL: un can() que decide por el rol contesta lo mismo que uno que decide
 * bien. Por eso acá se prueba con el usuario que arma `losQueEntran()`, que es
 * el que de verdad recorre la pasada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const vigia = require('../../server/avisos/vigia');
const { can } = require('../../server/permissions');

const IGLESIA = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del perfil','IG-PERF1','Activa')")
  .run().lastInsertRowid;

/*
 * Nombres y RUT irrepetibles: las pruebas del motor comparten UNA base y corren
 * en procesos paralelos, así que dos archivos con el mismo texto chocarían.
 */
const MARCA = `p${process.pid}`;
let cuantos = 0;
const rutNuevo = () => `${String(process.pid).slice(-6)}${String(++cuantos).padStart(2, '0')}-k`;

const perfilCon = (comoSeLlama, tabla) => db
  .prepare("INSERT INTO perfiles_permisos (nombre, permisos, estado) VALUES (?, ?, 'Activo')")
  .run(`${comoSeLlama} ${MARCA}`, JSON.stringify(tabla)).lastInsertRowid;

const cuentaCon = ({ rol, perfil_id = null, permisos = null }) => db
  .prepare(
    `INSERT INTO usuarios (rut, nombre, password, rol, perfil_id, permisos, activo, iglesia_id, iglesias)
     VALUES (?, ?, 'x', ?, ?, ?, 1, ?, ?)`
  )
  .run(rutNuevo(), `Cuenta ${MARCA}-${cuantos}`, rol, perfil_id, permisos, IGLESIA, `[${IGLESIA}]`)
  .lastInsertRowid;

/** El usuario TAL COMO lo arma la pasada del día. */
const comoLoVeLaRonda = (id) => vigia.losQueEntran().find((u) => Number(u.id) === Number(id));

/* ------------------------------------------------- la consulta que lo causaba */

test('la lista de la pasada trae los permisos propios y el perfil', () => {
  const quien = cuentaCon({ rol: 'consulta' });
  const suyo = comoLoVeLaRonda(quien);
  assert.ok(suyo, 'la cuenta activa tiene que estar en la lista');
  assert.ok('permisos' in suyo, 'sin «permisos», can() se salta las excepciones de esta persona');
  assert.ok('perfil_id' in suyo, 'sin «perfil_id», can() se salta el perfil que tenga puesto');
});

test('y sigue trayendo lo que el alcance necesita', () => {
  const quien = cuentaCon({ rol: 'consulta' });
  const suyo = comoLoVeLaRonda(quien);
  for (const columna of ['id', 'nombre', 'rol', 'avisos', 'iglesias', 'cuerpos', 'iglesia_id']) {
    assert.ok(columna in suyo, `«${columna}» hace falta y se cayó de la consulta`);
  }
});

test('la desactivada no entra: a quien no puede entrar no se le avisa', () => {
  const quien = cuentaCon({ rol: 'consulta' });
  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(quien);
  assert.equal(comoLoVeLaRonda(quien), undefined);
});

/* ------------------------------------------------- lo que el perfil concede */

test('un perfil que CONCEDE un módulo se respeta en la pasada', () => {
  /*
   * El rol «consulta» tiene las ayudas sociales cerradas (ver permissions.js,
   * punto 1.203.0). El perfil se las devuelve, y el vigía tiene que verlo.
   */
  const perfil = perfilCon('Encargada de ayudas', { ayudas_sociales: ['view', 'edit'] });
  const quien = cuentaCon({ rol: 'consulta', perfil_id: perfil });

  assert.equal(can({ rol: 'consulta' }, 'ayudas_sociales', 'view'), false, 'el rol solo, no');
  assert.equal(can(comoLoVeLaRonda(quien), 'ayudas_sociales', 'view'), true,
    'con el perfil puesto, la pasada tiene que decir que sí');
});

test('y una excepción propia también, que es como el sistema dice que se hace', () => {
  /*
   * «Quien de verdad la necesite la recibe por su nombre: en Usuarios,
   * "Excepciones para esta persona" le devuelve el módulo sin abrírselo al
   * resto del rol». Lo dice server/permissions.js. Si la pasada no las mira,
   * esa recomendación no sirve para los avisos.
   */
  const quien = cuentaCon({ rol: 'consulta', permisos: JSON.stringify({ ayudas_sociales: ['view'] }) });
  assert.equal(can(comoLoVeLaRonda(quien), 'ayudas_sociales', 'view'), true);
});

/* ------------------------------------------------- lo que el perfil quita */

test('un perfil que QUITA un módulo también manda, aunque el rol lo dé', () => {
  const perfil = perfilCon('Pastor sin fichas', { miembros: [] });
  const quien = cuentaCon({ rol: 'pastor', perfil_id: perfil });

  assert.equal(can({ rol: 'pastor' }, 'miembros', 'view'), true, 'el rol solo, sí');
  assert.equal(can(comoLoVeLaRonda(quien), 'miembros', 'view'), false,
    'con el perfil que se lo quitó, la pasada no puede seguir diciendo que sí');
});

test('y la revisión se calla de verdad: no arma el aviso con el nombre adentro', () => {
  /*
   * Ésta es la consecuencia que importa: no que `can()` conteste distinto, sino
   * que el aviso con nombre y apellido deje de armarse. Se prueba con la
   * revisión de las ayudas, que nombra al beneficiario en el cuerpo del aviso.
   *
   * (Se usa ésta y no la de los que cumplieron dieciocho, aunque aquélla era la
   * medida en el informe: las pruebas del motor comparten UNA base, y hay un
   * archivo que llama a `cumplieronLaMayoria` con un administrador sin iglesias
   * —que ve la base entera— y cuenta cuántos salen. Una ficha de menor dejada
   * acá le cambiaría la cuenta a ese archivo, en otro proceso.)
   */
  const perfil = perfilCon('Pastor sin ayudas', { ayudas_sociales: [] });
  const conAyudas = cuentaCon({ rol: 'pastor' });
  const sinAyudas = cuentaCon({ rol: 'pastor', perfil_id: perfil });

  db.prepare(
    `INSERT INTO ayudas_sociales (fecha, tipo_ayuda, beneficiario, estado, iglesia_id)
     VALUES (date('now','localtime','-120 days'), 'Mercadería', ?, 'Solicitada', ?)`
  ).run(`Quien Espera ${MARCA}`, IGLESIA);

  const loQueLeToca = (id) => {
    const salida = [];
    vigia.ayudasSinEntregar(comoLoVeLaRonda(id), (aviso) => salida.push(aviso));
    return salida;
  };

  const alQueSi = loQueLeToca(conAyudas);
  assert.equal(alQueSi.length, 1, 'a quien sí lleva las ayudas se le avisa');
  assert.match(alQueSi[0].cuerpo, new RegExp(`Quien Espera ${MARCA}`), 'y el aviso nombra a la persona');

  assert.deepEqual(loQueLeToca(sinAyudas), [],
    'a quien el perfil se las cerró no se le manda el nombre de nadie');
});

/* ------------------------------------------------- y la pasada entera */

test('la pasada del día completa respeta el perfil, no solo la revisión suelta', () => {
  /*
   * Las nueve pruebas que llamaban al vigía lo hacían con una revisión suelta y
   * un usuario escrito a mano, y la única que pasaba por `pasada()` entera
   * creaba una cuenta de rol `admin` —que tiene '*': ALL—. Con un
   * administrador, un can() que decide por el rol contesta lo mismo que uno que
   * decide bien, así que el hueco no tenía cómo salir. Ésta pasa por la pasada
   * entera y con una cuenta que NO es administradora.
   *
   * El empujón al teléfono se desconecta antes: no hay a quién mandarle nada y
   * cada archivo de prueba corre en su propio proceso, así que esto no le toca
   * el navegador a nadie más.
   */
  const navegador = require('../../server/avisos/navegador');
  const comoEra = navegador.empujar;
  navegador.empujar = async () => ({ mandados: 0, borrados: 0, fallados: 0, porque: null });

  try {
    const perfil = perfilCon('Encargada de ayudas de la pasada', { ayudas_sociales: ['view'] });
    const quien = cuentaCon({ rol: 'consulta', perfil_id: perfil });
    db.prepare(
      `INSERT INTO ayudas_sociales (fecha, tipo_ayuda, beneficiario, estado, iglesia_id)
       VALUES (date('now','localtime','-120 days'), 'Mercadería', ?, 'Solicitada', ?)`
    ).run(`Quien Espera En La Pasada ${MARCA}`, IGLESIA);

    vigia.pasada();

    const suyos = db
      .prepare("SELECT tipo FROM notificaciones WHERE usuario_id = ? AND tipo = 'ayuda_sin_entregar'")
      .all(quien);
    assert.equal(suyos.length, 1,
      'con el perfil puesto, la pasada entera tiene que dejarle el aviso de la ayuda');
  } finally {
    navegador.empujar = comoEra;
  }
});

test('la llave del respaldo concedida a mano hace llegar su aviso', () => {
  /*
   * El caso que el propio comentario de `respaldoYDisco` dice haber arreglado:
   * a quien se le concede «Respaldos del sistema» sin ser administrador de todo
   * no le llegaba el aviso de que la copia está atrasada. Se arregló mirando la
   * llave en vez del rol, pero el usuario que llegaba a esa comprobación venía
   * sin permisos ni perfil, así que seguía decidiendo el rol.
   */
  const quien = cuentaCon({ rol: 'consulta', permisos: JSON.stringify({ sistema_respaldo: ['view'] }) });
  assert.equal(can({ rol: 'consulta' }, 'sistema_respaldo', 'view'), false);
  assert.equal(can(comoLoVeLaRonda(quien), 'sistema_respaldo', 'view'), true);
});
