/**
 * Las reglas propias del módulo de Credenciales, corridas por el motor.
 *
 * El archivo del módulo dedica sus párrafos más largos a tres reglas, y una de
 * ellas viene con la anotación «Comprobado que pasaba»: fue un agujero real que
 * alguien encontró y tapó. NINGUNA DE LAS TRES TENÍA PRUEBA. Rotas a propósito
 * —anulando el gancho, una por una— ni el motor entero ni las suites completas
 * de aceptación y seguridad se enteraban.
 *
 * Lo que sí estaba bien cubierto eran las piezas sueltas —el número de serie,
 * el código de autenticidad, el QR, la página pública— y los permisos vistos
 * desde afuera. Lo que quedaba al descubierto era el corazón del módulo: el
 * gancho `beforeSave`, el `beforeDelete` y las dos rutas que cambian de estado.
 *
 * Por eso esto corre sobre el sistema ANDANDO y no llamando al gancho a mano:
 * una regla que se prueba a mano puede estar escrita, comprobada y desconectada
 * —ver la cabecera de andando.js, donde eso ya pasó una vez—.
 *
 * DOS DE LAS TRES TIENEN DOS CAPAS Y UNA TIENE UNA SOLA, y conviene saber cuál
 * es cuál:
 *
 *   · el ESTADO y los campos CONGELADOS están además marcados de solo lectura,
 *     así que el motor los descarta antes de llegar al gancho: rota una capa,
 *     la otra aguanta;
 *   · el TITULAR de otra iglesia lo frenan dos: primero la comprobación
 *     general de referencias del motor —`referenciasFueraDeAlcance`, que mira
 *     que el pastor elegido esté dentro de lo asignado y contesta 403— y
 *     después el gancho, que lo vuelve a mirar tomando la iglesia DE LA FICHA
 *     del pastor. Medido: quitando el gancho, la petición sigue rechazada.
 *
 * De ahí que estas pruebas vayan por el sistema andando y comprueben LO QUE SE
 * VE —que la petición se rechaza y que no vuelve ningún dato de esa persona—,
 * y no cuál de las dos capas contestó. Es lo correcto: mañana una de ellas
 * puede reescribirse, y lo que no puede cambiar es el resultado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');
const { db } = require('../../server/db');
const { digitoVerificador } = require('../../server/rut');

test.after(cerrarElSistema);

/* --------------------------------------------------------------------- */
/* Lo que hace falta para poder emitir de verdad                          */
/* --------------------------------------------------------------------- */

let n = 0;
const propio = () => `${process.pid % 100000}${String(++n).padStart(3, '0')}`;

/**
 * Un RUT válido que no choque con los de los otros archivos del motor.
 *
 * Ocho dígitos: el 2 de cabecera, tres del proceso y cuatro de un contador
 * propio. Los archivos del motor corren en paralelo sobre una misma base, así
 * que el número tiene que ser único entre procesos Y dentro de cada uno.
 */
function unRut() {
  const cuerpo = String(20000000 + (process.pid % 1000) * 10000 + (n % 10000));
  return `${cuerpo}-${digitoVerificador(cuerpo)}`;
}

function unaIglesia(nombre) {
  return db
    .prepare("INSERT INTO iglesias (nombre, codigo, tipo, ciudad, estado) VALUES (?,?,'Iglesia Local','Concepción','Activa')")
    .run(`${nombre} ${propio()}`, `C${propio()}`).lastInsertRowid;
}

function unPastor(iglesiaId, cargo = 'Pastor Diácono') {
  return db
    .prepare(
      `INSERT INTO pastores (nombres, apellidos, rut, cargo, iglesia_id, estado, foto)
       VALUES ('Juan Carlos', 'Soto Martínez', ?, ?, ?, 'Activo', 'foto.png')`
    )
    .run(unRut(), cargo, iglesiaId).lastInsertRowid;
}

/** Una cuenta acotada a unas iglesias, para poder chocar con el alcance. */
function unaCuentaAcotada(iglesias) {
  const rut = unRut();
  return db
    .prepare("INSERT INTO usuarios (rut, nombre, rol, activo, debe_cambiar_password, iglesias) VALUES (?,?,'admin',1,0,?)")
    .run(rut, `Acotada ${propio()}`, JSON.stringify(iglesias)).lastInsertRowid;
}

/**
 * Los recursos que la emisión exige: sin el logo, el sello y la firma no se
 * puede emitir, y esta prueba no va de eso.
 */
function conLosRecursosCargados() {
  const ajustes = require('../../server/ajustes');
  /*
   * Se ponen SIEMPRE, no solo si están vacíos.
   *
   * Decía «si no hay ninguno, pon uno», y eso es depender de lo que haya dejado
   * otro: los tres son UNO SOLO para todo el sistema —no cuelgan de ninguna
   * ficha— y los archivos del motor corren en paralelo sobre una misma base.
   * Bastaba con que otra prueba dejara el logo en blanco un instante para que
   * acá no se pudiera emitir, y el fallo salía en esta prueba, que no va de eso.
   */
  for (const cual of ['iglesia_logo', 'credencial_sello', 'credencial_firma']) {
    ajustes.guardar(cual, `${cual}.png`);
  }
}

/** Un borrador ya emitido, listo para probar lo que pasa después. */
async function unaEmitida(api, iglesiaId) {
  conLosRecursosCargados();
  const pastorId = unPastor(iglesiaId);
  const creada = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  assert.equal(creada.estado, 201, `no se pudo crear el borrador: ${creada.texto.slice(0, 200)}`);
  const emitida = await api('POST', `/credenciales/${creada.json.id}/emitir`, {});
  assert.equal(emitida.estado, 200, `no se pudo emitir: ${emitida.texto.slice(0, 250)}`);
  return { id: creada.json.id, pastorId, fila: emitida.json.credencial };
}

/* --------------------------------------------------------------------- */
/* 1 · El estado no se cambia desde el formulario                         */
/* --------------------------------------------------------------------- */

test('una credencial nace como borrador, aunque se pida otra cosa', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Nace');
  const pastorId = unPastor(iglesia);
  const r = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
    estado: 'Vigente',
  });
  assert.equal(r.estado, 201);
  assert.equal(r.json.estado, 'Borrador',
    'nace como borrador: la vigencia la da el botón de emitir, que es lo que asigna el número');
  assert.equal(r.json.serie, null, 'y sin número de serie');
});

test('un borrador no salta a vigente por el guardado corriente', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Salto');
  const pastorId = unPastor(iglesia);
  const creada = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  const antes = (await api('GET', `/credenciales/${creada.json.id}`)).json;
  await api('PUT', `/credenciales/${creada.json.id}`, { ...antes, estado: 'Vigente' });
  const despues = (await api('GET', `/credenciales/${creada.json.id}`)).json;
  assert.equal(despues.estado, 'Borrador', 'sigue siendo borrador');
  assert.equal(despues.serie, null, 'y sigue sin número: una vigente sin número sería peor que un error');
});

test('una emitida no se revoca por el guardado corriente', async () => {
  /**
   * Ésta es la que trae la anotación «Comprobado que pasaba». Con el permiso de
   * EDITAR credenciales, sin la llave de revocar, se podía mandar
   * `estado: 'Revocada'` por el guardado de siempre y anular la credencial de
   * cualquiera; o al revés, devolver a vigente una revocada y que la página
   * pública volviera a darla por buena.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Revocar');
  const { id } = await unaEmitida(api, iglesia);
  const antes = (await api('GET', `/credenciales/${id}`)).json;

  const r = await api('PUT', `/credenciales/${id}`, {
    ...antes, estado: 'Revocada', motivo_revocacion: 'sin pasar por el botón',
  });
  const despues = (await api('GET', `/credenciales/${id}`)).json;
  assert.equal(despues.estado, 'Vigente', `quedó en ${despues.estado} (la llamada respondió ${r.estado})`);

  /**
   * El texto del motivo SÍ se guarda, y no pasa nada: es un campo corriente
   * que la pantalla solo muestra cuando la credencial está revocada, y la
   * página pública solo lo entrega en ese caso —ver el `situacion ===
   * 'Revocada' ?` de credenciales/verificacion.js—. Queda anotado acá porque
   * se descubrió escribiendo esta prueba, y porque lo que importa es que ese
   * texto NO pueda salir mientras la credencial vale.
   */
  const verificada = require('../../server/credenciales/verificacion').verificar(
    require('../../server/credenciales/serie').conDigito(despues.serie, despues.serie_dv),
    require('../../server/credenciales/qr').queCodigoLeToca(despues),
    { buscar: () => despues, situacionDe: require('../../server/modules/credenciales').situacionDe }
  );
  assert.equal(verificada.valida, true, 'la credencial sigue verificando');
  assert.equal(verificada.situacion, 'Vigente');
  assert.equal(verificada.datos.motivo_revocacion, '',
    'un motivo escrito sobre una credencial que NO está revocada no puede salir a la página pública');
});

test('y una revocada no vuelve a valer por el guardado corriente', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Volver');
  const { id } = await unaEmitida(api, iglesia);
  await api('POST', `/credenciales/${id}/revocar`, { motivo: 'Se extravió' });
  assert.equal((await api('GET', `/credenciales/${id}`)).json.estado, 'Revocada');

  const antes = (await api('GET', `/credenciales/${id}`)).json;
  await api('PUT', `/credenciales/${id}`, { ...antes, estado: 'Vigente' });
  const despues = (await api('GET', `/credenciales/${id}`)).json;
  assert.equal(despues.estado, 'Revocada',
    'devolverla a vigente haría que la página pública volviera a darla por buena');
});

/* --------------------------------------------------------------------- */
/* 2 · Lo impreso no se reescribe una vez emitida                         */
/* --------------------------------------------------------------------- */

test('lo que salió impreso queda congelado cuando la ficha cambia', async () => {
  /**
   * Es el caso de la vida real, y el único que prueba de verdad la regla: la
   * persona sube de grado o se traslada DESPUÉS de que le entregaron su
   * credencial. El papel que anda en su bolsillo tiene que seguir diciendo lo
   * que decía, y la fila también, o el sistema y la tarjeta dejan de coincidir.
   *
   * Escrita al revés —mandando datos inventados por la API sin tocar la ficha—
   * esta prueba no probaba nada: el guardado los descarta y los vuelve a copiar
   * de la ficha, que no había cambiado, así que todo quedaba igual por el
   * motivo equivocado. Comprobado: rotas las dos capas que protegen lo
   * congelado, seguía en verde.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Congelada');
  const { id, pastorId } = await unaEmitida(api, iglesia);
  const antes = (await api('GET', `/credenciales/${id}`)).json;
  assert.equal(antes.snap_grado, 'Pastor Diácono');

  // La persona sube de grado y se traslada, después de que se le entregó
  const otraIglesia = unaIglesia('La nueva');
  db.prepare("UPDATE pastores SET cargo = 'Pastor Presbítero', nombres = 'José Miguel', iglesia_id = ? WHERE id = ?")
    .run(otraIglesia, pastorId);

  // Un guardado corriente de la credencial: se anota algo y se manda la ficha entera
  const r = await api('PUT', `/credenciales/${id}`, { ...antes, notas: 'anotación cualquiera' });
  assert.ok(r.estado < 400, `el guardado corriente tiene que seguir funcionando: ${r.texto.slice(0, 160)}`);

  const despues = (await api('GET', `/credenciales/${id}`)).json;
  assert.equal(despues.notas, 'anotación cualquiera', 'la anotación sí se guarda');
  for (const campo of ['snap_nombres', 'snap_apellidos', 'snap_grado', 'snap_iglesia',
    'snap_categoria', 'snap_rut', 'serie', 'serie_dv', 'iglesia_id']) {
    assert.equal(despues[campo], antes[campo],
      `${campo} siguió a la ficha: la tarjeta del bolsillo y esta fila dejaron de decir lo mismo`);
  }

  // Y tampoco se reescribe mandándolos a mano
  await api('PUT', `/credenciales/${id}`, {
    ...despues,
    snap_nombres: 'Otro', snap_apellidos: 'Nombre', snap_rut: '99999999-9',
    serie: '9999999', serie_dv: '9',
  });
  const alFinal = (await api('GET', `/credenciales/${id}`)).json;
  for (const campo of ['snap_nombres', 'snap_apellidos', 'snap_rut', 'serie', 'serie_dv']) {
    assert.equal(alFinal[campo], antes[campo], `${campo} se pudo reescribir a mano`);
  }
});

test('mientras es borrador, en cambio, los datos se refrescan de la ficha', async () => {
  /**
   * La otra mitad de la misma regla, y la que hace que no estorbe: un borrador
   * muestra lo que la ficha dice HOY. Si se congelara desde el principio, un
   * borrador preparado hace tres semanas se emitiría con datos viejos.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Refresca');
  const pastorId = unPastor(iglesia);
  const creada = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  assert.equal(creada.json.snap_grado, 'Pastor Diácono');

  db.prepare("UPDATE pastores SET cargo = 'Pastor Presbítero' WHERE id = ?").run(pastorId);
  const antes = (await api('GET', `/credenciales/${creada.json.id}`)).json;
  await api('PUT', `/credenciales/${creada.json.id}`, { ...antes, notas: 'una anotación' });
  const despues = (await api('GET', `/credenciales/${creada.json.id}`)).json;
  assert.equal(despues.snap_grado, 'Pastor Presbítero', 'el borrador se pone al día solo');
});

/* --------------------------------------------------------------------- */
/* 3 · El titular tiene que estar en una iglesia asignada                 */
/* --------------------------------------------------------------------- */

test('no se crea la credencial de un pastor de otra iglesia', async () => {
  /**
   * El comentario del gancho explica el agujero que esto tapa: quien tuviera
   * una iglesia asignada podía crear la credencial de un pastor de cualquier
   * otra mandando su número, y aunque la fila le quedara fuera de alcance —no
   * la volvía a ver— la RESPUESTA le devolvía el nombre y el RUT de esa
   * persona.
   *
   * Hoy lo frenan dos capas: la comprobación general de referencias del motor
   * y, detrás, el gancho del módulo. Se comprueba EL RESULTADO —rechazo y
   * ninguna filtración— y no cuál de las dos contestó: lo que no puede cambiar
   * es lo que la persona recibe.
   */
  await elSistemaAndando();
  const suya = unaIglesia('La suya');
  const ajena = unaIglesia('La ajena');
  const elDeAfuera = unPastor(ajena);
  const acotada = comoOtroUsuario(unaCuentaAcotada([suya]));

  const r = await acotada('POST', '/credenciales', {
    pastor_id: elDeAfuera, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  assert.ok(r.estado >= 400, `se creó igual: respondió ${r.estado}`);
  assert.match(r.texto, /fuera de (las iglesias|lo que)/i, `y dice por qué: ${r.texto.slice(0, 200)}`);
  assert.ok(!/Soto Mart/.test(r.texto), 'la respuesta no puede devolver el nombre de esa persona');
  assert.ok(!/\d{7,8}-[\dkK]/.test(r.texto), 'ni su RUT');
});

test('y la de un pastor de la suya sí se crea', async () => {
  // La otra mitad: la regla no puede estar frenando lo que corresponde
  await elSistemaAndando();
  const suya = unaIglesia('La propia');
  const elSuyo = unPastor(suya);
  const acotada = comoOtroUsuario(unaCuentaAcotada([suya]));
  const r = await acotada('POST', '/credenciales', {
    pastor_id: elSuyo, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  assert.equal(r.estado, 201, `no dejó crear la suya: ${r.texto.slice(0, 200)}`);
  assert.equal(r.json.iglesia_id, suya, 'y la iglesia se toma de la ficha del titular');
});

/* --------------------------------------------------------------------- */
/* 4 · Revocar exige el motivo, y una emitida no se borra                 */
/* --------------------------------------------------------------------- */

test('revocar sin motivo no se puede', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Sin motivo');
  const { id } = await unaEmitida(api, iglesia);
  for (const cuerpo of [{}, { motivo: '' }, { motivo: '   ' }]) {
    const r = await api('POST', `/credenciales/${id}/revocar`, cuerpo);
    assert.equal(r.estado, 400, `pasó con ${JSON.stringify(cuerpo)}`);
  }
  assert.equal((await api('GET', `/credenciales/${id}`)).json.estado, 'Vigente', 'y sigue vigente');
});

test('un borrador no se revoca: se elimina', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Borrador');
  const pastorId = unPastor(iglesia);
  const creada = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  const r = await api('POST', `/credenciales/${creada.json.id}/revocar`, { motivo: 'probando' });
  assert.equal(r.estado, 400);
  assert.match(r.texto, /borrador/i);

  const borrado = await api('DELETE', `/credenciales/${creada.json.id}`);
  assert.ok(borrado.estado < 400, `un borrador sí se borra, y respondió ${borrado.estado}`);
});

test('una credencial emitida no se borra nunca (puntos 10.2 y 17.6)', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('No se borra');
  const { id, fila } = await unaEmitida(api, iglesia);
  const r = await api('DELETE', `/credenciales/${id}`);
  assert.equal(r.estado, 400, `respondió ${r.estado}`);
  assert.match(r.texto, /no se puede eliminar/i);
  assert.match(r.texto, new RegExp(fila.serie), 'y la nombra por su número');
  assert.equal((await api('GET', `/credenciales/${id}`)).estado, 200, 'sigue estando');
});

test('y una revocada tampoco', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Revocada');
  const { id } = await unaEmitida(api, iglesia);
  await api('POST', `/credenciales/${id}/revocar`, { motivo: 'Se extravió' });
  const r = await api('DELETE', `/credenciales/${id}`);
  assert.equal(r.estado, 400, 'lo que hace que revocarla sirva de algo es que quede');
});

/* --------------------------------------------------------------------- */
/* 5 · Emitir: el número, el congelado y el reemplazo                     */
/* --------------------------------------------------------------------- */

test('emitir asigna el número, congela y deja vigente', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Emisión');
  const { id, fila } = await unaEmitida(api, iglesia);
  assert.equal(fila.estado, 'Vigente');
  assert.ok(fila.serie, 'tiene número de serie');
  assert.ok(fila.serie_dv !== null && fila.serie_dv !== '', 'y su dígito verificador');
  assert.equal(fila.snap_apellidos, 'Soto Martínez', 'con los datos de la ficha congelados');
  assert.equal(fila.iglesia_id, iglesia, 'y la iglesia del titular, que es de la que depende el alcance');
  const otraVez = await api('POST', `/credenciales/${id}/emitir`, {});
  assert.equal(otraVez.estado, 400, 'una credencial ya emitida no se vuelve a emitir');
});

test('al emitir la segunda, la anterior queda REEMPLAZADA y se conserva', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia('Reemplazo');
  conLosRecursosCargados();
  const pastorId = unPastor(iglesia);
  const primera = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  });
  await api('POST', `/credenciales/${primera.json.id}/emitir`, {});
  const segunda = await api('POST', '/credenciales', {
    pastor_id: pastorId, fecha_emision: '2026-06-01', fecha_vencimiento: '2028-06-01',
  });
  const emitida = await api('POST', `/credenciales/${segunda.json.id}/emitir`, {});
  assert.equal(emitida.estado, 200);

  const laVieja = (await api('GET', `/credenciales/${primera.json.id}`)).json;
  assert.equal(laVieja.estado, 'Reemplazada', 'la anterior no se borra: queda reemplazada');
  assert.equal(emitida.json.credencial.reemplaza_a, primera.json.id, 'y la nueva dice a cuál reemplaza');
  assert.notEqual(emitida.json.credencial.serie, laVieja.serie, 'con un número distinto');
});
