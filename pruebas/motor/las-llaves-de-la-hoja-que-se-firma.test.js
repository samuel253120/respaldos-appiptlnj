/**
 * Los datos entre llaves se reemplazan en la hoja que se firma y se entrega.
 *
 * El texto de un certificado se escribe una vez, con los datos entre llaves
 * —«…fue bautizado(a) el día {fecha_evento}, en {iglesia}»— y cada hoja sale
 * con lo suyo. Es la promesa central de «Formatos de Certificado», y el propio
 * módulo dice qué pasa si falla: «un certificado entregado que diga
 * «{fecha_evento}» hay que rehacerlo».
 *
 * HAY DOS LUGARES QUE RELLENAN, Y SOLO UNO ESTABA CUIDADO. El servidor arma la
 * constancia en PDF que se manda por correo; la pantalla arma la hoja
 * ceremonial —la de la orla y los colores, la que se firma, se sella y se
 * entrega—. Apagado el relleno de cada lado por separado, en la v1.309.0:
 *
 *     apagado en el SERVIDOR    2 pruebas en rojo
 *     apagado en la PANTALLA    3.503 pruebas del motor y 76 comprobaciones
 *                               del papel, todas verdes
 *
 * La que estaba cuidada era la copia; la que no, el original. Con el relleno
 * apagado, un certificado de membresía salía impreso diciendo «Certifica que es
 * miembro en plena comunión de {iglesia}», con su número, su orla, el nombre
 * del titular y las dos líneas de firma, y nada se quejaba.
 *
 * Acá se cuida la cuenta misma, que es rápida y corre siempre. Sobre el PAPEL
 * de verdad lo comprueba la suite del papel, en las tres disposiciones.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const palabras = require('../../server/certificado-en-palabras');

/**
 * Las funciones de la pantalla, sacadas del archivo y puestas a funcionar.
 *
 * Se ejecuta el código de verdad y no una copia escrita acá: si esta prueba
 * trajera su propia versión, no estaría comprobando la que corre. Lo que se le
 * pone alrededor son las cuatro cosas que la pantalla tiene y el motor no —el
 * nombre de la institución, la fecha en letras, el RUT con puntos y el escapado
 * de etiquetas—, escritas lo más simples que se puede para que lo que se mide
 * sea el relleno y no ellas.
 */
function lasDeLaPantalla() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  const trozo = (desdeQue, hastaQue) => {
    const a = src.indexOf(desdeQue);
    assert.ok(a > 0, `no se encontró «${desdeQue}» en la pantalla`);
    const b = src.indexOf(hastaQue, a);
    assert.ok(b > a, `no se encontró el final de «${desdeQue}»`);
    return src.slice(a, b);
  };
  const codigo = [
    trozo('const CERT_MESES = [', 'function certDatos(row)'),
    trozo('function certDatos(row)', 'function certRellenar(texto, row)'),
    trozo('function certRellenar(texto, row)', 'const CERT_TIPOGRAFIAS'),
  ].join('\n');

  const alrededor = `
    const IGLESIA = { nombre: 'Iglesia Pentecostal Triunfante' };
    const iglesiaDeTrabajo = (x) => x || '';
    const MESES_LARGOS = ['enero','febrero','marzo','abril','mayo','junio','julio',
      'agosto','septiembre','octubre','noviembre','diciembre'];
    const fechaLarga = (iso) => {
      const [a, m, d] = String(iso).slice(0, 10).split('-');
      return Number(d) + ' de ' + MESES_LARGOS[Number(m) - 1] + ' de ' + a;
    };
    const rutFormatear = (r) => String(r);
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  `;
  return new Function(`${alrededor}\n${codigo}\nreturn { certDatos, certRellenar, certRellenarMarcado };`)();
}

/** Un certificado con todos sus datos puestos, para que ninguna llave quede vacía. */
const UN_CERTIFICADO = {
  numero: 'CERT-001-2026',
  tipo: 'Presentación de niños',
  nombre_titular: 'Erick Kalem Aaron Solar Alfaro',
  conyuge: 'María Fernanda Rojas Silva',
  padre: 'José Luis Aaron Solar Vergara',
  madre: 'Camila Francisca Alfaro Aguayo',
  ciudad: 'Chillán',
  rut: '12345678-5',
  fecha_nacimiento: '2018-10-06',
  fecha_evento: '2026-03-15',
  fecha_emision: '2026-03-20',
  iglesia_id_label: 'La Nueva Jerusalén',
  oficiante_id_label: 'Pastor Juan Carlos Soto',
};

/** Lo que quedó sin reemplazar en un texto ya rellenado. */
const llavesQueQuedaron = (texto) => (String(texto).match(/\{\w+\}/g) || []);

/* --------------------------------------------------------------------- */
/* Que el relleno OCURRA, que es lo que no comprobaba nadie               */
/* --------------------------------------------------------------------- */

test('LA QUE FALTABA: ninguna llave conocida sobrevive a la hoja', () => {
  const { certRellenar } = lasDeLaPantalla();
  const todas = palabras.lasLlaves();
  const texto = todas.map((k) => `{${k}}`).join(' · ');
  const salida = certRellenar(texto, UN_CERTIFICADO);
  assert.deepEqual(llavesQueQuedaron(salida), [],
    'quedaron llaves sin reemplazar: una hoja así hay que rehacerla');
});

test('y los datos salen de verdad, no es que las llaves se borren', () => {
  /**
   * Sin esto, un relleno que se tragara las llaves en vez de reemplazarlas
   * pasaría la prueba anterior con una hoja en blanco donde va el dato.
   */
  const { certRellenar } = lasDeLaPantalla();
  const salida = certRellenar(
    'Certifica que {titular}, hijo(a) de {padre} y {madre}, fue presentado(a) el {fecha_evento} en {iglesia}, ' +
    'ante {oficiante}. Dado en {ciudad} el {fecha_emision}. N.º {numero}.',
    UN_CERTIFICADO
  );
  for (const debeSalir of [
    'Erick Kalem Aaron Solar Alfaro', 'José Luis Aaron Solar Vergara',
    'Camila Francisca Alfaro Aguayo', '15 de marzo de 2026', 'La Nueva Jerusalén',
    'Pastor Juan Carlos Soto', 'Chillán', '20 de marzo de 2026', 'CERT-001-2026',
  ]) {
    assert.ok(salida.includes(debeSalir), `falta «${debeSalir}» en: ${salida}`);
  }
});

test('las fechas partidas también, que son las que usan las dos hojas de la iglesia', () => {
  /**
   * La hoja de presentación de niños y la de matrimonio están escritas con la
   * frase de los espacios en blanco —«con fecha __ de ______ del año ____»—, y
   * ahí las llaves no son la fecha entera sino sus tres partes.
   */
  const { certRellenar } = lasDeLaPantalla();
  const salida = certRellenar(
    'nació el {nac_dia} de {nac_mes} del año {nac_anio}, presentado el {ev_dia} de {ev_mes} del año {ev_anio}, ' +
    'entregado el {em_dia} de {em_mes} del año {em_anio}',
    UN_CERTIFICADO
  );
  assert.match(salida, /nació el 06 de OCTUBRE del año 2018/);
  assert.match(salida, /presentado el 15 de MARZO del año 2026/);
  assert.match(salida, /entregado el 20 de MARZO del año 2026/);
  assert.deepEqual(llavesQueQuedaron(salida), []);
});

test('y en la hoja marcada, que es como se imprimen esas dos, tampoco queda ninguna', () => {
  /**
   * La presentación y el matrimonio no usan el relleno corriente sino el que
   * deja el dato subrayado, como el formulario en papel. Es otro trozo de
   * código y podía romperse por su cuenta.
   */
  const { certRellenarMarcado } = lasDeLaPantalla();
  const salida = certRellenarMarcado(
    'Certifica que {titular} nació el {nac_dia} de {nac_mes} del año {nac_anio} en {iglesia}.',
    UN_CERTIFICADO
  );
  assert.deepEqual(llavesQueQuedaron(salida), []);
  assert.ok(salida.includes('Erick Kalem Aaron Solar Alfaro'));
  assert.ok(salida.includes('OCTUBRE'));
  assert.match(salida, /<u class="cert-dato">/, 'el dato va subrayado, como en el papel');
});

test('un dato que falta deja el hueco, y no la llave a la vista', () => {
  /**
   * Es lo que dice la ayuda del campo: «el que no tenga dato queda en blanco».
   * Dejar «{conyuge}» impreso en un certificado entregado obliga a rehacerlo.
   */
  const { certRellenar } = lasDeLaPantalla();
  const salida = certRellenar('Entre {titular} y {conyuge}.', { nombre_titular: 'Ana Soto' });
  assert.equal(salida, 'Entre Ana Soto y .');
  assert.deepEqual(llavesQueQuedaron(salida), []);
});

test('LA CONTRACARA: una llave que nadie conoce SÍ se deja a la vista', () => {
  /**
   * Sin esta, un relleno que borrara toda llave —conocida o no— pasaría todas
   * las de arriba, y una frase escrita con un dato mal tecleado saldría coja
   * sin decir por qué. Es la decisión que el sistema ya tomó del lado del
   * servidor, y las dos copias tienen que tomarla igual.
   */
  const { certRellenar, certRellenarMarcado } = lasDeLaPantalla();
  assert.equal(certRellenar('Hola {titular} y {loquesea}', { nombre_titular: 'Ana' }),
    'Hola Ana y {loquesea}');
  assert.match(certRellenarMarcado('Hola {loquesea}', {}), /\{loquesea\}/);
  // Y el servidor decide lo mismo, que es lo que ya estaba probado
  assert.equal(palabras.rellenar('Hola {titular} y {loquesea}', palabras.losDatos({ nombre_titular: 'Ana' }, {})),
    'Hola Ana y {loquesea}');
});

test('el texto del formato se escapa antes de salir a la hoja marcada', () => {
  // Lo escribe una persona en un campo de texto, y la hoja marcada devuelve HTML
  const { certRellenarMarcado } = lasDeLaPantalla();
  const salida = certRellenarMarcado('<script>alert(1)</script> {titular}', { nombre_titular: '<b>Ana</b>' });
  assert.ok(!salida.includes('<script>'), 'no puede salir la etiqueta entera');
  assert.ok(!salida.includes('<b>Ana</b>'), 'ni la del dato');
  assert.ok(salida.includes('&lt;script&gt;'));
});

/* --------------------------------------------------------------------- */
/* Las dos copias siguen conociendo lo mismo                              */
/* --------------------------------------------------------------------- */

test('y las dos rellenan IGUAL, no solo conocen las mismas llaves', () => {
  /**
   * Ya había una prueba que compara las dos LISTAS de llaves. Esta compara el
   * resultado: dos listas iguales con dos cuentas distintas seguirían dando
   * hojas distintas según por dónde saliera el certificado.
   */
  const { certRellenar } = lasDeLaPantalla();
  const texto = palabras.lasLlaves().map((k) => `{${k}}`).join(' | ');
  const enLaPantalla = certRellenar(texto, UN_CERTIFICADO);
  const enElServidor = palabras.rellenar(texto, palabras.losDatos(UN_CERTIFICADO, {
    iglesia: UN_CERTIFICADO.iglesia_id_label,
    institucion: 'Iglesia Pentecostal Triunfante',
    oficiante: UN_CERTIFICADO.oficiante_id_label,
  }));
  assert.equal(enLaPantalla, enElServidor,
    'el mismo certificado dice cosas distintas según por dónde salga');
});
