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
 * Un archivo que todavía no pertenece a ninguna ficha —el que se acaba de
 * subir y aún no se guarda el formulario— se le muestra SOLO A QUIEN LO SUBIÓ.
 * Antes se le mostraba a cualquiera con sesión, y el motivo era razonable: en
 * ese momento no hay ficha que consultar, y sin eso no se podría ver la foto
 * que uno mismo acaba de elegir. Pero lo que se sube no es siempre una foto de
 * perfil. Medido: se elige el carnet de identidad de una miembro, se cierra el
 * formulario sin guardar, y la secretaria de otra iglesia se lo baja con un
 * 200 y su contenido. Y se queda ahí hasta que pasa la barrida, que da siete
 * días de gracia.
 *
 * Se arregla por donde estaba el hueco y no por donde duele: se recuerda quién
 * subió cada archivo, y mientras no tenga ficha solo lo ve esa persona. Con
 * eso, los siete días de la barrida dejan de importar.
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

/**
 * Quién subió cada archivo, mientras todavía no es de ninguna ficha.
 *
 * Va en la base y no en memoria a propósito: entre que alguien elige un
 * archivo y guarda el formulario puede reiniciarse el servidor, y si se
 * olvidara quién lo subió, esa persona dejaría de ver lo que acaba de elegir.
 */
db.exec(`CREATE TABLE IF NOT EXISTS archivos_subidos (
  archivo TEXT PRIMARY KEY,
  usuario_id INTEGER,
  cuando TEXT DEFAULT (datetime('now','localtime'))
)`);

/** Deja dicho quién acaba de subir este archivo. */
function recordarQuienSubio(archivo, usuarioId) {
  if (!archivo || !usuarioId) return;
  try {
    db.prepare('INSERT OR REPLACE INTO archivos_subidos (archivo, usuario_id) VALUES (?, ?)')
      .run(archivo, Number(usuarioId));
  } catch (e) {
    // Que no se pueda anotar no puede impedir subir el archivo: lo que pasa
    // entonces es que nadie lo ve hasta guardarlo, que es el lado seguro.
  }
}

/** Quién lo subió, o null si no consta. */
function quienLoSubio(archivo) {
  try {
    const fila = db.prepare('SELECT usuario_id FROM archivos_subidos WHERE archivo = ?').get(archivo);
    return fila ? fila.usuario_id : null;
  } catch (e) {
    return null;
  }
}

/** Se olvida quién lo subió: ya tiene ficha, o ya no está. */
function olvidarQuienSubio(archivo) {
  try {
    db.prepare('DELETE FROM archivos_subidos WHERE archivo = ?').run(archivo);
  } catch (e) { /* si no se puede, la barrida volverá a pasar */ }
}

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
  if (dueno) {
    if (!alcance.alcanza(dueno.def, dueno.fila, usuario)) {
      return { ok: false, motivo: 'Ese archivo pertenece a un registro que está fuera de lo que tiene asignado' };
    }
    return { ok: true };
  }

  /*
   * Sin ficha detrás. Dos casos, y solo dos.
   *
   * El logo, el sello y la firma de la institución no pertenecen a ninguna
   * ficha —viven en la configuración— y no son de nadie en particular: salen
   * en las credenciales, en las actas y en los documentos que imprime medio
   * sistema. Se siguen entregando a quien tenga sesión, como siempre.
   */
  if (esDeLaInstitucion(archivo)) return { ok: true };

  // Lo demás sin ficha es un archivo recién subido cuyo formulario todavía no
  // se guarda. Lo ve quien lo subió, y nadie más.
  const quien = quienLoSubio(archivo);
  if (quien && usuario && Number(quien) === Number(usuario.id)) return { ok: true };
  return {
    ok: false,
    motivo: 'Ese archivo todavía no pertenece a ninguna ficha: hasta que se guarde, solo lo ve quien lo subió',
  };
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
const DIAS_DE_GRACIA = () => require('./ajustes').numero('archivos_dias_gracia', 1, 90);

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

/**
 * La misma pregunta, pero para decidir si se ENTREGA el archivo.
 *
 * Es la de arriba con el modo de fallo dado vuelta, y por eso va aparte. Ante
 * la duda, aquella contesta «sí, está en uso» para no borrar nada por error;
 * si se reusara acá, un problema al consultar la base abriría el archivo a
 * todo el mundo, que es exactamente lo contrario de lo prudente. Acá, ante la
 * duda, no se entrega.
 */
function esDeLaInstitucion(archivo) {
  try {
    return !!db.prepare('SELECT 1 FROM configuracion WHERE valor = ? LIMIT 1').get(archivo);
  } catch (e) {
    return false;
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

/**
 * ¿Está de verdad en la carpeta de subidas?
 *
 * Se pregunta al guardar una ficha: un campo de archivo obligatorio se cumplía
 * con cualquier texto, así que se podía guardar un documento que prometía un
 * carnet y no tenía ninguno detrás. Se mira por el nombre a secas, igual que
 * al servirlo, para que las dos preguntas contesten sobre el mismo archivo.
 */
function existe(archivo) {
  if (!archivo) return false;
  try {
    return fs.statSync(path.join(UPLOADS_DIR, path.basename(String(archivo)))).isFile();
  } catch (e) {
    return false;
  }
}

/** Borra un archivo del disco y lo olvida. Devuelve si se fue. */
function borrarDelDisco(archivo) {
  recordados.delete(archivo);
  olvidarQuienSubio(archivo);
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
function limpiarHuerfanos({ diasDeGracia = DIAS_DE_GRACIA(), deVerdad = true } = {}) {
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
    if (loUsaAlguien(archivo, null)) {
      // Ya tiene ficha: quién lo subió deja de importar y la anotación sobra
      olvidarQuienSubio(archivo);
      continue;
    }
    huerfanos++;
    espacio += datos.size;
    if (deVerdad && borrarDelDisco(archivo)) borrados++;
  }
  return { revisados: nombres.length, huerfanos, borrados, espacio };
}

module.exports = {
  puedeVer, duenoDe, borrarLosDe, limpiarHuerfanos, DIAS_DE_GRACIA,
  // Para que la subida deje dicho quién fue: mientras el archivo no tenga
  // ficha, es lo único que decide quién puede abrirlo.
  recordarQuienSubio, quienLoSubio,
  // Para que no se guarde una ficha que promete un archivo que no está
  existe,
};
