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
 *
 * RENOMBRARLA SÍ SE PUEDE, y el nombre nuevo **se lleva los movimientos
 * consigo**: se pregunta primero, diciendo cuántos son, y los dos cambios van
 * en la misma transacción. Lo que cambia es la etiqueta con que está
 * clasificado un movimiento, no el movimiento —fecha, monto, concepto y cuenta
 * quedan intactos—, así que el informe sigue cuadrando en una sola línea en vez
 * de partirse en dos. Queda anotado en el Registro de Cambios, con cuántos.
 *
 * Con dos excepciones, y las dos por el mismo motivo: las siete categorías que
 * escribe el propio sistema (ver server/categorias-del-sistema.js) no se
 * renombran ni se borran, porque el sistema seguiría anotando con el nombre de
 * antes y al día siguiente el informe volvería a partirse.
 */
const TIPOS = ['Ingreso', 'Egreso', 'Ambos'];

/**
 * ¿Este cambio dejaría a la tesorería sin ninguna categoría que ofrecer?
 *
 * Al anotar un ingreso se ofrecen las de «Ingreso» y las de «Ambos»; al anotar
 * un gasto, las de «Egreso» y las de «Ambos». Si las de un lado se apagan
 * todas, el desplegable de ese lado queda vacío y no hay con qué clasificar.
 *
 * MEDIDO en la v1.341.0: se desactivaron las seis categorías de ingreso, una
 * por una, y ninguna dijo nada. Después la ruta que las ofrece devolvió cero, y
 * la ofrenda del domingo se anotó igual —201— clasificada con el valor de
 * fábrica. La iglesia quedaba anotando toda su plata bajo una palabra que ella
 * misma había apagado, sin enterarse.
 *
 * Se pregunta por el estado en que quedaría la lista DESPUÉS del cambio, así
 * que sirve igual para desactivar, para cambiarle el tipo y para borrar. `como`
 * dice cómo quedaría esta fila: `null` es «ya no está».
 */
function loQueDejariaSinCategorias(db, id, como) {
  const vivas = db
    .prepare('SELECT id, tipo, activo FROM categorias_tesoreria WHERE id != ? AND activo = 1')
    .all(id)
    .map((f) => String(f.tipo));
  if (como && Number(como.activo) !== 0) vivas.push(String(como.tipo));

  const sinNada = ['Ingreso', 'Egreso']
    .filter((lado) => !vivas.some((t) => t === lado || t === 'Ambos'));
  return sinNada.length ? sinNada : null;
}

/** El reparo, escrito para quien lo va a leer. */
function elAvisoDeQuedarseSinCategorias(lados) {
  const deQue = lados.length === 2
    ? 'ni para los ingresos ni para los gastos'
    : lados[0] === 'Ingreso' ? 'para los ingresos' : 'para los gastos';
  const elCaso = lados.includes('Ingreso') ? 'la ofrenda del domingo' : 'la cuenta de la luz';
  return (
    `Con eso no quedaría ninguna categoría ${deQue}: el desplegable saldría vacío y no habría `
    + `con qué clasificar ${elCaso}. Deje al menos una en uso, o cree antes la que va a usar.`
  );
}

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
      help: 'Como se verá al registrar un movimiento y en los informes. Ej: «Diezmos», «Servicios públicos». '
        + 'Si le cambia el nombre a una que ya se usó, los movimientos que la tienen pasan también al nombre nuevo.',
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
    beforeSave(data, { db, isNew, existing, confirmado }) {
      /*
       * Lo primero: que este guardado no deje a la tesorería sin con qué
       * clasificar. Va antes que lo del nombre porque no depende de él —se
       * llega acá desactivándola o cambiándole el tipo— y porque es lo que
       * impide que el sistema quede sin poder anotar un peso.
       */
      if (!isNew && existing) {
        const comoQuedaria = {
          tipo: data.tipo !== undefined ? data.tipo : existing.tipo,
          activo: data.activo !== undefined ? data.activo : existing.activo,
        };
        const sinNada = loQueDejariaSinCategorias(db, existing.id, comoQuedaria);
        if (sinNada) return elAvisoDeQuedarseSinCategorias(sinNada);
      }

      if (isNew || !existing || data.nombre === undefined) return null;
      const seLlamaba = String(existing.nombre || '');
      const seVaALlamar = String(data.nombre || '');
      if (seLlamaba.trim().toLowerCase() === seVaALlamar.trim().toLowerCase()) return null;

      const { quienLaEscribe } = require('../categorias-del-sistema');
      const quien = quienLaEscribe(seLlamaba);
      if (quien) {
        return (
          `«${seLlamaba}» no la elige nadie: la escribe ${quien}, así que su nombre no se puede cambiar. `
          + 'Si le cambiara el nombre, el sistema seguiría anotando con el de antes y esos movimientos '
          + 'quedarían clasificados con una categoría que ya no está en la lista. '
          + 'Si no la usa, desmárquela en «En uso»: deja de ofrecerse y sigue estando el día que haga falta.'
        );
      }

      /*
       * UNA QUE YA SE USÓ SE RENOMBRA, Y SE LLEVA SUS MOVIMIENTOS CONSIGO.
       *
       * Antes el renombrado pasaba callado y hacía el mismo daño que el borrado
       * —que sí estaba frenado—: los movimientos guardan el NOMBRE, así que
       * seguían diciendo el viejo. MEDIDO en la v1.341.0, con tres diezmos
       * anotados por $445.000: borrar «Diezmos» contestó 400 con su mensaje;
       * renombrarla a «Diezmos y primicias» contestó 200 sin una palabra, y el
       * informe quedó partido en dos —«Diezmos $445.000» y «Diezmos y primicias
       * $150.000»— para siempre.
       *
       * En la v1.345.0 esto se cerró rechazando el renombrado. Estaba mal
       * elegido: le quitaba a la iglesia una cosa que necesita hacer —corregir
       * el nombre de una categoría— para evitar un efecto que se puede evitar
       * de otra manera. Se cambió a pedido, en la v1.349.0.
       *
       * LO QUE SE HACE AHORA: se pregunta, y si dice que sí, el nombre nuevo se
       * lleva los movimientos. Los dos pasos van en la MISMA transacción del
       * motor —el arrastre está en `afterSave`, más abajo— así que o cambian los
       * dos o no cambia ninguno.
       *
       * Y NO ES REESCRIBIR EL LIBRO, que era el reparo. Lo que cambia es la
       * ETIQUETA con que está clasificado un movimiento, no el movimiento: la
       * fecha, el monto, el concepto y la cuenta quedan intactos. La categoría
       * es el nombre de un concepto, y el concepto no cambió: lo que la iglesia
       * llamaba «Pro-Templo» y ahora llama «Pro-Templo Sede Sur» es lo mismo.
       * Que el movimiento guarde el nombre y no un número es una decisión de
       * este sistema —para que borrar no deje huérfano a nadie—, y no tiene por
       * qué costarle a la iglesia el derecho a corregir una palabra.
       *
       * QUEDA ANOTADO, con cuántos movimientos se movieron: desde la v1.346.0
       * las categorías están entre los módulos que vigila el Registro de
       * Cambios, así que esto no pasa en silencio.
       */
      const usos = db
        .prepare('SELECT COUNT(*) AS c FROM tesoreria WHERE lower(categoria) = lower(?)')
        .get(seLlamaba).c;
      if (usos && !confirmado) {
        const cuantos = `${usos.toLocaleString('es-CL')} movimiento(s) de tesorería`;
        return {
          error: `«${seLlamaba}» está en ${cuantos}.`,
          confirmar:
            `«${seLlamaba}» está en ${cuantos}. Al cambiarle el nombre a «${seVaALlamar}», esos `
            + 'movimientos pasan a quedar clasificados con el nombre nuevo, para que el informe siga '
            + 'cuadrando en una sola línea en vez de partirse en dos. De cada movimiento no se toca '
            + 'nada más: la fecha, el monto, el concepto y la cuenta quedan igual. '
            + '¿Le cambio el nombre?',
        };
      }
      return null;
    },

    /**
     * El nombre nuevo se lleva los movimientos.
     *
     * Va acá y no en `beforeSave` porque tiene que ocurrir DESPUÉS de que la
     * categoría quede guardada, y dentro de la misma transacción del motor: o
     * cambian los dos o no cambia ninguno. Si esto fallara a mitad de camino,
     * la categoría tampoco se guarda y todo queda como estaba.
     *
     * Se compara sin distinguir mayúsculas para alcanzar también lo que se
     * anotó antes de la v1.344.0, cuando el guardado todavía no normalizaba la
     * categoría a como está escrita en la lista.
     */
    afterSave(row, { db, isNew, existing, user }) {
      if (isNew || !existing) return;
      const seLlamaba = String(existing.nombre || '');
      const seLlama = String(row.nombre || '');
      if (!seLlamaba || seLlamaba === seLlama) return;

      const movidos = db
        .prepare('UPDATE tesoreria SET categoria = ? WHERE lower(categoria) = lower(?)')
        .run(seLlama, seLlamaba).changes;
      if (!movidos) return;

      /*
       * Y queda dicho cuántos se movieron. El motor anota solo el cambio de la
       * ficha —«Nombre de la categoría: X → Y»—, que no dice lo que de verdad
       * pasó con la plata. Esta línea sí.
       */
      require('../bitacora').anotarCambio({
        def: module.exports,
        accion: 'Cambio',
        fila: row,
        usuario: user,
        detalle: `Al cambiar el nombre, ${movidos.toLocaleString('es-CL')} movimiento(s) de tesorería `
          + `pasaron de «${seLlamaba}» a «${seLlama}»`,
      });
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

      // Y que borrarla no deje la lista de un lado en cero: es la misma
      // comprobación que al desactivar, con esta fila fuera.
      const sinNada = loQueDejariaSinCategorias(db, row.id, null);
      if (sinNada) return elAvisoDeQuedarseSinCategorias(sinNada);

      return null;
    },
  },
  extraRoutes(router, { db, requirePerm }) {
    /**
     * Las categorías que se pueden elegir para un movimiento, según sea un
     * ingreso o un egreso. Devuelve el nombre como valor, porque es el nombre
     * lo que se guarda en el movimiento.
     *
     * Esa decisión —guardar el nombre y no un número— es la que hace que borrar
     * una categoría en uso dejaría huérfanos a sus movimientos, y por eso el
     * módulo lo frena. Renombrarla, en cambio, sí se puede: el guardado se
     * lleva los movimientos al nombre nuevo (ver `afterSave`).
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
