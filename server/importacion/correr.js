#!/usr/bin/env node
/**
 * Corre la importación del sistema anterior, módulo por módulo.
 *
 *   node server/importacion/correr.js --datos importacion/origen-v10.json [opciones]
 *
 *   --prueba            hace todo el trabajo y lo deshace al final (ensayo)
 *   --modulo <nombre>   corre solo ese módulo
 *   --hasta <nombre>    corre desde el primero hasta ese, inclusive
 *   --ruts <política>   qué hacer con un RUT cuyo dígito no calza:
 *                       detener (por defecto) · conservar · vaciar
 *
 * Al terminar imprime los conteos de cada módulo. Si algo no cuadra, se
 * detiene ahí mismo sin dejar nada a medias.
 *
 * Lo mismo se puede hacer desde la propia aplicación (Configuración →
 * Traspaso), que usa `correr()` de acá y muestra estas mismas líneas en
 * pantalla: quien tiene que decidir no necesita una consola.
 */
const fs = require('fs');
const path = require('path');

/** Los módulos, en el orden en que se pueden importar sin romper vínculos. */
const MODULOS = [
  ['iglesia', require('./m01-iglesia')],
  ['miembros', require('./m02-miembros')],
  ['cuerpos', require('./m03-cuerpos')],
  ['tesoreria', require('./m04-tesoreria')],
  ['asistencia', require('./m05-asistencia')],
  ['servicios', require('./m06-servicios')],
  ['usuarios', require('./m07-usuarios')],
  ['bitacora', require('./m09-bitacora')],
  ['actas', require('./m11-actas')],
  ['documentos', require('./m12-documentos')],
  // La segunda pasada enlaza los matrimonios; el pastor va después, para que
  // su cónyuge quede enlazada de una vez
  ['segunda-pasada', require('./m10-segunda-pasada')],
  ['pastores', require('./m08-pastor')],
];

/**
 * Dónde está el volcado del sistema anterior.
 *
 * Los datos de la iglesia no viajan dentro del programa: se suben cuando hay
 * que traspasarlos y quedan junto a la base, en la carpeta de datos. Si
 * además hay una copia en el repositorio —así se trabaja en desarrollo—, se
 * usa esa cuando no se ha subido ninguna.
 */
const ORIGEN_SUBIDO = path.join(require('../db').DATA_DIR, 'importacion', 'origen.json');
const ORIGEN_POR_DEFECTO = path.join(__dirname, '..', '..', 'importacion', 'origen-v10.json');

/** El archivo de origen que se va a usar, o null si no hay ninguno. */
function rutaDelOrigen() {
  for (const candidato of [ORIGEN_SUBIDO, ORIGEN_POR_DEFECTO]) {
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

/** Lee el volcado del sistema anterior. */
function leerOrigen(ruta) {
  const archivo = ruta
    ? (path.isAbsolute(ruta) ? ruta : path.join(process.cwd(), ruta))
    : rutaDelOrigen();
  if (!archivo || !fs.existsSync(archivo)) {
    const e = new Error('No hay ningún archivo de datos del sistema anterior. Suba el volcado para poder traspasarlo.');
    e.codigo = 'sin-origen';
    throw e;
  }
  const crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  return {
    archivo,
    nombre: path.basename(archivo),
    datos: crudo.data || crudo,
    descartadas: crudo.descartadas || {},
    lote: crudo.extraido_en || new Date().toISOString().slice(0, 19),
  };
}

/** El resumen de un módulo, en una línea. */
function resumenDe(nombre, resultado) {
  const detalle = Object.entries(resultado)
    .filter(([k]) => !['modulo', 'prueba', 'id_destino'].includes(k) && !k.startsWith('detalle_'))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
  return `✔ ${nombre.padEnd(12)} ${detalle}`;
}

/** Señal interna para deshacer un ensayo completo al terminarlo. */
class EnsayoTerminado extends Error {}

/**
 * Corre la importación completa y devuelve lo que pasó: las líneas que se
 * muestran (las mismas en la consola y en pantalla), el resultado de cada
 * módulo y, si algo se detuvo, dónde y por qué.
 *
 * En modo ensayo, los módulos escriben de verdad —uno necesita lo que dejó el
 * anterior: sin miembros no hay integrantes de cuerpos— y al final se deshace
 * todo junto, de una vez. Por eso el ensayo sirve igual sobre una base vacía.
 *
 * No lanza: un módulo que falla deja `error` en el resultado y detiene el
 * resto, porque el orden importa.
 */
function correr({ ruta, prueba = false, ruts = 'detener', solo = null, hasta = null } = {}) {
  const origen = leerOrigen(ruta);
  const lineas = [];
  const decir = (t) => lineas.push(t);

  decir(prueba ? '🧪 ENSAYO — no se guardará nada' : '📥 IMPORTACIÓN');
  decir(`   origen: ${origen.nombre} · lote ${origen.lote}`);
  decir('');

  const { db } = require('../db');
  // Lo mismo que hace el sistema al arrancar: si la base está recién creada,
  // deja la iglesia, el administrador y las cuentas de tesorería en su lugar.
  // Así la importación se puede correr sobre una base nueva sin levantar el
  // servidor primero.
  require('../migraciones').ejecutarMigraciones();
  require('../seed').ensureSeed();
  const equivalencias = require('./equivalencias');

  const resultados = [];
  // La iglesia la fija el primer módulo. Si se corre uno suelto, se recupera
  // de la tabla de equivalencias: sin ella, el resto no sabe dónde poner nada.
  let iglesiaId = equivalencias.resolver('iglesias', 'iglesia-central');
  let error = null;

  const pasarPorLosModulos = () => {
  for (const [nombre, importar] of MODULOS) {
    if (solo && solo !== nombre) continue;
    let resultado;
    try {
      // En el ensayo, cada módulo escribe: lo que se deshace es todo junto,
      // al final. Así el módulo que viene encuentra lo que dejó el anterior.
      resultado = importar(origen.datos, { lote: origen.lote, prueba: false, iglesiaId, rutsInvalidos: ruts });
    } catch (e) {
      error = { modulo: nombre, mensaje: e.message };
      decir('');
      decir(`❌ Se detuvo en "${nombre}":`);
      decir('');
      e.message.split('\n').forEach((l) => decir(l));
      decir('');
      decir('   No se guardó nada de ese módulo. Corrija el origen o la traducción y vuelva a correr.');
      break;
    }
    if (nombre === 'iglesia') iglesiaId = resultado.id_destino;
    resultados.push(resultado);
    decir(resumenDe(nombre, resultado));

    // Lo que quedó pendiente de revisar se dice acá mismo, no en letra chica
    for (const [clave, valor] of Object.entries(resultado)) {
      if (!clave.startsWith('detalle_') || !Array.isArray(valor) || !valor.length) continue;
      decir(`  ⚠ ${valor.length} para revisar (${clave.replace('detalle_', '')}):`);
      valor.forEach((v) => decir(
        '     ' + Object.values(v).filter((x) => x !== null && x !== undefined && x !== '').join(' — ')
      ));
    }

    if (hasta && hasta === nombre) break;
  }
  };

  if (prueba) {
    // Todo el ensayo dentro de una transacción que se deshace al terminar:
    // la base queda exactamente como estaba.
    try {
      db.transaction(() => {
        pasarPorLosModulos();
        throw new EnsayoTerminado();
      }).immediate();
    } catch (e) {
      if (!(e instanceof EnsayoTerminado)) throw e;
    }
  } else {
    pasarPorLosModulos();
  }

  if (!error) {
    decir('');
    decir(prueba
      ? '🧪 Era un ensayo: la base quedó como estaba.'
      : '✅ Listo. Los conteos de arriba son lo que quedó guardado.');
  }

  return { lineas, resultados, error, prueba, origen: { nombre: origen.nombre, lote: origen.lote } };
}

function main() {
  const argumentos = process.argv.slice(2);
  const opcion = (nombre, porDefecto) => {
    const i = argumentos.indexOf('--' + nombre);
    if (i === -1) return porDefecto;
    const siguiente = argumentos[i + 1];
    return siguiente && !siguiente.startsWith('--') ? siguiente : true;
  };

  let salida;
  try {
    salida = correr({
      ruta: opcion('datos', null) === true ? null : opcion('datos', null),
      prueba: !!opcion('prueba', false),
      ruts: String(opcion('ruts', 'detener')),
      solo: opcion('modulo', null) || null,
      hasta: opcion('hasta', null) || null,
    });
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    process.exit(1);
  }

  console.log('');
  salida.lineas.forEach((l) => console.log(l));
  console.log('');
  if (salida.error) process.exit(1);
  return salida.resultados;
}

if (require.main === module) main();
module.exports = { main, correr, leerOrigen, rutaDelOrigen, MODULOS, ORIGEN_SUBIDO, ORIGEN_POR_DEFECTO };
