/**
 * Los datos reservados, ahora que son más de un grupo.
 *
 * La salud ya tenía su llave. Los datos de contacto —teléfono, correo,
 * dirección— no tenían ninguna: los veía, los bajaba en la planilla y los
 * buscaba cualquiera que pudiera abrir el listado. Para una iglesia con ciento
 * setenta y nueve fichas eso es la nómina completa con teléfonos y direcciones
 * a un clic, en manos de quien solo tenía que consultar algo.
 *
 * Lo que se comprueba acá es el mecanismo entero, no un caso: que un módulo
 * pueda reservar CUALQUIER grupo de campos escribiendo `reservado: 'la_llave'`
 * en la declaración del campo, y que a quien no la tenga no le lleguen esos
 * datos por ninguna de las cuatro puertas —la ficha, el listado, la planilla y
 * el buscador—. Se dejan afuera las cuatro o no sirve ninguna: durante el
 * desarrollo el teléfono se escondía en la ficha y seguía encontrándose
 * escribiéndolo en el buscador.
 *
 * Y que de fábrica no cambia nada: las tres llaves nuevas vienen dadas a
 * todos, porque están para poder QUITARLAS.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const sensibles = require('../../server/sensibles');
const permisos = require('../../server/permissions');
const planilla = require('../../server/planilla');

const CONTACTO = 'miembros_contacto';
const SALUD = permisos.SALUD;

const MIEMBROS = {
  name: 'miembros',
  label: 'Miembros',
  searchFields: ['nombres', 'apellidos', 'rut', 'telefono', 'email'],
  fields: [
    { name: 'nombres', label: 'Nombres', type: 'text' },
    { name: 'apellidos', label: 'Apellidos', type: 'text' },
    { name: 'rut', label: 'RUT', type: 'rut' },
    { name: 'telefono', label: 'Teléfono', type: 'tel', reservado: CONTACTO },
    { name: 'email', label: 'Correo', type: 'email', reservado: CONTACTO },
    { name: 'direccion', label: 'Dirección', type: 'text', reservado: CONTACTO },
    { name: 'enfermedades', label: 'Enfermedades', type: 'textarea', sensible: true },
  ],
};

const ficha = () => ({
  id: 42, nombres: 'Ana', apellidos: 'Díaz', rut: '12.345.678-5',
  telefono: '+56911112222', email: 'ana@example.cl', direccion: 'Los Aromos 45',
  enfermedades: 'Diabetes tipo 2',
});

/** Alguien con esa llave quitada a mano, sin cambiarle nada más. */
const sinLlave = (rol, llave) => ({ rol, permisos: JSON.stringify({ [llave]: [] }) });

// ------------------------------------------------- de fábrica, nada cambia ----

test('las tres llaves nuevas vienen dadas a todos los roles', () => {
  for (const llave of ['miembros_contacto', 'datos_planilla', 'usuarios_clave']) {
    for (const rol of ['admin', 'pastor', 'secretario', 'tesorero', 'consulta']) {
      assert.equal(
        permisos.can({ rol }, llave, 'view'), true,
        `${rol} tendría que traer ${llave} de fábrica: están para poder quitarlas, no para darlas`
      );
    }
  }
});

test('y las que ya existían siguen donde estaban', () => {
  // Lo mismo que fijaba llaves.test.js, comprobado otra vez desde acá porque
  // ahora los valores por defecto se arman solos con llavesDeFabrica(): un
  // error ahí movería las cuatro de golpe y sin ruido.
  assert.deepEqual(permisos.permisosDelRol('admin', SALUD), ['view']);
  assert.deepEqual(permisos.permisosDelRol('pastor', SALUD), ['view']);
  assert.deepEqual(permisos.permisosDelRol('secretario', SALUD), []);
  for (const rol of ['pastor', 'secretario', 'tesorero', 'consulta']) {
    assert.deepEqual(permisos.permisosDelRol(rol, 'sistema_respaldo'), [], `${rol} no toca los respaldos`);
    assert.deepEqual(permisos.permisosDelRol(rol, 'sistema_configuracion'), [], `${rol} no toca la configuración`);
  }
  assert.deepEqual(permisos.permisosDelRol('admin', 'sistema_respaldo'), ['view', 'create']);
});

// ------------------------------------------------------- la ficha y el listado ----

test('a quien se le quitó el contacto, no le llega', () => {
  const limpia = sensibles.limpiar(MIEMBROS, ficha(), sinLlave('secretario', CONTACTO));
  assert.equal('telefono' in limpia, false, 'el teléfono no tiene que venir ni en blanco');
  assert.equal('email' in limpia, false);
  assert.equal('direccion' in limpia, false);
  // Y lo demás de la ficha llega entero
  assert.equal(limpia.nombres, 'Ana');
  assert.equal(limpia.rut, '12.345.678-5');
  // Un secretario tampoco alcanza la salud por su rol, así que van los dos
  assert.deepEqual(limpia.reservado_oculto.slice().sort(), [CONTACTO, SALUD].sort());
});

test('los dos grupos son independientes: quitar uno no toca el otro', () => {
  // Un pastor sin contacto sigue viendo la salud, que es lo suyo
  const pastor = sensibles.limpiar(MIEMBROS, ficha(), sinLlave('pastor', CONTACTO));
  assert.equal(pastor.enfermedades, 'Diabetes tipo 2');
  assert.equal('telefono' in pastor, false);
  assert.deepEqual(pastor.reservado_oculto, [CONTACTO]);

  // Y un secretario, que no alcanza la salud, sí ve el contacto
  const secretaria = sensibles.limpiar(MIEMBROS, ficha(), { rol: 'secretario' });
  assert.equal(secretaria.telefono, '+56911112222');
  assert.equal('enfermedades' in secretaria, false);
  assert.deepEqual(secretaria.reservado_oculto, [SALUD]);
  assert.equal(secretaria.salud_oculta, true, 'la marca vieja sigue viajando');
});

test('quien pierde los dos, pierde los dos', () => {
  const nadie = { rol: 'consulta', permisos: JSON.stringify({ [CONTACTO]: [], [SALUD]: [] }) };
  const limpia = sensibles.limpiar(MIEMBROS, ficha(), nadie);
  assert.deepEqual(limpia.reservado_oculto.slice().sort(), [CONTACTO, SALUD].sort());
  for (const campo of ['telefono', 'email', 'direccion', 'enfermedades']) {
    assert.equal(campo in limpia, false, `${campo} no tendría que llegar`);
  }
});

test('la ficha de uno mismo se ve entera, tenga o no la llave', () => {
  const ella = { rol: 'consulta', miembro_id: 42, permisos: JSON.stringify({ [CONTACTO]: [], [SALUD]: [] }) };
  const suya = sensibles.limpiar(MIEMBROS, ficha(), ella);
  assert.equal(suya.telefono, '+56911112222', 'su teléfono es suyo');
  assert.equal(suya.enfermedades, 'Diabetes tipo 2');
  // Pero solo la suya: la de otro sigue reservada
  const ajena = sensibles.limpiar(MIEMBROS, { ...ficha(), id: 99 }, ella);
  assert.equal('telefono' in ajena, false);
});

test('el listado entero pasa por lo mismo', () => {
  const filas = [ficha(), { ...ficha(), id: 43, nombres: 'Beto' }];
  const limpias = sensibles.limpiarVarias(MIEMBROS, filas, sinLlave('consulta', CONTACTO));
  assert.equal(limpias.length, 2);
  for (const f of limpias) assert.equal('telefono' in f, false);
});

// ---------------------------------------------------------------- al guardar ----

test('quien no lo ve tampoco lo borra al guardar', () => {
  // Sin esto, abrir la ficha y guardar dejaría el teléfono en blanco: el
  // formulario manda el campo vacío porque nunca recibió su valor.
  const datos = { nombres: 'Ana', telefono: '', email: '', direccion: '' };
  sensibles.protegerAlGuardar(MIEMBROS, datos, sinLlave('secretario', CONTACTO), ficha());
  assert.equal('telefono' in datos, false, 'no tiene que llegar a escribirse');
  assert.equal(datos.nombres, 'Ana', 'lo que sí puede tocar, se guarda');
});

test('y quien sí lo ve, lo guarda', () => {
  const datos = { telefono: '+56999999999' };
  sensibles.protegerAlGuardar(MIEMBROS, datos, { rol: 'secretario' }, ficha());
  assert.equal(datos.telefono, '+56999999999');
});

// ----------------------------------------------------------------- el buscador ----

test('no se puede dar con alguien buscando por un dato que no se ve', () => {
  // Es la puerta que se olvida: el teléfono no se mostraba, pero escribirlo en
  // el buscador devolvía a su dueño, y con eso el dato quedaba igual de
  // expuesto que si se mostrara.
  const buscables = sensibles.buscablesPara(MIEMBROS, sinLlave('consulta', CONTACTO));
  assert.deepEqual(buscables, ['nombres', 'apellidos', 'rut']);
});

test('quien sí lo alcanza busca por todo, como siempre', () => {
  assert.deepEqual(
    sensibles.buscablesPara(MIEMBROS, { rol: 'secretario' }),
    ['nombres', 'apellidos', 'rut', 'telefono', 'email']
  );
});

// ------------------------------------------------------------------ la planilla ----

test('la planilla no trae la columna que esa persona no alcanza', () => {
  const escrito = [];
  const res = {
    setHeader() {},
    send(buffer) { escrito.push(buffer.toString('utf8')); },
  };
  const fila = sensibles.limpiar(MIEMBROS, ficha(), sinLlave('consulta', CONTACTO));
  planilla.enviar(res, MIEMBROS, [fila], sinLlave('consulta', CONTACTO));

  const csv = escrito.join('');
  assert.ok(csv.includes('Nombres'), 'lo que sí alcanza tiene que estar');
  assert.ok(!csv.includes('Teléfono'), 'la columna del teléfono no tendría que existir');
  // Sin el «+», que es como el teléfono baja a la planilla desde la 1.97.4
  // (ver telefonoParaLaPlanilla en server/planilla.js): si se buscara con el
  // «+», esta comprobación pasaría sin haber mirado el número.
  assert.ok(!csv.includes('56911112222'), 'y menos el número');
  // La columna se quita entera y no se deja vacía: una casilla en blanco se
  // lee como «esta persona no tiene teléfono», que es peor que no traerla.
  assert.ok(!csv.includes('Correo'));
  assert.ok(!csv.includes('Dirección'));
});

test('y sí la trae para quien la alcanza', () => {
  const escrito = [];
  const res = { setHeader() {}, send(b) { escrito.push(b.toString('utf8')); } };
  planilla.enviar(res, MIEMBROS, [ficha()], { rol: 'secretario' });
  const csv = escrito.join('');
  assert.ok(csv.includes('Teléfono'));
  // El número, tal como baja a la planilla: sin el «+», que Excel podría tomar
  // por el comienzo de una cuenta (ver server/planilla.js). Lo que se prueba
  // acá es el permiso, no el formato, pero el formato tiene que estar bien
  // escrito o la comprobación no mira nada.
  assert.ok(csv.includes('56911112222'));
  assert.ok(!csv.includes('+56911112222'), 'el «+» se saca en la planilla');
});

// ------------------------------------------------------------ el mecanismo ----

test('un módulo puede reservar el grupo que quiera, declarando su llave', () => {
  // Es lo que hace que esto sirva para lo que venga: la declaración del campo
  // dice a qué llave pertenece, y el resto funciona solo.
  const INVENTADO = {
    name: 'ayudas_sociales',
    fields: [
      { name: 'monto' },
      { name: 'motivo', reservado: 'sistema_respaldo' }, // una llave que sí existe
    ],
  };
  const conLlave = { rol: 'admin' };
  const sin = { rol: 'consulta' };

  assert.equal(sensibles.limpiar(INVENTADO, { id: 1, monto: 50000, motivo: 'X' }, conLlave).motivo, 'X');
  const oculta = sensibles.limpiar(INVENTADO, { id: 1, monto: 50000, motivo: 'X' }, sin);
  assert.equal('motivo' in oculta, false);
  assert.equal(oculta.monto, 50000);
});

test('y reservar a una llave que no existe revienta al arrancar, no en silencio', () => {
  // Es el error que dejaría el campo reservado solo de nombre: sin la llave
  // declarada, la matriz no la escribe rol por rol y la reparte el comodín
  // '*', así que se la llevarían todos los que puedan ver algo. Encontrado
  // escribiendo esta misma prueba: el campo «inventado» se veía entero.
  const { normalizarParaPruebas } = require('../../server/registry');
  assert.throws(
    () => normalizarParaPruebas({
      name: 'inventado',
      fields: [{ name: 'motivo', reservado: 'una_llave_que_nadie_declaro' }],
    }),
    /no existe como llave/,
    'tendría que negarse a arrancar'
  );
});

test('un módulo sin nada reservado no se ve afectado', () => {
  const SIMPLE = { name: 'servicios', fields: [{ name: 'nombre' }, { name: 'hora' }] };
  const fila = { id: 1, nombre: 'Culto', hora: '19:00' };
  assert.equal(sensibles.limpiar(SIMPLE, fila, { rol: 'consulta' }), fila, 'ni se copia la fila');
  assert.equal(sensibles.vedados(SIMPLE, { rol: 'consulta' }, null).length, 0);
});
