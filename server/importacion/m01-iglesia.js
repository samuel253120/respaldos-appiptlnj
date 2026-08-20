/**
 * Módulo 1 · La iglesia.
 *
 * El sistema anterior administraba una sola congregación y la identificaba
 * con una etiqueta de texto, escrita de dos formas —"iglesia-central" e
 * "iglesia-central-1"— que son la misma. Las dos quedan apuntando a la ficha
 * que ya existe acá, para que ningún registro se pierda por el nombre.
 *
 * De su tabla `churches` salen los datos que este sistema no tenía: el nombre
 * completo, las siglas, la personalidad jurídica, la ciudad y el tipo.
 */
const { db } = require('../db');
const { importarModulo, texto } = require('./motor');
const equivalencias = require('./equivalencias');
const { traducir, TIPO_IGLESIA } = require('./traducciones');

/** Los nombres con que el origen se refiere a la misma iglesia. */
const ETIQUETAS = ['iglesia-central', 'iglesia-central-1'];

module.exports = function importarIglesia(origen, { lote, prueba }) {
  const ficha = origen.church || {};
  const ajustes = (origen.pdfSettings && origen.pdfSettings[0]) || origen.pdfSettings || {};

  return importarModulo({ nombre: 'iglesia', filas: [ficha], lote, prueba }, (ayuda) => {
    // Se reusa la iglesia que ya existe: es la misma congregación
    let fila = db.prepare('SELECT * FROM iglesias ORDER BY id LIMIT 1').get();
    if (!fila) {
      const info = db.prepare(`INSERT INTO iglesias (nombre, estado) VALUES (?, 'Activa')`).run('Iglesia Central');
      fila = db.prepare('SELECT * FROM iglesias WHERE id = ?').get(info.lastInsertRowid);
    }

    const datos = {
      nombre: texto(ficha.nombre) || fila.nombre,
      codigo: texto(ficha.siglas) || fila.codigo,
      ciudad: texto(ficha.comuna_ciudad) || fila.ciudad,
      tipo: ficha.tipo ? traducir(TIPO_IGLESIA, ficha.tipo, 'tipo de iglesia') : fila.tipo,
      direccion: texto(ajustes.churchAddress) || fila.direccion,
      telefono: texto(ajustes.churchPhone) || fila.telefono,
      email: texto(ajustes.churchEmail) || fila.email,
      notas: texto(ficha.personalidad_juridica)
        ? `Personalidad jurídica N.º ${ficha.personalidad_juridica}.`
        : fila.notas,
    };
    const columnas = Object.keys(datos);
    db.prepare(`UPDATE iglesias SET ${columnas.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`)
      .run(...columnas.map((c) => datos[c]), fila.id);

    // Las dos etiquetas del origen apuntan a esta misma ficha
    for (const etiqueta of ETIQUETAS) equivalencias.registrar('iglesias', etiqueta, 'iglesias', fila.id, lote);
    if (ficha.church_id) equivalencias.registrar('iglesias', ficha.church_id, 'iglesias', fila.id, lote);

    return { creadas: 0, actualizadas: 1, id_destino: fila.id, nombre: datos.nombre, tipo: datos.tipo };
  });
};
