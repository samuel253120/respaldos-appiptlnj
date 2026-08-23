/**
 * A dónde se está yendo el espacio del volumen.
 *
 * El sistema vive en un disco de tamaño fijo, y hasta ahora la única señal era
 * el «MB libres» de /health: un número suelto que dice que queda poco pero no
 * dice de qué. Cuando hay que decidir si conviene comprimir los documentos o
 * agrandar el disco, lo primero que hace falta es ver en qué se gastó.
 *
 * Son cuatro cosas y nada más:
 *
 *   la base .........  las fichas, el dinero, la asistencia. Crece despacio:
 *                      son textos y números.
 *   los documentos ..  las fotos y los escaneos que se suben. Es lo que crece
 *                      de verdad, y con diferencia.
 *   los respaldos ...  las copias que el sistema hace solo, todas en este
 *                      mismo disco.
 *   lo libre ........  lo que queda.
 *
 * Y una cuenta que evita la sorpresa: cuánto pesa en promedio un documento y
 * cuántos más caben a ese ritmo. Es la pregunta real de quien está por subir
 * doscientos escaneos.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR, UPLOADS_DIR } = require('./db');

/** Lo que pesa un archivo, o cero si ya no está. */
function pesa(ruta) {
  try {
    return fs.statSync(ruta).size;
  } catch (e) {
    return 0;
  }
}

/** Lo que pesa una carpeta entera, sin entrar en las de adentro. */
function pesaLaCarpeta(carpeta) {
  let bytes = 0;
  let cuantos = 0;
  try {
    for (const nombre of fs.readdirSync(carpeta)) {
      const suyo = pesa(path.join(carpeta, nombre));
      if (!suyo) continue;
      bytes += suyo;
      cuantos++;
    }
  } catch (e) {
    /* si la carpeta no existe todavía, van en cero */
  }
  return { bytes, cuantos };
}

/**
 * El reparto del disco, ahora mismo.
 *
 * El total no se toma de sumar las partes sino de lo que dice el sistema de
 * archivos: en el volumen hay más cosas que las nuestras, y una cuenta que no
 * cuadre con lo que informa el servidor sería peor que no dar ninguna.
 */
function estado() {
  const base = pesa(path.join(DATA_DIR, 'iglesias.db')) + pesa(path.join(DATA_DIR, 'iglesias.db-wal'));
  const documentos = pesaLaCarpeta(UPLOADS_DIR);
  const respaldos = pesaLaCarpeta(path.join(DATA_DIR, 'respaldos'));

  let libre = null;
  let total = null;
  try {
    const d = fs.statfsSync(DATA_DIR);
    libre = d.bavail * d.bsize;
    total = d.blocks * d.bsize;
  } catch (e) {
    /* sin esto se informa igual lo que ocupa cada cosa */
  }

  // Cuánto pesa un documento en promedio y cuántos más caben así. Es la
  // pregunta de quien está por subir doscientos escaneos, y responderla con el
  // promedio de los que ya subió es mucho más honesto que con una estimación.
  const promedio = documentos.cuantos ? Math.round(documentos.bytes / documentos.cuantos) : null;
  const caben = promedio && libre !== null ? Math.floor(libre / promedio) : null;

  const usado = total !== null && libre !== null ? total - libre : null;

  /**
   * Lo que ocupa el volumen y no es nuestro.
   *
   * En el disco puede haber más cosas que la base, los documentos y las
   * copias. Si ese resto no se nombrara, la barra lo pintaría como espacio
   * libre y diría que hay más sitio del que hay. Se calcula y se muestra
   * aparte, para que lo que se ve sume lo que el servidor informa.
   */
  const nuestro = base + documentos.bytes + respaldos.bytes;
  const otros = usado !== null ? Math.max(usado - nuestro, 0) : null;

  /**
   * ¿Este disco es solo del sistema?
   *
   * En el servidor publicado, la carpeta de datos es un volumen propio y todo
   * lo que hay adentro es nuestro. En un computador cualquiera es una carpeta
   * más dentro del disco de la máquina, y entonces «lo usado» son las fotos y
   * los programas de quien lo está probando. Conviene decirlo: si no, la
   * tarjeta parece estar hablando de los datos de la iglesia cuando no lo hace.
   */
  const soloNuestro = otros === null || otros <= nuestro * 3;

  return {
    base,
    documentos: documentos.bytes,
    cuantos_documentos: documentos.cuantos,
    respaldos: respaldos.bytes,
    cuantos_respaldos: respaldos.cuantos,
    otros,
    solo_nuestro: soloNuestro,
    libre,
    total,
    usado,
    promedio_documento: promedio,
    documentos_que_caben: caben,
    // Con menos de esto el sistema empieza a no poder guardar; se avisa antes.
    // Cuánto es «poco» se fija en la pantalla de configuración: en un disco de
    // 500 MB, 100 libres son holgura; en uno de 50 GB, son la víspera.
    apretado: libre !== null && libre < require('./ajustes').numero('disco_aviso_mb', 20, 5000) * 1024 * 1024,
  };
}

module.exports = { estado };
