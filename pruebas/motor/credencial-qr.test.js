/**
 * El contenido del código QR y, sobre todo, su tamaño.
 *
 * El QR es lo único de la credencial que tiene que funcionar en un aparato que
 * no es el nuestro: el teléfono de quien la recibe. Y ahí hay una regla que no
 * se negocia (punto 17.2): cada módulo —cada cuadradito— tiene que medir
 * 0,25 mm o más impreso, o no se lee. Como el recuadro es de tamaño fijo, eso
 * pone un techo a cuántos módulos pueden entrar, y por lo tanto a cuánto texto
 * cabe dentro del código.
 *
 * De ahí que el sistema, cuando el contenido no cabe, ACORTE EL CONTENIDO y
 * nunca achique el recuadro (punto 8.6). Estas pruebas comprueban las dos
 * mitades: que lo que dice el código sea lo que corresponde, y que la cuenta
 * del tamaño sea la de verdad.
 *
 * La cuenta del tamaño ya estuvo mal una vez: repartía los milímetros del
 * recuadro entre todos los módulos sin descontar el relleno que tiene por cada
 * lado, y anunciaba un módulo más grande del que salía impreso. Se descubrió
 * midiendo el QR sobre el PDF rasterizado (pruebas/credencial-impresa.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const qr = require('../../server/credenciales/qr');
const codigo = require('../../server/credenciales/codigo');

/** Una credencial emitida, con todo lo que el QR necesita. */
const CREDENCIAL = {
  serie: '0122026',
  serie_dv: '3',
  snap_nombres: 'Juan Carlos',
  snap_apellidos: 'Soto Martínez',
  snap_rut: '12.345.678-5',
  snap_grado: 'Pastor Presbítero',
  snap_funcion: 'Secretario',
  snap_categoria: 'SEDE',
  snap_iglesia: 'La Nueva Jerusalén',
  snap_comuna: 'Puente Alto',
  snap_foto: 'foto.png',
  fecha_emision: '2026-03-01',
  fecha_vencimiento: '2028-03-01',
};

/* --------------------------------------------------------------------- */
/* El tamaño, que es lo que manda                                        */
/* --------------------------------------------------------------------- */

test('el recuadro y su relleno son los mismos que dice la hoja de estilos', () => {
  // Estos tres números están también en `.qr-holder`, en public/credencial.css.
  // Si allá cambian y acá no, el sistema anuncia un tamaño de módulo que no es
  // el que sale impreso, y con ese número se decide si un código pasa o no.
  assert.equal(qr.RECUADRO_MM, 20);
  assert.equal(qr.RELLENO_MM, 0.3);
  assert.equal(qr.LADO_UTIL_MM, 19.4, 'el relleno se descuenta por los dos lados');
});

test('el techo de módulos y el mínimo por módulo dicen lo mismo', () => {
  /**
   * Son dos números que tienen que moverse juntos: en los 19,4 mm útiles, el
   * código más grande que se permite —57 módulos más la zona de silencio— deja
   * cada cuadradito en 0,318 mm, y eso tiene que seguir estando por encima del
   * mínimo. Si alguien sube el techo sin mirar esta cuenta, el sistema empieza
   * a emitir códigos que no se leen impresos.
   */
  const elMasGrande = qr.LADO_UTIL_MM / (qr.MAX_MODULOS + qr.SILENCIO * 2);
  assert.ok(
    elMasGrande >= qr.MINIMO_POR_MODULO_MM,
    `con ${qr.MAX_MODULOS} módulos cada uno mediría ${elMasGrande.toFixed(4)} mm`
  );
});

test('si ni acortando cabe, no se emite ningún código (punto 17.2)', () => {
  // Antes que un código ilegible, el recuadro rayado diciendo qué pasa.
  const imposible = { ...CREDENCIAL, snap_grado: 'PASTOR '.repeat(120) };
  const hecho = qr.para(imposible, { modo: 'sin_conexion' });
  assert.equal(hecho.hay, false, 'un código que pasa el techo de módulos no se puede imprimir');
  assert.match(hecho.falta.join(' '), /no se leería impreso/);
});

test('el tamaño del módulo se calcula sobre lo que el código de verdad ocupa', () => {
  const hecho = qr.para(CREDENCIAL, { modo: 'linea', dominio: 'https://iglesia.cl' });
  assert.equal(hecho.hay, true);
  // El lado útil repartido entre todos los módulos, zona de silencio incluida
  assert.equal(hecho.mm_por_modulo, Number((qr.LADO_UTIL_MM / hecho.size).toFixed(4)));
  assert.equal(hecho.size, hecho.modulos + qr.SILENCIO * 2);
});

test('nunca se emite un código por debajo del mínimo que se lee impreso', () => {
  for (const modo of ['linea', 'sin_conexion']) {
    const hecho = qr.para(CREDENCIAL, { modo, dominio: 'https://iglesia.cl' });
    assert.equal(hecho.hay, true, `no se generó en modo ${modo}`);
    assert.ok(
      hecho.mm_por_modulo >= qr.MINIMO_POR_MODULO_MM,
      `en modo ${modo} cada módulo mediría ${hecho.mm_por_modulo} mm`
    );
    assert.ok(hecho.modulos <= qr.MAX_MODULOS, `en modo ${modo} salieron ${hecho.modulos} módulos`);
  }
});

/**
 * Con el recuadro de 20 mm sobra sitio, así que los nombres YA NO SE ABREVIAN
 * (punto 1.4 de las modificaciones). Un nombre largo de verdad —de los que
 * antes salían como «FERNANDEZ DE LA TORRE J.M.»— ahora viaja entero.
 */
test('un nombre largo viaja completo: ya no se abrevia', () => {
  const largo = {
    ...CREDENCIAL,
    snap_nombres: 'José Miguel Alejandro Ramón',
    snap_apellidos: 'Fernández de la Torre Etchegoyen Muñoz Peña',
    snap_iglesia: 'La Nueva Jerusalén de la Comuna de San José de Maipo',
  };
  const hecho = qr.para(largo, { modo: 'sin_conexion' });
  assert.equal(hecho.hay, true);
  assert.equal(hecho.nivel, 0, 'con 20 mm de recuadro no hace falta acortar');
  assert.ok(hecho.texto.includes('JOSE MIGUEL ALEJANDRO RAMON'), 'los nombres van completos');
  // limpiar() saca la eñe igual que las tildes: adentro del código ocupa el
  // doble y agranda el QR. «Muñoz Peña» viaja entero, pero como MUNOZ PENA.
  assert.ok(hecho.texto.includes('FERNANDEZ DE LA TORRE ETCHEGOYEN MUNOZ PENA'), 'los apellidos también');
  assert.ok(hecho.texto.includes('PASTOR PRESBITERO'), 'y el grado sin abreviar');
  assert.ok(hecho.modulos <= qr.MAX_MODULOS, `salieron ${hecho.modulos} módulos`);
  assert.ok(hecho.mm_por_modulo >= qr.MINIMO_POR_MODULO_MM);
});

/**
 * Y la red de seguridad sigue puesta (punto 1.5): no se borró la lógica de
 * acortado, solo subió el umbral. Con un caso desmedido tiene que seguir
 * acortando el contenido en vez de achicar el recuadro.
 */
test('ante un caso desmedido sigue acortando el contenido, no el recuadro', () => {
  const desmedido = {
    ...CREDENCIAL,
    snap_nombres: 'José Miguel Alejandro Ramón Buenaventura Inmaculado',
    snap_apellidos: 'Fernández de la Torre Etchegoyen Muñoz Peña Larraín Undurraga',
    snap_iglesia: 'La Nueva Jerusalén de la Comuna de San José de Maipo, Provincia Cordillera',
    snap_grado: 'Pastor Presbítero Supernumerario de la Obra Nacional',
  };
  const hecho = qr.para(desmedido, { modo: 'sin_conexion' });
  assert.equal(hecho.hay, true);
  assert.ok(hecho.nivel >= 1, 'con ese largo tenía que haber acortado');
  assert.ok(hecho.modulos <= qr.MAX_MODULOS, `salieron ${hecho.modulos} módulos`);
  assert.ok(hecho.mm_por_modulo >= qr.MINIMO_POR_MODULO_MM);
});

/* --------------------------------------------------------------------- */
/* Qué dice el código                                                    */
/* --------------------------------------------------------------------- */

test('en línea lleva la dirección de verificación con el número de serie', () => {
  const hecho = qr.para(CREDENCIAL, { modo: 'linea', dominio: 'https://iglesia.cl' });
  assert.equal(hecho.texto, `https://iglesia.cl/v/0122026-3?c=${hecho.codigo}`);
  assert.match(hecho.codigo, /^[0-9A-Z]{7}$/);
});

test('sin conexión lleva los datos adentro, sin tildes y en mayúsculas', () => {
  const hecho = qr.para(CREDENCIAL, { modo: 'sin_conexion' });
  assert.ok(hecho.texto.includes('SOTO MARTINEZ'), 'los apellidos van sin tilde');
  assert.ok(hecho.texto.includes('12345678'), 'el RUT va sin puntos ni guion');
  assert.ok(hecho.texto.includes('0122026-3'), 'va el número de serie completo');
  assert.ok(hecho.texto.includes('0326-0328'), 'va la vigencia en mes y año');
  assert.ok(hecho.texto.includes(qr.PERSONALIDAD_JURIDICA), 'va la personalidad jurídica');
});

test('el código de un contenido acortado firma ese contenido, no otro', () => {
  /**
   * Quien verifica sin internet solo tiene lo que hay dentro del QR. Si el
   * código firmara los datos completos, no habría con qué comprobarlo: el
   * verificador leería un contenido acortado y una firma de otra cosa.
   */
  const hecho = qr.para(CREDENCIAL, { modo: 'sin_conexion' });
  const [contenido, firma] = hecho.texto.split('|C:');
  assert.equal(firma, codigo.firmar(contenido));
});

test('sin acortar, los dos modos firman lo mismo', () => {
  /**
   * Cada modo firma lo que su verificador va a poder leer: en línea, los datos
   * completos que el servidor tiene en la ficha; sin conexión, exactamente lo
   * que quedó impreso dentro del código.
   *
   * Mientras el recuadro era de 12,2 mm eso hacía dos cadenas distintas, porque
   * el contenido sin conexión casi siempre salía acortado. Con el recuadro de
   * 20 mm ya no se acorta (punto 1.4), así que las dos cadenas coinciden y el
   * código de autenticidad es el MISMO número. No es un descuido: es la misma
   * firma sobre los mismos datos, y significa que una credencial impresa en
   * modo sin conexión también se puede comprobar tecleando su código en la
   * página pública.
   */
  const enLinea = qr.para(CREDENCIAL, { modo: 'linea', dominio: 'https://iglesia.cl' });
  const sinConexion = qr.para(CREDENCIAL, { modo: 'sin_conexion' });
  assert.equal(sinConexion.nivel, 0, 'este caso no debería acortar nada');
  assert.equal(sinConexion.texto.split('|C:')[0], qr.datosQueSeFirman(CREDENCIAL));
  assert.equal(enLinea.codigo, sinConexion.texto.split('|C:')[1]);
});

test('y cuando hay que acortar, entonces sí firman cosas distintas', () => {
  // Acá el contenido impreso ya no es el de la ficha, así que las dos firmas
  // se separan —cada una sella lo que su verificador puede leer— y cambiar el
  // modo en Configuración no invalida lo ya impreso: cada credencial se
  // verifica como se imprimió.
  const desmedido = {
    ...CREDENCIAL,
    snap_nombres: 'José Miguel Alejandro Ramón Buenaventura Inmaculado',
    snap_apellidos: 'Fernández de la Torre Etchegoyen Muñoz Peña Larraín Undurraga',
    snap_iglesia: 'La Nueva Jerusalén de la Comuna de San José de Maipo, Provincia Cordillera',
    snap_grado: 'Pastor Presbítero Supernumerario de la Obra Nacional',
  };
  const enLinea = qr.para(desmedido, { modo: 'linea', dominio: 'https://iglesia.cl' });
  const sinConexion = qr.para(desmedido, { modo: 'sin_conexion' });
  assert.ok(sinConexion.nivel >= 1, 'este caso sí tenía que acortar');
  assert.notEqual(enLinea.codigo, sinConexion.texto.split('|C:')[1]);
});

/* --------------------------------------------------------------------- */
/* Y sin los datos completos, no hay código                              */
/* --------------------------------------------------------------------- */

test('sin los datos completos no se genera ningún código (punto 8.4)', () => {
  const aMedias = { ...CREDENCIAL, snap_rut: '', snap_iglesia: '' };
  const hecho = qr.para(aMedias, { modo: 'linea', dominio: 'https://iglesia.cl' });
  assert.equal(hecho.hay, false, 'una credencial a medio llenar no puede llevar QR');
  assert.ok(hecho.falta.length, 'y tiene que decir qué le falta');
  assert.equal(hecho.texto, undefined, 'nunca un código a medias');
});

test('sin número de serie tampoco: un borrador no lleva código', () => {
  const borrador = { ...CREDENCIAL, serie: null, serie_dv: null };
  const hecho = qr.para(borrador, { modo: 'linea', dominio: 'https://iglesia.cl' });
  assert.equal(hecho.hay, false);
  assert.ok(hecho.falta.some((x) => /serie/i.test(x)), `dijo que faltaba: ${hecho.falta.join(', ')}`);
});

/* --------------------------------------------------------------------- */
/* Las piezas sueltas                                                    */
/* --------------------------------------------------------------------- */

test('las fechas se convierten a mes y año de dos cifras', () => {
  assert.equal(qr.mesYAnio('2026-03-15'), '0326');
  assert.equal(qr.mesYAnio('2028-12-01'), '1228');
  assert.equal(qr.mesYAnio(''), '', 'sin fecha no se inventa nada');
  assert.equal(qr.mesYAnio('15/03/2026'), '', 'no se adivinan formatos escritos a mano');
});

test('las iniciales salen de los nombres, con punto y sin espacios', () => {
  assert.equal(qr.iniciales('Juan Carlos'), 'J.C.');
  assert.equal(qr.iniciales('José'), 'J.');
  assert.equal(qr.iniciales('  Ana   María  '), 'A.M.');
});

test('recortar no parte una palabra por la mitad', () => {
  assert.equal(qr.recorta('SEDE LA NUEVA JERUSALEN', 20), 'SEDE LA NUEVA');
  assert.equal(qr.recorta('CORTO', 20), 'CORTO', 'lo que ya cabe no se toca');
  assert.equal(qr.recorta('PALABRALARGUISIMAQUENOCABE', 10).length, 10,
    'una sola palabra que no cabe se corta igual, o no quedaría nada');
});
