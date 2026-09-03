/**
 * CE-09 y CE-10 · Dos avisos que faltaban al emitir.
 *
 * Los dos son de la misma clase y por eso van juntos: NINGUNO ES UN RECHAZO.
 * Lo que hacen es poner delante un dato que quien emite no tiene a la vista, y
 * dejarlo seguir. Es lo mismo que el sistema ya hace en Miembros con las fichas
 * que se llaman igual.
 *
 * CE-09 · EL NOMBRE QUE NO ES EL SUYO. Medido en la v1.299.0: un certificado
 * enlazado a un miembro y con «NOMBRE QUE NO ES EL SUYO» en el titular se
 * emitía con un 201 y sin decir nada. Lo que se imprime en la hoja es el
 * titular; el enlace es lo que ata el papel a una persona del sistema. Que
 * digan cosas distintas es, casi siempre, que el enlace apunta a quien no es —
 * y ese certificado va a aparecer en la ficha de una persona que no lo recibió.
 * Pero hay razones legítimas para que no coincidan: un nombre de casada, el
 * completo frente al corto, un segundo apellido que en la ficha no está.
 *
 * CE-10 · EL MISMO CERTIFICADO, DOS VECES. Medido: el segundo certificado de
 * bautismo a la misma persona se emitía con un 201 y sin preguntar. Volver a
 * emitir es normal —se pierde el papel, se moja, se pide una copia para un
 * trámite—, pero también es como se ve el mismo trámite hecho dos veces por dos
 * personas distintas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado, ciudad) VALUES (?, ?, 'Activa', 'Chillán')")
    .run(`Titular ${m}`, `TT${m}`.slice(0, 18)).lastInsertRowid;
}

function unMiembro(iglesia, nombres, apellidos) {
  return db.prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?, ?, ?, 'Activo')")
    .run(nombres, apellidos, iglesia).lastInsertRowid;
}

/** Un formato propio cuyo texto no nombra ningún día. */
function unFormato() {
  const nombre = `Hoja ${marca()}`;
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, texto, disposicion, tamano_hoja, orientacion)
     VALUES (?, 1, 100, 'Certifica lo suyo.', 'Clásica', 'Carta', 'Vertical')`
  ).run(nombre);
  return nombre;
}

async function emitir(api, campos) {
  return api('POST', '/certificados', {
    iglesia_id: campos.iglesia_id, nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`, ...campos,
  });
}

// ═════════════════════════ CE-09 · el titular que no calza ══

test('emitir a un nombre que no es el de la ficha enlazada PREGUNTA', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');

  const r = await emitir(api, {
    tipo: unFormato(), iglesia_id: iglesia, miembro_id: quien,
    nombre_titular: 'NOMBRE QUE NO ES EL SUYO',
  });
  assert.equal(r.estado, 400, 'antes contestaba 201 y no decía nada');
  assert.equal(r.json.confirmar, 'titular_que_no_calza');

  const aviso = String(r.json.error);
  assert.match(aviso, /a nombre de «NOMBRE QUE NO ES EL SUYO»/, 'dice lo que va a salir impreso');
  assert.match(aviso, /enlazado a la ficha de Ana Soto Vera/, 'y a quién está enlazado');
  assert.match(aviso, /va a aparecer en la ficha de una persona que no lo recibió/,
    'y por qué importa: es lo que hace el enlace');
  assert.match(aviso, /el de casada, el completo, el del registro civil/,
    'y reconoce las razones legítimas, que es lo que lo hace pregunta y no rechazo');
});

test('y contestando que sí, se emite: NO es un rechazo', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');

  const r = await emitir(api, {
    tipo: unFormato(), iglesia_id: iglesia, miembro_id: quien,
    nombre_titular: 'Ana Soto de Pérez', igual_asi: true,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.nombre_titular, 'Ana Soto de Pérez', 'la hoja dice el nombre que corresponde');
});

test('el mismo nombre escrito por otra mano no pregunta: sin tildes y sin mayúsculas', async () => {
  /*
   * «José» y «Jose» son la misma persona, y «ANA SOTO» también. Preguntar por
   * eso sería la clase de aviso que sale siempre y se aprieta sin leer.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'José', 'Muñoz Pérez');

  for (const escrito of ['José Muñoz Pérez', 'Jose Munoz Perez', 'JOSÉ MUÑOZ PÉREZ', '  José Muñoz Pérez  ']) {
    const r = await emitir(api, {
      tipo: unFormato(), iglesia_id: iglesia, miembro_id: quien, nombre_titular: escrito,
    });
    assert.equal(r.estado, 201, `preguntó por «${escrito}»: ${JSON.stringify(r.json)}`);
  }
});

test('sin enlace no hay con qué comparar, y no pregunta', async () => {
  const api = await elSistemaAndando();
  const r = await emitir(api, {
    tipo: unFormato(), iglesia_id: unaIglesia(), nombre_titular: 'Quien Sea',
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
});

test('y cambiarle SOLO el enlace a uno ya emitido pregunta igual', async () => {
  /*
   * Se mira sobre lo que QUEDARÍA guardado, no sobre lo que llega: enlazar mal
   * un certificado que ya existe hace exactamente el mismo daño que emitirlo
   * mal de entrada.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const otra = unMiembro(iglesia, 'Rosa', 'Pérez Vera');
  const cert = await emitir(api, {
    tipo: unFormato(), iglesia_id: iglesia, nombre_titular: 'Ana Soto Vera',
  });
  assert.equal(cert.estado, 201);

  const r = await api('PUT', `/certificados/${cert.json.id}`, { miembro_id: otra });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'titular_que_no_calza');
  assert.match(String(r.json.error), /Rosa Pérez Vera/);
});

// ═════════════════════════ CE-10 · el que ya tiene uno ══

test('el segundo certificado del mismo tipo a la misma persona PREGUNTA', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const tipo = unFormato();

  const uno = await emitir(api, {
    tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera',
    numero: `PRIMERO-${marca()}`, fecha_emision: '2026-03-10',
  });
  assert.equal(uno.estado, 201, JSON.stringify(uno.json));

  const dos = await emitir(api, {
    tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera',
  });
  assert.equal(dos.estado, 400, 'antes contestaba 201 y no preguntaba');
  assert.equal(dos.json.confirmar, 'certificado_que_ya_tiene');

  const aviso = String(dos.json.error);
  assert.ok(aviso.includes(`ya tiene un certificado de ${tipo}`), aviso);
  assert.ok(aviso.includes(uno.json.numero), 'lo nombra por su número');
  assert.match(aviso, /del 10-03-2026/, 'y dice de cuándo es');
  assert.match(aviso, /Si es una copia porque se perdió el papel, siga/,
    'y reconoce el caso legítimo');
});

test('y contestando que sí, se emite la copia', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const tipo = unFormato();
  const comun = { tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera' };

  assert.equal((await emitir(api, comun)).estado, 201);
  const dos = await emitir(api, { ...comun, igual_asi: true });
  assert.equal(dos.estado, 201, JSON.stringify(dos.json));
});

test('uno de OTRO tipo no pregunta: es otro documento', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const comun = { iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera' };

  assert.equal((await emitir(api, { ...comun, tipo: unFormato() })).estado, 201);
  assert.equal((await emitir(api, { ...comun, tipo: unFormato() })).estado, 201);
});

test('y a OTRA persona, tampoco', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const tipo = unFormato();

  const uno = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const otro = unMiembro(iglesia, 'Rosa', 'Pérez Vera');
  assert.equal((await emitir(api, { tipo, iglesia_id: iglesia, miembro_id: uno, nombre_titular: 'Ana Soto Vera' })).estado, 201);
  assert.equal((await emitir(api, { tipo, iglesia_id: iglesia, miembro_id: otro, nombre_titular: 'Rosa Pérez Vera' })).estado, 201);
});

test('EL QUE IMPORTA: uno ANULADO no cuenta, porque ese papel ya no vale', async () => {
  /*
   * Rehacer un certificado anulado es justamente el caso para el que existe
   * anular. Preguntar ahí sería estorbar en el único camino que el módulo
   * recomienda.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const tipo = unFormato();
  const comun = { tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera' };

  const uno = await emitir(api, { ...comun, estado: 'Anulado' });
  assert.equal(uno.estado, 201, JSON.stringify(uno.json));

  const dos = await emitir(api, comun);
  assert.equal(dos.estado, 201, 'el anulado no estorba al que lo reemplaza');
});

test('sin enlace tampoco pregunta: el nombre escrito no es con qué comparar', async () => {
  /*
   * Se mira SOLO el enlace. El nombre se teclea, y se teclea distinto;
   * preguntar por parecido de nombres sería el aviso que sale siempre.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const tipo = unFormato();
  const comun = { tipo, iglesia_id: iglesia, nombre_titular: 'Ana Soto Vera' };

  assert.equal((await emitir(api, comun)).estado, 201);
  assert.equal((await emitir(api, comun)).estado, 201);
});

test('editar uno ya emitido no pregunta por el repetido: llega tarde', async () => {
  /*
   * El segundo certificado ya está emitido; lo único que haría la pregunta es
   * estorbar cada vez que alguien le corrija una tilde a la ficha.
   */
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const tipo = unFormato();
  const comun = { tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera' };

  assert.equal((await emitir(api, comun)).estado, 201);
  const dos = await emitir(api, { ...comun, igual_asi: true });
  assert.equal(dos.estado, 201);

  const r = await api('PUT', `/certificados/${dos.json.id}`, { notas: 'Se entregó en mano.' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
});

// ══════════════════════ los dos juntos, en una sola pregunta ══

test('emitir uno repetido Y con el nombre cambiado dice las dos cosas', async () => {
  const api = await elSistemaAndando();
  const iglesia = unaIglesia();
  const quien = unMiembro(iglesia, 'Ana', 'Soto Vera');
  const tipo = unFormato();

  assert.equal((await emitir(api, {
    tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Ana Soto Vera',
  })).estado, 201);

  const r = await emitir(api, {
    tipo, iglesia_id: iglesia, miembro_id: quien, nombre_titular: 'Otra Persona Distinta',
  });
  assert.equal(r.estado, 400);
  const aviso = String(r.json.error);
  assert.match(aviso, /Hay dos cosas que revisar antes de guardar/);
  assert.match(aviso, /\(1\).*Otra Persona Distinta/s, 'primero el del nombre');
  assert.match(aviso, /\(2\).*ya tiene un certificado/s, 'después el del repetido');
  assert.equal(r.json.confirmar, 'titular_que_no_calza');
});

test('la pantalla sabe qué preguntar con las dos claves', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'), app.indexOf('const como = COMO_SE_PREGUNTA['));

  for (const clave of ['titular_que_no_calza', 'certificado_que_ya_tiene']) {
    const entrada = tabla.slice(tabla.indexOf(`${clave}: {`));
    assert.ok(entrada.startsWith(`${clave}: {`), `falta la entrada ${clave}`);
    const bloque = entrada.slice(0, entrada.indexOf('},'));
    assert.match(bloque, /titulo:/);
    assert.match(bloque, /volver:/);
    assert.match(bloque, /seguir:/);
  }
  // Los dos botones de seguir dicen POR QUÉ se sigue, que es lo que hace que
  // estas dos preguntas no sean un trámite
  assert.match(tabla, /seguir: 'El nombre es correcto, emitir'/);
  assert.match(tabla, /seguir: 'Es una copia, emitir'/);
});
