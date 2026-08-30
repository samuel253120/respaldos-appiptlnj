/**
 * EL CARNET QUE VENCE, Y NADIE AVISA.
 *
 * La ayuda del propio campo decía: «Con qué nombre se reconoce este documento
 * (ej.: "Carnet vigente hasta 2030")». El sistema estaba pidiendo que la
 * vigencia se escribiera DENTRO del nombre, donde ningún aviso la puede leer.
 * Medido antes:
 *
 *   campo de vencimiento en el módulo ....  no había
 *   avisos del panel sobre documentos ....  ninguno
 *   avisos que el sistema sí sabía dar ...  credencial por vencer · cuotas al
 *                                           debe · respaldo atrasado · faltas
 *                                           seguidas · cumplió la mayoría
 *
 * La maquinaria estaba hecha y probada. Esto es un campo de fecha, una consulta
 * con la misma forma que `credenciales.porVencer` y una línea más en el vigía.
 *
 * Lo que cuida este archivo:
 *   · que el campo exista, admita futuro y no pueda ser anterior al documento
 *   · que la ayuda del nombre deje de empujar la vigencia adentro del nombre
 *   · qué entra en «por vencer»: lo que vence dentro del plazo Y lo vencido
 *   · que la consulta respete el alcance de quien pregunta
 *   · que el aviso sea UNO POR PERSONA y no uno por papel
 *   · que la clave del aviso cambie cuando cambia lo que hay que decir
 *   · y que ningún aviso del vigía use nombres de campo que `crear` no conoce,
 *     que es un error que no se ve: el aviso sale con el título pelado
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const fs = require('fs');
const path = require('path');
require('../../server/ajustes');
const { db } = require('../../server/db');
const registry = require('../../server/registry');
const avisos = require('../../server/avisos/avisos');

const DOCS = registry.getModule('documentos_miembros');
const enDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const iglesia = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Central del vencimiento','IG-VEN1','Activa')")
  .run().lastInsertRowid;
const otra = db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES ('Norte del vencimiento','IG-VEN2','Activa')")
  .run().lastInsertRowid;

const unMiembro = (nombres, apellidos, ig) => db
  .prepare("INSERT INTO miembros (nombres, apellidos, iglesia_id, estado) VALUES (?,?,?,'Activo')")
  .run(nombres, apellidos, ig).lastInsertRowid;

const rosa = unMiembro('Rosa Elena', 'Cárcamo del Vencimiento', iglesia);
const juana = unMiembro('Juana', 'Paillán del Vencimiento', iglesia);
const ajena = unMiembro('Marta', 'De Otra Iglesia', otra);

const unPapel = (miembro, ig, tipo, nombre, vence) => db.prepare(
  'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo, vence) VALUES (?,?,?,?,?,?,?)'
).run(miembro, ig, tipo, nombre, '2020-04-12', 'papel.txt', vence).lastInsertRowid;

const suCarnet = unPapel(rosa, iglesia, 'Carnet de identidad', 'Carnet de Rosa', enDias(12));
const suPermiso = unPapel(rosa, iglesia, 'Otro', 'Permiso de Rosa', enDias(-40));
unPapel(rosa, iglesia, 'Certificado de bautismo', 'Bautismo de Rosa', null);
unPapel(juana, iglesia, 'Carnet de identidad', 'Carnet de Juana', enDias(200));
unPapel(ajena, otra, 'Carnet de identidad', 'Carnet de Marta', enDias(5));

const ADMIN = { id: 1, rol: 'admin' };
const SUYA = { id: 2, rol: 'secretario', iglesia_id: iglesia, iglesias: [iglesia] };
const AJENA = { id: 3, rol: 'secretario', iglesia_id: otra, iglesias: [otra] };
const mios = (usuario, dias) => DOCS.porVencer(usuario, dias).filter((d) => d.iglesia_id !== undefined || true);

/* ------------------------------- el campo */

test('el documento puede decir hasta cuándo vale', () => {
  const campo = DOCS.fields.find((f) => f.name === 'vence');
  assert.ok(campo, 'no hay campo de vencimiento');
  assert.equal(campo.type, 'date');
  assert.ok(!campo.required, 'una carta de traslado no vence: obligarlo llevaría a inventar la fecha');
  assert.equal(campo.futuro, true, 'una fecha de vencimiento es futura por definición');
  assert.equal(campo.noAntesDe, 'fecha', 'y no puede ser anterior al propio documento');
});

test('y la ayuda del nombre deja de pedir que la vigencia se escriba ahí', () => {
  const nombre = DOCS.fields.find((f) => f.name === 'nombre');
  assert.doesNotMatch(nombre.help, /vigente hasta/,
    'ese ejemplo empujaba la vigencia adentro del nombre, donde ningún aviso la lee');
});

test('la columna se ve en el listado', () => {
  assert.ok(DOCS.listFields.includes('vence'));
});

/* ------------------------------- qué está «por vencer» */

test('entra lo que vence dentro del plazo, y lo que ya venció', () => {
  const suyos = DOCS.porVencer(ADMIN, 30).map((d) => d.id);
  assert.ok(suyos.includes(suCarnet), 'vence en 12 días');
  assert.ok(suyos.includes(suPermiso), 'y este venció hace 40: lo vencido es lo más urgente');
});

test('no entra lo que no vence, ni lo que vence mucho después', () => {
  const suyos = DOCS.porVencer(ADMIN, 30).map((d) => d.nombre);
  assert.ok(!suyos.includes('Bautismo de Rosa'), 'un bautismo no vence');
  assert.ok(!suyos.includes('Carnet de Juana'), 'ese vence en 200 días');
  assert.ok(DOCS.porVencer(ADMIN, 365).map((d) => d.nombre).includes('Carnet de Juana'),
    'pero con más plazo, sí');
});

test('un vencimiento escrito con cualquier cosa no entra, y no hay que cuidarlo a mano', () => {
  /*
   * `date()` devuelve nulo con lo que no sea una fecha y comparar contra nulo
   * no es cierto: no entran solos. La consulta tenía además dos comprobaciones
   * «por si acaso» —que no fuera vacío y que `date()` no fuera nulo— y romper
   * las dos no ponía roja ninguna prueba, porque no cuidaban nada. Se sacaron;
   * esta prueba es la que ahora vigila que la regla siga siendo cierta.
   */
  const raro = unMiembro('Rara', 'Del Vencimiento Raro', iglesia);
  for (const basura of ['', '   ', 'no se sabe', '0000-00-00']) {
    db.prepare(
      'INSERT INTO documentos_miembros (miembro_id, iglesia_id, tipo, nombre, fecha, archivo, vence) VALUES (?,?,?,?,?,?,?)'
    ).run(raro, iglesia, 'Otro', `Papel «${basura}»`, '2020-04-12', 'x.txt', basura);
  }
  const suyos = DOCS.porVencer(ADMIN, 365).filter((d) => d.miembro_id === raro);
  assert.deepEqual(suyos, [], `entraron: ${JSON.stringify(suyos.map((d) => d.vence))}`);
});

test('vienen con los días que faltan, en negativo si ya pasó', () => {
  const porId = new Map(DOCS.porVencer(ADMIN, 30).map((d) => [d.id, d]));
  assert.equal(porId.get(suCarnet).dias, 12);
  assert.equal(porId.get(suPermiso).dias, -40);
});

test('vienen ordenados por lo que vence primero', () => {
  const fechas = DOCS.porVencer(ADMIN, 365).map((d) => d.vence);
  assert.deepEqual(fechas, [...fechas].sort(), 'es el orden en que hay que ocuparse de ellos');
});

test('y traen el nombre de la persona, que es lo que se lee en el aviso', () => {
  const uno = DOCS.porVencer(ADMIN, 30).find((d) => d.id === suCarnet);
  assert.match(uno.titular, /Rosa Elena Cárcamo del Vencimiento/);
});

test('el plazo sale de Configuración y no de un número escrito acá', () => {
  const ajustes = require('../../server/ajustes');
  const opcion = ajustes.OPCIONES.flatMap((g) => g.items).find((o) => o.clave === 'avisos_documento_dias');
  assert.ok(opcion, 'la opción tiene que existir para poder cambiarla sin tocar el código');
  assert.equal(opcion.defecto, '30');
  assert.equal(opcion.min, 1);
  assert.equal(opcion.max, 365);
  const src = fs.readFileSync(path.join(__dirname, '../../server/modules/documentos_miembros.js'), 'utf8');
  assert.match(src, /require\('\.\.\/ajustes'\)\.numero\('avisos_documento_dias', 1, 365\)/);
});

/* ------------------------------- de cada quien */

test('cada quien ve los papeles de la gente que alcanza', () => {
  assert.ok(DOCS.porVencer(SUYA, 30).length >= 2, 'la secretaria de la Central ve los de Rosa');
  assert.ok(!DOCS.porVencer(SUYA, 30).some((d) => d.nombre === 'Carnet de Marta'),
    'y no los de otra iglesia');
  assert.ok(DOCS.porVencer(AJENA, 30).some((d) => d.nombre === 'Carnet de Marta'),
    'y la de la Norte sí ve el suyo');
  assert.ok(!DOCS.porVencer(AJENA, 30).some((d) => d.nombre === 'Carnet de Rosa'));
});

/* ------------------------------- el aviso */

const vigia = require('../../server/avisos/vigia');

test('el vigía revisa los documentos por vencer', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../server/avisos/vigia.js'), 'utf8');
  assert.match(src, /const REVISIONES = \[[\s\S]{0,200}documentosPorVencer/);
  assert.match(src, /if \(!can\(usuario, 'documentos_miembros', 'view'\)\) return;/,
    'a quien no puede ver los documentos no se le avisa de ellos');
});

test('el tipo de aviso está declarado, para poder apagarlo', () => {
  const tipos = avisos.TIPOS || require('../../server/avisos/avisos').TIPOS;
  assert.ok(tipos && tipos.documento_por_vencer, 'sin declararlo, `crear` lo descarta y no sale nunca');
  assert.equal(tipos.documento_por_vencer.urgente, false, 'no interrumpe: va en el resumen del día');
  assert.ok(tipos.documento_por_vencer.label);
});

test('el aviso es uno por persona, no uno por papel', () => {
  /*
   * De la misma señora pueden vencer tres el mismo mes. Tres campanazos por
   * ella la misma mañana es la forma más rápida de que alguien apague los
   * avisos para siempre.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/avisos/vigia.js'), 'utf8');
  const desde = src.indexOf('function documentosPorVencer');
  const hasta = src.indexOf('Solicitudes a su cargo que ya debían');
  const trozo = src.slice(desde, hasta);
  assert.match(trozo, /const porPersona = new Map\(\)/);
  assert.match(trozo, /for \(const \[miembroId, suyos\] of porPersona\)/);
  assert.match(trozo, /clave: `documentos_vencen:\$\{miembroId\}:/,
    'la clave lleva a quién y con qué fechas: mientras no cambie, no repite el aviso');
  assert.match(trozo, /suyos\.map\(\(d\) => `\$\{d\.id\}=\$\{d\.vence\}`\)/,
    'y en cuanto se renueve o venza otro, vuelve a avisar');
});

test('la pasada del día deja el aviso, con su texto y su enlace', () => {
  const usuario = db.prepare(
    "INSERT INTO usuarios (rut, nombre, rol, activo, password) VALUES ('20111222-2','Secretaria del vencimiento','admin',1,'x')"
  ).run().lastInsertRowid;
  vigia.pasada();
  /*
   * Se busca EL DE ROSA entre los suyos y no «el último»: la pasada deja un
   * aviso por persona, así que el último puede ser el de cualquiera. La
   * primera versión de esta prueba tomaba el último y fallaba por eso —lo que
   * es, de paso, la comprobación de que los avisos van por persona—.
   */
  const dejados = db.prepare(
    "SELECT * FROM notificaciones WHERE usuario_id = ? AND tipo = 'documento_por_vencer' ORDER BY id"
  ).all(usuario);
  assert.ok(dejados.length >= 2, `la pasada dejó ${dejados.length}: tendría que haber uno por persona`);
  const suyo = dejados.find((n) => /Rosa Elena/.test(n.titulo));
  assert.ok(suyo, `no dejó el de Rosa; dejó: ${dejados.map((n) => n.titulo).join(' | ')}`);
  assert.match(suyo.titulo, /Rosa Elena Cárcamo del Vencimiento/);
  assert.match(suyo.cuerpo, /venció hace 40 día\(s\)/);
  assert.match(suyo.cuerpo, /le quedan 12 día\(s\)/);
  assert.match(suyo.enlace, new RegExp(`#/m/miembros/ficha/${rosa}/documentos`));
});

/* ------------------------------- y el error que no se ve */

test('ningún aviso del vigía usa nombres de campo que `crear` no conoce', () => {
  /*
   * `avisos.crear` toma solo las claves que sabe: lo demás se pierde en
   * silencio. El aviso de los que cumplieron 18 estaba escrito con «detalle» y
   * «ruta» en vez de «cuerpo» y «enlace», así que salía con el título pelado,
   * sin texto y sin adónde ir, y nada lo delataba. Se vio al copiarlo para
   * escribir este; esta prueba es para que no vuelva a pasar en el siguiente.
   */
  const src = fs.readFileSync(path.join(__dirname, '../../server/avisos/avisos.js'), 'utf8');
  const firma = src.match(/function crear\(\{([^}]*)\}\)/)[1];
  const conocidas = new Set(firma.split(',').map((x) => x.trim()).filter(Boolean));
  conocidas.add('usuario_id');

  const vig = fs.readFileSync(path.join(__dirname, '../../server/avisos/vigia.js'), 'utf8');
  const usadas = new Set();
  for (const m of vig.matchAll(/dejar\(\{([\s\S]*?)\n  \}\);/g)) {
    for (const k of m[1].matchAll(/^\s{4,6}([a-z_]+):/gm)) usadas.add(k[1]);
  }
  assert.ok(usadas.size >= 5, `no se encontraron las claves de los avisos (${usadas.size})`);
  const desconocidas = [...usadas].filter((k) => !conocidas.has(k));
  assert.deepEqual(desconocidas, [], `estas se pierden en silencio: ${desconocidas.join(', ')}`);
});
