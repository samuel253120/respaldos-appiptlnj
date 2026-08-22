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
const { db } = require('./db');
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

module.exports = { puedeVer, duenoDe };
