/**
 * Módulo: Categorías de Tesorería.
 *
 * En qué se clasifica cada movimiento: diezmos, ofrendas, servicios públicos,
 * mantenimiento… Antes esa lista venía escrita dentro del programa, así que
 * agregar «Pro-Templo Sede Sur» o dejar de usar una obligaba a tocar el
 * código. Ahora la mantiene la propia iglesia desde acá.
 *
 * Cada categoría dice si es de **ingreso**, de **egreso** o de las dos, y al
 * registrar un movimiento solo se ofrecen las que corresponden a lo que se
 * está anotando: al registrar un gasto no aparece «Diezmos».
 *
 * Una categoría que ya se usó no se borra: se **desactiva**. Borrarla dejaría
 * a esos movimientos clasificados con un nombre que ya no existe en ninguna
 * parte, y los informes de años anteriores dejarían de cuadrar. Desactivada
 * deja de ofrecerse en los movimientos nuevos y lo antiguo queda como estaba.
 */
const TIPOS = ['Ingreso', 'Egreso', 'Ambos'];

module.exports = {
  name: 'categorias_tesoreria',
  label: 'Categorías de Tesorería',
  labelSingular: 'Categoría',
  icon: '🏷️',
  group: 'Sistema',
  order: 74,
  display: '{nombre}',
  searchFields: ['nombre', 'notas'],
  listFields: ['nombre', 'tipo', 'activo', 'notas'],
  filterFields: ['tipo', 'activo'],
  defaultSort: { field: 'nombre', dir: 'asc' },
  fields: [
    {
      name: 'nombre', label: 'Nombre de la categoría', type: 'text', required: true, unique: true,
      help: 'Como se verá al registrar un movimiento y en los informes. Ej: «Diezmos», «Servicios públicos».',
    },
    {
      name: 'tipo', label: 'Se usa en', type: 'select', required: true, default: 'Ingreso', options: TIPOS,
      help: 'Al registrar un ingreso solo se ofrecen las de ingreso, y al registrar un gasto, las de egreso. «Ambos» aparece en los dos.',
    },
    {
      name: 'activo', label: 'En uso', type: 'boolean', default: 1,
      help: 'Al desmarcarla deja de ofrecerse en los movimientos nuevos. Los que ya estaban clasificados con ella no se tocan.',
    },
    { name: 'notas', label: 'Para qué es', type: 'text', help: 'Opcional: qué entra en esta categoría, para que todos la usen igual.' },
  ],
  hooks: {
    /**
     * Las siete que escribe el sistema no se renombran.
     *
     * Ver server/categorias-del-sistema.js: hay siete nombres que no los elige
     * nadie al anotar un movimiento porque los escribe el propio sistema —al
     * registrar un préstamo, un traspaso, la ofrenda de un culto o una cuota—.
     * Renombrar una de ellas no le cambia el nombre a nada: el sistema sigue
     * escribiendo el de antes, y desde ese día cada movimiento suyo cae en una
     * categoría que ya no está en la lista.
     *
     * Desactivarla SÍ se puede, y es a propósito: una iglesia que nunca ha
     * pedido un préstamo tiene derecho a sacar esas cuatro del desplegable para
     * que no le estorben. Desactivada sigue existiendo, así que el día que de
     * verdad haya un préstamo el movimiento cae en una categoría que existe.
     */
    beforeSave(data, { isNew, existing }) {
      if (isNew || !existing || data.nombre === undefined) return null;
      const seLlamaba = String(existing.nombre || '');
      const seVaALlamar = String(data.nombre || '');
      if (seLlamaba.trim().toLowerCase() === seVaALlamar.trim().toLowerCase()) return null;

      const { quienLaEscribe } = require('../categorias-del-sistema');
      const quien = quienLaEscribe(seLlamaba);
      if (!quien) return null;

      return (
        `«${seLlamaba}» no la elige nadie: la escribe ${quien}, así que su nombre no se puede cambiar. `
        + 'Si le cambiara el nombre, el sistema seguiría anotando con el de antes y esos movimientos '
        + 'quedarían clasificados con una categoría que ya no está en la lista. '
        + 'Si no la usa, desmárquela en «En uso»: deja de ofrecerse y sigue estando el día que haga falta.'
      );
    },

    /**
     * Una categoría que ya se usó no se borra. Si se borrara, los movimientos
     * que la tienen quedarían clasificados con un nombre que ya no existe.
     *
     * Y LAS SIETE DEL SISTEMA NO SE BORRAN NUNCA, tengan movimientos o no.
     *
     * Ésa es la parte que faltaba, y se midió: en una instalación recién
     * sembrada las siete se borraron una tras otra, las siete con un 200 y sin
     * una palabra, porque todavía no tenían ningún movimiento —no ha habido
     * préstamos, ni traspasos, ni se ha cerrado el primer culto—. Son
     * exactamente las que alguien saca el primer mes al ordenar la lista porque
     * «no las usamos». Después se registró un préstamo del banco por tres
     * millones y el sistema lo anotó igual, como «Préstamos recibidos»: una
     * categoría que ya no existía, que no se ofrecía y que la tesorera no podía
     * corregir eligiendo la buena, porque la buena ya no estaba.
     */
    beforeDelete(row, { db }) {
      const { quienLaEscribe } = require('../categorias-del-sistema');
      const quien = quienLaEscribe(row.nombre);
      if (quien) {
        return (
          `«${row.nombre}» no se puede borrar: la escribe ${quien}, y sin ella esos movimientos `
          + 'quedarían clasificados con una categoría que no existe en ninguna parte. '
          + 'Si no la usa, desmárquela en «En uso»: deja de ofrecerse al anotar y sigue estando '
          + 'el día que haga falta.'
        );
      }
      const usos = db.prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE categoria = ?').get(row.nombre).c;
      if (usos) {
        return (
          `«${row.nombre}» está en ${usos.toLocaleString('es-CL')} movimiento(s) de tesorería, así que no se puede ` +
          'borrar sin dejarlos sin clasificación. Desmárquela en «En uso» y dejará de ofrecerse para los nuevos, ' +
          'sin tocar los que ya están.'
        );
      }
      return null;
    },
  },
  extraRoutes(router, { db, requirePerm }) {
    /**
     * Las categorías que se pueden elegir para un movimiento, según sea un
     * ingreso o un egreso. Devuelve el nombre como valor, porque es el nombre
     * lo que se guarda en el movimiento: así, si algún día la categoría se
     * borra o se renombra, lo ya registrado sigue diciendo lo que decía.
     */
    router.get('/categorias_tesoreria/opciones', requirePerm('tesoreria', 'view'), (req, res) => {
      const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : null;
      const donde = tipo && tipo !== 'Ambos' ? "AND tipo IN (?, 'Ambos')" : '';
      const filas = db
        .prepare(`SELECT nombre FROM categorias_tesoreria WHERE activo = 1 ${donde} ORDER BY nombre`)
        .all(...(donde ? [tipo] : []));
      res.json(filas.map((f) => ({ id: f.nombre, label: f.nombre })));
    });
  },
};
