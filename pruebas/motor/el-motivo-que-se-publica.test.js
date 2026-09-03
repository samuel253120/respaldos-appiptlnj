/**
 * El motivo de una revocación se publica, y en todas partes tiene que decirlo.
 *
 * Cuando alguien revoca una credencial escribe por qué, y ese texto no se
 * queda adentro: la página de verificación se lo muestra tal cual a cualquiera
 * que escanee el código de esa credencial. Es una decisión tomada y correcta
 * —quien tiene la tarjeta en la mano necesita saber por qué no vale—, pero
 * entonces quien lo escribe tiene que saberlo ANTES de escribirlo.
 *
 * NO SE SABÍA. La caja donde se escribe decía solo que «queda en el registro de
 * cambios», que suena a un lugar de la oficina; la ayuda del campo decía lo
 * mismo, y el aviso del servidor cuando faltaba, también. Comprobado de punta a
 * punta: revocada una credencial con el motivo «Se le retiró por faltas graves
 * a la disciplina de la iglesia», ese texto salía íntegro en la página pública,
 * abierta sin ninguna sesión.
 *
 * El sistema ya había tomado ese cuidado por el otro lado: cuando revoca solo
 * —porque el titular falleció, se jubiló o se trasladó— usa a propósito un
 * motivo neutro, y su comentario explica que esa página la abre cualquiera con
 * un teléfono. Lo que faltaba era el mismo cuidado en el motivo que se escribe
 * a mano, que es justamente el que puede llevar algo delicado sobre alguien.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const credenciales = require('../../server/modules/credenciales');
const verificacion = require('../../server/credenciales/verificacion');
const pagina = require('../../server/credenciales/pagina');
const ejerce = require('../../server/pastor-que-ejerce');

/** Que el texto avise de que eso se va a ver afuera. */
const avisaQueSePublica = (texto) =>
  /se publica|SE PUBLICA|lo va a leer|lo lee|va a leer quien/i.test(String(texto || ''));

/* --------------------------------------------------------------------- */
/* Que de verdad se publica: si esto cambiara, lo demás sobra             */
/* --------------------------------------------------------------------- */

test('el motivo escrito sale en la página pública, tal cual', () => {
  const MOTIVO = 'Fue robada en el terminal de buses';
  const fila = {
    id: 1, serie: '0122026', serie_dv: '3', estado: 'Revocada', motivo_revocacion: MOTIVO,
    snap_nombres: 'Juan', snap_apellidos: 'Soto', snap_rut: '12345678-5',
    snap_grado: 'Pastor Diácono', snap_categoria: 'SEDE', snap_iglesia: 'La Nueva Jerusalén',
    fecha_emision: '2026-03-01', fecha_vencimiento: '2028-03-01',
  };
  const resultado = verificacion.verificar('0122026-3', 'no importa', {
    buscar: () => fila,
    situacionDe: credenciales.situacionDe,
    // se saltea la comprobación del código: lo que se mira acá es qué se muestra
  });
  // El código no calza a propósito, así que se arma el resultado a mano con la
  // misma forma que devuelve la verificación cuando sí calza
  assert.equal(resultado.valida, false, 'sin el código correcto no se muestra nada, y está bien');

  const comoSiCalzara = {
    situacion: 'Revocada', color: 'rojo', sirve: false,
    datos: {
      nombres: 'Juan', apellidos: 'Soto', grado: 'Pastor Diácono', cargo: '',
      categoria: 'SEDE', iglesia: 'La Nueva Jerusalén', comuna: '',
      rut_tapado: '••.•••.678-5', serie: '0122026-3',
      emitida: '2026-03-01', vence: '2028-03-01',
      motivo_revocacion: MOTIVO, hay_foto: false,
    },
  };
  const html = pagina.valida(comoSiCalzara, { institucion: 'IPT', direccionDeLaFoto: '' });
  assert.ok(html.includes(MOTIVO),
    'la página pública muestra el motivo: por eso hay que avisar de que se publica');
});

/* --------------------------------------------------------------------- */
/* Y por eso, los tres lugares donde se pide lo dicen                     */
/* --------------------------------------------------------------------- */

test('la ayuda del campo avisa de que se publica', () => {
  const campo = credenciales.fields.find((f) => f.name === 'motivo_revocacion');
  assert.ok(campo, 'falta el campo del motivo');
  assert.ok(avisaQueSePublica(campo.help),
    `la ayuda tiene que decir que se publica, y dice: «${campo.help}»`);
  assert.ok(/notas/i.test(campo.help),
    'y dónde poner lo que NO tiene que salir de la oficina');
});

test('el aviso del servidor, cuando falta el motivo, también', () => {
  // Por el guardado corriente
  const alGuardar = credenciales.hooks.beforeSave(
    { estado: 'Revocada', motivo_revocacion: '   ' },
    { isNew: false, existing: { id: 1, estado: 'Revocada', pastor_id: 1 }, user: null }
  );
  assert.ok(typeof alGuardar === 'string', `se esperaba un aviso, llegó ${JSON.stringify(alGuardar)}`);
  assert.ok(avisaQueSePublica(alGuardar), `y tiene que avisar de que se publica: «${alGuardar}»`);
});

test('la caja donde se escribe, en la pantalla, lo dice antes de escribirlo', () => {
  /**
   * Se mira el archivo de la pantalla y no el navegador: lo que se comprueba es
   * que el texto ESTÉ, que es lo que se había quedado sin decir. Correrlo en un
   * navegador para leer un párrafo sería cargar medio sistema para nada.
   */
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const caja = /titulo: '🚫 Revocar la credencial',[\s\S]*?aceptar: 'Revocarla'/.exec(app);
  assert.ok(caja, 'no se encontró la caja de revocar en la pantalla');
  const texto = caja[0];
  assert.ok(/El motivo se publica/i.test(texto),
    'la caja tiene que decir que el motivo se publica');
  assert.ok(/escanee/i.test(texto), 'y quién lo va a leer');
  assert.ok(/notas/i.test(texto), 'y dónde va lo que no tiene que salir de la oficina');
  assert.ok(!/queda en el registro de cambios\.<\/p>/.test(texto),
    'ya no puede decir solo que queda en el registro de cambios, que suena a un lugar de adentro');
});

test('y ofrece motivos ya redactados para leerse en público', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const lista = /const MOTIVOS = \[([\s\S]*?)\];/.exec(app);
  assert.ok(lista, 'la pantalla tiene que ofrecer motivos ya escritos');
  const cuantos = (lista[1].match(/'/g) || []).length / 2;
  assert.ok(cuantos >= 4, `se esperaban varios motivos a elegir, hay ${cuantos}`);
  assert.ok(/extravi|robada/i.test(lista[1]), 'los casos corrientes tienen que estar');
});

/* --------------------------------------------------------------------- */
/* Lo que ya estaba bien y no se toca                                     */
/* --------------------------------------------------------------------- */

test('la revocación automática sigue usando un motivo neutro', () => {
  /**
   * Es la decisión que este arreglo viene a extender, no a cambiar: cuando el
   * sistema revoca solo, el motivo no dice si la persona falleció, se jubiló o
   * se trasladó. Eso queda en el historial del pastor.
   */
  const fuente = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server', 'pastor-que-ejerce.js'), 'utf8');
  assert.match(fuente, /motivo: 'El titular ya no ejerce en el ministerio\.'/);
  for (const estado of ejerce.YA_NO_EJERCEN) {
    assert.ok(!fuente.includes(`motivo: '${estado}`), `el motivo público no puede nombrar «${estado}»`);
  }
});

test('el motivo se escapa antes de salir a la página', () => {
  // Es público y lo escribe una persona: no puede llevar etiquetas adentro
  const conEtiquetas = {
    situacion: 'Revocada', color: 'rojo', sirve: false,
    datos: {
      nombres: 'Juan', apellidos: 'Soto', grado: '', cargo: '', categoria: '', iglesia: '',
      comuna: '', rut_tapado: '', serie: '0122026-3', emitida: '', vence: '',
      motivo_revocacion: '<script>alert(1)</script>', hay_foto: false,
    },
  };
  const html = pagina.valida(conEtiquetas, { institucion: 'IPT', direccionDeLaFoto: '' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no puede salir la etiqueta entera');
  assert.ok(html.includes('&lt;script&gt;'), 'sale escapada');
});
