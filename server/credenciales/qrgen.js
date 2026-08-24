/**
 * El generador de códigos QR, tal cual viene del archivo de diseño aprobado.
 *
 * Es la misma implementación de docs/credencial-pastor.html, copiada sin
 * tocar una línea. No se cambia por una biblioteca ni se «mejora»: el punto
 * 0.2 de la especificación dice que se traslada, y así el código que sale del
 * sistema es idéntico al que sale del archivo original.
 *
 * Va en el servidor y no en el navegador por una razón concreta: el contenido
 * del QR lleva el código de autenticidad, que se firma con una clave que no
 * puede salir del servidor (ver codigo.js). Si el QR se armara en la pantalla,
 * la clave tendría que viajar con él.
 *
 *   QRGen.make(texto, nivel) -> { size, isDark(x, y) }
 *   QRGen.svgPath(texto, nivel, silencio) -> { size, path }
 */
/* eslint-disable */
var QRGen = (function () {
  "use strict";

  // --- GF(256) ---
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // Reed-Solomon divisor (grado 'degree'); coeficientes de mayor a menor, sin el 1 líder
  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gmul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gmul(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var res = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res.shift();
      res.push(0);
      for (var j = 0; j < divisor.length; j++) res[j] ^= gmul(divisor[j], factor);
    }
    return res;
  }

  // Tablas ECC (índice = versión 1..40; posición 0 relleno)
  var ECC_CW = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ];
  var NUM_BLOCKS = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  ];
  var ECL = { L: 0, M: 1, Q: 2, H: 3 };
  var ECL_FMT = { 0: 1, 1: 0, 2: 3, 3: 2 }; // bits de formato por nivel

  function rawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      result -= (25 * na - 10) * na - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function dataCodewords(ver, eclIdx) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_CW[eclIdx][ver] * NUM_BLOCKS[eclIdx][ver];
  }
  function alignPositions(ver) {
    if (ver === 1) return [];
    var na = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < na; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function toBytes(str) {
    // UTF-8
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return out;
  }

  function make(text, eclName, forceMask) {
    var eclIdx = ECL[eclName || "M"];
    var data = toBytes(text);

    // elegir versión mínima donde caben los datos (modo byte)
    var ver = 0, ccBits = 0, totalCodewords = 0;
    for (var v = 1; v <= 40; v++) {
      var cc = (v <= 9) ? 8 : 16;               // bits del contador
      var cap = dataCodewords(v, eclIdx) * 8;    // bits disponibles
      var need = 4 + cc + data.length * 8;       // modo + contador + datos
      if (need <= cap) { ver = v; ccBits = cc; totalCodewords = dataCodewords(v, eclIdx); break; }
    }
    if (ver === 0) throw new Error("Datos demasiado largos para un código QR");

    // --- bitstream de datos ---
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(0b0100, 4);                 // modo byte
    put(data.length, ccBits);       // contador
    for (var i = 0; i < data.length; i++) put(data[i], 8);
    // terminador + relleno a byte
    put(0, Math.min(4, totalCodewords * 8 - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    var cw = [];
    for (i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    var pad = [0xEC, 0x11], pi = 0;
    while (cw.length < totalCodewords) cw.push(pad[pi++ % 2]);

    // --- Reed-Solomon por bloques ---
    var numBlocks = NUM_BLOCKS[eclIdx][ver];
    var eccLen = ECC_CW[eclIdx][ver];
    var rawCodewords = Math.floor(rawDataModules(ver) / 8);
    var numShort = numBlocks - (rawCodewords % numBlocks);
    var shortLen = Math.floor(rawCodewords / numBlocks);   // longitud TOTAL del bloque corto (datos+ecc)
    var divisor = rsDivisor(eccLen);
    var blocks = [], k = 0;
    for (var b = 0; b < numBlocks; b++) {
      var len = shortLen - eccLen + (b < numShort ? 0 : 1);   // codewords de datos del bloque
      var dat = cw.slice(k, k + len); k += len;
      var ecc = rsRemainder(dat, divisor);
      blocks.push({ data: dat, ecc: ecc });
    }
    // intercalar (data por columnas, saltando bloques cortos; luego todo el ECC)
    var result = [];
    var maxData = shortLen - eccLen + 1;
    for (i = 0; i < maxData; i++)
      for (b = 0; b < numBlocks; b++)
        if (i < blocks[b].data.length) result.push(blocks[b].data[i]);
    for (i = 0; i < eccLen; i++)
      for (b = 0; b < numBlocks; b++)
        result.push(blocks[b].ecc[i]);

    // --- matriz ---
    var size = ver * 4 + 17;
    var mod = [], isFn = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(false)); isFn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { if (x >= 0 && x < size && y >= 0 && y < size) { mod[y][x] = dark; isFn[y][x] = true; } }

    // timing
    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    // finders + separators
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = cx + dx, yy = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // alignment
    var ap = alignPositions(ver);
    for (i = 0; i < ap.length; i++) for (var j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      var acx = ap[i], acy = ap[j];
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++)
        setFn(acx + dx2, acy + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    // reservar format (se rellena luego) y version info
    function reserveFormat() {
      for (i = 0; i <= 5; i++) { setFn(8, i, false); setFn(i, 8, false); }
      setFn(8, 7, false); setFn(7, 8, false); setFn(8, 8, false);
      for (i = 0; i < 8; i++) { setFn(size - 1 - i, 8, false); }
      for (i = 0; i < 7; i++) { setFn(8, size - 1 - i, false); }
      setFn(8, size - 8, true); // módulo oscuro
    }
    reserveFormat();
    if (ver >= 7) {
      // version info (BCH 18,6)
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var bit = (vbits >>> i) & 1;
        var a = size - 11 + (i % 3), c = Math.floor(i / 3);
        setFn(a, c, bit === 1); setFn(c, a, bit === 1);
      }
    }

    // colocar datos en zigzag
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var xx = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? size - 1 - vert : vert;
          if (!isFn[yy][xx] && idx < result.length * 8) {
            mod[yy][xx] = ((result[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0;
            idx++;
          }
        }
      }
    }

    // --- máscaras ---
    function maskCond(m, x, y) {
      switch (m) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return (x * y) % 2 + (x * y) % 3 === 0;
        case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
        case 7: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
      }
      return false;
    }
    function drawFormat(m) {
      var d = (ECL_FMT[eclIdx] << 3) | m;
      var rem = d;
      for (var i2 = 0; i2 < 10; i2++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fbits = ((d << 10) | rem) ^ 0x5412;
      for (i2 = 0; i2 <= 5; i2++) mod[i2][8] = ((fbits >>> i2) & 1) !== 0;
      mod[7][8] = ((fbits >>> 6) & 1) !== 0;
      mod[8][8] = ((fbits >>> 7) & 1) !== 0;
      mod[8][7] = ((fbits >>> 8) & 1) !== 0;
      for (i2 = 9; i2 < 15; i2++) mod[8][14 - i2] = ((fbits >>> i2) & 1) !== 0;
      for (i2 = 0; i2 < 8; i2++) mod[8][size - 1 - i2] = ((fbits >>> i2) & 1) !== 0;
      for (i2 = 8; i2 < 15; i2++) mod[size - 15 + i2][8] = ((fbits >>> i2) & 1) !== 0;
      mod[size - 8][8] = true;
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++)
        if (!isFn[y][x] && maskCond(m, x, y)) mod[y][x] = !mod[y][x];
    }
    function penalty() {
      var p = 0, i2, j2;
      // filas y columnas: corridas >=5
      for (i2 = 0; i2 < size; i2++) {
        var runC = 1, runR = 1;
        for (j2 = 1; j2 < size; j2++) {
          if (mod[i2][j2] === mod[i2][j2 - 1]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; }
          else runC = 1;
          if (mod[j2][i2] === mod[j2 - 1][i2]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; }
          else runR = 1;
        }
      }
      // bloques 2x2
      for (i2 = 0; i2 < size - 1; i2++) for (j2 = 0; j2 < size - 1; j2++) {
        var c = mod[i2][j2];
        if (c === mod[i2][j2 + 1] && c === mod[i2 + 1][j2] && c === mod[i2 + 1][j2 + 1]) p += 3;
      }
      // proporción oscuro
      var dark = 0;
      for (i2 = 0; i2 < size; i2++) for (j2 = 0; j2 < size; j2++) if (mod[i2][j2]) dark++;
      var ratio = dark * 100 / (size * size);
      var k2 = 0; while (Math.abs(ratio - 50) > (k2 + 1) * 5) k2++;
      p += k2 * 10;
      return p;
    }

    // --- máscaras (sobre copia base, sin efectos de estado) ---
    function cloneM(src) { return src.map(function (r) { return r.slice(); }); }
    var baseMod = cloneM(mod);
    function restore() { for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) mod[y][x] = baseMod[y][x]; }

    var best = 0, bestP = Infinity;
    if (typeof forceMask === "number") {
      best = forceMask;
    } else {
      for (var m = 0; m < 8; m++) {
        restore(); applyMask(m); drawFormat(m);
        var pen = penalty();
        if (pen < bestP) { bestP = pen; best = m; }
      }
    }
    restore(); applyMask(best); drawFormat(best);

    return {
      size: size,
      isDark: function (x, y) { return mod[y][x] === true; },
      _dbg: { codewords: result, base: baseMod, isFn: isFn, mask: best, rawCw: rawCodewords }
    };
  }

  function svgPath(text, eclName, quiet) {
    var qr = make(text, eclName);
    var q = (quiet == null) ? 4 : quiet;
    var n = qr.size, total = n + 2 * q, parts = [];
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (qr.isDark(x, y)) {
          var x0 = x; while (x < n && qr.isDark(x, y)) x++;
          parts.push("M" + (x0 + q) + " " + (y + q) + "h" + (x - x0) + "v1h-" + (x - x0) + "z");
        } else x++;
      }
    }
    return { size: total, path: parts.join("") };
  }

  return { make: make, svgPath: svgPath };
})();

module.exports = QRGen;
