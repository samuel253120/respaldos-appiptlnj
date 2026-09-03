/**
 * Las dos rutas propias de «Formatos de Certificado».
 *
 * El módulo abre dos puertas además de las que le da el motor:
 *
 *   /formatos_certificado/opciones   los formatos que se pueden elegir HOY al
 *                                    emitir: solo los que están en uso, en su
 *                                    orden, y con su disposición, porque de
 *                                    ella dependen los campos que la ficha del
 *                                    certificado va a pedir.
 *   /formatos_certificado/para       el formato completo con que hay que
 *                                    imprimir un certificado, buscado por su
 *                                    NOMBRE, que es lo que el certificado
 *                                    guardó en «tipo».
 *
 * NINGUNA DE LAS DOS TENÍA PRUEBA. Cuatro roturas medidas en la v1.309.0, todas
 * contra el motor entero y la suite del papel, y las cuatro pasaron sin que
 * nada se pusiera rojo:
 *
 *   · quitarle «activo = 1» a /opciones — un formato retirado de circulación
 *     vuelve a ofrecerse al emitir;
 *   · quitarle el permiso a /opciones y a /para;
 *   · no mandar la disposición — al elegir el tipo, la ficha deja de saber qué
 *     datos pedir, y una presentación de niños deja de pedir los padres y los
 *     padrinos.
 *
 * La primera es la que más pesa, porque «EN USO» ES EL CAMINO QUE EL MÓDULO
 * RECOMIENDA: es lo que ofrece cuando alguien quiere dejar de usar un formato
 * sin tocar los certificados que ya salieron con él, y lo dice en dos avisos
 * distintos —al intentar borrar uno en uso y al renombrarlo—. Toda esa salida
 * descansaba en cinco palabras de una consulta que ninguna prueba miraba.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const def = require('../../server/modules/formatos_certificado');
const { elSistemaAndando, comoOtroUsuario, cerrarElSistema } = require('./andando');

test.after(cerrarElSistema);

const marca = () => `${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

/** Un formato con nombre propio, para que dos pruebas en paralelo no se pisen. */
function unFormato(campos = {}) {
  const m = marca();
  const nombre = campos.nombre || `Formato ${m}`;
  const id = db.prepare(
    `INSERT INTO formatos_certificado (nombre, activo, orden, disposicion, texto)
     VALUES (?, ?, ?, ?, ?)`
  ).run(nombre, campos.activo === undefined ? 1 : campos.activo,
    campos.orden === undefined ? 500 : campos.orden,
    campos.disposicion || 'Clásica', campos.texto || 'De {iglesia}.').lastInsertRowid;
  return { id, nombre };
}

/* --------------------------------------------------------------------- */
/* Los permisos, leídos de cómo el módulo monta sus rutas                 */
/* --------------------------------------------------------------------- */

/** Con qué permiso quedó montada cada ruta. */
function comoSeMontan() {
  const puertas = {};
  let pedido = null;
  def.extraRoutes(
    { get: (ruta) => { puertas[ruta] = pedido; pedido = null; } },
    {
      db,
      requirePerm: (modulo, accion) => { pedido = { modulo, accion }; return () => {}; },
    }
  );
  return puertas;
}

test('LAS DOS PUERTAS PIDEN PERMISO, y sobre certificados', () => {
  /**
   * Sobre CERTIFICADOS y no sobre los formatos, que es la decisión correcta:
   * quien emite tiene que poder elegir el tipo aunque no le toque administrar
   * los formatos. Si un día se cambiara a «formatos_certificado», la ficha de
   * un certificado se quedaría sin poder ofrecer los tipos.
   */
  const puertas = comoSeMontan();
  assert.deepEqual(puertas['/formatos_certificado/opciones'], { modulo: 'certificados', accion: 'view' });
  assert.deepEqual(puertas['/formatos_certificado/para'], { modulo: 'certificados', accion: 'view' });
});

test('y a quien no lo tiene, el sistema andando le dice que no', () => {
  /*
   * Lo de arriba mira cómo se montan; esto mira qué contestan de verdad, con
   * el router del sistema y un usuario a quien le quitaron ese permiso.
   */
  const m = marca();
  const rut = `${20000000 + (process.pid % 1000) * 10 + 1}`;
  const quien = db.prepare(
    `INSERT INTO usuarios (rut, nombre, rol, activo, permisos)
     VALUES (?, ?, 'secretario', 1, ?)`
  ).run(rut, `Sin certificados ${m}`, JSON.stringify({ certificados: [] })).lastInsertRowid;

  return (async () => {
    await elSistemaAndando();
    const suya = comoOtroUsuario(quien);
    for (const ruta of ['/formatos_certificado/opciones', '/formatos_certificado/para?tipo=Bautismo']) {
      const r = await suya('GET', ruta);
      assert.equal(r.estado, 403, `${ruta} tendría que contestar 403 y contestó ${r.estado}`);
    }
  })();
});

/* --------------------------------------------------------------------- */
/* /opciones: lo que se puede elegir HOY                                  */
/* --------------------------------------------------------------------- */

test('LA QUE MÁS PESA: un formato sacado de uso deja de ofrecerse al emitir', async () => {
  /**
   * «En uso» es el camino que el módulo recomienda para dejar de usar un
   * formato sin tocar los certificados que ya salieron con él. Sin este filtro
   * ese camino no lleva a ninguna parte: el formato retirado sigue en la lista
   * de tipos y alguien lo vuelve a elegir.
   */
  const api = await elSistemaAndando();
  const enUso = unFormato({ activo: 1 });
  const retirado = unFormato({ activo: 0 });

  const r = await api('GET', '/formatos_certificado/opciones');
  assert.equal(r.estado, 200);
  const nombres = r.json.map((o) => o.id);
  assert.ok(nombres.includes(enUso.nombre), 'el que está en uso tiene que ofrecerse');
  assert.ok(!nombres.includes(retirado.nombre),
    'el que se sacó de uso NO puede seguir ofreciéndose al emitir');
});

test('pero el retirado se sigue pudiendo imprimir: los ya emitidos no se tocan', async () => {
  /**
   * La otra mitad, y la que hace que sacar de uso no sea lo mismo que borrar.
   * Un certificado emitido con ese formato tiene que seguir saliendo con su
   * texto y su diseño, y para eso /para no mira si está en uso.
   */
  const api = await elSistemaAndando();
  const retirado = unFormato({ activo: 0, texto: 'Lo que este formato certifica.' });
  const r = await api('GET', `/formatos_certificado/para?tipo=${encodeURIComponent(retirado.nombre)}`);
  assert.equal(r.estado, 200);
  assert.ok(r.json, 'un formato retirado tiene que seguir sirviendo para imprimir lo ya emitido');
  assert.equal(r.json.texto, 'Lo que este formato certifica.');
});

test('cada opción trae su disposición, que es de lo que cuelgan los datos que se piden', async () => {
  /**
   * Al elegir el tipo, la ficha del certificado tiene que saber EN EL MOMENTO
   * qué forma tendrá la hoja: de eso dependen los campos que pide —los padres y
   * los padrinos en la presentación de niños, el otro cónyuge en el
   * matrimonio—. Sin la disposición, esos campos no aparecen y el certificado
   * se emite a medias.
   */
  const api = await elSistemaAndando();
  const suyo = unFormato({ disposicion: 'Presentación de niños' });
  const r = await api('GET', '/formatos_certificado/opciones');
  const opcion = r.json.find((o) => o.id === suyo.nombre);
  assert.ok(opcion, 'no salió el formato recién creado');
  assert.equal(opcion.disposicion, 'Presentación de niños');
  assert.equal(opcion.label, suyo.nombre, 'lo que se ve al elegir es el nombre del formato');
});

test('y el que no la tiene guardada cae a la clásica, no a nulo', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  const nombre = `Sin disposición ${m}`;
  db.prepare('INSERT INTO formatos_certificado (nombre, activo, orden) VALUES (?, 1, 500)').run(nombre);
  const r = await api('GET', '/formatos_certificado/opciones');
  const opcion = r.json.find((o) => o.id === nombre);
  assert.equal(opcion.disposicion, 'Clásica',
    'sin disposición la ficha no sabría qué campos pedir');
});

test('salen en el orden que la iglesia les puso, y con el mismo número por nombre', async () => {
  const api = await elSistemaAndando();
  const m = marca();
  // Tres del mismo lote, con órdenes a propósito desordenados
  const b = unFormato({ nombre: `Orden ${m} B`, orden: 700 });
  const a = unFormato({ nombre: `Orden ${m} A`, orden: 700 });
  const primero = unFormato({ nombre: `Orden ${m} Z`, orden: 600 });

  const r = await api('GET', '/formatos_certificado/opciones');
  const suyos = r.json.map((o) => o.id).filter((n) => n.includes(`Orden ${m}`));
  assert.deepEqual(suyos, [primero.nombre, a.nombre, b.nombre],
    'primero el de orden más chico, y con el mismo número se ordenan por nombre');
});

/* --------------------------------------------------------------------- */
/* /para: el formato con que se imprime                                   */
/* --------------------------------------------------------------------- */

test('se busca por NOMBRE, que es lo que el certificado guardó', async () => {
  /**
   * No por número: así un certificado viejo se sigue imprimiendo con el formato
   * que le corresponde aunque entremedio se hayan creado otros.
   */
  const api = await elSistemaAndando();
  const suyo = unFormato({ texto: 'Certifica lo suyo.' });
  const r = await api('GET', `/formatos_certificado/para?tipo=${encodeURIComponent(suyo.nombre)}`);
  assert.equal(r.json.nombre, suyo.nombre);
  assert.equal(r.json.id, suyo.id);
});

test('un tipo que ya no tiene formato contesta nulo, y la hoja sale igual', async () => {
  /**
   * Es la decisión escrita en el módulo: «si su tipo ya no tiene formato, se
   * contesta nulo y la hoja sale con lo de siempre, que es mejor que no salir».
   * La hoja además lo DICE, que es lo que arregló la v1.292.0.
   */
  const api = await elSistemaAndando();
  const r = await api('GET', `/formatos_certificado/para?tipo=Un tipo que no existe ${marca()}`);
  assert.equal(r.estado, 200, 'no puede ser un error: el certificado existe y hay que poder imprimirlo');
  assert.equal(r.json, null);
});

test('y sin tipo tampoco revienta', async () => {
  const api = await elSistemaAndando();
  for (const ruta of ['/formatos_certificado/para', '/formatos_certificado/para?tipo=', '/formatos_certificado/para?tipo=%20%20']) {
    const r = await api('GET', ruta);
    assert.equal(r.estado, 200, ruta);
    assert.equal(r.json, null, ruta);
  }
});
