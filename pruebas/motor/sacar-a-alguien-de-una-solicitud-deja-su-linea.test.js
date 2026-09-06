/**
 * Sacar a alguien de una solicitud deja su línea, igual que sumarlo.
 *
 * Cuando se suma a alguien a una solicitud, el módulo escribe una línea en la
 * tramitación. Cuando se lo saca, no escribía ninguna, y la tramitación seguía
 * diciendo que se la sumó.
 *
 * MEDIDO en la v1.434.0:
 *
 *   personas_solicitud       al SUMARLA .. 1 línea «Se sumó a Ana Soto Lara…»
 *                            al SACARLA .. 0 líneas
 *   documentos_solicitudes   al adjuntarlo  1 línea
 *   (la pestaña de al lado)  al quitarlo .. 1 línea
 *
 * Importa poco y por eso el informe lo puso último: la persona desaparece de la
 * pestaña, así que nadie va a creer que sigue ahí. Pero la tramitación de una
 * solicitud existe para poder reconstruir después qué se hizo y en qué orden, y
 * quedaba afirmando algo que dejó de ser cierto sin decir cuándo dejó de serlo.
 *
 * Es exactamente la forma del defecto que corrigió la v1.209.0 en otros cuatro
 * módulos, con el razonamiento escrito en server/bitacora.js: «Cada uno tiene
 * DOS mitades, el alta y la baja… dejaban su línea al crearse y ninguna al
 * borrarse, así que el historial quedaba afirmando algo que ya no era cierto».
 * Aquella campaña arregló cuatro; éste no estaba en la lista (hallazgo SA-06).
 *
 * ── DÓNDE SE ESCRIBIÓ, Y POR QUÉ AHÍ ──
 *
 * El informe proponía «un afterDelete de tres líneas». No hay tal gancho: el
 * motor no tiene `afterDelete` en ningún módulo, y agregárselo por un caso era
 * más de lo que hace falta. La baja va donde ya viven las otras cinco, en
 * server/bitacora.js, que además sabe no escribir en el historial de una ficha
 * que ya no existe —si se borra la solicitud entera, su tramitación se va con
 * ella y esto crearía líneas huérfanas—.
 *
 * Y la tabla de esas bajas pasa a llevar su propio TEXTO. Antes solo servía
 * para papeles de una carpeta, con el texto escrito a mano en el sitio que la
 * usa; ahora lo que cambia entre los cinco es el texto y la regla es una sola,
 * que es lo que ese archivo dice de sí mismo dos tablas más abajo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');
const { digitoVerificador } = require('../../server/rut');
const { hoy } = require('../../server/fechas');

test.after(cerrarElSistema);

const marca = process.pid % 100000;
let cuantos = 0;
const unRut = () => {
  const n = `${13000000 + (marca * 31 + cuantos++ * 3571) % 900000}`;
  return `${n}-${digitoVerificador(n)}`;
};

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(`La baja ${marca}`, `LB-${marca}`).lastInsertRowid;
const miembro = db
  .prepare("INSERT INTO miembros (nombres, apellidos, rut, iglesia_id, estado) VALUES (?,?,?,?,'Activo')")
  .run('Ana', `Soto LB ${marca}`, unRut(), iglesia).lastInsertRowid;

const unaSolicitud = (asunto) => db
  .prepare(
    `INSERT INTO solicitudes (fecha, iglesia_id, solicitante_tipo, miembro_id, tipo, asunto, estado)
     VALUES (?, ?, 'Miembro', ?, 'Otro', ?, 'Pendiente')`
  ).run(hoy(), iglesia, miembro, `${asunto} ${marca}`).lastInsertRowid;

const laTramitacion = (solicitud) => db
  .prepare('SELECT descripcion FROM historial_solicitudes WHERE solicitud_id = ? ORDER BY id')
  .all(solicitud).map((f) => f.descripcion);

// ------------------------------------------- las dos mitades ---------------

test('sumar a alguien deja línea, y sacarlo también', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Con su grupo familiar');

  const p = await api('POST', '/personas_solicitud', {
    solicitud_id: s, persona_tipo: 'Miembro', miembro_id: miembro, relacion: 'Grupo familiar',
  });
  assert.equal(p.estado, 201, p.texto.slice(0, 200));
  const alSumarla = laTramitacion(s);
  assert.ok(alSumarla.some((t) => /^Se sumó a .*Grupo familiar/.test(t)), 'faltó la línea de la alta');

  const r = await api('DELETE', `/personas_solicitud/${p.json.id}?igual_asi=true`);
  assert.equal(r.estado, 200, r.texto.slice(0, 200));

  const alSacarla = laTramitacion(s);
  assert.equal(alSacarla.length, alSumarla.length + 1, 'sacarla no dejaba ninguna línea');
  const ultima = alSacarla[alSacarla.length - 1];
  assert.match(ultima, /^Se sacó a /, `la última línea decía «${ultima}»`);
  assert.match(ultima, /Grupo familiar/, 'con el papel que tenía, que es lo que deja de ser cierto');
  assert.match(ultima, /de la solicitud\.$/);
});

test('y la tramitación deja de afirmar algo que dejó de ser cierto', async () => {
  /*
   * Lo que importa no es que haya una línea más: es que las dos se puedan leer
   * seguidas y cuenten lo que pasó, en orden.
   */
  const api = await elSistemaAndando();
  const s = unaSolicitud('Se sumó y se sacó');
  const p = await api('POST', '/personas_solicitud', {
    solicitud_id: s, persona_tipo: 'Miembro', miembro_id: miembro, relacion: 'Testigo',
  });
  await api('DELETE', `/personas_solicitud/${p.json.id}?igual_asi=true`);

  const suyas = laTramitacion(s).filter((t) => /Testigo/.test(t));
  assert.equal(suyas.length, 2, 'tienen que quedar las dos mitades');
  assert.match(suyas[0], /^Se sumó/);
  assert.match(suyas[1], /^Se sacó/);
});

test('la línea la escribe quien la sacó, y con la fecha de hoy', async () => {
  const api = await elSistemaAndando();
  const s = unaSolicitud('Quién y cuándo');
  const p = await api('POST', '/personas_solicitud', {
    solicitud_id: s, persona_tipo: 'Miembro', miembro_id: miembro, relacion: 'Cónyuge',
  });
  await api('DELETE', `/personas_solicitud/${p.json.id}?igual_asi=true`);
  const fila = db
    .prepare("SELECT * FROM historial_solicitudes WHERE solicitud_id = ? AND descripcion LIKE 'Se sacó%'")
    .get(s);
  assert.ok(fila, 'no quedó la línea');
  assert.equal(fila.origen, 'Automático', 'la escribió el sistema al ocurrir el hecho');
  assert.equal(fila.tipo, 'Gestión',
    'sacar a una persona es una gestión, no un documento: el filtro por tipo de la pestaña '
    + 'la ofrece junto a la línea de cuando se la sumó, que es donde se busca');
  assert.equal(fila.fecha, hoy(), 'la fecha es la del día en que se la sacó');
  assert.ok(fila.registrado_por, 'y queda quién lo hizo');
});

// ------------------------------------------- lo que no se toca -------------

test('borrar la solicitud entera no deja líneas huérfanas', async () => {
  /*
   * Si se borra la solicitud, su tramitación se va con ella y sus personas
   * también: escribir una línea por cada una dejaría filas apuntando a un
   * trámite que ya no existe.
   *
   * QUIÉN LO IMPIDE, EN REALIDAD. Hay dos cerraduras y solo una se alcanza. La
   * que actúa es el camino del arrastre (server/dependencias.js), que borra las
   * filas que cuelgan directamente, sin pasar por la anotación: acá no llega
   * ninguna persona ni ningún papel. La segunda —la comprobación de que la
   * solicitud siga existiendo, dentro de la anotación— es un candado de más:
   * quitarlo no pone roja ninguna prueba, y queda dicho para que nadie lo lea
   * como código vivo que alguien olvidó probar. Es la misma situación que el
   * `id IS NOT ?` de server/carpetas.js, y está escrita igual ahí.
   */
  const api = await elSistemaAndando();
  const s = unaSolicitud('Se borra entera');
  await api('POST', '/personas_solicitud', {
    solicitud_id: s, persona_tipo: 'Miembro', miembro_id: miembro, relacion: 'Beneficiario',
  });
  const r = await api('DELETE', `/solicitudes/${s}?igual_asi=true`);
  assert.equal(r.estado, 200, r.texto.slice(0, 250));
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM historial_solicitudes WHERE solicitud_id = ?').get(s).n, 0,
    'quedaron líneas apuntando a una solicitud que ya no está'
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM personas_solicitud WHERE solicitud_id = ?').get(s).n, 0
  );
});

test('la carpeta de la misma solicitud sigue con sus dos mitades', async () => {
  // La tabla se generalizó para que cupieran las personas; los papeles no
  // pueden haber cambiado de comportamiento al hacerlo.
  const api = await elSistemaAndando();
  const s = unaSolicitud('Con papeles');
  const archivo = `lb-${marca}-carta.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, archivo), 'papel');
  const d = await api('POST', '/documentos_solicitudes', {
    solicitud_id: s, tipo: 'Otro', nombre: `Carta ${marca}`, archivo,
  });
  assert.equal(d.estado, 201, d.texto.slice(0, 200));
  assert.ok(laTramitacion(s).some((t) => /^Se adjuntó «Carta/.test(t)));

  await api('DELETE', `/documentos_solicitudes/${d.json.id}?igual_asi=true`);
  const ultima = laTramitacion(s).slice(-1)[0];
  assert.match(ultima, /^Se quitó «Carta/, `decía «${ultima}»`);
  assert.match(ultima, /de su carpeta\.$/, 'con las comillas angulares de esta pestaña');
});

test('y las carpetas de una ficha siguen escribiendo con sus comillas rectas', async () => {
  const api = await elSistemaAndando();
  const archivo = `lb-${marca}-carnet.txt`;
  fs.writeFileSync(path.join(UPLOADS_DIR, archivo), 'papel');
  const d = await api('POST', '/documentos_miembros', {
    miembro_id: miembro, tipo: 'Otro', nombre: `Carnet ${marca}`, archivo,
  });
  assert.equal(d.estado, 201, d.texto.slice(0, 200));
  await api('DELETE', `/documentos_miembros/${d.json.id}?igual_asi=true`);
  const linea = db
    .prepare("SELECT descripcion FROM bitacora WHERE miembro_id = ? AND descripcion LIKE 'Se quitó%' ORDER BY id DESC LIMIT 1")
    .get(miembro);
  assert.ok(linea, 'la carpeta de un miembro dejó de escribir su baja');
  assert.match(linea.descripcion, /^Se quitó "Carnet/, `decía «${linea.descripcion}»`);
});

// ------------------------------------------- la regla ----------------------

test('la baja de un satélite se declara en una tabla, no en una condición', () => {
  /*
   * Es lo que ese archivo dice de sí mismo dos tablas más abajo: «lo que cambia
   * entre ellos es el texto, no la regla». Si el próximo satélite se agrega
   * escribiendo otra condición al lado, esto se pone rojo.
   */
  const fuente = fs.readFileSync(path.join(__dirname, '../../server/bitacora.js'), 'utf8');
  const i = fuente.indexOf('const LA_BAJA_EN_LA_FICHA_DE_LA_QUE_CUELGA');
  assert.ok(i > 0, 'la tabla cambió de nombre sin que nadie viniera a mirar acá');
  const tabla = fuente.slice(i, fuente.indexOf('\n};', i));
  for (const quien of ['documentos_miembros', 'documentos_iglesias', 'documentos_pastores',
    'documentos_solicitudes', 'personas_solicitud']) {
    assert.match(tabla, new RegExp(`\\n  ${quien}: \\{`), `${quien} no está declarado en la tabla`);
  }
  assert.equal((tabla.match(/\n    texto:/g) || []).length, 5, 'los cinco traen su propio texto');
});
