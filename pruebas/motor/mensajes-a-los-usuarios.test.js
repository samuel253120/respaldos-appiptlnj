/**
 * Los mensajes escritos a mano: a quién llegan, a quién NO, y qué queda.
 *
 * Un mensaje es lo único que manda el sistema y no lo decidió el sistema: lo
 * escribió una persona para otras. Eso cambia lo que puede salir mal, y por eso
 * se vigila desde acá cada una de estas cinco cosas:
 *
 *   · QUE ALCANCE MÁS DE LA CUENTA. La llave de enviar mensajes no puede
 *     volverse una manera de averiguar qué cuentas existen en la otra iglesia.
 *     El alcance no se calcula en el módulo de mensajes: se le pide al mismo
 *     que arma el listado de Usuarios. Si un día se separan, se separan en
 *     silencio, y acá está la prueba que no lo deja.
 *
 *   · QUE SE PISEN ENTRE ELLOS. Cada aviso lleva una clave para no repetirse
 *     mientras siga sin leer. Con una clave suelta —«mensaje» a secas— el
 *     segundo mensaje del día no se crearía hasta que alguien leyera el
 *     primero. Por eso la clave lleva el número del mensaje.
 *
 *   · QUE SE PUEDA SILENCIAR EN SECRETO. Los demás avisos se apagan; este no,
 *     porque quien lo manda no tiene acuse de recibo. El teléfono sí se apaga:
 *     sonar es una interrupción y eso es cosa de cada uno.
 *
 *   · QUE DESPIERTE DOSCIENTOS TELÉFONOS POR UNA EQUIVOCACIÓN. Elegir «todos»
 *     creyendo que es un cuerpo no se puede deshacer.
 *
 *   · QUE NO QUEDE CONSTANCIA. Un mensaje es un acto de alguien sobre otros:
 *     tiene que estar en el Registro de Cambios. Esta prueba encontró que NO
 *     estaba —la anotación reventaba adentro y el `catch` se comía el error—.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
require('../../server/registry'); // la bitácora arma el nombre con el registro cargado
const mensajes = require('../../server/avisos/mensajes');
const avisos = require('../../server/avisos/avisos');
const navegador = require('../../server/avisos/navegador');

/*
 * El empujón al teléfono se anota en vez de salir. No es por evitar la red
 * —sin aparatos suscritos no manda nada igual— sino porque lo que hay que
 * comprobar es la DECISIÓN: cuándo el sistema resuelve interrumpir a alguien.
 */
const empujones = [];
navegador.empujar = (usuarioId, aviso) => {
  empujones.push({ usuarioId, aviso });
  return Promise.resolve(1);
};

// --------------------------------------------------------------- el escenario

const iglesiaDe = (nombre, codigo) =>
  db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')").run(nombre, codigo).lastInsertRowid;

let cuantosRut = 61000000;
function cuenta(nombre, { iglesia = null, administra = null, rol = 'secretario', activo = 1, perfil = null, prefiere = null } = {}) {
  const id = db
    .prepare(
      `INSERT INTO usuarios (nombre, rut, rol, activo, password, iglesia_id, iglesias, perfil_id, avisos)
       VALUES (?, ?, ?, ?, 'x', ?, ?, ?, ?)`
    )
    .run(nombre, `${cuantosRut++}-0`, rol, activo, iglesia, administra ? JSON.stringify(administra) : null,
      perfil, prefiere ? JSON.stringify(prefiere) : null).lastInsertRowid;
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
}

const norte = iglesiaDe('Iglesia de los Mensajes Norte', 'MSG-N');
const sur = iglesiaDe('Iglesia de los Mensajes Sur', 'MSG-S');

const jefa = cuenta('Jefa de los Mensajes', { iglesia: norte, administra: [norte], rol: 'admin' });
const ana = cuenta('Ana de los Mensajes', { iglesia: norte });
const beto = cuenta('Beto de los Mensajes', { iglesia: norte });
const dormida = cuenta('Dormida de los Mensajes', { iglesia: norte, activo: 0 });
const carla = cuenta('Carla de los Mensajes del Sur', { iglesia: sur });

const suyos = (id) => db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? ORDER BY id').all(id);
const nombres = (gente) => gente.map((u) => u.nombre).sort();
const cuantosMensajes = () => db.prepare('SELECT COUNT(*) c FROM mensajes_enviados').get().c;

// ------------------------------------------------------------- a quién alcanza

test('le escribe exactamente a quienes ve en Usuarios', () => {
  assert.deepEqual(nombres(mensajes.aQuienesAlcanza(jefa, 'todos')),
    ['Ana de los Mensajes', 'Beto de los Mensajes']);
});

test('y él mismo no está entre sus destinatarios', () => {
  const gente = mensajes.aQuienesAlcanza(jefa, 'todos');
  assert.ok(!gente.some((u) => u.id === jefa.id),
    'mandarse un mensaje a uno mismo no le dice nada a nadie, y en «todos» sería siempre un aviso de más');
});

test('una cuenta desactivada no recibe: ya no entra a leerlo', () => {
  assert.ok(!mensajes.aQuienesAlcanza(jefa, 'todos').some((u) => u.id === dormida.id));
});

test('la iglesia ajena no se alcanza ni nombrándola derecho', () => {
  assert.deepEqual(mensajes.aQuienesAlcanza(jefa, 'iglesia', sur), [],
    'el destino acota, nunca amplía: encima va siempre el alcance de quien manda');
});

test('ni eligiendo a dedo a una persona de allá', () => {
  assert.deepEqual(mensajes.aQuienesAlcanza(jefa, 'personas', [carla.id]), []);
});

test('y en una lista mezclada llega solo a los suyos', () => {
  assert.deepEqual(nombres(mensajes.aQuienesAlcanza(jefa, 'personas', [ana.id, carla.id])),
    ['Ana de los Mensajes']);
});

test('sin nadie elegido no alcanza a nadie —y no a todos, que es el error caro—', () => {
  assert.deepEqual(mensajes.aQuienesAlcanza(jefa, 'personas', []), []);
  assert.deepEqual(mensajes.aQuienesAlcanza(jefa, 'personas', null), []);
});

test('un destino que no existe no alcanza a nadie', () => {
  assert.deepEqual(mensajes.aQuienesAlcanza(jefa, 'la_congregacion_entera', 1), []);
});

test('quien administra toda la organización sí alcanza las dos iglesias', () => {
  const general = cuenta('General de los Mensajes', { rol: 'admin' });
  const gente = mensajes.aQuienesAlcanza(general, 'iglesia', sur);
  assert.deepEqual(nombres(gente), ['Carla de los Mensajes del Sur'],
    'sin iglesias asignadas se ve todo: es el administrador general, y el alcance lo dice el mismo lugar de siempre');
});

// ------------------------------------------------- lo que la pantalla ofrece

test('la pantalla ofrece las cuatro maneras de elegir a quién', () => {
  const puede = mensajes.aQuienPuedeEscribir(jefa);
  assert.deepEqual(puede.destinos.map((d) => d.clave), ['todos', 'iglesia', 'perfil', 'personas']);
  assert.equal(puede.destinos.find((d) => d.clave === 'todos').pide, null, '«todos» no pide elegir nada más');
  assert.equal(puede.destinos.find((d) => d.clave === 'personas').pide, 'usuarios');
});

test('y solo ofrece las iglesias que alcanza, con las personas que alcanza', () => {
  const puede = mensajes.aQuienPuedeEscribir(jefa);
  assert.deepEqual(puede.iglesias.map((i) => i.nombre), ['Iglesia de los Mensajes Norte'],
    'ofrecer la iglesia ajena sería contarle que existe');
  assert.equal(puede.cuantosEnTotal, 2, 'el número que se muestra antes de mandar es el de verdad');
  assert.deepEqual(nombres(puede.personas), ['Ana de los Mensajes', 'Beto de los Mensajes']);
});

test('a quienes tienen un perfil de permisos también se les puede escribir', () => {
  const perfil = db
    .prepare("INSERT INTO perfiles_permisos (nombre, estado) VALUES ('Perfil ZZ de los Mensajes','Activo')")
    .run().lastInsertRowid;
  db.prepare('UPDATE usuarios SET perfil_id = ? WHERE id = ?').run(perfil, ana.id);

  assert.deepEqual(nombres(mensajes.aQuienesAlcanza(jefa, 'perfil', perfil)), ['Ana de los Mensajes']);
  assert.ok(mensajes.aQuienPuedeEscribir(jefa).perfiles.some((p) => p.id === perfil),
    'un perfil que nadie usa no se ofrece; este lo usa alguien');
});

// ----------------------------------------------------- lo que no se puede mandar

test('lo que falta se dice antes de mandar nada', () => {
  const base = { titulo: 'Algo', cuerpo: 'Algo que decir', destino: 'todos' };
  const casos = [
    [{ ...base, titulo: '' }, /título/i, 'sin título'],
    [{ ...base, titulo: '   ' }, /título/i, 'un título de puros espacios es no tener título'],
    [{ ...base, titulo: 'x'.repeat(121) }, /120/, 'lo que no cabe en la pantalla de un teléfono'],
    [{ ...base, cuerpo: '' }, /en blanco/i, 'sin mensaje'],
    [{ ...base, cuerpo: '  \n ' }, /en blanco/i, 'un mensaje de puros espacios'],
    [{ ...base, cuerpo: 'y'.repeat(2001) }, /2000/, 'un mensaje que no termina más'],
    [{ ...base, destino: 'nadie_sabe' }, /a quién/i, 'un destino que no existe'],
    [{ ...base, destino: 'iglesia' }, /Falta elegir/i, 'la iglesia sin decir cuál'],
    [{ ...base, destino: 'perfil' }, /Falta elegir/i, 'el perfil sin decir cuál'],
  ];
  for (const [datos, esperado, porque] of casos) {
    assert.match(String(mensajes.loQueFalta(datos)), esperado, porque);
  }
});

test('y lo que sí se puede mandar pasa, incluso justo en el límite', () => {
  assert.equal(mensajes.loQueFalta({ titulo: 'Reunión', cuerpo: 'A las ocho', destino: 'todos' }), null);
  assert.equal(mensajes.loQueFalta({
    titulo: 'x'.repeat(120), cuerpo: 'y'.repeat(2000), destino: 'iglesia', valor: norte,
  }), null, 'el tope es hasta ahí, no antes');
});

test('un mensaje mal escrito no deja rastro: ni constancia ni avisos', () => {
  const antes = cuantosMensajes();
  const cuantosDeAna = suyos(ana.id).length;
  assert.match(String(mensajes.enviar(jefa, { titulo: '', cuerpo: 'Hola', destino: 'todos' }).error), /título/i);
  assert.equal(cuantosMensajes(), antes, 'no se guardó un mensaje a medias');
  assert.equal(suyos(ana.id).length, cuantosDeAna, 'ni le llegó a nadie');
});

test('mandarle a nadie se dice, en vez de dar por hecho que salió', () => {
  const salida = mensajes.enviar(jefa, { titulo: 'Al vacío', cuerpo: 'Nadie', destino: 'personas', valor: [carla.id] });
  assert.match(String(salida.error), /ninguna cuenta activa/i,
    'creer que un mensaje salió cuando no salió es peor que no poder mandarlo');
});

// ----------------------------------------------------------- el enlace del aviso

test('el enlace solo puede llevar a una pantalla de este sistema', () => {
  for (const bueno of ['#/m/solicitudes', '#/m/miembros?id=3', '#/mensajes', '#/']) {
    assert.equal(mensajes.enlaceLimpio(bueno), bueno);
  }
  for (const malo of ['https://ejemplo.cl/algo', 'javascript:alert(1)', '//ejemplo.cl', 'ejemplo.cl', '#sin-barra']) {
    assert.equal(mensajes.enlaceLimpio(malo), null,
      `«${malo}» se toca sin pensarlo en la pantalla bloqueada de un teléfono`);
  }
  assert.equal(mensajes.enlaceLimpio(''), null);
  assert.equal(mensajes.enlaceLimpio(null), null);
  assert.equal(mensajes.enlaceLimpio('  #/m/cuerpos  '), '#/m/cuerpos', 'un espacio de más no invalida nada');
});

// --------------------------------------------------------------- mandar uno

test('el mensaje llega a la campanita de cada uno, y no a la de quien lo mandó', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'La reunión se cambió a las 8',
    cuerpo: 'La coordinación de mañana pasa de las 19:00 a las 20:00.',
    destino: 'todos',
  });
  assert.equal(salida.error, undefined);
  assert.equal(salida.cuantos, 2);

  for (const quien of [ana, beto]) {
    const ultimo = suyos(quien.id).pop();
    assert.equal(ultimo.tipo, 'mensaje');
    assert.equal(ultimo.titulo, 'La reunión se cambió a las 8');
    assert.equal(ultimo.clave, `mensaje:${salida.id}`);
  }
  assert.equal(suyos(jefa.id).length, 0);
  assert.equal(suyos(carla.id).length, 0, 'la otra iglesia sigue sin enterarse');
});

test('dos mensajes del mismo día no se pisan, aunque no se haya leído el primero', () => {
  const antes = suyos(beto.id).length;
  const uno = mensajes.enviar(jefa, { titulo: 'Primero', cuerpo: 'Uno', destino: 'personas', valor: [beto.id] });
  const dos = mensajes.enviar(jefa, { titulo: 'Segundo', cuerpo: 'Dos', destino: 'personas', valor: [beto.id] });

  assert.equal(dos.cuantos, 1, 'el segundo también llegó');
  assert.equal(suyos(beto.id).length, antes + 2);
  assert.notEqual(uno.id, dos.id);
  const claves = suyos(beto.id).slice(-2).map((n) => n.clave);
  assert.deepEqual(claves, [`mensaje:${uno.id}`, `mensaje:${dos.id}`],
    'con una clave suelta el segundo no se habría creado, y después no habría cómo contar quién leyó cuál');
});

test('el enlace de afuera se descarta y el mensaje sale igual', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Con enlace de afuera', cuerpo: 'Ojo', destino: 'personas', valor: [ana.id],
    enlace: 'https://sitio-cualquiera.cl/entrar',
  });
  assert.equal(salida.cuantos, 1);
  assert.equal(db.prepare('SELECT enlace FROM mensajes_enviados WHERE id = ?').get(salida.id).enlace, null);
  assert.equal(suyos(ana.id).pop().enlace, null);
});

test('y el enlace de adentro viaja hasta el aviso', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Revisen la bandeja', cuerpo: 'Hay tres sin responder', destino: 'personas', valor: [ana.id],
    enlace: '#/m/solicitudes',
  });
  assert.equal(suyos(ana.id).pop().enlace, '#/m/solicitudes');
  assert.equal(db.prepare('SELECT enlace FROM mensajes_enviados WHERE id = ?').get(salida.id).enlace, '#/m/solicitudes');
});

test('queda constancia en el Registro de Cambios de quién mandó qué y a cuántos', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Gracias por la campaña', cuerpo: 'Quedó muy bien', destino: 'personas', valor: [ana.id, beto.id],
  });
  const anotado = db.prepare("SELECT * FROM registro_cambios WHERE modulo = 'Mensajes' AND registro_id = ?").get(salida.id);
  assert.ok(anotado, 'sin esto, el único rastro de un mensaje a toda la iglesia sería la memoria de quien lo mandó');
  assert.equal(anotado.accion, 'Envío');
  assert.equal(anotado.registro, 'Gracias por la campaña');
  assert.equal(anotado.usuario, jefa.nombre);
  assert.match(anotado.detalle, /2 personas elegidas · 2 persona\(s\)/);
});

test('cada destino queda escrito como se lee, no como número', () => {
  const dice = (datos) => {
    const salida = mensajes.enviar(jefa, { titulo: 'Aviso', cuerpo: 'Cuerpo del aviso', ...datos });
    assert.equal(salida.error, undefined, JSON.stringify(datos));
    return db.prepare('SELECT destino, destino_id, destino_dice FROM mensajes_enviados WHERE id = ?').get(salida.id);
  };
  assert.equal(dice({ destino: 'todos' }).destino_dice, 'A todas las personas que alcanza');
  const aLaIglesia = dice({ destino: 'iglesia', valor: norte });
  assert.equal(aLaIglesia.destino_dice, 'A la iglesia Iglesia de los Mensajes Norte');
  assert.equal(aLaIglesia.destino_id, norte);
  const aUna = dice({ destino: 'personas', valor: [ana.id] });
  assert.equal(aUna.destino_dice, 'A una persona');
  assert.equal(aUna.destino_id, null, 'a un puñado de personas elegidas no le corresponde un número');
});

// ------------------------------------------------- lo urgente lo decide quien escribe

test('un mensaje urgente interrumpe; uno de rutina espera al resumen del día', () => {
  empujones.length = 0;
  mensajes.enviar(jefa, {
    titulo: 'Cuando puedan', cuerpo: 'Revisen las fichas', destino: 'personas', valor: [ana.id],
  });
  assert.equal(empujones.length, 0, 'sin marcarlo urgente no le suena el teléfono a nadie');

  mensajes.enviar(jefa, {
    titulo: 'Se suspende la reunión', cuerpo: 'No vengan', destino: 'personas', valor: [ana.id, beto.id], urgente: true,
  });
  assert.equal(empujones.length, 2, 'marcado urgente, sale en el momento a cada uno');
  assert.deepEqual(empujones.map((e) => e.usuarioId).sort(), [ana.id, beto.id].sort());
});

test('lo urgente de un mensaje lo decide el mensaje, no el tipo', () => {
  /*
   * Todos los demás avisos heredan de su tipo si interrumpen o no. Un mensaje
   * escrito a mano puede ser «la reunión se cambió a las 8» o «cuando puedan,
   * revisen las fichas», y quien lo escribe es el único que sabe cuál es.
   */
  assert.equal(avisos.TIPOS.mensaje.urgente, true, 'el tipo, por sí solo, interrumpiría siempre');
  empujones.length = 0;
  avisos.avisar({ usuario_id: ana.id, tipo: 'mensaje', clave: 'a-mano:1', titulo: 'Sin apuro', urgente: false });
  assert.equal(empujones.length, 0);
  avisos.avisar({ usuario_id: ana.id, tipo: 'mensaje', clave: 'a-mano:2', titulo: 'Con apuro', urgente: true });
  assert.equal(empujones.length, 1);
  avisos.avisar({ usuario_id: ana.id, tipo: 'mensaje', clave: 'a-mano:3', titulo: 'Como diga el tipo' });
  assert.equal(empujones.length, 2, 'sin decir nada, manda el tipo, como en todo el resto del sistema');
});

// --------------------------------------------- la campanita no se puede apagar

test('el mensaje no se puede silenciar en la campanita', () => {
  const sorda = cuenta('Sorda de los Mensajes', {
    iglesia: norte,
    prefiere: { mensaje: { sistema: false, navegador: false }, cumpleanos_hoy: { sistema: false } },
  });
  assert.equal(avisos.quiere(sorda, 'mensaje', 'sistema'), true,
    'quien lo manda no tiene acuse de recibo: poder apagarlo en secreto lo vuelve una moneda al aire');
  assert.equal(avisos.preferenciasDe(sorda).mensaje.sistema, true, 'y la pantalla lo muestra encendido');

  assert.equal(avisos.quiere(sorda, 'cumpleanos_hoy', 'sistema'), false,
    'los demás sí se apagan: si no, esto no probaría nada');
});

test('pero el teléfono sí, porque sonar es una interrupción', () => {
  const sorda = db.prepare('SELECT * FROM usuarios WHERE nombre = ?').get('Sorda de los Mensajes');
  assert.equal(avisos.quiere(sorda, 'mensaje', 'navegador'), false);

  empujones.length = 0;
  const salida = mensajes.enviar(jefa, {
    titulo: 'A quien lo apagó', cuerpo: 'Igual queda', destino: 'personas', valor: [sorda.id], urgente: true,
  });
  assert.equal(salida.cuantos, 1, 'la constancia le llega igual');
  assert.equal(suyos(sorda.id).pop().titulo, 'A quien lo apagó');
  assert.equal(empujones.length, 0, 'y el teléfono no le suena');
});

// ------------------------------------------------------- cuántos lo leyeron

test('lo que se ha mandado dice a cuántos llegó y cuántos lo abrieron', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Para contar los leídos', cuerpo: 'Ábranlo', destino: 'personas', valor: [ana.id, beto.id],
  });
  const mio = () => mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.id === salida.id);

  assert.equal(mio().cuantos, 2);
  assert.equal(mio().leidos, 0);
  assert.equal(mio().quien, jefa.nombre);

  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?').get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyo.id);
  assert.equal(mio().leidos, 1, 'la contraparte de que la campanita no se pueda apagar');
  assert.equal(mio().cuantos, 2, 'a cuántos llegó no cambia porque uno lo abra');
});

test('pero no dice QUIÉNES lo leyeron', () => {
  const uno = mensajes.loQueSeHaMandado(jefa, 200)[0];
  assert.deepEqual(Object.keys(uno).sort(), [
    'created_at', 'cuantos', 'cuerpo', 'destino_dice', 'enlace', 'id', 'leidos',
    'quien', 'quien_retiro', 'retirado_en', 'sin_leer', 'titulo', 'urgente',
  ], 'saber quién abrió qué sería vigilar a la gente por dentro del sistema; para eso está preguntarle');
  // Los números dicen cuántos, nunca quiénes
  for (const clave of ['leidos', 'cuantos', 'sin_leer']) assert.equal(typeof uno[clave], 'number');
});

test('lo más nuevo va primero, que es lo que se mira', () => {
  const lista = mensajes.loQueSeHaMandado(jefa, 200);
  const ids = lista.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
});

// ------------------------------------------------------ el freno de la equivocación

test('a más de quinientos de una vez no se manda: se pide acotar', () => {
  /*
   * Doscientos teléfonos despertados por elegir «todos» creyendo que era un
   * cuerpo no se pueden volver a dormir. El tope no es de la máquina —son unas
   * decenas de cuentas— sino de lo que no se puede deshacer.
   */
  const muchos = iglesiaDe('Iglesia de los Mensajes Tope', 'MSG-TOPE');
  const jefe = cuenta('Jefe del Tope', { iglesia: muchos, administra: [muchos], rol: 'admin' });
  const cuantos = mensajes.TOPE_DE_UN_ENVIO + 1;
  const meter = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, password, iglesia_id) VALUES (?, ?, 'consulta', 1, 'x', ?)"
  );
  db.transaction(() => {
    for (let i = 0; i < cuantos; i++) meter.run(`Del Tope ${i}`, `${cuantosRut++}-0`, muchos);
  })();

  const antes = cuantosMensajes();
  const salida = mensajes.enviar(jefe, { titulo: 'A todos', cuerpo: 'De una vez', destino: 'todos' });
  assert.match(String(salida.error), new RegExp(`${cuantos} personas.*${mensajes.TOPE_DE_UN_ENVIO}`));
  assert.equal(cuantosMensajes(), antes, 'no se mandó a los primeros quinientos y se cortó');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE tipo = ? AND titulo = ?').get('mensaje', 'A todos').c, 0);
});

// ------------------------------------------ retirar un mensaje ya mandado

/*
 * Se equivocó en la hora, o lo mandó a la iglesia entera cuando iba a tres
 * personas. Antes no había nada que hacer: el aviso quedaba en cuarenta
 * campanitas y lo único posible era mandar otro pidiendo disculpas.
 *
 * Retirar borra los avisos que siguen SIN LEER. Los ya leídos no se tocan: esa
 * gente ya lo vio, y borrárselo sería reescribirle lo que recuerda.
 */
const leDejaron = (quien, titulo) =>
  suyos(quien.id).some((n) => n.titulo === titulo);

test('retirar le saca el aviso a quien no lo abrió, y no a quien sí', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'La reunión es a las 7', cuerpo: 'Mañana a las 19:00.',
    destino: 'personas', valor: [ana.id, beto.id],
  });
  const suyoDeAna = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyoDeAna.id);

  const r = mensajes.retirar(jefa, salida.id);
  assert.equal(r.error, undefined);
  assert.equal(r.borrados, 1, 'solo el que seguía sin abrir');

  assert.ok(leDejaron(ana, 'La reunión es a las 7'), 'la que ya lo había leído lo conserva');
  assert.ok(!leDejaron(beto, 'La reunión es a las 7'), 'al que no lo había abierto se le quitó');
});

test('y lo que ya se había leído sigue contando', () => {
  const mio = mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.titulo === 'La reunión es a las 7');
  assert.equal(mio.cuantos, 2, 'a cuántos llegó no cambia: llegó');
  assert.equal(mio.leidos, 1, 'y quien lo leyó, lo leyó');
  assert.equal(mio.sin_leer, 0);
  assert.ok(mio.retirado_en, 'queda marcado como retirado');
  assert.equal(mio.quien_retiro, jefa.nombre);
});

test('queda la constancia de que hubo una corrección', () => {
  const salida = mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.titulo === 'La reunión es a las 7');
  const anotado = db.prepare(
    "SELECT * FROM registro_cambios WHERE modulo = 'Mensajes' AND accion = 'Retiro' AND registro_id = ?"
  ).get(salida.id);
  assert.ok(anotado, 'retirar algo que ya vio gente no puede pasar sin dejar rastro');
  assert.equal(anotado.usuario, jefa.nombre);
  assert.match(anotado.detalle, /Retirado de 1 campanita/);
});

test('no se retira dos veces', () => {
  const salida = mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.titulo === 'La reunión es a las 7');
  assert.match(String(mensajes.retirar(jefa, salida.id).error), /ya estaba retirado/i);
});

test('ni uno que ya nadie tiene sin abrir: se dice por qué', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Este lo leyeron todos', cuerpo: 'x', destino: 'personas', valor: [ana.id],
  });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyo.id);

  const r = mensajes.retirar(jefa, salida.id);
  assert.match(String(r.error), /no hay nada que retirar/i,
    'poner el sello de «retirado» sobre algo que ya vieron todos sería mentirle a quien lo mire después');
  assert.equal(
    db.prepare('SELECT retirado_en FROM mensajes_enviados WHERE id = ?').get(salida.id).retirado_en, null
  );
});

test('y no se le retira nada a la otra iglesia', () => {
  const jefeDeAlla = cuenta('Jefe que Retira de Más', { iglesia: sur, administra: [sur], rol: 'admin' });
  const mio = mensajes.enviar(jefa, {
    titulo: 'Que no me lo toquen', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  const r = mensajes.retirar(jefeDeAlla, mio.id);
  assert.match(String(r.error), /no está entre los que usted puede ver/i,
    'retirar es el mismo alcance que mirar: lo que no se ve, no se toca');
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE clave = ?').get(`mensaje:${mio.id}`).c, 2,
    'y los avisos siguen donde estaban'
  );
});

test('el historial dice a cuántos se les puede retirar todavía', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Para mirar el sin abrir', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  const mio = () => mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.id === salida.id);
  assert.equal(mio().sin_leer, 2);
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyo.id);
  assert.equal(mio().sin_leer, 1, 'sin ese número, el botón de retirar no sabe si sirve de algo');
  mensajes.retirar(jefa, salida.id);
  assert.equal(mio().sin_leer, 0);
});

// ------------------------------ el conteo de leídos, que no se puede borrar solo

/*
 * Los avisos leídos se borran solos a los noventa días. El conteo de leídos
 * salía de contarlos, así que la constancia se deshacía sola: «40 de 40 leídos»
 * pasaba a decir «0 de 40», sin avisar y sin quedar a medias. Es peor que perder
 * el dato, porque afirma lo contrario. Ahora el número se guarda al leerlo.
 */
const comoVa = (id, quien = jefa) => {
  const suyo = mensajes.loQueSeHaMandado(quien, 200).find((m) => m.id === id);
  return `${suyo.leidos} de ${suyo.cuantos}`;
};

test('el conteo de leídos sobrevive al borrado de los avisos', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'El aviso de diciembre', cuerpo: 'Para contarlo en marzo',
    destino: 'personas', valor: [ana.id, beto.id],
  });
  for (const quien of [ana, beto]) {
    const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
      .get(quien.id, `mensaje:${salida.id}`);
    avisos.marcarLeida(quien.id, suyo.id);
  }
  assert.equal(comoVa(salida.id), '2 de 2');

  // pasan los noventa días
  db.prepare("UPDATE notificaciones SET leida_en = date('now','localtime','-120 days') WHERE clave = ?")
    .run(`mensaje:${salida.id}`);
  const borrados = avisos.limpiarLosViejos(90);
  assert.ok(borrados >= 2, 'la limpieza tenía que llevarse esos avisos');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE clave = ?').get(`mensaje:${salida.id}`).c, 0);

  assert.equal(comoVa(salida.id), '2 de 2',
    'quien revise en marzo qué pasó con el aviso de diciembre no puede leer que no lo abrió nadie');
});

test('volver a marcar el mismo aviso no cuenta dos veces', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Para marcarlo dos veces', cuerpo: 'Uno', destino: 'personas', valor: [ana.id],
  });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  assert.equal(avisos.marcarLeida(ana.id, suyo.id), 1);
  assert.equal(avisos.marcarLeida(ana.id, suyo.id), 0, 'ya estaba leído');
  assert.equal(comoVa(salida.id), '1 de 1');
});

test('«marcar todos como leídos» cuenta cada mensaje una vez', () => {
  const uno = mensajes.enviar(jefa, { titulo: 'De a montón 1', cuerpo: 'x', destino: 'personas', valor: [beto.id] });
  const dos = mensajes.enviar(jefa, { titulo: 'De a montón 2', cuerpo: 'x', destino: 'personas', valor: [beto.id] });
  avisos.crear({ usuario_id: beto.id, tipo: 'cumpleanos_hoy', clave: 'cumple:9', titulo: 'Alguien cumple' });

  assert.ok(avisos.marcarTodasLeidas(beto.id) >= 3);
  assert.equal(comoVa(uno.id), '1 de 1');
  assert.equal(comoVa(dos.id), '1 de 1');
  assert.equal(avisos.marcarTodasLeidas(beto.id), 0, 'ya no le queda nada sin leer');
  assert.equal(comoVa(uno.id), '1 de 1', 'y pasarlo de nuevo no vuelve a sumar');

  /*
   * Y el caso de verdad, que es el que pasa todas las semanas: ya marcó todo,
   * después le llega otro, y vuelve a apretar «marcar todos». Los viejos no
   * pueden volver a contarse por ir en la misma pasada que el nuevo.
   */
  const tres = mensajes.enviar(jefa, { titulo: 'De a montón 3', cuerpo: 'x', destino: 'personas', valor: [beto.id] });
  assert.equal(avisos.marcarTodasLeidas(beto.id), 1, 'solo el nuevo estaba sin leer');
  assert.equal(comoVa(tres.id), '1 de 1');
  assert.equal(comoVa(uno.id), '1 de 1', 'el de la semana pasada sigue en uno');
  assert.equal(comoVa(dos.id), '1 de 1');
});

test('leer un aviso que no es un mensaje no toca ningún conteo', () => {
  const salida = mensajes.enviar(jefa, { titulo: 'Testigo', cuerpo: 'x', destino: 'personas', valor: [ana.id] });
  const antes = comoVa(salida.id);
  const otro = avisos.crear({ usuario_id: ana.id, tipo: 'credencial_por_vencer', clave: 'credencial_vence:777', titulo: 'Vence' });
  avisos.marcarLeida(ana.id, otro.id);
  assert.equal(comoVa(salida.id), antes);
});

test('una clave que no es de un mensaje, o de uno que no existe, no anota nada', () => {
  assert.equal(mensajes.anotarLectura(['cumple:3', 'respaldo', '', null]), 0);
  assert.equal(mensajes.anotarLectura(['mensaje:999999']), 0, 'un mensaje que no existe no crea nada');
  assert.equal(mensajes.anotarLectura('mensaje:no-es-un-numero'), 0);
});

test('la migración rescata lo que todavía se puede saber', () => {
  /*
   * En las bases que ya venían andando el número no estaba guardado. Se llena
   * una vez con los avisos que aún no se han borrado; lo que la limpieza ya se
   * llevó no vuelve, porque no hay de dónde sacarlo.
   */
  const { elConteoDeLeidosSeGuarda } = require('../../server/migraciones');
  const salida = mensajes.enviar(jefa, {
    titulo: 'De antes de que se guardara', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyo.id);

  // como si esa columna no se hubiera llevado nunca
  db.prepare('UPDATE mensajes_enviados SET leidos = 0 WHERE id = ?').run(salida.id);
  db.prepare('DELETE FROM migraciones WHERE nombre = ?').run('el conteo de leídos se guarda en el mensaje');
  assert.equal(comoVa(salida.id), '0 de 2');

  elConteoDeLeidosSeGuarda();
  assert.equal(comoVa(salida.id), '1 de 2', 'lo que quedaba en las campanitas se rescata');

  // y correrla de nuevo no vuelve a sumar
  elConteoDeLeidosSeGuarda();
  assert.equal(comoVa(salida.id), '1 de 2');
});

// ------------------------------------ de quién es cada mensaje del historial

/*
 * Lo que se ha mandado se ve como se ve todo lo demás: lo de la gente que uno
 * ve. La primera versión del módulo no lo acotaba y traía los últimos treinta
 * envíos del sistema entero, con su texto completo; la administradora de una
 * iglesia leía la correspondencia de la otra. Estas cinco pruebas son las que
 * faltaban.
 */
const titulosQueVe = (quien) => mensajes.loQueSeHaMandado(quien, 200).map((m) => m.titulo);

test('el historial no muestra lo que mandó la otra iglesia', () => {
  const jefeDelSur = cuenta('Jefe de los Mensajes del Sur', { iglesia: sur, administra: [sur], rol: 'admin' });

  const acaDelNorte = mensajes.enviar(jefa, {
    titulo: 'Asunto interno del Norte', cuerpo: 'Hablemos de la tesorería antes del domingo.',
    destino: 'personas', valor: [ana.id],
  });
  const allaDelSur = mensajes.enviar(jefeDelSur, {
    titulo: 'Asunto interno del Sur', cuerpo: 'Lo de la campaña quedó para el jueves.',
    destino: 'personas', valor: [carla.id],
  });
  assert.equal(acaDelNorte.cuantos, 1);
  assert.equal(allaDelSur.cuantos, 1);

  assert.ok(!titulosQueVe(jefeDelSur).includes('Asunto interno del Norte'),
    'un mensaje interno es de los textos más francos que se escriben en una oficina');
  assert.ok(!titulosQueVe(jefa).includes('Asunto interno del Sur'));

  // y no es que se esconda el título y viaje el cuerpo
  const loSuyo = mensajes.loQueSeHaMandado(jefeDelSur, 200);
  assert.ok(!JSON.stringify(loSuyo).includes('Hablemos de la tesorería'),
    'el texto tampoco viaja por otro lado');
});

test('pero lo propio nunca se esconde', () => {
  assert.ok(titulosQueVe(jefa).includes('Asunto interno del Norte'));
  const solo = cuenta('Sin Nadie Alrededor', { iglesia: sur, administra: [sur], rol: 'admin' });
  const suyo = mensajes.enviar(solo, { titulo: 'El único que mandó', cuerpo: 'Uno solo', destino: 'todos' });
  assert.equal(suyo.error, undefined);
  assert.deepEqual(titulosQueVe(solo).filter((t) => t === 'El único que mandó'), ['El único que mandó'],
    'uno siempre se ve a sí mismo: si no, quien manda no podría revisar lo que mandó');
});

test('y en la misma oficina se ve lo del colega', () => {
  const otraDelNorte = cuenta('La Otra Jefa del Norte', { iglesia: norte, administra: [norte], rol: 'admin' });
  assert.ok(titulosQueVe(otraDelNorte).includes('Asunto interno del Norte'),
    'la constancia es del equipo, no de quien apretó el botón');
  assert.ok(!titulosQueVe(otraDelNorte).includes('Asunto interno del Sur'));
});

test('quien administra toda la organización lo sigue viendo todo', () => {
  const general = cuenta('General de los Historiales', { rol: 'admin' });
  const suyos = titulosQueVe(general);
  assert.ok(suyos.includes('Asunto interno del Norte'));
  assert.ok(suyos.includes('Asunto interno del Sur'),
    'sin iglesias asignadas se ve todo, como en cualquier otro listado del sistema');
});

test('un mensaje cuyo autor ya no existe no se le abre a cualquiera', () => {
  /*
   * `enviado_por` puede quedar en blanco si la cuenta se borra. Un mensaje así
   * no es de nadie: quien está acotado a sus iglesias no tiene por qué leerlo,
   * y quien ve toda la organización sí.
   */
  const huerfano = mensajes.enviar(jefa, {
    titulo: 'De una cuenta que ya no está', cuerpo: 'Texto viejo', destino: 'personas', valor: [ana.id],
  });
  db.prepare('UPDATE mensajes_enviados SET enviado_por = NULL WHERE id = ?').run(huerfano.id);

  const jefeDelSur = db.prepare('SELECT * FROM usuarios WHERE nombre = ?').get('Jefe de los Mensajes del Sur');
  const general = db.prepare('SELECT * FROM usuarios WHERE nombre = ?').get('General de los Historiales');
  assert.ok(!titulosQueVe(jefa).includes('De una cuenta que ya no está'));
  assert.ok(!titulosQueVe(jefeDelSur).includes('De una cuenta que ya no está'));
  assert.ok(titulosQueVe(general).includes('De una cuenta que ya no está'));
});

// --------------------------------------------------- lo que muestra la pantalla

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

test('la puerta del menú se abre solo con la llave, y la ruta también', () => {
  /*
   * Una entrada de menú que lleva a un «no tiene permiso» es peor que no
   * tenerla: le dice a la mitad de la oficina que existe algo que no puede
   * usar, y el que la toca cree que el sistema está fallando.
   */
  assert.match(app, /name: '_mensajes',[\s\S]{0,200}si: \(\) => tieneLlave\('avisos_enviar'\)/);
  assert.match(app, /parts\[0\] === 'mensajes' && tieneLlave\('avisos_enviar'\)/,
    'y escribir la dirección a mano tampoco entra');
});

test('la pantalla ofrece retirar solo cuando le queda a alguien sin abrir', () => {
  const trozo = app.slice(app.indexOf('async function pintarElHistorial('),
    app.indexOf('async function pintarElHistorial(') + 4500);
  assert.match(trozo, /!m\.retirado_en && m\.sin_leer/,
    'ofrecerlo cuando ya nadie lo tiene sin abrir es ofrecer un botón que solo puede fallar');
  assert.match(trozo, /confirm\(loQueSeVaARetirar\(m\)\)/, 'y se pregunta antes, con el número');
  assert.match(app, /Se le va a quitar de la campanita \$\{aCuantos\}/);
});

test('«volver a mandar» copia el texto y NO el destino', () => {
  const desde = app.indexOf("querySelectorAll('[data-repetir]')");
  const trozo = app.slice(desde, app.indexOf('Copiado arriba', desde) + 80);
  assert.ok(desde > 0 && trozo.length > 200, 'no se encontró el trozo que copia el mensaje');
  for (const campo of ['msgTitulo', 'msgCuerpo', 'msgEnlace', 'msgUrgente']) {
    assert.ok(trozo.includes(campo), `no copia ${campo}`);
  }
  assert.ok(!/msgDestino|msgPersonas|msgIglesia|msgPerfil/.test(trozo),
    'dejar puesto «a toda la iglesia» es justo el clic que uno no quiere dar sin pensarlo');
  assert.match(trozo, /Revise a quién va antes de mandarlo/);
});

test('en las preferencias, lo que no se puede apagar sale dicho y no como casilla', () => {
  const trozo = app.slice(app.indexOf('/avisos/preferencias'));
  assert.match(trozo.slice(0, 4000), /t\.siempre\s*\n?\s*\?/,
    'una casilla que no obedece es peor que no tenerla: parece que uno eligió algo');
});
