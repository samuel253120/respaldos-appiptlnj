/**
 * El sistema no se queda sin administrador, por ninguna de las tres puertas.
 *
 * La cabecera del módulo de Usuarios lo promete entre las cuatro cosas que dice
 * de sí mismo: «No se puede eliminar el propio usuario ni el último
 * administrador». Y era verdad para ELIMINAR.
 *
 * MEDIDO EN LA v1.316.0, sobre una base con un solo administrador:
 *
 *   borrarle la cuenta     🛑 «No se puede eliminar el último administrador»
 *   desactivarla           pasa, sin decir nada
 *   bajarle el rol         pasa, sin decir nada
 *
 * Y DESACTIVAR ES PEOR QUE BORRAR. Sin administrador activo no queda nadie con
 * permiso sobre Usuarios, así que nadie puede volver a activarlo desde el
 * sistema: la única salida es entrar a la base de datos por fuera. Borrar la
 * cuenta, en cambio, al menos dejaría crear otra si alguien más tuviera el
 * permiso.
 *
 * No hace falta mala intención. Una secretaria dando de baja a un pastor que se
 * trasladó, sin fijarse en que esa cuenta era la última con rol de
 * administrador, deja la iglesia encerrada fuera de su propio sistema.
 *
 * ESTE SE NIEGA EN VEZ DE PREGUNTAR, al revés que el aviso de las solicitudes
 * abiertas que está al lado. Allá hay un caso legítimo que confirmar —quien
 * deja la iglesia tiene que perder el acceso hoy, no cuando alguien reparta sus
 * trámites— y acá no hay ninguno: un sistema sin administrador no es una
 * decisión que alguien quiera tomar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/usuarios');
const { digitoVerificador } = require('../../server/rut');

let siguiente = 0;
function unRut() {
  const n = 21300000 + (process.pid % 700) * 100 + (siguiente++ % 100);
  return `${n}-${digitoVerificador(String(n))}`;
}

/**
 * Una base con EXACTAMENTE los administradores que se pidan.
 *
 * Los archivos del motor comparten una sola base y corren en paralelo, así que
 * contar administradores «los que haya» no diría nada: se apagan los que estén
 * y se dejan los de esta prueba, dentro de una transacción que se deshace al
 * terminar.
 */
function conSoloEstosAdministradores(cuantos, hacer) {
  const apagados = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = 1").all();
  const apagar = db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?');
  const encender = db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?');
  for (const u of apagados) apagar.run(u.id);

  const mios = [];
  for (let i = 0; i < cuantos; i++) {
    const rut = unRut();
    const id = Number(db.prepare(
      "INSERT INTO usuarios (rut, nombre, rol, activo) VALUES (?, ?, 'admin', 1)"
    ).run(rut, `Administrador ${rut}`, ).lastInsertRowid);
    mios.push(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
  }
  try {
    return hacer(mios);
  } finally {
    for (const m of mios) db.prepare('DELETE FROM usuarios WHERE id = ?').run(m.id);
    for (const u of apagados) encender.run(u.id);
  }
}

/** El aviso que devuelva el gancho, o null. */
const alGuardar = (fila, cambio) =>
  def.hooks.beforeSave(cambio, { isNew: false, id: fila.id, existing: fila, db, user: { id: fila.id + 9999 } });
const alBorrar = (fila) => def.hooks.beforeDelete(fila, { user: { id: fila.id + 9999 }, db });

/* --------------------------------------------------------------------- */
/* Las tres puertas, con un solo administrador                            */
/* --------------------------------------------------------------------- */

test('LA QUE FALTABA: al último administrador no se le puede desactivar la cuenta', () => {
  conSoloEstosAdministradores(1, ([unico]) => {
    const aviso = alGuardar(unico, { activo: 0 });
    assert.ok(typeof aviso === 'string', `se esperaba un aviso y llegó ${JSON.stringify(aviso)}`);
    assert.match(aviso, /último administrador activo/);
    assert.match(aviso, /desactivar su cuenta/);
  });
});

test('LA OTRA QUE FALTABA: ni bajarle el rol', () => {
  conSoloEstosAdministradores(1, ([unico]) => {
    for (const rol of ['consulta', 'secretario', 'pastor', 'tesorero']) {
      const aviso = alGuardar(unico, { rol });
      assert.ok(typeof aviso === 'string', `bajarlo a ${rol} tendría que frenarse`);
      assert.match(aviso, /cambiarle el rol/);
    }
  });
});

test('y la que ya estaba: tampoco borrarle la cuenta', () => {
  conSoloEstosAdministradores(1, ([unico]) => {
    const aviso = alBorrar(unico);
    assert.ok(typeof aviso === 'string');
    assert.match(aviso, /último administrador activo/);
    assert.match(aviso, /eliminar su cuenta/);
  });
});

test('las tres dan el MISMO aviso, que dice por qué no se puede deshacer', () => {
  /**
   * Es lo que distingue este caso de todos los demás avisos del sistema: no es
   * «esto no se puede», es «esto no se puede DESHACER». Quien lo lea tiene que
   * entender por qué antes de buscar la manera de forzarlo.
   */
  conSoloEstosAdministradores(1, ([unico]) => {
    for (const aviso of [alGuardar(unico, { activo: 0 }), alGuardar(unico, { rol: 'consulta' }), alBorrar(unico)]) {
      assert.match(aviso, /Nadie podría volver a entrar a administrar cuentas/);
      assert.match(aviso, /Nombre antes a otra persona como administradora/, 'dice qué hacer en su lugar');
      assert.match(aviso, /último administrador activo/);
    }
  });
});

/* --------------------------------------------------------------------- */
/* Y con dos, las tres se pueden: la regla no estorba                     */
/* --------------------------------------------------------------------- */

test('con DOS administradores, las tres puertas se abren', () => {
  /**
   * La otra mitad, y la que hace que el arreglo no cambie un problema por otro.
   * Dar de baja a un administrador que se fue de la iglesia es lo corriente, y
   * tiene que poder hacerse mientras quede otro.
   */
  conSoloEstosAdministradores(2, ([uno]) => {
    assert.equal(alGuardar(uno, { activo: 0 }), null, 'desactivarlo');
    assert.equal(alGuardar(uno, { rol: 'consulta' }), null, 'bajarle el rol');
    assert.equal(alBorrar(uno), null, 'borrarlo');
  });
});

test('lo que se cuenta es lo que QUEDARÍA, no lo que hay', () => {
  /**
   * Es la diferencia que hacía que la regla vieja mirara mal: contaba los
   * administradores de ahora, y lo que deja al sistema sin ninguno es el número
   * de DESPUÉS.
   */
  conSoloEstosAdministradores(2, ([uno, dos]) => {
    // Se apaga el segundo por fuera: ahora el primero es el único que queda
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(dos.id);
    const aviso = alGuardar(uno, { activo: 0 });
    assert.ok(typeof aviso === 'string',
      'con el otro ya apagado, este pasa a ser el último y no se puede desactivar');
    db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(dos.id);
  });
});

test('un administrador que YA estaba desactivado no cuenta como el último', () => {
  conSoloEstosAdministradores(1, ([unico]) => {
    const apagado = { ...unico, activo: 0 };
    // Ya no era administrador activo: cambiarle cualquier cosa no deja al
    // sistema peor de lo que estaba
    assert.equal(alGuardar(apagado, { rol: 'consulta' }), null);
    assert.equal(alBorrar(apagado), null);
  });
});

/* --------------------------------------------------------------------- */
/* Lo que la regla NO toca                                                */
/* --------------------------------------------------------------------- */

test('al último administrador se le sigue pudiendo corregir el resto de la ficha', () => {
  conSoloEstosAdministradores(1, ([unico]) => {
    assert.equal(alGuardar(unico, { telefono: '+56911112233' }), null);
    assert.equal(alGuardar(unico, { email: `correo${process.pid}@ejemplo.cl` }), null);
  });
});

test('y guardar su ficha entera sin cambiarle el rol ni el estado tampoco protesta', () => {
  /**
   * El formulario manda la ficha completa en cada guardado, así que la regla
   * tiene que mirar cómo QUEDARÍA y no si el campo viene. Sin esto, la ficha
   * del último administrador no se podría guardar nunca.
   */
  conSoloEstosAdministradores(1, ([unico]) => {
    assert.equal(alGuardar(unico, { rol: 'admin', activo: 1, telefono: '+56900000000' }), null);
  });
});

test('la que ya existía sigue en pie: uno no se borra a sí mismo', () => {
  conSoloEstosAdministradores(2, ([uno]) => {
    const aviso = def.hooks.beforeDelete(uno, { user: { id: uno.id }, db });
    assert.equal(aviso, 'No puede eliminar su propio usuario');
  });
});

test('y la cabecera del módulo dice lo que ahora hace de verdad', () => {
  /**
   * Decía «ni el último administrador» y cuidaba una de las tres puertas. Un
   * módulo que promete de más es peor que uno que no promete nada.
   */
  const fs = require('fs');
  const path = require('path');
  const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'modules', 'usuarios.js'), 'utf8');
  const cabecera = fuente.slice(0, fuente.indexOf('*/'));
  assert.match(cabecera, /sin ningún\s+\*\s+administrador activo/);
  assert.match(cabecera, /ni borrando esa cuenta, ni desactivándola, ni/);
});
