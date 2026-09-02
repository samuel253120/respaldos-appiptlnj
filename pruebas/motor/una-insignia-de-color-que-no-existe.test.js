/**
 * Una insignia pintada con un color que la hoja de estilos no define.
 *
 * Las píldoras de estado del sistema se escriben `class="badge verde"`, y el
 * color sale de una regla `.badge.<color>` de la hoja de estilos. Poner ahí un
 * nombre que no existe NO da error en ninguna parte: el navegador no encuentra
 * la regla, la píldora se queda con el fondo neutro de `.badge` a secas, y el
 * estado sigue diciendo lo que dice pero deja de distinguirse del de al lado.
 * Se pierde en silencio, que es la peor manera de perderse.
 *
 * Estaba pasando en cinco lugares, con dos nombres inventados —«amber» y
 * «orange»— y uno que se pedía sin haberse escrito nunca, «gray»:
 *
 *   panel · cuerpos sin directiva ...... «por vencer» igual que «sin directiva»
 *   panel · cuotas sin monto ........... la cuenta de integrantes, sin color
 *   panel · credenciales por vencer .... VENCIDA y POR VENCER, iguales las dos,
 *                                        que es de lo único que trata la tarjeta
 *   configuración · pregunta ........... «Sin definir» igual que «Definida»
 *   avisos · tipo de aviso ............. «al momento» igual que «en el resumen»
 *   credenciales · las seis situaciones . Por vencer, Vencida y Reemplazada,
 *                                        las tres con la misma píldora gris
 *
 * «gray» hacía falta de verdad —una credencial vencida, o reemplazada al
 * renovarla, es un estado que ya pasó y que no reprocha nada— así que se
 * escribió la regla en vez de repintar esos estados de un color que grite.
 *
 * Esta prueba lee el código: junta los colores que la hoja define y los que la
 * pantalla pide, y no deja pasar uno pedido que no esté definido.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');

const leer = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
const css = leer('public/styles.css');
const app = leer('public/app.js');

/** Los colores que la hoja de estilos define, sacados de ella y no de una lista a mano. */
function losColoresQueExisten() {
  const salen = new Set();
  for (const m of css.matchAll(/^\.badge\.([a-z-]+)\s*\{/gm)) salen.add(m[1]);
  return salen;
}

/** Cualquier clase que la hoja de estilos vista, sea de insignia o no. */
function lasClasesQueExisten() {
  const salen = new Set();
  /* Mirando y no comiéndose lo que sigue, porque en «.badge.green» hay dos. */
  for (const m of css.matchAll(/\.([a-z][a-z0-9-]*)(?=[\s,:{[.>])/g)) salen.add(m[1]);
  return salen;
}

/**
 * Las clases de color que la pantalla le cuelga a una insignia.
 *
 * De cada `class="badge …"` sale la palabra escrita derecho —`class="badge red"`—
 * y, cuando el color se decide en el momento, los textos entre comillas que están
 * en posición de RESULTADO: los que vienen después de un `?` o de un `:`. Los que
 * están antes son con qué se compara —`c.nivel === 'sin' ? …`— y no son colores;
 * meterlos daría una alarma falsa en cada insignia que cambia sola.
 */
function lasClasesQueSePiden() {
  const piden = [];
  for (const m of app.matchAll(/class="badge ([^"]*)"/g)) {
    const resto = m[1];
    const donde = resto.slice(0, 60);
    const derecho = resto.match(/^([a-z][a-z0-9-]*)/);
    if (derecho) piden.push({ clase: derecho[1], donde });
    for (const c of resto.matchAll(/[?:]\s*'([a-z][a-z0-9-]*)'/g)) piden.push({ clase: c[1], donde });
  }
  return piden;
}

/** El mapa de colores de las situaciones de una credencial, tal como está escrito. */
function losColoresDeLaCredencial() {
  const desde = app.indexOf('function insigniaDeCredencial');
  assert.ok(desde > 0, 'no está insigniaDeCredencial');
  const bloque = app.slice(desde, app.indexOf('\n}', desde));
  const mapa = {};
  for (const m of bloque.matchAll(/'?([A-Za-zÁÉÍÓÚáéíóú ]+)'?\s*:\s*'([a-z-]+)'/g)) mapa[m[1].trim()] = m[2];
  return mapa;
}

test('la hoja de estilos define los colores de las insignias', () => {
  const existen = losColoresQueExisten();
  for (const color of ['green', 'red', 'yellow', 'blue', 'gray']) {
    assert.ok(existen.has(color), `falta la regla .badge.${color}`);
  }
});

test('cada insignia de la pantalla usa una clase que la hoja de estilos viste', () => {
  /*
   * La regla es «que vista algo», no «que sea uno de los colores»: hay
   * insignias que se pintan con una clase suya —`inf-no-inscrito`— y están
   * bien. Lo que no puede pasar es que la clase no exista en ninguna parte.
   */
  const existen = lasClasesQueExisten();
  const piden = lasClasesQueSePiden();
  assert.ok(piden.length >= 20, `se leyeron muy pocas insignias (${piden.length}): el lector se rompió`);
  const inventadas = piden.filter((p) => !existen.has(p.clase));
  assert.deepEqual(
    inventadas.map((p) => `${p.clase} — en «${p.donde}»`),
    [],
    'una insignia pide una clase que la hoja de estilos no define: se va a ver sin color',
  );
});

test('las seis situaciones de una credencial tienen un color que existe', () => {
  const existen = losColoresQueExisten();
  const mapa = losColoresDeLaCredencial();
  const situaciones = ['Vigente', 'Por vencer', 'Vencida', 'Revocada', 'Reemplazada', 'Borrador'];
  for (const s of situaciones) {
    assert.ok(mapa[s], `la situación «${s}» no tiene color`);
    assert.ok(existen.has(mapa[s]), `«${s}» se pinta de «${mapa[s]}», que no existe`);
  }
});

test('una credencial por vencer no se ve igual que una ya vencida', () => {
  /*
   * Es la distinción que se perdía: las dos salían grises. «Vencida» y
   * «Reemplazada» sí comparten color a propósito —las dos son estados que ya
   * pasaron— pero la que está a punto de vencer todavía se puede renovar a
   * tiempo, que es justamente lo que el color tiene que decir.
   */
  const mapa = losColoresDeLaCredencial();
  assert.notEqual(mapa['Por vencer'], mapa.Vencida);
  assert.notEqual(mapa['Por vencer'], mapa.Vigente);
});

test('la tarjeta del panel distingue la credencial vencida de la que está por vencer', () => {
  const desde = app.indexOf('const avisoCredenciales');
  assert.ok(desde > 0, 'no está la tarjeta de credenciales del panel');
  const tarjeta = app.slice(desde, app.indexOf('const avisoSinTitular', desde) > desde
    ? app.indexOf('const avisoSinTitular', desde) : desde + 4000);
  const linea = tarjeta.match(/class="badge \$\{c\.situacion === 'Vencida' \? '([a-z-]+)' : '([a-z-]+)'\}"/);
  assert.ok(linea, 'la marca de esa tarjeta cambió de forma: revisar esta prueba');
  assert.notEqual(linea[1], linea[2], 'vencida y por vencer se verían iguales');
  const existen = losColoresQueExisten();
  assert.ok(existen.has(linea[1]) && existen.has(linea[2]));
});
