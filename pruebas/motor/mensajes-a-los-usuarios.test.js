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

// --------------------- antes de mandar: a cuántos va, y preguntar dos veces

/*
 * La pantalla decía a cuántos le llegaba con «a todos» y con las personas
 * elegidas a dedo, y no decía nada con «a una iglesia» ni «a un perfil», que son
 * justamente los dos que pueden alcanzar a mucha gente. Y el botón mandaba al
 * primer clic.
 */
test('cada destino dice a cuántos alcanza', () => {
  const puede = mensajes.aQuienPuedeEscribir(jefa);
  const suya = puede.iglesias.find((i) => i.id === norte);
  assert.equal(suya.cuantos, puede.cuantosEnTotal,
    'en este escenario toda su gente es de su iglesia: los dos números tienen que calzar');
  assert.ok(suya.cuantos > 0);
  assert.equal(puede.preguntarDesde, mensajes.PREGUNTAR_DESDE);
});

test('y un perfil que no usa nadie que uno alcance no se ofrece', () => {
  const solo = db.prepare("INSERT INTO perfiles_permisos (nombre, estado) VALUES ('Perfil ZZ de Nadie','Activo')")
    .run().lastInsertRowid;
  const delSur = db.prepare("INSERT INTO perfiles_permisos (nombre, estado) VALUES ('Perfil ZZ Solo del Sur','Activo')")
    .run().lastInsertRowid;
  db.prepare('UPDATE usuarios SET perfil_id = ? WHERE id = ?').run(delSur, carla.id);

  const puede = mensajes.aQuienPuedeEscribir(jefa);
  assert.ok(!puede.perfiles.some((p) => p.id === solo), 'uno que no usa nadie no lleva a ninguna parte');
  assert.ok(!puede.perfiles.some((p) => p.id === delSur),
    'y uno que solo usa gente de otra iglesia, elegirlo devolvía un error que no explicaba nada');
  assert.ok(puede.perfiles.every((p) => p.cuantos > 0), 'todos los que se ofrecen llevan a alguien');
});

test('a poca gente no se pregunta nada', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'A los de la oficina', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  assert.equal(salida.error, undefined, 'escribirle a los tres de la oficina es cosa de todos los días');
  assert.equal(salida.cuantos, 2);
});

test('pero a mucha se pregunta antes, con el número', () => {
  const suya = iglesiaDe('Iglesia de los Muchos ZZ', 'MSG-MUCH');
  const jefe = cuenta('Jefe de los Muchos', { iglesia: suya, administra: [suya], rol: 'admin' });
  for (let i = 0; i < mensajes.PREGUNTAR_DESDE; i++) {
    cuenta(`Gente del Umbral ${i}`, { iglesia: suya, rol: 'consulta' });
  }
  const antes = db.prepare('SELECT COUNT(*) c FROM mensajes_enviados').get().c;

  const preguntando = mensajes.enviar(jefe, { titulo: 'A todos los del umbral', cuerpo: 'Aviso general', destino: 'todos' });
  assert.equal(preguntando.confirmar, 'le_llega_a_muchos');
  assert.match(String(preguntando.error), new RegExp(`le va a llegar a ${mensajes.PREGUNTAR_DESDE} personas`));
  assert.match(String(preguntando.error), /solo se le puede retirar a quien no lo haya abierto/);
  assert.equal(preguntando.cuantos, mensajes.PREGUNTAR_DESDE);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM mensajes_enviados').get().c, antes,
    'preguntar no puede dejar el mensaje mandado a medias');

  const igual = mensajes.enviar(jefe, {
    titulo: 'A todos los del umbral', cuerpo: 'Aviso general', destino: 'todos', igual_asi: true,
  });
  assert.equal(igual.error, undefined, 'y quien contesta que sí no tiene que volver a contestar');
  assert.equal(igual.cuantos, mensajes.PREGUNTAR_DESDE);
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
  assert.equal(aLaIglesia.destino_dice, 'A Iglesia de los Mensajes Norte',
    'casi todas se llaman «Iglesia algo»: «A la iglesia Iglesia de los Mensajes Norte» se lee mal');
  assert.equal(aLaIglesia.destino_id, norte);

  // Y a una que no se llame así, se le pone el artículo
  const conNombreSuelto = iglesiaDe('Betania de los Mensajes', 'MSG-BET');
  cuenta('De Betania', { iglesia: conNombreSuelto, administra: [conNombreSuelto] });
  assert.equal(mensajes.DESTINOS.iglesia.dice(conNombreSuelto), 'A la iglesia Betania de los Mensajes');
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
  /*
   * Y esto manda por encima de la pregunta de «le va a llegar a mucha gente»:
   * son dos cosas distintas —una se contesta y se sigue, la otra no se puede
   * seguir— y si la pregunta se adelantara, quien dijera que sí se toparía
   * después con el tope y su «sí» no habría servido de nada.
   */
  assert.equal(salida.confirmar, undefined);
  assert.equal(cuantosMensajes(), antes, 'no se mandó a los primeros quinientos y se cortó');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE tipo = ? AND titulo = ?').get('mensaje', 'A todos').c, 0);
});

// -------------------------- que al destinatario no se le pierdan los mensajes

/*
 * La campanita traía los últimos veinte y nada más. Con veintisiete sin leer,
 * el número rojo decía veintisiete y la lista dejaba llegar a veinte: siete
 * avisos sin abrir que no había cómo alcanzar, y una cuenta que no bajaba a
 * cero aunque uno leyera todo lo que veía.
 */
test('la campanita pone primero lo que está sin leer, y dice si quedaron más atrás', () => {
  const suyo = cuenta('Quien Recibe de a Montones', { iglesia: norte });
  for (let i = 1; i <= 27; i++) {
    mensajes.enviar(jefa, { titulo: `Aviso número ${i}`, cuerpo: 'x', destino: 'personas', valor: [suyo.id] });
  }
  const panel = avisos.paraLaCampanita(suyo.id, 20);
  assert.equal(panel.sinLeer, 27);
  assert.equal(panel.ultimos.length, 20);
  assert.equal(panel.hayMas, true, 'sin esto, la pantalla no sabe que tiene que ofrecer «ver más»');

  const masGrande = avisos.paraLaCampanita(suyo.id, 40);
  assert.equal(masGrande.ultimos.length, 27, 'pidiendo más se alcanza a todos');
  assert.equal(masGrande.hayMas, false);
});

test('y un aviso viejo sin leer no queda debajo de uno nuevo ya leído', () => {
  const suyo = cuenta('Quien Deja Uno sin Abrir', { iglesia: norte });
  const viejo = mensajes.enviar(jefa, { titulo: 'El viejo sin abrir', cuerpo: 'x', destino: 'personas', valor: [suyo.id] });
  for (let i = 1; i <= 25; i++) {
    const nuevo = mensajes.enviar(jefa, { titulo: `Nuevo ${i}`, cuerpo: 'x', destino: 'personas', valor: [suyo.id] });
    const aviso = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
      .get(suyo.id, `mensaje:${nuevo.id}`);
    avisos.marcarLeida(suyo.id, aviso.id);
  }
  const panel = avisos.paraLaCampanita(suyo.id, 20);
  assert.equal(panel.sinLeer, 1);
  assert.equal(panel.ultimos[0].titulo, 'El viejo sin abrir',
    'por fecha quedaba el vigésimo sexto y no se veía nunca; es justo el que había que leer');
  assert.equal(viejo.error, undefined);
});

test('los mensajes recibidos son solo los mensajes, y solo los de uno', () => {
  const suyo = cuenta('Quien Guarda lo Suyo', { iglesia: norte });
  const otro = cuenta('Quien No Tiene Nada', { iglesia: norte });
  mensajes.enviar(jefa, { titulo: 'Para el que guarda', cuerpo: 'Texto largo', destino: 'personas', valor: [suyo.id] });
  avisos.crear({ usuario_id: suyo.id, tipo: 'cumpleanos_hoy', clave: 'cumple:99', titulo: 'Alguien cumple' });

  const mios = avisos.recibidos(suyo.id, {});
  assert.equal(mios.total, 1, 'los avisos que hace el sistema no son mensajes de nadie');
  assert.equal(mios.mensajes[0].titulo, 'Para el que guarda');
  assert.equal(mios.mensajes[0].de, jefa.nombre);
  assert.equal(mios.mensajes[0].cuerpo, 'Texto largo', 'con su texto entero: es para volver a leerlo');

  const delOtro = avisos.recibidos(otro.id, {});
  assert.equal(delOtro.total, 0, 'y nadie ve los de otro');
  assert.deepEqual(delOtro.mensajes, [], 'ni en la lista, que es por donde se colarían');
});

test('mirarlos no marca nada como leído', () => {
  /*
   * Quien abre esa pantalla puede estar releyendo lo del mes pasado. Dar por
   * leído de una pasada todo lo que aparece le mentiría a quien lo mandó, que
   * cuenta los leídos para saber si hace falta insistir.
   */
  const suyo = cuenta('Quien Solo Mira', { iglesia: norte });
  const salida = mensajes.enviar(jefa, { titulo: 'Sin abrir todavía', cuerpo: 'x', destino: 'personas', valor: [suyo.id] });
  avisos.recibidos(suyo.id, {});
  avisos.recibidos(suyo.id, { limit: 100 });
  assert.equal(avisos.paraLaCampanita(suyo.id, 5).sinLeer, 1);
  assert.equal(mensajes.loQueSeHaMandado(jefa, 200).find((m) => m.id === salida.id).leidos, 0);
});

test('la lista se pide por partes sin repetir ni saltarse ninguno', () => {
  const suyo = cuenta('Quien Recibe Muchos', { iglesia: norte });
  for (let i = 1; i <= 12; i++) {
    mensajes.enviar(jefa, { titulo: `Por partes ${i}`, cuerpo: 'x', destino: 'personas', valor: [suyo.id] });
  }
  const primera = avisos.recibidos(suyo.id, { limit: 5 });
  const segunda = avisos.recibidos(suyo.id, { limit: 5, offset: 5 });
  const tercera = avisos.recibidos(suyo.id, { limit: 5, offset: 10 });
  assert.equal(primera.total, 12);
  assert.deepEqual([primera.hayMas, segunda.hayMas, tercera.hayMas], [true, true, false]);
  const juntos = [...primera.mensajes, ...segunda.mensajes, ...tercera.mensajes].map((m) => m.id);
  assert.equal(new Set(juntos).size, 12, 'ni repetidos ni saltados');
});

// ------------------------------------------ de parte de quién viene el aviso

/*
 * El aviso llegaba con título, texto y fecha, y nada más: el nombre de quien lo
 * mandó quedaba guardado en el registro del envío y no viajaba. Un mensaje sin
 * firma se lee como si lo dijera «el sistema», y el sistema no cambia la hora de
 * una reunión: la cambia una persona a la que uno le puede preguntar.
 */
test('el aviso de un mensaje dice de quién viene', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Se adelanta el ensayo', cuerpo: 'Media hora antes.', destino: 'personas', valor: [ana.id],
  });
  const suyo = db.prepare('SELECT * FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  assert.equal(suyo.de, jefa.nombre);

  const enLaCampanita = avisos.paraLaCampanita(ana.id, 5).ultimos[0];
  assert.equal(enLaCampanita.de, jefa.nombre, 'y la campanita lo trae, que es donde se lee');
});

test('los avisos que escribe el sistema no llevan firma', () => {
  /*
   * No vienen de nadie: los hace el sistema mirando los datos, y firmarlos
   * sería inventar un autor. Se prueban las dos puertas —la que usa el vigía y
   * la que usan los avisos sueltos— porque por cualquiera de las dos se podría
   * colar una firma de más.
   */
  const delVigia = avisos.crear({
    usuario_id: ana.id, tipo: 'credencial_por_vencer', clave: 'credencial_vence:31', titulo: 'Vence una credencial',
  });
  assert.equal(delVigia.de, null);

  const suelto = avisos.avisar({
    usuario_id: ana.id, tipo: 'solicitud_asignada', clave: 'solicitud:404', titulo: 'Le tocó una solicitud',
  });
  assert.equal(suelto.de, null);
});

test('en el teléfono la firma va en el texto, no en el título', () => {
  /*
   * El título es lo poco que se alcanza a leer en una pantalla bloqueada.
   * Gastarlo en un nombre puede dejar fuera justamente lo que había que decir.
   */
  empujones.length = 0;
  mensajes.enviar(jefa, {
    titulo: 'Se suspende el ensayo', cuerpo: 'Por la lluvia.',
    destino: 'personas', valor: [ana.id], urgente: true,
  });
  assert.equal(empujones.length, 1);
  assert.equal(empujones[0].aviso.titulo, 'Se suspende el ensayo');
  assert.equal(empujones[0].aviso.cuerpo, `${jefa.nombre}: Por la lluvia.`);
});

test('la migración se la pone a los avisos que ya estaban repartidos', () => {
  const { elAvisoDiceDeQuienViene } = require('../../server/migraciones');
  const salida = mensajes.enviar(jefa, {
    titulo: 'De antes de la firma', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  db.prepare('UPDATE notificaciones SET de = NULL WHERE clave = ?').run(`mensaje:${salida.id}`);
  db.prepare('DELETE FROM migraciones WHERE nombre = ?').run('los avisos de un mensaje dicen de quién vienen');

  elAvisoDiceDeQuienViene();
  const firmados = db.prepare('SELECT de FROM notificaciones WHERE clave = ?').all(`mensaje:${salida.id}`);
  assert.equal(firmados.length, 2);
  assert.ok(firmados.every((f) => f.de === jefa.nombre), 'el nombre se recupera: el aviso dice de qué mensaje es');
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

// ------------------------------- el mensaje largo: en la campanita y en el teléfono

/*
 * El texto podía tener hasta dos mil caracteres y viajaba entero a los dos
 * lados. En la campanita, mil quinientos caracteres medían 598 px sobre un panel
 * de 592: un solo aviso tapaba todos los demás. Y al teléfono, con el largo
 * máximo y palabras acentuadas, la carga daba 4.317 bytes contra los 4.096 que
 * garantiza el estándar; el servicio la rechaza y el error queda solo en el
 * registro del servidor.
 */
test('al teléfono va un extracto, no el texto entero', () => {
  empujones.length = 0;
  const largo = 'La campaña parte el primero de octubre y cada cuerpo entrega su plan antes del viernes. '.repeat(20);
  mensajes.enviar(jefa, {
    titulo: 'Instrucciones de la campaña', cuerpo: largo,
    destino: 'personas', valor: [ana.id], urgente: true,
  });
  assert.equal(empujones.length, 1);
  const alTelefono = empujones[0].aviso.cuerpo;
  assert.ok(alTelefono.length <= avisos.LARGO_EN_EL_TELEFONO + 1, `viajaron ${alTelefono.length} caracteres`);
  assert.ok(alTelefono.endsWith('…'), 'y se dice que sigue');
  assert.ok(alTelefono.startsWith(`${jefa.nombre}: La campaña parte`), 'con la firma y el principio de lo que dice');
});

test('y la carga del empujón no se acerca al techo del estándar', () => {
  const carga = JSON.stringify({
    titulo: 'á'.repeat(120),
    cuerpo: avisos.paraElTelefono('ó'.repeat(2000)),
    enlace: '#/m/solicitudes',
    etiqueta: 'mensaje:12345',
  });
  assert.ok(Buffer.byteLength(carga) < 1000,
    `la carga da ${Buffer.byteLength(carga)} bytes; antes daba 4.317 contra un techo de 4.096`);
});

test('lo corto viaja tal cual, sin puntos suspensivos', () => {
  empujones.length = 0;
  mensajes.enviar(jefa, {
    titulo: 'Se suspende', cuerpo: 'Por la lluvia.', destino: 'personas', valor: [ana.id], urgente: true,
  });
  assert.equal(empujones[0].aviso.cuerpo, `${jefa.nombre}: Por la lluvia.`);
});

test('el recorte no parte una palabra por la mitad', () => {
  // El «abc» de adelante corre el corte para que caiga DENTRO de una palabra:
  // con las palabras justo calzadas, cortar a lo bruto daba el mismo resultado
  // y la prueba no probaba nada
  const cortado = avisos.paraElTelefono(`abc ${'palabra '.repeat(40)}`);
  assert.ok(!/palab…$/.test(cortado), `quedó «${cortado.slice(-20)}»`);
  assert.match(cortado, /palabra…$/);
  // pero una sola palabra larguísima se corta igual: no hay dónde
  assert.equal(avisos.paraElTelefono('x'.repeat(500)).length, avisos.LARGO_EN_EL_TELEFONO + 1);
});

test('el texto entero se guarda igual: lo que se recorta es lo que viaja', () => {
  const largo = 'Cada cuerpo entrega su plan antes del viernes. '.repeat(20);
  const salida = mensajes.enviar(jefa, {
    titulo: 'Con todo el texto', cuerpo: largo, destino: 'personas', valor: [ana.id],
  });
  assert.equal(mensajes.unEnvio(jefa, salida.id).cuerpo, largo.trim());
  assert.equal(avisos.recibidos(ana.id, { limit: 1 }).mensajes[0].cuerpo, largo.trim());

  // Y el aviso guardado también: la campanita es donde queda la constancia, y
  // una constancia recortada no es una constancia
  const suyo = db.prepare('SELECT cuerpo FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  assert.equal(suyo.cuerpo, largo.trim());
});

// ----------------------------- a quiénes fue, y poder releer lo que se mandó

/*
 * El registro decía cuántos eran y no cuáles —«A 3 personas elegidas» no
 * contesta la pregunta más obvia que se le hace a una constancia— y la pantalla
 * no mostraba el texto, que estaba guardado y no se veía en ninguna parte.
 */
test('queda anotado a quiénes fue cada mensaje', () => {
  const salida = mensajes.enviar(jefa, {
    titulo: 'Reunión de coordinación', cuerpo: 'El jueves a las 19:00.',
    destino: 'personas', valor: [ana.id, beto.id],
  });
  const abierto = mensajes.unEnvio(jefa, salida.id);
  assert.deepEqual(abierto.destinatarios.map((x) => x.nombre).sort(), [ana.nombre, beto.nombre].sort());
  assert.equal(abierto.cuerpo, 'El jueves a las 19:00.', 'y lo que decía, para poder releerlo');
  assert.equal(abierto.destino_dice, 'A 2 personas elegidas');
});

test('el nombre queda escrito, para cuando la cuenta ya no esté', () => {
  const seVa = cuenta('Quien Después se Borra', { iglesia: norte });
  const salida = mensajes.enviar(jefa, { titulo: 'Al que se fue', cuerpo: 'x', destino: 'personas', valor: [seVa.id] });
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(seVa.id);
  const abierto = mensajes.unEnvio(jefa, salida.id);
  assert.equal(abierto.destinatarios[0].nombre, 'Quien Después se Borra',
    'la constancia tiene que seguir diciendo a quién se le escribió');
});

test('pero sigue sin decir quién lo leyó', () => {
  const salida = mensajes.enviar(jefa, { titulo: 'Para mirar los leídos', cuerpo: 'x', destino: 'personas', valor: [ana.id] });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(ana.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(ana.id, suyo.id);
  const abierto = mensajes.unEnvio(jefa, salida.id);
  assert.equal(abierto.leidos, 1, 'cuántos, sí');
  assert.deepEqual(Object.keys(abierto.destinatarios[0]).sort(), ['nombre', 'usuario_id'],
    'quiénes, no: saber quién abrió qué sería vigilar a la gente por dentro del sistema');
});

test('un envío ajeno no se abre', () => {
  const jefeDeAlla = cuenta('Jefe que Abre de Más', { iglesia: sur, administra: [sur], rol: 'admin' });
  const mio = mensajes.enviar(jefa, { titulo: 'Que no lo abran', cuerpo: 'x', destino: 'personas', valor: [ana.id] });
  assert.equal(mensajes.unEnvio(jefeDeAlla, mio.id), null,
    'abrirlo es lo mismo que mirarlo en la lista: el mismo alcance');
});

test('«Mis mensajes» ya no depende de que el aviso siga ahí', () => {
  const quien = cuenta('Quien Guarda para Siempre', { iglesia: norte });
  const salida = mensajes.enviar(jefa, {
    titulo: 'De hace medio año', cuerpo: 'Lo que se dijo entonces', destino: 'personas', valor: [quien.id],
  });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(quien.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(quien.id, suyo.id);
  db.prepare("UPDATE notificaciones SET leida_en = date('now','localtime','-200 days') WHERE clave = ?")
    .run(`mensaje:${salida.id}`);
  avisos.limpiarLosViejos(90);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notificaciones WHERE clave = ?').get(`mensaje:${salida.id}`).c, 0);

  const mios = avisos.recibidos(quien.id, {});
  assert.equal(mios.total, 1, 'lo que uno quiere volver a leer no se puede ir con el aviso');
  assert.equal(mios.mensajes[0].titulo, 'De hace medio año');
  assert.equal(mios.mensajes[0].cuerpo, 'Lo que se dijo entonces');
  assert.equal(mios.mensajes[0].de, jefa.nombre);
  assert.equal(mios.mensajes[0].leida, 1, 'sin aviso y sin retiro, es que lo leyó');
});

test('y un mensaje retirado antes de abrirlo no le queda a nadie', () => {
  const quien = cuenta('Quien No Alcanzó a Verlo', { iglesia: norte });
  const salida = mensajes.enviar(jefa, { titulo: 'Retirado a tiempo', cuerpo: 'x', destino: 'personas', valor: [quien.id] });
  assert.equal(avisos.recibidos(quien.id, {}).total, 1);
  mensajes.retirar(jefa, salida.id);
  assert.equal(avisos.recibidos(quien.id, {}).total, 0,
    'retirarlo quiere decir justamente eso: no alcanzó a verlo');
});

test('pero el que sí alcanzó a leerlo lo conserva', () => {
  const rapido = cuenta('Quien lo Leyó Enseguida', { iglesia: norte });
  const lento = cuenta('Quien no lo Abrió', { iglesia: norte });
  const salida = mensajes.enviar(jefa, {
    titulo: 'Retirado a medias', cuerpo: 'x', destino: 'personas', valor: [rapido.id, lento.id],
  });
  const suyo = db.prepare('SELECT id FROM notificaciones WHERE usuario_id = ? AND clave = ?')
    .get(rapido.id, `mensaje:${salida.id}`);
  avisos.marcarLeida(rapido.id, suyo.id);
  mensajes.retirar(jefa, salida.id);
  assert.equal(avisos.recibidos(rapido.id, {}).total, 1, 'ya lo vio: borrárselo sería reescribirle lo que recuerda');
  assert.equal(avisos.recibidos(lento.id, {}).total, 0);
});

test('la migración rescata a quiénes fue lo que ya estaba mandado', () => {
  const { losDestinatariosQuedanAnotados } = require('../../server/migraciones');
  const salida = mensajes.enviar(jefa, {
    titulo: 'De antes de la lista', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  db.prepare('DELETE FROM mensajes_destinatarios WHERE mensaje_id = ?').run(salida.id);
  db.prepare('DELETE FROM migraciones WHERE nombre = ?').run('a quiénes fue cada mensaje queda anotado');
  assert.deepEqual(mensajes.unEnvio(jefa, salida.id).destinatarios, []);

  /*
   * Y uno mandado con la versión nueva, que YA los tiene anotados, no puede
   * quedar con todo repetido: la migración corre una vez sobre una base donde
   * conviven los de antes y los de después.
   */
  const yaLosTenia = mensajes.enviar(jefa, {
    titulo: 'De después de la lista', cuerpo: 'x', destino: 'personas', valor: [ana.id, beto.id],
  });
  assert.equal(mensajes.unEnvio(jefa, yaLosTenia.id).destinatarios.length, 2);

  losDestinatariosQuedanAnotados();
  const rescatados = mensajes.unEnvio(jefa, salida.id).destinatarios;
  assert.deepEqual(rescatados.map((x) => x.nombre).sort(), [ana.nombre, beto.nombre].sort(),
    'lo que todavía se puede saber está en los avisos que llevan la clave del mensaje');
  assert.equal(mensajes.unEnvio(jefa, yaLosTenia.id).destinatarios.length, 2,
    'y al que ya los tenía no se le repiten');
});

// ------------------------------------ el ritmo: cuántos se pueden mandar seguidos

/*
 * El tope de quinientos es POR ENVÍO. No había ninguno para la cantidad de
 * envíos, y medido salieron veinticinco mensajes urgentes seguidos a la misma
 * persona en 85 ms. Por separado las dos reglas están bien; juntas dejan un
 * hueco, porque el aviso de un mensaje no se puede apagar en la campanita.
 */
const ritmo = require('../../server/avisos/ritmo');

test('deja mandar hasta el tope y después frena', () => {
  ritmo.olvidarTodo();
  const quien = 90001;
  for (let i = 0; i < ritmo.DE_FABRICA; i++) {
    assert.equal(ritmo.cuantoLeFalta(quien), 0, `el envío ${i + 1} tenía que pasar`);
    ritmo.anotarEnvio(quien);
  }
  assert.ok(ritmo.cuantoLeFalta(quien) > 0, 'el que sigue, no');
  assert.equal(ritmo.cuantosLleva(quien), ritmo.DE_FABRICA);
});

test('y dice cuánto falta, en vez de un «no» a secas', () => {
  ritmo.olvidarTodo();
  const quien = 90002;
  const ahora = Date.now();
  for (let i = 0; i < ritmo.DE_FABRICA; i++) ritmo.anotarEnvio(quien, ahora);
  const faltan = ritmo.cuantoLeFalta(quien, ahora);
  assert.equal(faltan, Math.ceil(ritmo.VENTANA_MS / 1000), 'recién mandados: falta la hora entera');
  assert.match(ritmo.comoSeExplica(faltan), /Puede mandar otro en 60 minutos/);
  assert.match(ritmo.comoSeExplica(faltan), /no se puede apagar/,
    'el porqué importa: sin eso el tope parece un capricho');
});

test('pasada la hora vuelve a dejar', () => {
  ritmo.olvidarTodo();
  const quien = 90003;
  const hace61 = Date.now() - 61 * 60 * 1000;
  for (let i = 0; i < ritmo.DE_FABRICA; i++) ritmo.anotarEnvio(quien, hace61);
  assert.equal(ritmo.cuantosLleva(quien), 0, 'los de hace más de una hora ya no cuentan');
  assert.equal(ritmo.cuantoLeFalta(quien), 0);
});

test('el tope es de cada persona, no del sistema', () => {
  ritmo.olvidarTodo();
  for (let i = 0; i < ritmo.DE_FABRICA; i++) ritmo.anotarEnvio(90004);
  assert.ok(ritmo.cuantoLeFalta(90004) > 0);
  assert.equal(ritmo.cuantoLeFalta(90005), 0, 'que uno se pase no puede callar a los demás');
});

test('la ruta solo gasta el tope con lo que salió', () => {
  /*
   * Un rechazo por falta de título, o la pregunta de «le va a llegar a mucha
   * gente», no pueden gastar: si gastaran, contestar que sí costaría dos, y
   * quien se equivoca al escribir pagaría por equivocarse.
   */
  const rutas = fs.readFileSync(path.join(__dirname, '../../server/avisos/rutas.js'), 'utf8');
  const trozo = rutas.slice(rutas.indexOf("router.post('/avisos/mensajes'"),
    rutas.indexOf("router.post('/avisos/mensajes'") + 1200);
  assert.match(trozo, /if \(salida\.error\) return res\.status\(400\)[\s\S]*ritmo\.anotarEnvio/,
    'la anotación tiene que ir DESPUÉS de la salida por error');
  assert.match(trozo, /const falta = ritmo\.cuantoLeFalta\(req\.user\.id\);/);
  assert.match(trozo, /res\.status\(429\)/, 'y el freno se dice con el código que le corresponde');
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

test('la campanita muestra de quién viene, cuando viene de alguien', () => {
  const trozo = app.slice(app.indexOf('function abrirElPanelDeAvisos('),
    app.indexOf('function abrirElPanelDeAvisos(') + 2200);
  assert.match(trozo, /a\.de \? `<div class="cam-de">de \$\{esc\(a\.de\)\}<\/div>` : ''/,
    'y solo cuando viene de alguien: los avisos del sistema no se firman');
});

test('la campanita separa los ya leídos y ofrece ver más', () => {
  const trozo = app.slice(app.indexOf('async function abrirElPanelDeAvisos('),
    app.indexOf('async function abrirElPanelDeAvisos(') + 3200);
  assert.match(trozo, /const primerLeido = d\.ultimos\.findIndex\(\(a\) => a\.leida\);/,
    'ver un aviso de la semana pasada encima de uno de hoy parece que la lista está desordenada');
  assert.match(trozo, /cam-corte">Ya leídos/);
  assert.match(trozo, /d\.hayMas \? '<div class="cam-mas">/, 'y se puede llegar a los de más atrás');
  assert.match(trozo, /href="#\/mis-mensajes"/, 'con la puerta a los mensajes recibidos donde se los busca');
});

test('la pantalla de los recibidos no marca nada al abrirse', () => {
  const trozo = app.slice(app.indexOf('async function viewMisMensajes('),
    app.indexOf('async function viewMisMensajes(') + 3600);
  assert.ok(!/\/leido'\)|\/avisos\/leidos/.test(trozo.split('data-leido')[0]),
    'abrirla no puede dar por leído lo que uno solo hojeó');
  assert.match(trozo, /data-leido="\$\{m\.id\}"/, 'se marca uno por uno, y a propósito');
  assert.match(trozo, /msg-texto">\$\{esc\(m\.cuerpo\)\}/, 'con el texto entero, que es para lo que sirve');
});

test('la pantalla dice el número en los cuatro destinos', () => {
  const trozo = app.slice(app.indexOf('const aCuantos = () => {'), app.indexOf('const aCuantos = () => {') + 700);
  assert.match(trozo, /elegido\.dataset\.cuantos/,
    'la iglesia y el perfil son justo los dos que pueden alcanzar a mucha gente');
  assert.ok(!/return null;/.test(trozo), 'ya no hay un destino que no diga nada');
  assert.match(app, /data-cuantos="\$\{i\.cuantos\}"/);
});

test('y pregunta con los dos botones antes de mandarlo a mucha gente', () => {
  assert.match(app, /le_llega_a_muchos: \{[\s\S]{0,60}Le va a llegar a mucha gente/);
  const trozo = app.slice(app.indexOf('async function mandar(igualAsi)'),
    app.indexOf('async function mandar(igualAsi)') + 2400);
  assert.match(trozo, /preguntarSiIgualVa\(err, \(\) => mandar\(true\), 'msgError'\)/,
    'y al decir que sí se manda de nuevo, no se pierde lo escrito');
  assert.match(trozo, /igual_asi: !!igualAsi/);
});

test('la pantalla deja abrir un envío y ver a quiénes fue', () => {
  const trozo = app.slice(app.indexOf("querySelectorAll('[data-abrir]')"),
    app.indexOf("querySelectorAll('[data-abrir]')") + 1800);
  assert.match(trozo, /\/avisos\/mensajes\/\$\{boton\.dataset\.abrir\}/);
  assert.match(trozo, /msg-texto">\$\{esc\(e\.cuerpo/, 'con el texto, que estaba guardado y no se veía');
  assert.match(trozo, /msg-aquienes[\s\S]{0,120}A quiénes fue/);
  assert.match(trozo, /e\.destinatarios\.map\(\(x\) => `<li>/, 'con la lista, no solo el título');
  assert.match(trozo, /es de antes de que se guardara/,
    'de un mensaje viejo se dice que no quedó anotado, en vez de mostrar una lista vacía');
});

test('en la campanita el texto va recortado, y tocarlo lleva a donde está entero', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/styles.css'), 'utf8');
  const regla = css.slice(css.indexOf('.cam-c {'), css.indexOf('.cam-c {') + 260);
  assert.match(regla, /-webkit-line-clamp: 3/,
    'mil quinientos caracteres medían 598 px sobre un panel de 592: tapaban todo lo demás');
  assert.match(regla, /overflow: hidden/);

  const trozo = app.slice(app.indexOf("panel.querySelectorAll('.cam-lista li[data-id]')"),
    app.indexOf("panel.querySelectorAll('.cam-lista li[data-id]')") + 1200);
  assert.match(trozo, /li\.dataset\.tipo === 'mensaje'\) location\.hash = '\/mis-mensajes'/,
    'un texto recortado que no lleva a ninguna parte es peor que no recortarlo');
});

test('en las preferencias, lo que no se puede apagar sale dicho y no como casilla', () => {
  const trozo = app.slice(app.indexOf('/avisos/preferencias'));
  assert.match(trozo.slice(0, 4000), /t\.siempre\s*\n?\s*\?/,
    'una casilla que no obedece es peor que no tenerla: parece que uno eligió algo');
});
