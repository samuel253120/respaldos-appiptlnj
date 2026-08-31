/**
 * Lo que significa que una iglesia esté inactiva.
 *
 * Hasta acá, nada. El campo tenía sus tres opciones, se guardaba, se pintaba de
 * gris en el listado, y ninguna regla del sistema lo consultaba. Medido sobre
 * una iglesia creada directamente como inactiva:
 *
 *   anotarle un miembro nuevo ................. 201
 *   crearle un cuerpo nuevo ................... 201
 *   meterle plata en la caja .................. 201
 *   ¿la ofrece el desplegable de un miembro? .. sí
 *
 * Y es la ÚNICA salida que el sistema ofrece para retirar una congregación:
 * borrarla está prohibido, y el aviso que lo dice termina con «márquela como
 * inactiva». Un estado que no hace cumplir nada promete una protección que no
 * existe.
 *
 * Se frena LO NUEVO, no lo que ya está: una iglesia inactiva es historia, y la
 * historia se lee, se consulta, se corrige y se imprime.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { getModule } = require('../../server/registry');
const inactivas = require('../../server/iglesia-inactiva');

let n = 0;
const iglesia = (estado = 'Activa') => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, ?)")
  .run(`Iglesia ${++n} del Retiro`, `RET${n}-${process.pid}`, estado).lastInsertRowid;

const cerrada = iglesia('Inactiva');
const abierta = iglesia('Activa');
const formandose = iglesia('En formación');

/** Corre la regla como la corre el motor, después del gancho del módulo. */
const alGuardar = (modulo, data, { existing = null, isNew = true } = {}) =>
  inactivas.avisoSiLaIglesiaEstaInactiva(db, getModule(modulo), { data, existing, isNew });

// ------------------------------------------------- no recibe nada nuevo ----

test('una iglesia inactiva no recibe gente, cuerpos ni plata nuevos', () => {
  for (const modulo of ['miembros', 'no_miembros', 'cuerpos', 'tesoreria', 'cuentas_tesoreria',
                        'pastores', 'solicitudes', 'certificados', 'inventarios', 'asistencias']) {
    const aviso = alGuardar(modulo, { iglesia_id: cerrada });
    assert.match(String(aviso), /está marcada como inactiva/i, `${modulo} la dejó pasar`);
  }
});

test('y el aviso dice cuál es y cuál es la salida', () => {
  const aviso = alGuardar('miembros', { iglesia_id: cerrada });
  assert.match(aviso, new RegExp(`Iglesia ${1} del Retiro`.replace(/\d+/, '\\d+')), 'la nombra');
  assert.match(aviso, /cámbiele el estado a «Activa» en su ficha/i, 'y dice cómo salir');
  assert.match(aviso, /si esto corresponde a otra iglesia, elíjala/i);
});

test('una iglesia activa recibe lo que sea', () => {
  assert.equal(alGuardar('miembros', { iglesia_id: abierta }), null);
});

test('y una «En formación» también: para eso se está formando', () => {
  assert.equal(alGuardar('miembros', { iglesia_id: formandose }), null,
    'una congregación que se está armando necesita justamente poder inscribir gente');
});

// ------------------------------------- lo que ya está se sigue corrigiendo ----

test('lo que ya vive en una iglesia inactiva se sigue pudiendo corregir', () => {
  /*
   * Es la mitad que importa: una iglesia retirada es historia, y la historia se
   * corrige cuando está mal escrita. Frenarlo entero obligaría a reactivar la
   * congregación para arreglarle una falta de ortografía a un nombre.
   */
  const existing = { id: 9, nombre: 'Alguien', iglesia_id: cerrada };
  assert.equal(alGuardar('miembros', { nombres: 'Alguien Corregido' }, { existing, isNew: false }), null);
  assert.equal(alGuardar('miembros', { iglesia_id: cerrada }, { existing, isNew: false }), null,
    'y volver a mandar la misma iglesia no es mudarse a ninguna parte');
});

test('pero MUDAR un registro hacia una iglesia inactiva se frena', () => {
  const existing = { id: 9, nombre: 'Alguien', iglesia_id: abierta };
  const aviso = alGuardar('miembros', { iglesia_id: cerrada }, { existing, isNew: false });
  assert.match(String(aviso), /no puede pasarse nada nuevo/i,
    'trasladar a alguien a una congregación que se cerró es lo mismo que inscribirlo ahí');
});

test('y sacarlo de ella hacia una activa, no', () => {
  const existing = { id: 9, nombre: 'Alguien', iglesia_id: cerrada };
  assert.equal(alGuardar('miembros', { iglesia_id: abierta }, { existing, isNew: false }), null,
    'es justamente lo que hay que hacer al cerrar una congregación: repartir a su gente');
});

// ------------------------------------------ lo que SÍ se le puede escribir ----

test('su historial, sus documentos y la auditoría se le siguen escribiendo', () => {
  /*
   * Son los módulos que existen para contar lo que le pasó a la iglesia, y el
   * cierre es justamente lo que hay que poder anotar.
   */
  for (const modulo of ['historial_iglesias', 'documentos_iglesias', 'registro_cambios']) {
    assert.equal(alGuardar(modulo, { iglesia_id: cerrada }), null, `${modulo} tendría que poder`);
  }
});

test('y una cuenta de usuario, porque ahí «iglesia» quiere decir otra cosa', () => {
  /*
   * En una ficha cualquiera `iglesia_id` dice de qué iglesia es el registro; en
   * una cuenta de usuario dice cuál es su iglesia PRINCIPAL, la que se le
   * propone al crear cosas. Es la misma advertencia que ya está escrita en
   * server/alcance.js.
   */
  assert.equal(alGuardar('usuarios', { iglesia_id: cerrada }), null);
  assert.ok(inactivas.PUEDEN_ESCRIBIRLE.includes('usuarios'));
});

test('la ficha de la propia iglesia se edita: es como se la reactiva', () => {
  /*
   * Y sale por la puerta general, no por una excepción escrita a su nombre: un
   * guardado de `iglesias` no lleva ningún `iglesia_id` —la iglesia es ella—,
   * así que la regla no tiene ninguna a la que mirar y devuelve null en la
   * primera línea. La primera versión la nombraba aparte por las dudas; esa
   * línea se sacó al comprobar que quitarla no rompía nada.
   */
  const def = getModule('iglesias');
  assert.equal(def.fields.filter((f) => f.name === 'iglesia_id').length, 0,
    'si un día la ficha de la iglesia llevara un «iglesia_id», habría que volver a nombrarla');
  const existing = { id: cerrada, nombre: 'X', estado: 'Inactiva' };
  assert.equal(alGuardar('iglesias', { estado: 'Activa' }, { existing, isNew: false }), null,
    'si esto se frenara, una iglesia inactiva no se podría volver a abrir nunca');
});

test('un módulo sin iglesia no entra en la regla', () => {
  assert.equal(alGuardar('perfiles_permisos', { nombre: 'Uno' }), null);
});

test('y una iglesia que no existe no frena nada', () => {
  assert.equal(alGuardar('miembros', { iglesia_id: 999999 }), null,
    'de eso se encarga la comprobación de referencias rotas, no ésta');
});

// ------------------------------------ y el motor la aplica, de verdad ----

/*
 * Hasta acá todo llama a la regla a mano, y eso deja fuera lo único que el
 * usuario ve: que el MOTOR la corra al guardar. La primera versión de este
 * archivo se quedaba ahí, y se notó al revés —borrando de server/crud.js la
 * línea que lanza el aviso, las 17 pruebas seguían pasando en verde—: la
 * regla estaba escrita, comprobada y desconectada, y ninguna prueba lo decía.
 *
 * Así que estas últimas guardan de verdad. Se levanta el mismo router que
 * usa el servidor —server/crud.js `buildRouter`—, con su autenticación de
 * siempre, y se le mandan peticiones HTTP como las manda el navegador. No hay
 * nada simulado: el pase se firma con la llave del sistema, el usuario existe
 * en la base y el guardado pasa por las mismas doce comprobaciones.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { buildRouter } = require('../../server/crud');
const { JWT_SECRET } = require('../../server/auth');
const { digitoVerificador } = require('../../server/rut');

let servidor = null;
let pedir = null;

/** El sistema andando, con una sesión de administrador ya abierta. */
async function elSistemaAndando() {
  if (pedir) return pedir;
  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter());
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((listo) => servidor.once('listening', listo));
  const puerto = servidor.address().port;

  const rut = `${90000000 + (process.pid % 9000000)}`;
  const quien = db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, debe_cambiar_password) VALUES (?,?,?,1,0)')
    .run(`${rut}-${digitoVerificador(rut)}`, `Administradora del retiro ${process.pid}`, 'admin');
  const pase = jwt.sign({ id: quien.lastInsertRowid, rol: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

  pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${pase}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    return { estado: r.status, texto, json };
  };
  return pedir;
}

test.after(() => { if (servidor) servidor.close(); });

test('guardando de verdad: una iglesia que se retira deja de recibir cosas', async () => {
  const api = await elSistemaAndando();
  const marca = `retiro-${process.pid}`;

  // 1 · La congregación mientras funciona, con un cuerpo y una persona dentro
  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia que se retira ${marca}`, codigo: `RTR${process.pid}`, estado: 'Activa',
  });
  assert.ok(nueva.json && nueva.json.id, `no se pudo crear la iglesia: ${nueva.texto.slice(0, 200)}`);
  const iglesiaId = nueva.json.id;

  const cuerpo = await api('POST', '/cuerpos', {
    nombre: `Damas ${marca}`, tipo: 'Cuerpo', iglesia_id: iglesiaId, estado: 'Activo',
  });
  assert.ok(cuerpo.json && cuerpo.json.id, `no se pudo crear el cuerpo: ${cuerpo.texto.slice(0, 200)}`);

  const rutDeAlguien = `${19000000 + (process.pid % 900000)}`;
  const persona = await api('POST', '/miembros', {
    nombres: 'Persona', apellidos: `Delretiro ${marca}`,
    rut: `${rutDeAlguien}-${digitoVerificador(rutDeAlguien)}`,
    iglesia_id: iglesiaId, estado: 'Activo',
  });
  assert.ok(persona.json && persona.json.id, `no se pudo anotar a la persona: ${persona.texto.slice(0, 200)}`);

  /*
   * Este paso es el guardia de todo lo que sigue: si el alta de un miembro
   * fallara por cualquier otro motivo —un campo que falta, un permiso—, los
   * 400 de más abajo saldrían igual y la prueba aprobaría sin haber probado
   * nada. Que aquí entre confirma que lo único que cambia después es el
   * estado de la iglesia.
   */
  assert.equal(persona.estado, 201, 'mientras la iglesia está activa, anotar gente tiene que servir');

  // 2 · Se retira: se la marca inactiva desde su propia ficha, que es la
  //     única salida que el sistema ofrece para cerrar una congregación
  const retiro = await api('PUT', `/iglesias/${iglesiaId}`, { estado: 'Inactiva' });
  assert.equal(retiro.estado, 200, `no se pudo marcar inactiva: ${retiro.texto.slice(0, 200)}`);

  // 3 · Y desde ahí no recibe nada nuevo
  const rutDeOtro = `${18000000 + (process.pid % 900000)}`;
  const otroMiembro = await api('POST', '/miembros', {
    nombres: 'Otra', apellidos: `Despues ${marca}`,
    rut: `${rutDeOtro}-${digitoVerificador(rutDeOtro)}`,
    iglesia_id: iglesiaId, estado: 'Activo',
  });
  assert.equal(otroMiembro.estado, 400, `anotó gente en una iglesia retirada: ${otroMiembro.texto.slice(0, 200)}`);
  assert.match(otroMiembro.json.error, /está marcada como inactiva/i);

  const otroCuerpo = await api('POST', '/cuerpos', {
    nombre: `Jovenes ${marca}`, tipo: 'Cuerpo', iglesia_id: iglesiaId, estado: 'Activo',
  });
  assert.equal(otroCuerpo.estado, 400, 'le creó un cuerpo nuevo');

  const caja = await api('POST', '/cuentas_tesoreria', {
    nombre: `Caja ${marca}`, ambito: 'Iglesia local', iglesia_id: iglesiaId,
    estado: 'Activa', saldo_inicial: 0, igual_asi: true,
  });
  assert.equal(caja.estado, 400, 'le abrió una caja nueva');

  // 4 · Pero su historia se sigue escribiendo, y lo que ya vive ahí se corrige
  const anotacion = await api('POST', '/historial_iglesias', {
    iglesia_id: iglesiaId, fecha: '2026-08-30', tipo: 'Otro',
    descripcion: `Se retiró la congregación ${marca}`,
  });
  assert.equal(anotacion.estado, 201,
    `el cierre hay que poder anotarlo en su historial: ${anotacion.texto.slice(0, 200)}`);

  const correccion = await api('PUT', `/miembros/${persona.json.id}`, { telefono: '+56911112233' });
  assert.equal(correccion.estado, 200,
    `lo que ya vive en ella se sigue corrigiendo: ${correccion.texto.slice(0, 200)}`);

  // 5 · Y si la congregación vuelve, se reabre por donde el aviso dice
  const vuelve = await api('PUT', `/iglesias/${iglesiaId}`, { estado: 'Activa' });
  assert.equal(vuelve.estado, 200, `no se pudo reactivar: ${vuelve.texto.slice(0, 200)}`);
  const alVolver = await api('POST', '/miembros', {
    nombres: 'Otra', apellidos: `Despues ${marca}`,
    rut: `${rutDeOtro}-${digitoVerificador(rutDeOtro)}`,
    iglesia_id: iglesiaId, estado: 'Activo',
  });
  assert.equal(alVolver.estado, 201,
    `reactivada tiene que volver a recibir gente: ${alVolver.texto.slice(0, 200)}`);
});

test('guardando de verdad: tampoco entra por la puerta de atrás', async () => {
  /*
   * La razón por la que la regla corre DESPUÉS del gancho del módulo y no
   * antes, con las demás comprobaciones generales.
   *
   * Hay módulos que no reciben la iglesia: la deducen ellos. Un artículo de
   * inventario de un cuerpo la copia del cuerpo (server/modules/inventarios.js),
   * y por eso llega al motor con `iglesia_id` vacío. Preguntando antes del
   * gancho, este artículo entraría igual en una iglesia retirada, porque en ese
   * momento todavía no hay ninguna iglesia que mirar.
   */
  const api = await elSistemaAndando();
  const marca = `puertatras-${process.pid}`;

  const nueva = await api('POST', '/iglesias', {
    nombre: `Iglesia de atrás ${marca}`, codigo: `ATR${process.pid}`, estado: 'Activa',
  });
  assert.ok(nueva.json && nueva.json.id, nueva.texto.slice(0, 200));
  const cuerpo = await api('POST', '/cuerpos', {
    nombre: `Coro ${marca}`, tipo: 'Cuerpo', iglesia_id: nueva.json.id, estado: 'Activo',
  });
  assert.ok(cuerpo.json && cuerpo.json.id, cuerpo.texto.slice(0, 200));

  const deLaCosa = {
    articulo: `Teclado ${marca}`, ambito: 'Cuerpo / Grupo', cuerpo_id: cuerpo.json.id,
    regimen: 'Propio', cantidad: 1, igual_asi: true,
  };
  const mientrasAnda = await api('POST', '/inventarios', deLaCosa);
  assert.equal(mientrasAnda.estado, 201,
    `guardia: sin iglesia_id el artículo tiene que entrar igual mientras la iglesia funciona: ${mientrasAnda.texto.slice(0, 200)}`);
  assert.equal(String(mientrasAnda.json.iglesia_id), String(nueva.json.id),
    'y su iglesia la pone el módulo, copiándola del cuerpo: eso es lo que la regla tiene que alcanzar a ver');

  await api('PUT', `/iglesias/${nueva.json.id}`, { estado: 'Inactiva' });

  const despues = await api('POST', '/inventarios', { ...deLaCosa, articulo: `Atril ${marca}` });
  assert.equal(despues.estado, 400,
    'un artículo que no nombra la iglesia entró igual: la regla está corriendo antes del gancho del módulo');
  assert.match(despues.json.error, /está marcada como inactiva/i);
});

// --------------------------------------- y los desplegables dejan de ofrecerla ----

test('los formularios piden las iglesias que sí reciben cosas', async () => {
  /*
   * La otra mitad del arreglo, y la que la gente ve primero: frenar el guardado
   * sin sacarla del desplegable deja a alguien eligiéndola, llenando la ficha
   * entera y recibiendo el aviso recién al apretar «Guardar».
   *
   * Se pregunta a la ruta de verdad —`/api/iglesias/activas`, la que el campo
   * pide— y no al texto del módulo: que la propiedad esté escrita no dice nada
   * de lo que la ruta contesta.
   */
  const api = await elSistemaAndando();
  assert.equal(getModule('iglesias').opcionesPorDefecto, '/iglesias/activas?ademas={iglesia_id}',
    'y es esa la ruta que el campo pide');

  const marca = `desplegable-${process.pid}`;
  const anda = await api('POST', '/iglesias', {
    nombre: `Iglesia que sigue ${marca}`, codigo: `SIG${process.pid}`, estado: 'Activa',
  });
  const retirada = await api('POST', '/iglesias', {
    nombre: `Iglesia retirada ${marca}`, codigo: `RET${process.pid}`, estado: 'Activa',
  });
  assert.ok(anda.json && anda.json.id && retirada.json && retirada.json.id,
    `${anda.texto.slice(0, 120)} / ${retirada.texto.slice(0, 120)}`);
  await api('PUT', `/iglesias/${retirada.json.id}`, { estado: 'Inactiva' });

  const ofrecidas = (await api('GET', '/iglesias/activas')).json || [];
  const ids = ofrecidas.map((o) => String(o.id));
  assert.ok(ids.includes(String(anda.json.id)), 'la que funciona tiene que salir');
  assert.ok(!ids.includes(String(retirada.json.id)),
    'la retirada se sigue ofreciendo: alguien la va a elegir y el aviso le va a llegar tarde');

  /*
   * Y la que el campo YA tenía elegida sale igual, esté como esté. Sin esto,
   * abrir la ficha de un miembro de una congregación retirada la dejaba sin
   * iglesia en el desplegable, y guardar se la habría borrado.
   */
  const conLaSuya = (await api('GET', `/iglesias/activas?ademas=${retirada.json.id}`)).json || [];
  assert.ok(conLaSuya.map((o) => String(o.id)).includes(String(retirada.json.id)),
    'la ficha de quien pertenece a una iglesia retirada tiene que seguir mostrándola');
});

test('y el listado de siempre las sigue trayendo todas', async () => {
  /*
   * La mitad que se rompe sin querer. Sacarlas del desplegable es el arreglo;
   * sacarlas del LISTADO sería llevarse por delante la historia que la regla
   * dice proteger: consultar lo de una congregación retirada —quién estuvo,
   * cuánto se juntó, qué actas quedaron— es justamente para lo que se guarda.
   */
  const api = await elSistemaAndando();
  const marca = `enlalista-${process.pid}`;
  const suya = await api('POST', '/iglesias', {
    nombre: `Iglesia guardada ${marca}`, codigo: `LST${process.pid}`, estado: 'Activa',
  });
  assert.ok(suya.json && suya.json.id, suya.texto.slice(0, 200));
  await api('PUT', `/iglesias/${suya.json.id}`, { estado: 'Inactiva' });

  /*
   * Se la busca por su marca y no se pide el listado entero: estas pruebas
   * corren en paralelo sobre la misma base y cuántas iglesias haya en ella no
   * es asunto de este archivo. La ruta es la misma —el buscador del listado es
   * el listado con un filtro puesto—, así que lo que se comprueba es igual.
   */
  const enLaLista = (await api('GET', `/iglesias?q=${encodeURIComponent(marca)}&page=1&pageSize=50`))
    .json.rows || [];
  assert.ok(enLaLista.some((f) => String(f.id) === String(suya.json.id)),
    'una iglesia retirada tiene que seguir saliendo en el listado');
  assert.equal((await api('GET', `/iglesias/${suya.json.id}`)).estado, 200,
    'y su ficha tiene que seguir abriéndose');
});

test('los filtros del listado las siguen ofreciendo todas', () => {
  /*
   * Acotar un listado por una iglesia retirada es justamente cómo se consulta
   * lo suyo. Un campo de VARIAS —«Iglesias que administra»— también: alguien
   * tiene que poder quedar a cargo de los registros de la que se cerró.
   */
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /getOptions\(rutaOpciones\(f, null, \{ filtrando: true \}\)\)/);
  const desde = app.indexOf('function rutaOpciones(');
  const trozo = app.slice(desde, app.indexOf('\n}', desde));
  assert.match(trozo, /!filtrando && f\.type === 'ref'/,
    'solo para elegir dónde va algo nuevo: ni filtros ni campos de varias');
});

test('y los nombres de las iglesias se siguen acortando en cualquier lista', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  assert.match(app, /ruta\.startsWith\('\/iglesias\/'\)/,
    'pegado a una sola ruta, los nombres salían largos otra vez en la nueva');
});
