/**
 * Los iconos de la aplicación: que existan, que midan lo que dicen medir, y
 * sobre todo que los recortables aguanten el recorte.
 *
 * ANDROID NO MUESTRA EL ICONO TAL CUAL. Le aplica una máscara que elige cada
 * fabricante —círculo, cuadrado redondeado, gota— y se queda solo con lo que
 * cae dentro de la «zona segura»: el círculo central del 80%. Todo lo de
 * afuera se pierde, sin aviso y sin error.
 *
 * Por eso esto se prueba. El logo de la iglesia lleva un anillo de letras
 * pegado al borde, y el manifiesto llegó a declarar ESE MISMO archivo como
 * recortable: en el teléfono aparecía con el nombre de la iglesia cortado a la
 * mitad. Nada en el sistema falla cuando eso pasa —el icono se sirve, el
 * manifiesto es válido, las pruebas pasan—; solo se ve feo en la pantalla de
 * quien lo instaló, que es justamente donde nadie va a mirar hasta que ya está
 * repartido.
 *
 * La comprobación de la tinta obliga a leer el PNG a mano. Vale la pena: sin
 * eso, la prueba diría que todo está bien con un icono que se corta igual.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLICO = path.join(__dirname, '..', '..', 'public');
const manifiesto = JSON.parse(fs.readFileSync(path.join(PUBLICO, 'manifest.webmanifest'), 'utf8'));

const conProposito = (cual) =>
  manifiesto.icons.filter((i) => (i.purpose || 'any').split(/\s+/).includes(cual));

// ------------------------------------------------------- leer un PNG a pelo

/** El ancho y el alto salen de la cabecera IHDR, siempre en el mismo lugar. */
function mide(archivo) {
  const b = fs.readFileSync(archivo);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${archivo} no es un PNG`);
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20), profundidad: b[24], tipo: b[25] };
}

/**
 * Los píxeles, deshaciendo los filtros por línea que define el formato.
 *
 * Solo se contempla lo que este proyecto genera: 8 bits por canal, sin
 * entrelazar, en color con o sin transparencia. Si algún día se guardan de
 * otra forma, la prueba lo dice en vez de dar un resultado inventado.
 */
function pixeles(archivo) {
  const b = fs.readFileSync(archivo);
  const { ancho, alto, profundidad, tipo } = mide(archivo);
  assert.equal(profundidad, 8, `${archivo}: se esperaban 8 bits por canal`);
  assert.ok(tipo === 2 || tipo === 6, `${archivo}: se esperaba color (con o sin transparencia)`);
  const canales = tipo === 6 ? 4 : 3;

  const trozos = [];
  let i = 8;
  while (i < b.length) {
    const largo = b.readUInt32BE(i);
    const nombre = b.subarray(i + 4, i + 8).toString();
    if (nombre === 'IDAT') trozos.push(b.subarray(i + 8, i + 8 + largo));
    if (nombre === 'IEND') break;
    i += largo + 12;
  }
  const crudo = zlib.inflateSync(Buffer.concat(trozos));

  const porLinea = ancho * canales;
  const salida = Buffer.alloc(alto * porLinea);
  let p = 0;
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[p++];
    const linea = crudo.subarray(p, p + porLinea);
    p += porLinea;
    const destino = salida.subarray(y * porLinea, (y + 1) * porLinea);
    const arriba = y ? salida.subarray((y - 1) * porLinea, y * porLinea) : Buffer.alloc(porLinea);
    for (let x = 0; x < porLinea; x++) {
      const a = x >= canales ? destino[x - canales] : 0;
      const c = x >= canales ? arriba[x - canales] : 0;
      let v = linea[x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += arriba[x];
      else if (filtro === 3) v += (a + arriba[x]) >> 1;
      else if (filtro === 4) {
        const pp = a + arriba[x] - c;
        const da = Math.abs(pp - a), db = Math.abs(pp - arriba[x]), dc = Math.abs(pp - c);
        v += da <= db && da <= dc ? a : db <= dc ? arriba[x] : c;
      }
      destino[x] = v & 0xff;
    }
  }
  return { ancho, alto, canales, datos: salida };
}

/** Qué parte de la tinta del icono cae FUERA del círculo que se le indique. */
function tintaFuera(archivo, porcionDelLado) {
  const { ancho, alto, canales, datos } = pixeles(archivo);
  const cx = ancho / 2, cy = alto / 2;
  const radio = (Math.min(ancho, alto) * porcionDelLado) / 2;
  let fuera = 0, total = 0;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const o = (y * ancho + x) * canales;
      const [r, g, b] = [datos[o], datos[o + 1], datos[o + 2]];
      const transparente = canales === 4 && datos[o + 3] < 40;
      if (transparente || (r > 235 && g > 235 && b > 235)) continue; // el fondo no es tinta
      total++;
      if (Math.hypot(x - cx, y - cy) > radio) fuera++;
    }
  }
  return { fuera, total };
}

// ----------------------------------------------------------------- lo básico

test('todos los iconos que declara el manifiesto existen', () => {
  assert.ok(manifiesto.icons.length, 'el manifiesto no declara ninguno');
  for (const icono of manifiesto.icons) {
    const ruta = path.join(PUBLICO, icono.src);
    assert.ok(fs.existsSync(ruta), `falta ${icono.src}, y el teléfono lo va a pedir igual`);
  }
});

test('y miden de verdad lo que dicen medir', () => {
  for (const icono of manifiesto.icons) {
    const [ancho, alto] = icono.sizes.split('x').map(Number);
    const real = mide(path.join(PUBLICO, icono.src));
    assert.equal(real.ancho, ancho, `${icono.src} dice ${icono.sizes} y mide ${real.ancho}`);
    assert.equal(real.alto, alto, `${icono.src} dice ${icono.sizes} y mide ${real.alto}`);
  }
});

test('el icono de la pantalla de inicio del iPhone también está', () => {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  const m = html.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
  assert.ok(m, 'no está declarado el apple-touch-icon');
  assert.ok(fs.existsSync(path.join(PUBLICO, m[1])), `falta ${m[1]}`);
});

// ------------------------------------------------------------ los recortables

test('hay iconos recortables declarados', () => {
  assert.ok(conProposito('maskable').length >= 1, 'sin uno, Android recorta el normal a su antojo');
});

test('el recortable NO es el mismo archivo que el normal', () => {
  // Esto fue exactamente el error: el manifiesto declaraba el logo completo
  // —con su anillo de letras— también como recortable.
  const normales = new Set(conProposito('any').map((i) => i.src));
  for (const icono of conProposito('maskable')) {
    assert.ok(
      !normales.has(icono.src),
      `${icono.src} está declarado como normal Y como recortable: el recortable necesita márgenes que el normal no tiene`
    );
  }
});

test('a los recortables no se les corta nada: la tinta cabe en la zona segura', () => {
  for (const icono of conProposito('maskable')) {
    const { fuera, total } = tintaFuera(path.join(PUBLICO, icono.src), 0.8);
    assert.ok(total > 0, `${icono.src} salió en blanco`);
    const porcentaje = (100 * fuera) / total;
    assert.ok(
      porcentaje < 0.5,
      `${icono.src}: ${porcentaje.toFixed(1)}% de la tinta queda fuera del círculo central del 80%, ` +
        'así que Android se la va a comer'
    );
  }
});

test('y aun así el emblema llena el icono, no queda perdido en el medio', () => {
  // El defecto contrario: pasarse de márgenes deja un dibujo diminuto rodeado
  // de blanco, que al lado de los demás iconos del teléfono se ve mal.
  for (const icono of conProposito('maskable')) {
    const { total } = tintaFuera(path.join(PUBLICO, icono.src), 1);
    const { ancho, alto } = mide(path.join(PUBLICO, icono.src));
    const ocupa = (100 * total) / (ancho * alto);
    assert.ok(ocupa > 8, `${icono.src}: el dibujo ocupa solo el ${ocupa.toFixed(1)}% del icono`);
  }
});

test('el logo completo, en cambio, NO cabe: por eso hizo falta uno aparte', () => {
  // Si esto dejara de ser cierto, el icono aparte sobra. Mientras el logo
  // lleve su anillo de letras, seguirá haciendo falta.
  const { fuera, total } = tintaFuera(path.join(PUBLICO, '/icons/icon-512.png'), 0.8);
  assert.ok((100 * fuera) / total > 5, 'el logo completo ya no se corta; revise si sigue haciendo falta el recortable');
});
