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
 */
const fs = require('fs');
const path = require('path');

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = argumentos.indexOf('--' + nombre);
  if (i === -1) return porDefecto;
  const siguiente = argumentos[i + 1];
  return siguiente && !siguiente.startsWith('--') ? siguiente : true;
};

const PRUEBA = !!opcion('prueba', false);
const RUTA = String(opcion('datos', 'importacion/origen-v10.json'));
const SOLO = opcion('modulo', null);
const HASTA = opcion('hasta', null);
const RUTS = String(opcion('ruts', 'detener'));

/** Los módulos, en el orden en que se pueden importar sin romper vínculos. */
const MODULOS = [
  ['iglesia', require('./m01-iglesia')],
  ['miembros', require('./m02-miembros')],
  ['cuerpos', require('./m03-cuerpos')],
  ['tesoreria', require('./m04-tesoreria')],
  ['asistencia', require('./m05-asistencia')],
  ['servicios', require('./m06-servicios')],
];

function main() {
  const archivo = path.isAbsolute(RUTA) ? RUTA : path.join(process.cwd(), RUTA);
  if (!fs.existsSync(archivo)) {
    console.error(`\n❌ No encuentro el archivo de origen: ${archivo}\n`);
    process.exit(1);
  }
  const crudo = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const origen = crudo.data || crudo;
  const lote = crudo.extraido_en || new Date().toISOString().slice(0, 19);

  console.log(`\n${PRUEBA ? '🧪 ENSAYO — no se guardará nada' : '📥 IMPORTACIÓN'}`);
  console.log(`   origen: ${path.basename(archivo)} · lote ${lote}\n`);

  const { db } = require('../db');
  const equivalencias = require('./equivalencias');
  const informe = [];

  // La iglesia la fija el primer módulo. Si se corre uno suelto, se recupera
  // de la tabla de equivalencias: sin ella, el resto no sabe dónde poner nada.
  let iglesiaId = equivalencias.resolver('iglesias', 'iglesia-central');

  for (const [nombre, importar] of MODULOS) {
    if (SOLO && SOLO !== nombre) continue;
    let resultado;
    try {
      resultado = importar(origen, { lote, prueba: PRUEBA, iglesiaId, rutsInvalidos: RUTS });
    } catch (e) {
      console.error(`\n❌ Se detuvo en "${nombre}":\n\n${e.message}\n`);
      console.error('   No se guardó nada de ese módulo. Corrija el origen o la traducción y vuelva a correr.\n');
      process.exit(1);
    }
    if (nombre === 'iglesia') iglesiaId = resultado.id_destino;
    informe.push(resultado);

    const detalle = Object.entries(resultado)
      .filter(([k]) => !['modulo', 'prueba', 'id_destino'].includes(k) && !k.startsWith('detalle_'))
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join(' · ');
    console.log(`✔ ${nombre.padEnd(12)} ${detalle}`);

    // Lo que quedó pendiente de revisar se dice acá mismo, no en letra chica
    for (const [clave, valor] of Object.entries(resultado)) {
      if (!clave.startsWith('detalle_') || !Array.isArray(valor) || !valor.length) continue;
      console.log(`  ⚠ ${valor.length} para revisar (${clave.replace('detalle_', '')}):`);
      valor.forEach((v) => console.log(
        '     ' + Object.values(v).filter((x) => x !== null && x !== undefined && x !== '').join(' — ')
      ));
    }

    if (HASTA && HASTA === nombre) break;
  }

  console.log('');
  if (PRUEBA) console.log('🧪 Era un ensayo: la base quedó como estaba.\n');
  else console.log('✅ Listo. Los conteos de arriba son lo que quedó guardado.\n');
  return informe;
}

if (require.main === module) main();
module.exports = { main };
