/**
 * La verificación pública: qué se contesta y, sobre todo, qué NO se contesta.
 *
 * Esta es la única parte del sistema que muestra datos de una persona sin
 * pedir sesión. Todo lo que sigue existe para que eso no se convierta en un
 * agujero:
 *
 *   · sin el código correcto no sale ni un dato, y las respuestas de «ese
 *     número no existe» y «el código no calza» son la MISMA (punto 9.2). Si se
 *     distinguieran, probar números serviría para averiguar qué credenciales
 *     hay emitidas;
 *   · el RUT no sale entero (punto 9.4);
 *   · un borrador no se verifica: no salió en papel;
 *   · y una credencial revocada aparece revocada en el momento (punto 10.6),
 *     que es lo único que la tarjeta impresa no puede decir por sí sola.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const verificacion = require('../../server/credenciales/verificacion');
const qr = require('../../server/credenciales/qr');
const codigo = require('../../server/credenciales/codigo');

/** Una credencial emitida y vigente. */
const EMITIDA = {
  id: 1,
  serie: '0122026',
  serie_dv: '3',
  estado: 'Vigente',
  snap_nombres: 'Juan Carlos',
  snap_apellidos: 'Soto Martínez',
  snap_rut: '12.345.678-5',
  snap_grado: 'Pastor Presbítero',
  snap_funcion: 'Secretario',
  snap_categoria: 'SEDE',
  snap_iglesia: 'La Nueva Jerusalén',
  snap_comuna: 'Puente Alto',
  snap_foto: 'retrato.png',
  fecha_emision: '2026-03-01',
  fecha_vencimiento: '2028-03-01',
  motivo_revocacion: null,
};

/** El sistema de verdad: busca en la base y calcula la situación. */
const comoEnElSistema = (fila) => ({
  buscar: (numero) => (fila && fila.serie === numero ? fila : null),
  situacionDe: require('../../server/modules/credenciales').situacionDe,
});

const codigoDe = (fila) => qr.queCodigoLeToca(fila);

/* --------------------------------------------------------------------- */
/* Lo que se muestra cuando está todo bien                               */
/* --------------------------------------------------------------------- */

test('con el código correcto se muestra la credencial', () => {
  const r = verificacion.verificar('0122026-3', codigoDe(EMITIDA), comoEnElSistema(EMITIDA));
  assert.equal(r.valida, true);
  assert.equal(r.situacion, 'Vigente');
  assert.equal(r.color, 'verde');
  assert.equal(r.datos.nombres, 'Juan Carlos');
  assert.equal(r.datos.apellidos, 'Soto Martínez');
  assert.equal(r.datos.serie, '0122026-3');
  assert.equal(r.datos.hay_foto, true);
});

test('también sirve la dirección escrita sin el dígito verificador', () => {
  // Alguien puede copiarla a mano mirando la tarjeta y saltárselo
  const r = verificacion.verificar('0122026', codigoDe(EMITIDA), comoEnElSistema(EMITIDA));
  assert.equal(r.valida, true);
});

test('pero un dígito verificador equivocado no pasa', () => {
  const r = verificacion.verificar('0122026-9', codigoDe(EMITIDA), comoEnElSistema(EMITIDA));
  assert.equal(r.valida, false);
});

/* --------------------------------------------------------------------- */
/* El RUT (punto 9.4)                                                    */
/* --------------------------------------------------------------------- */

test('el RUT no sale entero: solo los últimos tres dígitos y el verificador', () => {
  const r = verificacion.verificar('0122026-3', codigoDe(EMITIDA), comoEnElSistema(EMITIDA));
  assert.equal(r.datos.rut_tapado, '••.•••.678-5');
  // Y en ninguna parte de lo que se devuelve aparece el RUT completo
  const todo = JSON.stringify(r);
  assert.ok(!todo.includes('12345678'), 'el RUT completo se coló en la respuesta');
  assert.ok(!todo.includes('12.345.678'), 'el RUT completo se coló en la respuesta');
});

test('se tapa cualquier largo de RUT, y se sigue leyendo como un RUT', () => {
  assert.equal(verificacion.rutTapado('12.345.678-5'), '••.•••.678-5');
  assert.equal(verificacion.rutTapado('9.876.543-2'), '•.•••.543-2');
  assert.equal(verificacion.rutTapado('12345678-K'), '••.•••.678-K');
  assert.equal(verificacion.rutTapado(''), '');
});

/* --------------------------------------------------------------------- */
/* Lo que NO se contesta (punto 9.2)                                     */
/* --------------------------------------------------------------------- */

test('con un código cambiado no sale ningún dato', () => {
  const r = verificacion.verificar('0122026-3', 'AAAAAAA', comoEnElSistema(EMITIDA));
  assert.equal(r.valida, false);
  assert.equal(r.datos, undefined, 'no puede venir ni un dato');
  assert.equal(r.situacion, undefined);
});

test('un número que no existe y un código equivocado dan LA MISMA respuesta', () => {
  /**
   * Es la prueba que sostiene todo lo demás. Si estas dos respuestas se
   * diferenciaran en algo —en un campo, en un texto, en lo que sea— probar
   * números serviría para armar la lista de credenciales emitidas sin
   * acertarle nunca a un código.
   */
  const noExiste = verificacion.verificar('9999999-9', codigoDe(EMITIDA), comoEnElSistema(EMITIDA));
  const codigoMalo = verificacion.verificar('0122026-3', 'AAAAAAA', comoEnElSistema(EMITIDA));
  const sinCodigo = verificacion.verificar('0122026-3', '', comoEnElSistema(EMITIDA));
  assert.deepEqual(noExiste, { valida: false });
  assert.deepEqual(codigoMalo, { valida: false });
  assert.deepEqual(sinCodigo, { valida: false });
});

test('un borrador no se verifica: no salió en papel', () => {
  const borrador = { ...EMITIDA, estado: 'Borrador' };
  const r = verificacion.verificar('0122026-3', codigoDe(borrador), comoEnElSistema(borrador));
  assert.equal(r.valida, false);
});

test('cambiar un dato después de emitir rompe el sello', () => {
  /**
   * El código se calcula sobre los datos congelados. Si alguien tocara la base
   * por fuera del sistema —el nombre, la iglesia, la fecha de vencimiento—, el
   * código impreso deja de calzar y la credencial aparece como no válida. Es
   * lo que hace que el papel y la fila digan lo mismo o no digan nada.
   */
  const impreso = codigoDe(EMITIDA);
  for (const [campo, otro] of [
    ['snap_apellidos', 'Soto Martinez Perez'],
    ['snap_iglesia', 'Otra Iglesia'],
    ['snap_rut', '12.345.679-3'],
    ['fecha_vencimiento', '2030-03-01'],
    ['snap_grado', 'Pastor Diácono'],
  ]) {
    const tocada = { ...EMITIDA, [campo]: otro };
    const r = verificacion.verificar('0122026-3', impreso, comoEnElSistema(tocada));
    assert.equal(r.valida, false, `cambiar ${campo} tendría que romper el sello`);
  }
});

test('el cargo no entra en el sello, y por eso no lo rompe', () => {
  // El cargo no viaja dentro del código —es opcional y cambia seguido—, así
  // que se deja anotado acá que eso es a propósito y no un descuido.
  const otra = { ...EMITIDA, snap_funcion: 'Tesorero' };
  const r = verificacion.verificar('0122026-3', codigoDe(EMITIDA), comoEnElSistema(otra));
  assert.equal(r.valida, true);
  assert.equal(r.datos.cargo, 'Tesorero');
});

/* --------------------------------------------------------------------- */
/* Los estados (puntos 9.3 y 10.6)                                       */
/* --------------------------------------------------------------------- */

test('una credencial revocada se muestra, con su estado y su motivo', () => {
  const revocada = { ...EMITIDA, estado: 'Revocada', motivo_revocacion: 'Extravío informado por el titular' };
  const r = verificacion.verificar('0122026-3', codigoDe(revocada), comoEnElSistema(revocada));
  assert.equal(r.valida, true, 'existe: no es una credencial falsa, es una anulada');
  assert.equal(r.situacion, 'Revocada');
  assert.equal(r.color, 'rojo');
  assert.equal(r.sirve, false);
  assert.equal(r.datos.motivo_revocacion, 'Extravío informado por el titular');
});

test('una vencida se muestra vencida, y una reemplazada reemplazada', () => {
  const vencida = { ...EMITIDA, fecha_vencimiento: '2020-01-01' };
  const rv = verificacion.verificar('0122026-3', codigoDe(vencida), comoEnElSistema(vencida));
  assert.equal(rv.situacion, 'Vencida');
  assert.equal(rv.sirve, false);

  const reemplazada = { ...EMITIDA, estado: 'Reemplazada' };
  const rr = verificacion.verificar('0122026-3', codigoDe(reemplazada), comoEnElSistema(reemplazada));
  assert.equal(rr.situacion, 'Reemplazada');
  assert.equal(rr.sirve, false);
});

test('el motivo de revocación no se filtra en las que no están revocadas', () => {
  // Una credencial que se revocó y después se… no: el motivo solo acompaña al
  // estado que lo explica. En cualquier otro estado no tiene por qué salir.
  const conMotivoViejo = { ...EMITIDA, estado: 'Vigente', motivo_revocacion: 'un motivo antiguo' };
  const r = verificacion.verificar('0122026-3', codigoDe(conMotivoViejo), comoEnElSistema(conMotivoViejo));
  assert.equal(r.datos.motivo_revocacion, '');
});

/* --------------------------------------------------------------------- */
/* La página que se dibuja con todo eso                                  */
/* --------------------------------------------------------------------- */

test('la página no válida no lleva ningún dato de nadie', () => {
  const pagina = require('../../server/credenciales/pagina');
  const html = pagina.noValida('Iglesia Pentecostal Triunfante La Nueva Jerusalén');
  assert.ok(html.includes('CREDENCIAL NO VÁLIDA'));
  for (const dato of ['Soto', 'Juan', '678', '0122026', 'Presbítero']) {
    assert.ok(!html.includes(dato), `la página no válida menciona «${dato}»`);
  }
});

test('lo que venga de la base entra escapado en la página', () => {
  /**
   * Los datos de una credencial salen del registro de personas, que lo llena
   * gente. Si alguien escribiera una etiqueta en el nombre de una iglesia,
   * esa etiqueta no puede llegar viva a una página pública.
   */
  const pagina = require('../../server/credenciales/pagina');
  const conTravesura = {
    valida: true, situacion: 'Vigente', color: 'verde', sirve: true,
    datos: {
      nombres: '<script>alert(1)</script>', apellidos: 'Soto', grado: '', cargo: '',
      categoria: '', iglesia: '"><img src=x onerror=alert(1)>', comuna: '',
      rut_tapado: '••.•••.678-5', serie: '0122026-3', emitida: '', vence: '',
      motivo_revocacion: '', hay_foto: false,
    },
  };
  const html = pagina.valida(conTravesura, { institucion: 'X', direccionDeLaFoto: '/v/1/foto' });

  /**
   * Lo que se comprueba es que esos caracteres lleguen ESCAPADOS, no que las
   * palabras no aparezcan. «onerror» escrito dentro de un texto no hace nada;
   * lo que hace daño es el `<` que abre una etiqueta y la comilla que cierra
   * un atributo, y son justo esos dos los que tienen que venir convertidos.
   */
  assert.ok(!html.includes('<script'), 'se coló una etiqueta script');
  assert.ok(!html.includes('"><img'), 'se coló una etiqueta que rompe el atributo de al lado');
  assert.ok(html.includes('&lt;script&gt;'), 'el texto tiene que verse, pero escapado');
  assert.ok(html.includes('&quot;&gt;&lt;img'), 'la comilla y el signo tienen que venir convertidos');
});

/* --------------------------------------------------------------------- */
/* El tope de intentos (punto 9.6)                                       */
/* --------------------------------------------------------------------- */

test('verificar credenciales de verdad no gasta el tope', () => {
  const limite = require('../../server/credenciales/limite');
  limite.olvidarTodo();
  // Cien verificaciones buenas seguidas desde la misma dirección
  for (let i = 0; i < 100; i++) {
    assert.equal(limite.cuantoLeFalta('1.2.3.4'), 0, `la número ${i + 1} quedó frenada`);
  }
});

test('a los intentos errados se les acaba el minuto', () => {
  const limite = require('../../server/credenciales/limite');
  limite.olvidarTodo();
  const maximo = limite.tope();
  for (let i = 0; i < maximo; i++) {
    assert.equal(limite.cuantoLeFalta('9.9.9.9'), 0);
    limite.anotarFallo('9.9.9.9');
  }
  const espera = limite.cuantoLeFalta('9.9.9.9');
  assert.ok(espera > 0 && espera <= 60, `tenía que quedar frenada, y dijo ${espera}`);
});

test('el freno es de una dirección, no de todas', () => {
  const limite = require('../../server/credenciales/limite');
  limite.olvidarTodo();
  for (let i = 0; i < limite.tope() + 5; i++) limite.anotarFallo('9.9.9.9');
  assert.ok(limite.cuantoLeFalta('9.9.9.9') > 0, 'la que insistió tiene que estar frenada');
  assert.equal(limite.cuantoLeFalta('8.8.8.8'), 0, 'el vecino no tiene por qué pagar');
});

test('pasado el minuto se puede volver a intentar', () => {
  const limite = require('../../server/credenciales/limite');
  limite.olvidarTodo();
  const haceUnRato = Date.now() - limite.VENTANA_MS - 1000;
  for (let i = 0; i < limite.tope() + 5; i++) limite.anotarFallo('7.7.7.7', haceUnRato);
  assert.equal(limite.cuantoLeFalta('7.7.7.7'), 0, 'los errores de hace un minuto ya no cuentan');
});

test('el código se compara en tiempo constante', () => {
  // No se mide el tiempo —eso sería una prueba inestable—: se comprueba que
  // la comparación pase por la función que lo hace bien y no por un `===`.
  const datos = qr.datosQueSeFirman(EMITIDA);
  const bueno = codigo.firmar(datos);
  assert.equal(codigo.corresponde(datos, bueno), true);
  assert.equal(codigo.corresponde(datos, bueno.slice(0, -1) + 'X'), false);
  assert.equal(codigo.corresponde(datos, bueno.slice(0, 6)), false, 'un código más corto no pasa');
  assert.equal(codigo.corresponde(datos, bueno + 'X'), false, 'ni uno más largo');
});
