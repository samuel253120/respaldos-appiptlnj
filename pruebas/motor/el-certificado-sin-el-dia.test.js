/**
 * CE-06 · El día que no se dice.
 *
 * La hoja clásica —bautismo, traslado, buena conducta— dice «Certifica que fue
 * bautizado(a) en las aguas […] el día {fecha_evento}, en {iglesia}». Ese día
 * sale de la FECHA DEL EVENTO, que no es obligatoria.
 *
 * MEDIDO en la v1.296.0: un certificado de bautismo sin fecha del evento se
 * emitía con un 201, y su hoja salía diciendo, palabra por palabra,
 * «… el día , en Iglesia Central». La frase se cierra sola y el hueco pasa
 * desapercibido hasta que el papel está firmado y entregado.
 *
 * El módulo ya tenía escrita la regla que hacía falta —«un certificado no se
 * emite a medias», punto 17.5— y la aplicaba a las otras dos formas: un
 * matrimonio sin cónyuge y una presentación sin padres se rechazan. La clásica
 * había quedado fuera, y es la que usan seis de los ocho tipos que trae el
 * sistema.
 *
 * LA REGLA NO ES «LA FECHA ES OBLIGATORIA», y este archivo lo prueba por los
 * dos lados: un certificado de membresía dice «es miembro en plena comunión de
 * tal iglesia» y no nombra ningún día, así que se emite sin ella. Lo que se
 * comprueba es lo que ESA hoja va a imprimir.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

/* La siembra primero, porque este archivo también CREA formatos. */
require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Dia ${m}`, `DI${m}`.slice(0, 18)).lastInsertRowid;
}

/** Un formato propio, para no depender de los que otro archivo puede reescribir. */
function unFormato(campos) {
  const nombre = `Hoja ${marca()}`;
  const claves = Object.keys(campos);
  db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, disposicion, tamano_hoja, orientacion${
      claves.length ? ', ' : ''}${claves.map((c) => `"${c}"`).join(', ')})
     VALUES (?, 1, 100, 'Clásica', 'Carta', 'Vertical'${claves.length ? ', ' : ''}${claves.map(() => '?').join(', ')})`
  ).run(nombre, ...claves.map((c) => campos[c]));
  return nombre;
}

async function emitir(api, tipo, campos = {}) {
  return api('POST', '/certificados', {
    tipo, iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', numero: `CERT-${marca()}`, ...campos,
  });
}

// ══════════════════════ cuando la hoja va a nombrar el día ══

test('un bautismo sin la fecha del bautismo NO se emite', async () => {
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica que fue bautizado(a) el día {fecha_evento}, en {iglesia}.' });

  const r = await emitir(api, tipo);
  assert.equal(r.estado, 400, 'antes contestaba 201 y la hoja salía con el hueco');
  assert.match(String(r.json.error), /nombra el día del evento, y está en blanco/);
});

test('y el aviso muestra el hueco y da las dos salidas', async () => {
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica que fue bautizado(a) el día {fecha_evento}, en {iglesia}.' });

  const aviso = String((await emitir(api, tipo)).json.error);
  assert.match(aviso, /«… el día , en …»/, 'enseña cómo saldría la frase');
  assert.match(aviso, /Escriba la fecha del evento/);
  assert.ok(aviso.includes(`formato «${tipo}»`), 'y nombra el formato que habría que corregir');
});

test('con la fecha puesta se emite sin más', async () => {
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica que fue bautizado(a) el día {fecha_evento}, en {iglesia}.' });

  const r = await emitir(api, tipo, { fecha_evento: '2026-02-01' });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.fecha_evento, '2026-02-01');
});

test('la fecha partida en día, mes y año cuenta igual: es la de las hojas de papel', async () => {
  /*
   * La presentación de niños y el matrimonio no escriben «{fecha_evento}»:
   * escriben «el día {ev_dia} de {ev_mes} de {ev_anio}», que es lo que hace la
   * frase con los espacios en blanco. Mirando solo la primera forma, esas dos
   * hojas se seguían emitiendo con tres huecos en vez de uno.
   */
  const api = await elSistemaAndando();
  for (const dato of ['ev_dia', 'ev_mes', 'ev_anio']) {
    const tipo = unFormato({ texto: `Certifica lo suyo, el {${dato}} de ese año.` });
    const r = await emitir(api, tipo);
    assert.equal(r.estado, 400, `{${dato}} no se contó como el día del evento`);
  }
});

test('y lo cuenta esté donde esté: en el título, en la línea de la fecha o en el versículo', async () => {
  const api = await elSistemaAndando();
  for (const campo of ['titulo', 'texto_fecha', 'epigrafe', 'rotulo_titular']) {
    const tipo = unFormato({ texto: 'Certifica lo suyo.', [campo]: 'El {fecha_evento} de marras' });
    const r = await emitir(api, tipo);
    assert.equal(r.estado, 400, `no lo miró en «${campo}»`);
  }
});

test('el texto propio del certificado también manda, y le gana al del formato', async () => {
  /*
   * Un certificado puede traer su propio texto, y es el que se imprime. Si el
   * formato no nombra el día pero el texto de ESTE certificado sí, la hoja va a
   * salir con el hueco igual.
   */
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica que es miembro en plena comunión de {iglesia}.' });

  const suelto = await emitir(api, tipo);
  assert.equal(suelto.estado, 201, 'el formato no nombra ningún día');

  const conTexto = await emitir(api, tipo, { texto: 'Certifica lo ocurrido el día {fecha_evento}.' });
  assert.equal(conTexto.estado, 400, 'pero el texto propio sí');
});

// ═══════════════ cuando la hoja NO lo nombra: se emite igual ══

test('LO QUE ESTA REGLA NO ES: una membresía sin fecha del evento se emite', async () => {
  /*
   * «Certifica que es miembro en plena comunión de tal iglesia» no nombra
   * ningún día. Exigir la fecha del evento acá sería pedir un dato que la hoja
   * no va a usar, y de esos el sistema ya sabe lo que pasa: se rellena con
   * cualquier cosa para poder guardar.
   */
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica que es miembro en plena comunión de {iglesia}.' });
  const r = await emitir(api, tipo);
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  assert.equal(r.json.fecha_evento, null);
});

test('y los ocho formatos que trae el sistema siguen pudiendo emitirse', async () => {
  /*
   * Cinco de los ocho nombran el día y tres no. Lo que esta prueba cuida es que
   * la regla no haya dejado ninguno inservible: con su fecha puesta, todos
   * salen.
   */
  const api = await elSistemaAndando();
  const traidos = db.prepare("SELECT nombre FROM formatos_certificado WHERE nombre IN ('Bautismo', 'Membresía', 'Traslado', 'Buena conducta', 'Reconocimiento', 'Otro')").all();
  assert.equal(traidos.length, 6);
  for (const { nombre } of traidos) {
    const r = await emitir(api, nombre, { fecha_evento: '2026-02-01' });
    assert.equal(r.estado, 201, `«${nombre}» no se pudo emitir: ${JSON.stringify(r.json)}`);
  }
});

test('un tipo sin formato tampoco se traba: no hay texto que mire', async () => {
  const api = await elSistemaAndando();
  const r = await emitir(api, `Tipo sin formato ${marca()}`);
  assert.equal(r.estado, 201, JSON.stringify(r.json));
});

// ════════════════════════ la regla también al editar ══

test('editar uno viejo que quedó sin el día lo hace saltar', async () => {
  /*
   * Es a propósito, y es lo mismo que ya hacían las otras dos reglas de «no se
   * emite a medias»: un certificado guardado sin el día está roto —su hoja sale
   * con el hueco— y guardarlo otra vez sin arreglarlo lo dejaría roto. La
   * salida la dice el propio aviso.
   */
  const api = await elSistemaAndando();
  const tipo = unFormato({ texto: 'Certifica lo ocurrido el día {fecha_evento}.' });
  const cert = await emitir(api, tipo, { fecha_evento: '2026-02-01' });
  assert.equal(cert.estado, 201);

  db.prepare('UPDATE certificados SET fecha_evento = NULL WHERE id = ?').run(cert.json.id);

  const r = await api('PUT', `/certificados/${cert.json.id}`, { notas: 'Se entregó en mano.' });
  assert.equal(r.estado, 400);
  assert.match(String(r.json.error), /nombra el día del evento/);

  const conFecha = await api('PUT', `/certificados/${cert.json.id}`, {
    notas: 'Se entregó en mano.', fecha_evento: '2026-02-01',
  });
  assert.equal(conFecha.estado, 200, 'y escribiendo la fecha, se guarda');
});
