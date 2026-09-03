/**
 * CE-04 · Anular un certificado tampoco preguntaba.
 *
 * Anular es la operación CORRECTA: el número se conserva, la fila no
 * desaparece, el libro sigue cuadrando. Es la que este módulo recomienda en vez
 * de borrar, y desde la v1.292.0 es una operación completa, porque la hoja
 * impresa lleva el sello que dice que ese papel no vale.
 *
 * Pero es una decisión sobre un papel que puede estar en manos de alguien.
 * MEDIDO en la v1.294.0: `PUT {estado: «Anulado»}` sobre un certificado emitido
 * contestaba 200 sin una palabra.
 *
 * Y LA MISMA PUERTA EN EL OTRO SENTIDO, que el informe no había nombrado y pesa
 * igual o más: volver un certificado anulado a «Emitido» también contestaba 200,
 * su hoja dejaba de llevar el sello, y de paso se borraba la fecha de la
 * anulación —tiene que borrarse; uno que vale no puede seguir diciendo cuándo
 * dejó de valer—, así que en la ficha no quedaba dicho que alguna vez se anuló.
 *
 * Las dos se preguntan ahora, cada una con su frase, y las dos dicen LO QUE EL
 * SISTEMA NO PUEDE HACER: recoger el papel que ya se entregó.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/certificados');
const { elSistemaAndando, cerrarElSistema } = require('./andando');

require('../../server/migraciones').formatosDeCertificadoQueTraiaElSistema();

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
const hoy = () => require('../../server/fechas').hoy();

function unaIglesia() {
  const m = marca();
  return db.prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')")
    .run(`Anular ${m}`, `AN${m}`.slice(0, 18)).lastInsertRowid;
}

async function unCertificado(api, campos = {}) {
  const r = await api('POST', '/certificados', {
    // Con la fecha del evento, que desde la v1.297.0 un certificado cuyo texto
    // nombra el día no se emite sin él (CE-06): la hoja saldría con el hueco.
    tipo: 'Bautismo', iglesia_id: unaIglesia(), nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', fecha_evento: '2026-02-01', numero: `CERT-${marca()}`, ...campos,
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json;
}

/** Lo que contesta el servidor al cambiarle el estado sin confirmar. */
async function loQueDiceAlCambiarA(api, id, estado, clave) {
  const r = await api('PUT', `/certificados/${id}`, { estado });
  assert.equal(r.estado, 400, 'antes contestaba 200 y lo cambiaba en silencio');
  assert.equal(r.json.confirmar, clave);
  return String(r.json.error);
}

// ═══════════════════════════════════════════════ anular pregunta ══

test('anular un certificado emitido PREGUNTA en vez de anularlo', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'certificado_que_se_anula');

  const sigue = await api('GET', `/certificados/${cert.id}`);
  assert.equal(sigue.json.estado, 'Emitido', 'mientras no contesten, sigue valiendo');
  assert.equal(sigue.json.fecha_anulacion, null, 'y no se estampó ninguna fecha');
});

test('el aviso dice cuál es, qué pasa con el número, y qué NO puede hacer el sistema', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { nombre_titular: 'Pedro Díaz Rojas' });
  const aviso = await loQueDiceAlCambiarA(api, cert.id, 'Anulado', 'certificado_que_se_anula');

  assert.match(aviso, new RegExp(`n\\.º ${cert.numero}`));
  assert.match(aviso, /de Bautismo/);
  assert.match(aviso, /a nombre de Pedro Díaz Rojas/);
  assert.match(aviso, /emitido el 10-03-2026/);
  assert.match(aviso, /El número no se libera/, 'que es lo que la distingue de borrar');
  assert.match(aviso, /sello «ANULADO»/, 'y lo que va a pasar con la hoja');
  assert.match(aviso, /no puede hacer es recoger el que ya se entregó/,
    'lo único que el sistema no puede arreglar, y por lo que hay que ir a buscar el papel');
});

test('y contestando que sí, se anula y se estampa el día', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado', igual_asi: true });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.estado, 'Anulado');
  assert.equal(r.json.fecha_anulacion, hoy());
});

// ══════════════════════════════════ y devolverle la validez, también ══

test('volver un certificado anulado a «Emitido» también PREGUNTA', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Emitido' });
  assert.equal(r.estado, 400);
  assert.equal(r.json.confirmar, 'certificado_que_vuelve_a_valer');

  const sigue = await api('GET', `/certificados/${cert.id}`);
  assert.equal(sigue.json.estado, 'Anulado');
  assert.equal(sigue.json.fecha_anulacion, hoy(), 'y su fecha de anulación no se borró');
});

test('ese aviso dice desde cuándo estaba anulado y qué se pierde al devolverlo', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });
  const aviso = await loQueDiceAlCambiarA(api, cert.id, 'Emitido', 'certificado_que_vuelve_a_valer');

  assert.match(aviso, new RegExp(`El certificado n\\.º ${cert.numero}`), 'empieza nombrándolo');
  assert.match(aviso, new RegExp(`está anulado desde el ${require('../../server/fechas').comoSeLee(hoy())}`));
  assert.match(aviso, /deja de llevar el sello/);
  assert.match(aviso, /se borra la fecha de anulación/);
  assert.match(aviso, /no quedará dicho que alguna vez se anuló, solo en el Registro de Cambios/);
});

test('y contestando que sí, vuelve a valer y la fecha se borra', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });

  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Emitido', igual_asi: true });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.estado, 'Emitido');
  assert.equal(r.json.fecha_anulacion, null);
});

// ═══════════════════════════════════════ cuándo NO se pregunta ══

test('emitir uno nuevo ya anulado no pregunta nada', async () => {
  /*
   * Es legítimo: así se registra un certificado viejo que en el libro de papel
   * ya estaba dado de baja. No cambia nada de lo que hubiera, y quien lo
   * escribe acaba de elegir ese estado en el formulario.
   */
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });
  assert.equal(cert.estado, 'Anulado');
  assert.equal(cert.fecha_anulacion, hoy());
});

test('guardar cualquier otra cosa de un certificado tampoco pregunta', async () => {
  const api = await elSistemaAndando();
  const cert = await unCertificado(api);
  const r = await api('PUT', `/certificados/${cert.id}`, { notas: 'Se entregó en mano.' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.notas, 'Se entregó en mano.');
  assert.equal(r.json.estado, 'Emitido');
});

test('y volver a guardar uno anulado, dejándolo anulado, tampoco', async () => {
  // El estado no cambia: no hay ninguna decisión que confirmar, y preguntarlo
  // en cada guardado enseñaría a contestar que sí sin leer
  const api = await elSistemaAndando();
  const cert = await unCertificado(api, { estado: 'Anulado' });
  const r = await api('PUT', `/certificados/${cert.id}`, { estado: 'Anulado', notas: 'Rehecho.' });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.fecha_anulacion, hoy(), 'y la fecha no se vuelve a estampar');
});

// ════════════════════════════════ las tres frases del módulo ══

test('las tres preguntas de este módulo empiezan diciendo cuál certificado es', () => {
  /*
   * Anular, devolver la validez y borrar se contestan desde un listado o desde
   * un formulario donde todas las fichas se parecen. Las tres comparten la
   * misma cabecera —`cualEs`— justamente para que no se pueda escribir una
   * cuarta que se olvide de decirlo.
   */
  const fila = {
    numero: 'CERT-001-2026', tipo: 'Bautismo', nombre_titular: 'Ana Soto Vera',
    fecha_emision: '2026-03-10', fecha_evento: '2026-02-01',
    estado: 'Anulado', fecha_anulacion: '2026-04-01',
  };
  const frases = [
    def.hooks.beforeSave({ estado: 'Anulado' }, { existing: { ...fila, estado: 'Emitido' }, db, confirmado: false }),
    def.hooks.beforeSave({ estado: 'Emitido' }, { existing: fila, db, confirmado: false }),
    def.hooks.beforeDelete(fila, { confirmado: false }),
  ].map((r) => String(r.error));

  for (const frase of frases) {
    assert.match(frase, /n\.º CERT-001-2026/, frase);
    assert.match(frase, /Bautismo/, frase);
    assert.match(frase, /Ana Soto Vera/, frase);
    assert.match(frase, /10-03-2026/, frase);
  }
  assert.equal(new Set(frases).size, 3, 'y las tres dicen cosas distintas después de eso');
});

test('la pantalla sabe qué preguntar con las dos claves', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  const tabla = app.slice(app.indexOf('const COMO_SE_PREGUNTA = {'), app.indexOf('const como = COMO_SE_PREGUNTA['));

  for (const clave of ['certificado_que_se_anula', 'certificado_que_vuelve_a_valer']) {
    const entrada = tabla.slice(tabla.indexOf(`${clave}: {`));
    assert.ok(entrada.startsWith(`${clave}: {`), `falta la entrada ${clave}`);
    const bloque = entrada.slice(0, entrada.indexOf('},'));
    assert.match(bloque, /titulo:/);
    assert.match(bloque, /volver:/);
    assert.match(bloque, /seguir:/);
  }
  // Y los botones de seguir dicen cuál de las dos decisiones se toma
  assert.match(tabla, /seguir: 'Anularlo'/);
  assert.match(tabla, /seguir: 'Devolverle la validez'/);
});

// ════════════════ el campo con que se anula, visible en la pantalla ══

test('EL QUE CASI SE ESCAPA: el campo «Estado» no cae dentro de una sección que se esconde', () => {
  /*
   * APARECIÓ PROBANDO ESTO EN EL NAVEGADOR, no leyendo el código.
   *
   * El formulario se reparte en secciones así: un campo que declara `seccion`
   * abre una, y los que le siguen SIN declarar ninguna se quedan adentro. Los
   * cinco últimos campos del certificado —la ciudad, el texto, el estado, la
   * fecha de anulación y las notas— no declaraban la suya, así que caían
   * dentro de «El matrimonio», que solo se muestra cuando la disposición es
   * Matrimonio.
   *
   * Medido en la v1.294.0 abriendo la ficha de un certificado de BAUTISMO: de
   * los veinticuatro controles del formulario, «estado» estaba en el documento
   * pero oculto. Anular desde la pantalla era imposible salvo en los
   * certificados de matrimonio — y la pregunta que este archivo comprueba no se
   * podía ni alcanzar.
   */
  const enSuSeccion = {};
  let abre = null;
  for (const f of def.fields) {
    if (f.seccion) abre = f;
    enSuSeccion[f.name] = abre;
  }
  for (const campo of ['ciudad', 'texto', 'estado', 'fecha_anulacion', 'notas']) {
    const seccion = enSuSeccion[campo];
    assert.ok(seccion, `«${campo}» quedó sin sección`);
    assert.ok(!seccion.showIf,
      `«${campo}» cae en «${seccion.seccion}», que solo se muestra con ${JSON.stringify(seccion.showIf)}`);
  }
});

test('y NINGÚN módulo arrastra un campo suyo a una sección condicional', () => {
  /*
   * La misma comprobación para los treinta y nueve, porque el descuido no es de
   * este módulo sino de la forma en que se declaran las secciones: agregar un
   * campo al final de una lista es lo más natural del mundo, y si el último
   * bloque abierto era condicional, ese campo desaparece de la pantalla sin que
   * nada avise.
   *
   * Se dejan fuera los campos que el motor genera solo: un campo de tipo
   * `persona` trae su enlace `<campo>_id` pegado detrás, y ese enlace pertenece
   * a la misma sección que su pareja por construcción.
   */
  const arrastrados = [];

  for (const modulo of require('../../server/registry').allModules()) {
    if (!modulo.fields) continue;
    let abre = null;
    let anterior = null;
    for (const f of modulo.fields) {
      if (f.seccion) { abre = f; anterior = f; continue; }
      const esElEnlaceDeUnaPersona = anterior && anterior.type === 'persona' && f.name === `${anterior.name}_id`;
      if (abre && abre.showIf && !f.showIf && !esElEnlaceDeUnaPersona) {
        arrastrados.push(`${modulo.name}.${f.name} → «${abre.seccion}» (${JSON.stringify(abre.showIf)})`);
      }
      anterior = f;
    }
  }

  assert.deepEqual(arrastrados, [],
    'estos campos se esconden con una sección que no es suya:\n  ' + arrastrados.join('\n  '));
});

test('lo que sale impreso y lo interno no van en la misma caja', () => {
  /*
   * Los cinco campos del final se podían haber puesto en UNA sola sección: con
   * eso ya no se escondían, que era el problema. Pero el rótulo habría mentido
   * a la mitad de ellos. «Notas internas» dice en su ayuda que no salen en la
   * hoja, y meterlas bajo un letrero que dice «Lo que sale impreso» es hacer
   * que alguien dude antes de escribir ahí lo que necesita anotar —o peor, que
   * no lo escriba—. Por eso son dos secciones, y por eso esto se comprueba.
   */
  const seccionDe = (nombre) => {
    let abre = null;
    for (const f of def.fields) {
      if (f.seccion) abre = f;
      if (f.name === nombre) return abre ? abre.seccion : null;
    }
    return null;
  };
  assert.equal(seccionDe('texto'), seccionDe('ciudad'), 'lo que se imprime, junto');
  assert.notEqual(seccionDe('notas'), seccionDe('texto'),
    'las notas internas no van bajo el rótulo de lo que sale impreso');
  assert.equal(seccionDe('estado'), seccionDe('notas'), 'y el estado va con ellas');
  assert.match(String(seccionDe('texto')), /impreso/i, 'el rótulo dice qué es');
});

test('y dos secciones seguidas no se llaman igual', () => {
  /*
   * «Los datos del niño(a)» estaba declarada dos veces seguidas, así que la
   * pantalla dibujaba dos cajas con el mismo rótulo y números distintos —«1 Los
   * datos del niño(a)» y «2 Los datos del niño(a)»—, que se lee como un error
   * porque lo es. Los bloques se numeran por lo que se ve.
   */
  const titulos = def.fields.filter((f) => f.seccion).map((f) => f.seccion);
  for (let i = 1; i < titulos.length; i += 1) {
    assert.notEqual(titulos[i], titulos[i - 1], `«${titulos[i]}» se abre dos veces seguidas`);
  }
});
