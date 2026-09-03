/**
 * El código de autenticidad del QR: lo que hace que no se pueda falsificar.
 *
 * Son siete caracteres calculados sobre los datos de la credencial más una
 * clave. Si alguien cambia un dato del contenido del QR, el código deja de
 * calzar y la verificación lo rechaza (punto 8.3 y prueba 15.9).
 *
 * La diferencia con el archivo de diseño no es de estilo. Ahí el cálculo vivía
 * en el navegador, con la clave escrita adentro, y su propio comentario lo
 * admitía: «disuade y detecta alteraciones, no sustituye a una firma emitida
 * por un servidor». Acá la clave vive solo en el servidor, así que el código sí
 * es una firma: sin la clave no se puede fabricar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const codigo = require('../../server/credenciales/codigo');

const DATOS = 'SOTO MARTINEZ J.C.|P.PRESBITERO|123456785|SEDE LA NUEVA JERUSALEN|1232026-3|0326-0328|7217';

test('siempre son siete caracteres, sea cual sea el contenido', () => {
  // El recuadro del QR tiene un tamaño fijo: un código que a veces midiera seis
  // y a veces ocho cambiaría el largo del contenido y con él el tamaño de los
  // módulos impresos.
  for (let i = 0; i < 3000; i++) {
    const c = codigo.firmar(`credencial ${i} con datos de largo variable ${'x'.repeat(i % 60)}`);
    assert.equal(c.length, 7, `salió de largo ${c.length}`);
    assert.match(c, /^[0-9A-Z]{7}$/, `salió con caracteres raros: ${c}`);
  }
});

test('el mismo contenido da siempre el mismo código', () => {
  assert.equal(codigo.firmar(DATOS), codigo.firmar(DATOS));
});

test('cambiar un solo carácter cambia el código (prueba 15.9)', () => {
  const bueno = codigo.firmar(DATOS);
  const alterados = [
    DATOS.replace('SOTO', 'SOTA'),          // el apellido
    DATOS.replace('123456785', '123456786'), // el RUT
    DATOS.replace('1232026-3', '1242026-3'), // el número de serie
    DATOS.replace('0326-0328', '0326-0338'), // la vigencia
    DATOS.replace('SEDE', 'MATRIZ'),         // la categoría de la iglesia
  ];
  for (const malo of alterados) {
    assert.notEqual(codigo.firmar(malo), bueno, `no cambió al alterar: ${malo}`);
    assert.equal(codigo.corresponde(malo, bueno), false, 'tendría que rechazarlo');
  }
});

test('un código inventado no pasa', () => {
  assert.equal(codigo.corresponde(DATOS, 'AAAAAAA'), false);
  assert.equal(codigo.corresponde(DATOS, ''), false);
  assert.equal(codigo.corresponde(DATOS, null), false);
  assert.equal(codigo.corresponde(DATOS, undefined), false);
  // Ni uno del largo correcto pero cambiado en un carácter
  const bueno = codigo.firmar(DATOS);
  const casi = bueno.slice(0, 6) + (bueno[6] === 'A' ? 'B' : 'A');
  assert.equal(codigo.corresponde(DATOS, casi), false);
});

test('el suyo sí pasa, escrito en minúsculas también', () => {
  const c = codigo.firmar(DATOS);
  assert.equal(codigo.corresponde(DATOS, c), true);
  assert.equal(codigo.corresponde(DATOS, c.toLowerCase()), true, 'quien lo escribe a mano no distingue mayúsculas');
});

test('dos credenciales distintas no comparten código', () => {
  // Si dos contenidos distintos dieran el mismo código, el de una serviría para
  // validar la otra. Con siete caracteres de base 36 hay margen de sobra, pero
  // conviene comprobar que el cálculo de verdad los separa.
  const vistos = new Map();
  for (let i = 1; i <= 5000; i++) {
    const datos = `APELLIDO ${i}|P.DIACONO|1234567${i % 10}|SEDE IGLESIA|${String(i).padStart(3, '0')}2026-1|0126-0130|7217`;
    const c = codigo.firmar(datos);
    assert.ok(!vistos.has(c) || vistos.get(c) === datos, `dos contenidos distintos dieron ${c}`);
    vistos.set(c, datos);
  }
  assert.ok(vistos.size > 4990, `demasiadas coincidencias: ${vistos.size} códigos para 5000 credenciales`);
});

test('la clave no viaja al navegador', () => {
  // La comprobación de verdad es que el módulo no la exporte ni la deje
  // asomarse: si algún día alguien la agregara a lo que se manda, esto lo dice.
  const expuesto = JSON.stringify(Object.keys(codigo));
  assert.ok(!expuesto.includes('CLAVE'), 'el módulo no puede exportar la clave');
});

/* --------------------------------------------------------------------- */
/* Y que la clave que firma sea de VERDAD la del servidor                 */
/* --------------------------------------------------------------------- */

/**
 * Estas cuatro pruebas arrancan procesos aparte, y no es por gusto.
 *
 * El módulo lee la clave UNA VEZ, al cargarse, y se la queda. Dentro de un
 * mismo proceso no hay forma de cambiarla, así que preguntarle dos veces con
 * dos claves distintas exige dos procesos. Es el único rincón del módulo donde
 * hace falta.
 *
 * POR QUÉ HACEN FALTA. Comprobado: cambiando el código para que use SIEMPRE la
 * clave de reserva —la que está escrita en el archivo y es pública— y dejando
 * intacta la comprobación que decide si avisar, todas las pruebas seguían en
 * verde Y el aviso de arranque tampoco salía, porque esa comprobación mira la
 * variable de entorno y la variable seguía puesta. El sistema habría dicho que
 * estaba bien configurado mientras firmaba con la clave que cualquiera puede
 * leer en el repositorio, y ninguna credencial emitida así valdría nada.
 *
 * La única prueba que tocaba el asunto comprobaba que `tieneClavePropia()`
 * devolviera un booleano, que es algo que no puede fallar.
 */
function comoFirmaOtroServidor(entorno) {
  const { execFileSync } = require('node:child_process');
  const guion =
    "const c = require(process.argv[1]);" +
    "process.stdout.write(JSON.stringify({ codigo: c.firmar(process.argv[2]), propia: c.tieneClavePropia() }));";
  const salida = execFileSync(
    process.execPath,
    ['-e', guion, require.resolve('../../server/credenciales/codigo'), DATOS],
    {
      encoding: 'utf8',
      // Se arranca con un entorno limpio: si se heredara el de la prueba,
      // CREDENCIAL_SECRETO se colaría en el caso que justamente lo quita
      env: { PATH: process.env.PATH, NODE_ENV: 'test', ...entorno },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return JSON.parse(salida);
}

/** Lo mismo, pero quedándose con lo que el módulo avisa al cargarse. */
function loQueAvisaAlArrancar(entorno) {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(
    process.execPath,
    ['-e', "require(process.argv[1]);", require.resolve('../../server/credenciales/codigo')],
    { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test', ...entorno } }
  );
  return String(r.stderr || '');
}

test('dos claves distintas firman distinto', () => {
  const una = comoFirmaOtroServidor({ CREDENCIAL_SECRETO: 'una-clave-cualquiera' });
  const otra = comoFirmaOtroServidor({ CREDENCIAL_SECRETO: 'otra-clave-distinta' });
  assert.notEqual(una.codigo, otra.codigo,
    'si dos claves distintas dieran el mismo código, la clave no estaría firmando nada');
});

test('con clave propia NO se firma con la de reserva (punto 8.3)', () => {
  /**
   * Es la comprobación que faltaba, y la que atrapa el caso peligroso: que el
   * sistema diga que tiene su clave configurada mientras firma con la pública.
   */
  const conLaSuya = comoFirmaOtroServidor({ CREDENCIAL_SECRETO: 'la-del-servidor-publicado' });
  const conLaDeReserva = comoFirmaOtroServidor({});
  assert.equal(conLaSuya.propia, true, 'con la variable puesta tiene que decir que la clave es suya');
  assert.equal(conLaDeReserva.propia, false, 'sin ninguna variable, no lo es');
  assert.notEqual(conLaSuya.codigo, conLaDeReserva.codigo,
    'el código firmado con la clave del servidor no puede ser el mismo que el de la clave pública');
});

test('a falta de la propia sirve la de la sesión, y tampoco es la de reserva', () => {
  // El módulo acepta JWT_SECRET como segunda opción: es mejor que la escrita
  // en el código, aunque lo correcto sea poner CREDENCIAL_SECRETO
  const conJwt = comoFirmaOtroServidor({ JWT_SECRET: 'la-de-la-sesion' });
  const conLaDeReserva = comoFirmaOtroServidor({});
  assert.equal(conJwt.propia, true);
  assert.notEqual(conJwt.codigo, conLaDeReserva.codigo);
});

test('sin clave configurada, el servidor lo avisa al arrancar', () => {
  /**
   * El aviso es lo único que separa a un servidor mal publicado de uno que
   * firma credenciales con una clave pública sin que nadie se entere.
   */
  const sinNada = loQueAvisaAlArrancar({});
  assert.match(sinNada, /CREDENCIAL_SECRETO/, 'tiene que nombrar la variable que falta');
  assert.match(sinNada, /clave de reserva|es pública/i, 'y decir qué está pasando mientras tanto');
  const conLaSuya = loQueAvisaAlArrancar({ CREDENCIAL_SECRETO: 'la-del-servidor' });
  assert.ok(!/CREDENCIAL_SECRETO/.test(conLaSuya),
    'con la clave puesta no puede seguir avisando: un aviso que sale siempre no lo lee nadie');
});
