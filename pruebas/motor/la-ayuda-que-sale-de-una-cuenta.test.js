/**
 * LA PLATA QUE SALE POR EL MOSTRADOR TIENE QUE ESTAR EN EL LIBRO DE LA PLATA.
 *
 * Una ayuda social es la única cosa del sistema que saca dinero y mercadería
 * para dárselos a una persona, y era la única salida de recursos que no dejaba
 * rastro en Tesorería. Medido antes de esto, sobre datos de prueba:
 *
 *   ayudas marcadas «Entregada» ..............  3, por $123.000
 *   movimientos en Tesorería .................  3.004
 *   de esos, alguno que venga de una ayuda ...  0
 *   puente entre los dos módulos, en el código  no existía
 *
 * No es que faltara una cifra: eran dos verdades sobre la misma plata en dos
 * pantallas del mismo sistema. El informe de ayudas decía que salieron
 * $123.000 y el balance decía que no salió nada.
 *
 * Y NO TODA AYUDA ES PLATA, que es lo que hace este puente distinto de los
 * otros dos —la ofrenda de un servicio y la cuota de un integrante—. Una caja
 * de mercadería donada no salió de ninguna cuenta, y forzar un egreso por cada
 * ayuda descuadraría la caja al revés: la iglesia aparecería gastando un
 * dinero que nunca tuvo. Por eso el puente puede decir que no, y lo dice
 * alguien: al entregar hay que indicar de dónde salió.
 *
 * Lo que cuida este archivo:
 *   · que no se pueda entregar sin decir de dónde salió
 *   · que lo que sale de una cuenta deje su egreso, con su método y su cuenta
 *   · que lo que va en especie no deje ninguno, y suelte la cuenta que tuviera
 *   · que el egreso se corrija y se retire con la ayuda, incluso al volverla
 *     atrás o al borrarla
 *   · que el informe diga qué parte de lo entregado salió de cuentas, para que
 *     se pueda cuadrar con el libro
 *   · que la cuenta elegida sea alcanzable, de esta iglesia y no esté cerrada
 *   · que ese movimiento no se pueda editar por su cuenta en Tesorería
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const ajustes = require('../../server/ajustes');
const { db } = require('../../server/db');
const AYUDAS = require('../../server/modules/ayudas_sociales');
const TESORERIA = require('../../server/modules/tesoreria');
const puente = require('../../server/ayuda-tesoreria');
const fs = require('fs');
const path = require('path');

/* ------------------------------- el mostrador de prueba */

const unaIglesia = (nombre, codigo) => db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado) VALUES (?,?,'Activa')")
  .run(nombre, codigo).lastInsertRowid;

const NUESTRA = unaIglesia('Central del mostrador', 'IG-AYT1');
const LA_OTRA = unaIglesia('Norte del mostrador', 'IG-AYT2');

const unaCuenta = (nombre, iglesia, estado = 'Activa') => db
  .prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado)
     VALUES (?, ?, ?, 'Proyecto / Trabajo', ?)`
  )
  .run(nombre, iglesia ? 'Iglesia local' : 'Corporación', iglesia, estado).lastInsertRowid;

const CAJA = unaCuenta('Caja de ayuda social', NUESTRA);
const CERRADA = unaCuenta('Caja vieja', NUESTRA, 'Cerrada');
const AJENA = unaCuenta('Caja de la Norte', LA_OTRA);
const DE_LA_CORPORACION = unaCuenta('Fondo solidario nacional', null);

const BERTA = db
  .prepare("INSERT INTO no_miembros (nombres, apellidos) VALUES ('Berta','Loyola del Puente')")
  .run().lastInsertRowid;

const ADMIN = { id: 9101, rol: 'admin', iglesias: '[]', iglesia_id: null, cuerpos: '[]' };
const DE_LA_NORTE = { id: 9102, rol: 'secretario', iglesias: `[${LA_OTRA}]`, iglesia_id: LA_OTRA, cuerpos: '[]' };

/** Una ayuda guardada de verdad: pasa por el hook y por la sincronización. */
function guardar(datos, existing) {
  const data = { ...datos };
  const error = AYUDAS.hooks.beforeSave(data, { user: ADMIN, isNew: !existing, existing, db });
  if (error) return { error: String(error.error || error) };

  const campos = Object.keys(data).filter((c) => data[c] !== undefined);
  let id;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE ayudas_sociales SET ${campos.map((c) => `"${c}" = ?`).join(', ')} WHERE id = ?`)
      .run(...campos.map((c) => data[c]), id);
  } else {
    id = db
      .prepare(
        `INSERT INTO ayudas_sociales (${campos.map((c) => `"${c}"`).join(',')})
         VALUES (${campos.map(() => '?').join(',')})`
      )
      .run(...campos.map((c) => data[c])).lastInsertRowid;
  }
  const fila = db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id);
  AYUDAS.hooks.afterSave(fila, { db });
  return { fila: db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id) };
}

const suMovimiento = (id) => db.prepare('SELECT * FROM tesoreria WHERE ayuda_id = ?').get(id);

/*
 * Una ayuda BIEN LLENA, a propósito.
 *
 * Lleva quién la aprobó y su respaldo porque desde la 1.205.0 una ayuda que se
 * marca entregada sin esos datos hace una pregunta antes de guardar, y estas
 * pruebas son del puente con la tesorería, no de la pregunta. Contestarle que
 * sí a todo con `confirmado` habría sido más corto y habría dejado de probar
 * el camino de verdad: así se prueba el que hace alguien que llena la ficha.
 * De la pregunta se ocupa la-ayuda-entregada-dice-cuanto-valia.test.js.
 */
const UNA = (mas = {}) => ({
  fecha: '2026-08-12', iglesia_id: NUESTRA, beneficiario_tipo: 'No miembro', no_miembro_id: BERTA,
  tipo_ayuda: 'Alimentos', valor_estimado: 45000, estado: 'Entregada',
  aprobada_por: 'Pastora Ruiz', soporte: '1788000000000-boleta-de-la-caja.pdf',
  salida: puente.DE_UNA_CUENTA, cuenta_id: CAJA, metodo: 'Transferencia', ...mas,
});

/* ------------------------------- la decisión que antes no existía */

test('no se entrega sin decir de dónde salió', () => {
  const { error } = guardar(UNA({ salida: null, cuenta_id: null, metodo: null }));
  assert.match(String(error), /de dónde salió/);
});

test('ni una que ya estaba entregada de antes de que se preguntara', () => {
  /*
   * Se exige en el momento en que la cosa sale, que es cuando alguien lo sabe.
   * A una ficha de hace dos años, exigírselo la dejaba imposible de tocar:
   * quien entra a arreglarle una coma no puede contestar de dónde salió.
   */
  const deAntes = { id: 1, estado: 'Entregada', salida: null };
  assert.equal(
    AYUDAS.hooks.beforeSave({ descripcion: 'una coma' },
      { user: ADMIN, isNew: false, existing: deAntes, db, confirmado: false }),
    null
  );
});

test('pero una ayuda que todavía no se entrega no tiene que decirlo', () => {
  const { fila, error } = guardar(UNA({ estado: 'Solicitada', salida: null, cuenta_id: null, metodo: null }));
  assert.equal(error, undefined);
  assert.equal(suMovimiento(fila.id), undefined, 'lo que no se ha entregado no salió de ninguna parte');
});

/* ------------------------------- lo que sale de una cuenta */

test('la ayuda que sale de una cuenta deja su egreso, con su método', () => {
  const { fila } = guardar(UNA());
  const m = suMovimiento(fila.id);
  assert.ok(m, 'el egreso quedó anotado');
  assert.equal(m.tipo, 'Egreso');
  assert.equal(m.monto, 45000);
  assert.equal(m.cuenta_id, CAJA);
  assert.equal(m.fecha, '2026-08-12');
  assert.equal(m.categoria, 'Ayuda social', 'la categoría de fábrica, que ya existía');
  assert.equal(m.entre_cuentas, 0, 'esta plata sale de la organización: no es un traslado');
  /*
   * El método viaja porque lo dice la ayuda. La ofrenda anotaba «Efectivo» en
   * todos sus movimientos y con parte de la plata llegando al banco el libro
   * no cuadraba con la cartola; se arregló allá y no se repite acá.
   */
  assert.equal(m.metodo, 'Transferencia');
  assert.match(m.concepto, /Ayuda social: Alimentos — Berta Loyola del Puente/);
  assert.equal(fila.movimiento_id, m.id, 'y la ayuda sabe cuál es el suyo');
});

test('corregirle el monto o la cuenta corrige el egreso, no agrega otro', () => {
  const { fila } = guardar(UNA());
  const antes = suMovimiento(fila.id).id;
  const { fila: luego } = guardar({ valor_estimado: 61000, cuenta_id: DE_LA_CORPORACION }, fila);
  const m = suMovimiento(luego.id);
  assert.equal(m.id, antes, 'es el mismo movimiento');
  assert.equal(m.monto, 61000);
  assert.equal(m.cuenta_id, DE_LA_CORPORACION);
  assert.equal(m.iglesia_id, null, 'la cuenta de la corporación no es de ninguna iglesia');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM tesoreria WHERE ayuda_id = ?').get(luego.id).n, 1
  );
});

/* ------------------------------- lo que no sale de ninguna cuenta */

test('lo que se entrega en especie no deja egreso, y suelta la cuenta que tuviera', () => {
  const { fila } = guardar(UNA());
  assert.ok(suMovimiento(fila.id), 'primero salió de la caja');
  const { fila: luego } = guardar({ salida: puente.EN_ESPECIE }, fila);
  assert.equal(suMovimiento(luego.id), undefined, 'la mercadería donada no salió de ninguna cuenta');
  assert.equal(luego.cuenta_id, null, 'y la ayuda ya no dice que salió de una');
  assert.equal(luego.metodo, null);
  assert.equal(luego.movimiento_id, null);
});

test('una fila escrita por otro módulo, que dice «en especie» y arrastra una cuenta, tampoco anota', () => {
  /*
   * No toda ayuda entra por el formulario. Una solicitud aprobada crea la suya
   * con la misma conexión y sin pasar por el hook (ver
   * server/solicitud-ayuda.js), así que a la sincronización pueden llegar
   * filas que la revisión nunca tocó. Acá se arma justamente esa: dice que fue
   * en especie y todavía trae la cuenta pegada.
   *
   * Esta prueba se escribió al romper a propósito la línea que mira la salida
   * y ver que no se caía nada: la revisión ya soltaba la cuenta antes, así que
   * por el formulario nunca se llegaba a este caso. La guarda no sobraba; era
   * la prueba la que no miraba por acá.
   */
  const id = db
    .prepare(
      `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id, beneficiario,
                                    tipo_ayuda, valor_estimado, estado, salida, cuenta_id)
       VALUES ('2026-08-14', ?, 'No miembro', ?, 'Berta Loyola del Puente', 'Ropa', 30000,
               'Entregada', ?, ?)`
    )
    .run(NUESTRA, BERTA, puente.EN_ESPECIE, CAJA).lastInsertRowid;

  puente.sincronizarEgresoDeAyuda(db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(id), db);
  assert.equal(suMovimiento(id), undefined, 'lo que fue en especie no descuenta de ninguna cuenta');
});

test('volverla atrás retira el egreso: no se gastó lo que no se entregó', () => {
  const { fila } = guardar(UNA());
  assert.ok(suMovimiento(fila.id));
  const { fila: luego } = guardar({ estado: 'Solicitada' }, fila);
  assert.equal(suMovimiento(luego.id), undefined);
  assert.equal(luego.movimiento_id, null);
});

test('borrar la ayuda se lleva su egreso', () => {
  const { fila } = guardar(UNA());
  assert.ok(suMovimiento(fila.id));
  AYUDAS.hooks.beforeDelete(fila, { db });
  db.prepare('DELETE FROM ayudas_sociales WHERE id = ?').run(fila.id);
  assert.equal(suMovimiento(fila.id), undefined);
});

/* ------------------------------- de qué cuenta puede salir */

test('no sale de una cuenta de otra iglesia', () => {
  const { error } = guardar(UNA({ cuenta_id: AJENA }));
  assert.match(String(error), /es de otra iglesia/);
});

test('ni de una que quien la registra no alcanza', () => {
  const data = UNA();
  const error = AYUDAS.hooks.beforeSave(data, { user: DE_LA_NORTE, isNew: true, existing: null, db });
  assert.match(String(error), /no está entre las iglesias que administra/);
});

test('ni de una cuenta cerrada', () => {
  const { error } = guardar(UNA({ cuenta_id: CERRADA }));
  assert.match(String(error), /está cerrada/);
});

test('pero sí de una de la corporación, que no es de ninguna iglesia', () => {
  const { fila, error } = guardar(UNA({ cuenta_id: DE_LA_CORPORACION }));
  assert.equal(error, undefined);
  assert.ok(suMovimiento(fila.id));
});

test('y no se descuenta un egreso de cero', () => {
  const { error } = guardar(UNA({ valor_estimado: 0 }));
  assert.match(String(error), /monto entregado/);
});

/* ------------------------------- el movimiento es de la ayuda */

test('ese movimiento no se edita por su cuenta en Tesorería', () => {
  const { fila } = guardar(UNA());
  const m = suMovimiento(fila.id);
  const error = TESORERIA.hooks.beforeSave({ monto: 1 }, { user: ADMIN, existing: m, db, confirmado: true });
  assert.match(String(error), /ayuda social entregada/);
  assert.match(String(error), /Ayudas Sociales/, 'y dice dónde se corrige');
});

test('y no se le reclama la boleta: su respaldo vive en la ayuda', () => {
  const { fila } = guardar(UNA());
  const m = suMovimiento(fila.id);
  const insignia = TESORERIA.computed.find((c) => c.name === 'respaldo').calc(m);
  assert.equal(insignia.texto, '—', 'un egreso generado no lo adjunta nadie a mano');

  // Y el filtro de «egresos sin respaldo» tampoco lo cuenta como pendiente
  const filtro = TESORERIA.filtrosPropios.find((f) => f.nombre === 'respaldo');
  const { sql } = filtro.donde('Egresos sin respaldo');
  const sale = db.prepare(`SELECT id FROM tesoreria WHERE id = ? AND (${sql})`).get(m.id);
  assert.equal(sale, undefined);
});

/* ------------------------------- se puede apagar, como los otros dos */

test('apagado en Configuración, no anota nada y retira lo anotado', () => {
  const { fila } = guardar(UNA());
  assert.ok(suMovimiento(fila.id));
  ajustes.guardar('ayuda_registra_tesoreria', '0');
  try {
    puente.sincronizarEgresoDeAyuda(db.prepare('SELECT * FROM ayudas_sociales WHERE id = ?').get(fila.id), db);
    assert.equal(suMovimiento(fila.id), undefined);
    const { fila: otra } = guardar(UNA());
    assert.equal(suMovimiento(otra.id), undefined);
    /*
     * Pero la pregunta de dónde salió se sigue haciendo: es lo que deja
     * constancia de si la iglesia puso la plata, y eso no depende de si el
     * libro se lleva en el sistema o a mano.
     */
    const { error } = guardar(UNA({ salida: null, cuenta_id: null, metodo: null }));
    assert.match(String(error), /de dónde salió/);
  } finally {
    ajustes.guardar('ayuda_registra_tesoreria', '1');
  }
});

/* ------------------------------- las dos pantallas dicen lo mismo */

test('el informe separa lo que salió de cuentas de lo que se dio en especie', () => {
  /*
   * Esta era la consecuencia de fondo del hallazgo: el informe decía «$123.000
   * entregados» y el balance decía que no había salido nada. Con el puente, lo
   * que salió de cuentas es exactamente lo que el libro tiene anotado como
   * «Ayuda social», y lo que se dio en especie se cuenta aparte —vale lo que
   * vale y no descuenta de ninguna cuenta—.
   */
  const aQuien = require('../../server/a-quien-se-ayudo');
  const mias = `WHERE iglesia_id = ${NUESTRA} AND fecha = '2026-09-03'`;
  const como = (mas) => guardar(UNA({ fecha: '2026-09-03', ...mas })).fila;

  como({ valor_estimado: 20000 });
  como({ valor_estimado: 30000 });
  como({ valor_estimado: 12000, salida: puente.EN_ESPECIE, cuenta_id: null, metodo: null });
  // Una de las de antes, sin la decisión: se cuenta aparte y no se le inventa lado
  db.prepare(
    `INSERT INTO ayudas_sociales (fecha, iglesia_id, beneficiario_tipo, no_miembro_id, beneficiario,
                                  tipo_ayuda, valor_estimado, estado)
     VALUES ('2026-09-03', ?, 'No miembro', ?, 'Berta Loyola del Puente', 'Ropa', 7000, 'Entregada')`
  ).run(NUESTRA, BERTA);

  const r = aQuien.cifrasDe(db, mias, []);
  assert.equal(r.entregado, 69000, 'todo lo entregado, salga de donde salga');
  assert.equal(r.de_cuentas, 50000);
  assert.equal(r.en_especie, 12000);
  assert.equal(r.sin_decidir, 1, 'las de antes se cuentan, no se reparten a dedo');

  const enElLibro = db
    .prepare(
      `SELECT COALESCE(SUM(monto), 0) AS s FROM tesoreria
        WHERE categoria = 'Ayuda social'
          AND ayuda_id IN (SELECT id FROM ayudas_sociales ${mias})`
    )
    .get().s;
  assert.equal(enElLibro, r.de_cuentas, 'el informe y el libro dicen la misma cifra');
});

/* ------------------------------- la casilla dice qué se escribe en ella */

test('el buscador de la cuenta pide el nombre de una cuenta, no el RUT de una persona', () => {
  /*
   * Las cuentas pasan de veinte, así que el campo se dibuja como buscador, y
   * el buscador traía una sola frase escrita fija: «escriba el nombre, el
   * apellido o el RUT», que para una cuenta no quiere decir nada. Le pasaba
   * igual al de Tesorería desde antes; se arregla en los dos, porque es el
   * mismo campo.
   *
   * Esto se comprueba leyendo el código y no pidiéndole la respuesta al
   * servidor: /api/meta se arma dentro de index.js, que al cargarse levanta el
   * sistema entero. Lo que se cuida acá es la cadena completa —el módulo lo
   * declara, /api/meta lo deja pasar, la pantalla lo usa—, porque romper
   * cualquiera de los tres deja la casilla diciendo lo que no es.
   */
  const cuentaDeLaAyuda = AYUDAS.fields.find((f) => f.name === 'cuenta_id');
  const cuentaDelMovimiento = TESORERIA.fields.find((f) => f.name === 'cuenta_id');
  assert.match(cuentaDeLaAyuda.placeholder, /nombre de la cuenta/);
  assert.match(cuentaDelMovimiento.placeholder, /nombre de la cuenta/);

  const lee = (r) => fs.readFileSync(path.join(__dirname, '../..', r), 'utf8');
  assert.match(lee('server/index.js'), /placeholder: placeholder \|\| null,/,
    '/api/meta tiene que dejarlo pasar: la lista de propiedades es cerrada');
  assert.match(lee('public/app.js'), /placeholder="\$\{esc\(f\.placeholder \|\|/,
    'y la pantalla tiene que usarlo, con el de siempre por omisión');
});
