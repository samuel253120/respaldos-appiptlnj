/**
 * Quién puede abrir un archivo subido.
 *
 * Los archivos —fotos, carnets, certificados, actas escaneadas— se guardan
 * todos en una misma carpeta con un nombre al azar. Antes se entregaban a
 * quien los pidiera, sin preguntar: bastaba con tener el enlace, y un enlace
 * se reenvía. Ahí van documentos de identidad de la gente de la iglesia, así
 * que ahora se pregunta dos cosas antes de entregar uno:
 *
 *   1. ¿Tiene sesión abierta?
 *   2. ¿El registro al que pertenece ese archivo está dentro de lo que esa
 *      persona puede ver? El secretario de un cuerpo no abre el carnet de un
 *      miembro de otra iglesia, aunque le pasen el enlace.
 *
 * Para responder lo segundo hay que saber de qué ficha es el archivo. No se
 * guarda en ninguna parte: se busca por las columnas de archivo de todos los
 * módulos, que están indexadas justo para esto. Se recuerda lo encontrado,
 * porque un listado con veinticinco fotos pregunta veinticinco veces.
 *
 * Un archivo que no pertenece a ninguna ficha —el que se acaba de subir y
 * todavía no se guarda el formulario— se le muestra a cualquiera que tenga
 * sesión: en ese momento no hay ficha que consultar, y sin eso no se podría
 * ver la foto que uno mismo acaba de elegir.
 */
const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('./db');
const { allModules } = require('./registry');
const alcance = require('./alcance');

/** Las columnas de archivo de cada módulo, calculadas una sola vez. */
let dondeBuscar = null;
function columnasDeArchivo() {
  if (dondeBuscar) return dondeBuscar;
  dondeBuscar = [];
  for (const def of allModules()) {
    const columnas = def.fields.filter((f) => f.type === 'file').map((f) => f.name);
    if (columnas.length) dondeBuscar.push({ def, columnas });
  }
  return dondeBuscar;
}

// Lo encontrado se recuerda; lo no encontrado no, porque un archivo recién
// subido pasa a tener dueño en cuanto se guarda su formulario.
const recordados = new Map(); // archivo → { modulo, id }
const TOPE = 5000;

/** La ficha a la que pertenece un archivo, o null si todavía no es de nadie. */
function duenoDe(archivo) {
  const recordado = recordados.get(archivo);
  if (recordado) {
    const def = allModules().find((m) => m.name === recordado.modulo);
    const fila = def && db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(recordado.id);
    if (fila && Object.values(fila).includes(archivo)) return { def, fila };
    recordados.delete(archivo); // cambió de dueño o se borró: se busca de nuevo
  }

  for (const { def, columnas } of columnasDeArchivo()) {
    const donde = columnas.map((c) => `"${c}" = ?`).join(' OR ');
    let fila;
    try {
      fila = db.prepare(`SELECT * FROM "${def.name}" WHERE ${donde} LIMIT 1`).get(...columnas.map(() => archivo));
    } catch (e) {
      continue; // una tabla que aún no existe no impide revisar las demás
    }
    if (!fila) continue;
    if (recordados.size >= TOPE) recordados.clear();
    recordados.set(archivo, { modulo: def.name, id: fila.id });
    return { def, fila };
  }
  return null;
}

/**
 * ¿Puede esta persona abrir este archivo? Devuelve { ok } y, cuando no, el
 * motivo escrito para quien lo lea.
 */
function puedeVer(archivo, usuario) {
  const dueno = duenoDe(archivo);
  if (!dueno) return { ok: true }; // recién subido, todavía sin ficha
  if (!alcance.alcanza(dueno.def, dueno.fila, usuario)) {
    return { ok: false, motivo: 'Ese archivo pertenece a un registro que está fuera de lo que tiene asignado' };
  }
  return { ok: true };
}

/**
 * Los archivos que quedan sin dueño.
 *
 * Cuando se borraba una ficha con documentos, los archivos seguían en el
 * disco para siempre. Nadie los veía —no hay ficha desde donde llegar a
 * ellos— pero ocupaban lugar, y en un servidor con el espacio contado, lo que
 * se acumula sin que nadie mire termina llenándolo.
 *
 * Se limpia por dos vías, porque una sola no alcanza:
 *
 *   · **Al borrar una ficha**, se borran sus archivos en el mismo momento.
 *     Antes se comprueba que ningún otro registro los esté usando: dos fichas
 *     pueden apuntar al mismo archivo si alguien lo copió a mano, y borrar el
 *     de una dejaría a la otra sin su foto.
 *   · **Una barrida cada cierto tiempo**, para los que quedaron sueltos antes
 *     de esto y para los que se suben y nunca se guardan —uno elige una foto,
 *     se arrepiente y cierra el formulario: el archivo ya está en el disco.
 */
/**
 * Días que se le dan a un archivo recién subido antes de considerarlo perdido.
 *
 * No puede ser cero: entre que se sube un archivo y se guarda el formulario
 * que lo enlaza pasan minutos, y a veces la persona deja la pantalla abierta
 * y vuelve al otro día. Borrarlo mientras tanto sería borrarle el trabajo.
 */
const DIAS_DE_GRACIA = 7;

/**
 * ¿La configuración del sistema está usando este archivo?
 *
 * El logo de la institución es un archivo subido que no pertenece a ninguna
 * ficha: vive en la tabla de configuración. Sin preguntar por él, la barrida
 * lo daría por perdido y lo borraría a los siete días, y un buen día la
 * pantalla de acceso amanecería con el logo de fábrica.
 */
function loUsaLaConfiguracion(archivo) {
  try {
    const fila = db.prepare('SELECT 1 FROM configuracion WHERE valor = ? LIMIT 1').get(archivo);
    return !!fila;
  } catch (e) {
    return true; // si no se puede preguntar, no se borra: nunca por las dudas
  }
}

/** ¿Algún registro, de cualquier módulo, está usando este archivo? */
function loUsaAlguien(archivo, salvo) {
  if (loUsaLaConfiguracion(archivo)) return true;
  for (const { def, columnas } of columnasDeArchivo()) {
    const donde = columnas.map((c) => `"${c}" = ?`).join(' OR ');
    const excluir = salvo && salvo.def.name === def.name ? 'AND id <> ?' : '';
    try {
      const fila = db
        .prepare(`SELECT id FROM "${def.name}" WHERE (${donde}) ${excluir} LIMIT 1`)
        .get(...columnas.map(() => archivo), ...(excluir ? [salvo.id] : []));
      if (fila) return true;
    } catch (e) {
      // Una tabla que aún no existe no impide revisar las demás. Si no se
      // pudo preguntar, se responde que sí: nunca se borra por las dudas.
      continue;
    }
  }
  return false;
}

/** Borra un archivo del disco y lo olvida. Devuelve si se fue. */
function borrarDelDisco(archivo) {
  recordados.delete(archivo);
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, archivo));
    return true;
  } catch (e) {
    return false; // ya no estaba, o el disco no deja: no es motivo para fallar
  }
}

/**
 * Los archivos de una ficha que se está por borrar.
 *
 * Se llama DENTRO de la transacción que borra el registro, pero antes del
 * DELETE, que es cuando todavía se puede leer qué archivos tenía. Se borran
 * del disco solo los que no use ninguna otra ficha.
 */
function borrarLosDe(def, fila) {
  const suyos = def.fields.filter((f) => f.type === 'file').map((f) => fila[f.name]).filter(Boolean);
  let borrados = 0;
  for (const archivo of new Set(suyos)) {
    if (loUsaAlguien(archivo, { def, id: fila.id })) continue;
    if (borrarDelDisco(archivo)) borrados++;
  }
  return borrados;
}

/**
 * La barrida: borra los archivos que no usa nadie y que llevan más de unos
 * días ahí. Devuelve qué encontró, para poder decirlo.
 */
function limpiarHuerfanos({ diasDeGracia = DIAS_DE_GRACIA, deVerdad = true } = {}) {
  let nombres;
  try {
    nombres = fs.readdirSync(UPLOADS_DIR);
  } catch (e) {
    return { revisados: 0, huerfanos: 0, borrados: 0, espacio: 0 };
  }

  const limite = Date.now() - diasDeGracia * 24 * 60 * 60 * 1000;
  let huerfanos = 0;
  let borrados = 0;
  let espacio = 0;

  for (const archivo of nombres) {
    let datos;
    try {
      datos = fs.statSync(path.join(UPLOADS_DIR, archivo));
    } catch (e) {
      continue;
    }
    if (!datos.isFile() || datos.mtimeMs > limite) continue;
    if (loUsaAlguien(archivo, null)) continue;
    huerfanos++;
    espacio += datos.size;
    if (deVerdad && borrarDelDisco(archivo)) borrados++;
  }
  return { revisados: nombres.length, huerfanos, borrados, espacio };
}

module.exports = { puedeVer, duenoDe, borrarLosDe, limpiarHuerfanos, DIAS_DE_GRACIA };
