/**
 * EL MOTIVO DE UNA AYUDA SOCIAL SALÍA A UNA PANTALLA BLOQUEADA.
 *
 * La cabecera de server/avisos/avisos.js lo promete por escrito:
 *
 *   «El aviso puede terminar en la pantalla bloqueada de un teléfono, donde lo
 *    ve cualquiera que pase. Por eso lleva el hecho y el enlace […] y nunca el
 *    dato: ni el RUT, ni el motivo de una ayuda social, ni nada de salud.»
 *
 * MEDIDO en la v1.335.0, interceptando el empujón de la pasada del día para una
 * cuenta que lleva las ayudas y nada más:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Una ayuda pedida sigue sin entregarse                       │
 *   │ Mercadería para Carmen Salgado Vera (05-06-2026, hace 90    │
 *   │ día(s), «Solicitada»).                                     │
 *   └────────────────────────────────────────────────────────────┘
 *
 * El resumen del día manda los TITULARES cuando hay dos avisos o más, y el
 * cuerpo entero cuando hay uno solo. Para quien lleva las ayudas, uno solo es
 * el día normal.
 *
 * Lo que cuida este archivo:
 *   · que el texto de la ayuda no salga nunca al teléfono, ni por el resumen
 *     del día ni por un empujón suelto
 *   · que el título sí salga, porque dice el hecho y no el dato
 *   · que la constancia quede COMPLETA en la campanita: acá no se está
 *     escondiendo información, se está eligiendo por dónde viaja
 *   · y que a los demás avisos no se les quite el texto de paso
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const avisos = require('../../server/avisos/avisos');

const MARCA = `t${process.pid}`;

/* ------------------------------------------------- la marca en el tipo */

test('la ayuda sin entregar está marcada como reservada', () => {
  assert.equal(avisos.TIPOS.ayuda_sin_entregar.reservado, true,
    'sin la marca, el cuerpo con el nombre y el motivo vuelve a salir al teléfono');
});

test('y es la única: los demás mandan su texto como siempre', () => {
  const marcados = Object.entries(avisos.TIPOS).filter(([, def]) => def.reservado).map(([t]) => t);
  assert.deepEqual(marcados, ['ayuda_sin_entregar']);
});

/* ------------------------------------------------- lo que viaja */

test('del aviso de una ayuda va el título, y en vez del texto una frase sin datos', () => {
  const alTelefono = avisos.loQueVaAlTelefono({
    tipo: 'ayuda_sin_entregar',
    titulo: 'Una ayuda pedida sigue sin entregarse',
    cuerpo: `Mercadería para Carmen Salgado ${MARCA} (05-06-2026, hace 90 día(s), «Solicitada»).`,
  });
  assert.equal(alTelefono.titulo, 'Una ayuda pedida sigue sin entregarse',
    'el título dice el hecho y ése sí puede ir');
  assert.equal(alTelefono.cuerpo, avisos.EN_VEZ_DEL_TEXTO);
  assert.ok(!/Carmen Salgado/.test(alTelefono.cuerpo), 'el nombre no puede viajar');
  assert.ok(!/Mercadería/.test(alTelefono.cuerpo), 'ni el motivo');
});

test('a los demás avisos no se les toca el texto', () => {
  const alTelefono = avisos.loQueVaAlTelefono({
    tipo: 'credencial_por_vencer',
    titulo: 'Credencial 0012 por vencer',
    cuerpo: 'Le quedan 30 día(s).',
  });
  assert.equal(alTelefono.cuerpo, 'Le quedan 30 día(s).');
});

test('y de quién viene sigue yendo al principio del texto, no del título', () => {
  const alTelefono = avisos.loQueVaAlTelefono({
    tipo: 'mensaje',
    titulo: 'Reunión de oficiales',
    cuerpo: 'Se cambió a las 20:00.',
    de: 'Pastor Soto',
  });
  assert.equal(alTelefono.titulo, 'Reunión de oficiales', 'el título no se gasta en un nombre');
  assert.equal(alTelefono.cuerpo, 'Pastor Soto: Se cambió a las 20:00.');
});

test('un texto largo se sigue recortando a lo que se alcanza a leer', () => {
  const largo = 'Se cambió la reunión y hay varias cosas que contar. '.repeat(10);
  const alTelefono = avisos.loQueVaAlTelefono({ tipo: 'mensaje', titulo: 'Aviso', cuerpo: largo });
  assert.ok(alTelefono.cuerpo.length <= avisos.LARGO_EN_EL_TELEFONO + 1, 'no viaja de más');
  assert.ok(alTelefono.cuerpo.endsWith('…'), 'y se nota que sigue');
});

/* ------------------------------------------------- lo que queda en la campanita */

test('la constancia entera queda en la campanita: no se esconde nada', () => {
  /*
   * Esto es lo que distingue esta corrección de «sacarle el nombre al aviso»:
   * el texto completo tiene que seguir estando donde se entra con contraseña.
   */
  const quien = db.prepare(
    "INSERT INTO usuarios (nombre, rut, rol, activo, password) VALUES ('Quien Lleva Ayudas', ?, 'tesorero', 1, 'x')"
  ).run(`${String(process.gid || 5).slice(0, 1)}${String(process.pid).slice(-6)}-0`).lastInsertRowid;

  const texto = `Mercadería para Carmen Salgado ${MARCA} (05-06-2026, hace 90 día(s), «Solicitada»).`;
  const fila = avisos.crear({
    usuario_id: quien,
    tipo: 'ayuda_sin_entregar',
    clave: `ayudas_esperando:${MARCA}`,
    titulo: 'Una ayuda pedida sigue sin entregarse',
    cuerpo: texto,
    enlace: '#/m/ayudas_sociales',
  });
  assert.ok(fila, 'el aviso tiene que guardarse igual');
  assert.equal(fila.cuerpo, texto, 'entero, con el nombre y el motivo');

  const enLaCampanita = avisos.paraLaCampanita(quien, 20).ultimos;
  assert.equal(enLaCampanita.length, 1);
  assert.equal(enLaCampanita[0].cuerpo, texto, 'y entero también al abrir la campanita');
});

/* ------------------------------------------------- el camino de verdad */

test('el resumen del día pasa por acá y no arma el texto por su cuenta', () => {
  /*
   * La pasada del día tenía su propia línea armando el texto del empujón, y por
   * ahí se escapaba. Se comprueba leyendo el código: una prueba de choque solo
   * falla el día que alguien vuelve a escribir la línea, y esto falla siempre.
   */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'avisos', 'vigia.js'), 'utf8');
  assert.match(src, /avisos\.loQueVaAlTelefono\(empujables\[0\]\)/,
    'el resumen del día tiene que pedirle a avisos.js qué puede salir');
  assert.ok(!/paraElTelefono\(soloUno/.test(src),
    'y no volver a armarlo por su cuenta, que es como se escapó la primera vez');
});

test('el empujón de un aviso suelto también pasa por acá', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'avisos', 'avisos.js'), 'utf8');
  const desde = src.indexOf('function avisar(');
  assert.ok(desde > 0);
  const trozo = src.slice(desde);
  assert.match(trozo, /loQueVaAlTelefono\(\{ tipo, titulo, cuerpo, de \}\)/,
    'un aviso urgente sale por la misma puerta que el resumen del día');
});
