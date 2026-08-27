/**
 * Las hojas que no son «un título, un nombre y un párrafo».
 *
 * POR QUÉ IMPORTA. Un certificado se firma, se sella y se entrega: lo que
 * salió impreso no se corrige después. Y hasta ahora los ocho formatos que
 * traía el sistema tenían todos la misma forma, cuando dos de ellos no la
 * tienen en papel y nunca la tuvieron:
 *
 *   PRESENTACIÓN DE NIÑOS   dice cuándo nació el niño, quién lo presentó,
 *                           quiénes son sus padres y sus dos parejas de
 *                           padrinos.
 *   MATRIMONIO              nombra a los DOS cónyuges en una frase corrida.
 *
 * Lo que se cuida acá:
 *
 *   · Que no se emita a medias (punto 17.5). Un certificado de matrimonio a
 *     nombre de una sola persona, o uno de presentación sin los padres, es un
 *     papel entregado que hay que rehacer. La comprobación vive en el
 *     servidor, no en la pantalla.
 *   · Que al cambiar el tipo se suelten los datos del otro. Si alguien empieza
 *     un matrimonio, escribe al cónyuge y después lo cambia a membresía, ese
 *     nombre no puede quedar guardado esperando reaparecer.
 *   · Que la forma de la hoja quede escrita en el propio certificado: si no,
 *     cambiarle la disposición al formato cambiaría la forma de todos los que
 *     ya están firmados.
 *   · Que la actualización NO pise el formato que la iglesia ya editó.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { exigirBaseDescartable } = require('./aislada');
exigirBaseDescartable();

const { db } = require('../../server/db');
const certificados = require('../../server/modules/certificados');
const formatos = require('../../server/modules/formatos_certificado');
const {
  formatosDeCertificadoQueTraiaElSistema, hojasDePresentacionYMatrimonio,
} = require('../../server/migraciones');

const iglesia = db
  .prepare("INSERT INTO iglesias (nombre, codigo, estado, ciudad) VALUES ('De los papeles', 'IG-PP', 'Activa', 'Concepción')")
  .run().lastInsertRowid;

/* ── Las dos hojas quedan armadas al actualizar ────────────────────── */

formatosDeCertificadoQueTraiaElSistema();
hojasDePresentacionYMatrimonio();

const deLaIglesia = (nombre) => db.prepare('SELECT * FROM formatos_certificado WHERE nombre = ?').get(nombre);

test('la presentación de niños queda con su hoja, su versículo y su marco', () => {
  const f = deLaIglesia('Presentación de niños');
  assert.equal(f.disposicion, 'Presentación de niños');
  assert.equal(f.orientacion, 'Horizontal');
  assert.equal(f.epigrafe_cita, 'San Marcos 10:14');
  assert.match(f.epigrafe, /Dejad a los niños venir a mí/);
  assert.equal(f.firma_izquierda, 'Firma Pastor');
  assert.equal(f.firma_derecha, 'Timbre Iglesia');
  // El texto trae las fechas partidas, que es lo que hace la frase con espacios
  for (const dato of ['{nac_dia}', '{nac_mes}', '{nac_anio}', '{oficiante}', '{ev_dia}']) {
    assert.ok(f.texto.includes(dato), `falta ${dato} en el texto`);
  }
  assert.equal(f.grosor_marco, 7, 'la orla del original es gruesa');
});

test('el matrimonio nombra a los dos cónyuges y lleva su versículo al pie', () => {
  const f = deLaIglesia('Matrimonio');
  assert.equal(f.disposicion, 'Matrimonio');
  assert.equal(f.epigrafe_cita, 'Génesis 2:24');
  assert.ok(f.texto.includes('{titular}') && f.texto.includes('{conyuge}'),
    'la frase tiene que nombrar a los dos');
  assert.ok(f.texto_fecha.includes('{ciudad}'));
});

test('los demás formatos siguen siendo los de siempre', () => {
  const otros = db
    .prepare("SELECT nombre, disposicion FROM formatos_certificado WHERE nombre NOT IN ('Presentación de niños', 'Matrimonio')")
    .all();
  assert.equal(otros.length, 6);
  for (const f of otros) assert.equal(f.disposicion, 'Clásica', `${f.nombre} no debía cambiar`);
});

/* ── Emitir con la forma que corresponde ───────────────────────────── */

/** Pasa un certificado por su hook, como lo hace el motor. */
function emitir(datos, { existing = null } = {}) {
  const copia = { ...datos };
  const error = certificados.hooks.beforeSave(copia, { existing, db });
  return error ? { error } : { datos: copia };
}

const base = {
  numero: 'X-1', iglesia_id: iglesia, nombre_titular: 'Erick Kalem Solar Alfaro',
  fecha_emision: '2026-03-21', fecha_evento: '2026-03-21',
};

test('la forma de la hoja se copia del formato al certificado', () => {
  const r = emitir({ ...base, tipo: 'Presentación de niños', padre: 'José Luis Solar', madre: 'Camila Alfaro' });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.disposicion, 'Presentación de niños');
  // Si no quedara escrita acá, cambiarle la disposición al formato cambiaría
  // la forma de todos los certificados ya firmados y entregados
});

test('la ciudad se congela al emitir', () => {
  const r = emitir({ ...base, tipo: 'Membresía' });
  assert.equal(r.datos.ciudad, 'Concepción');
  assert.equal(r.datos.disposicion, 'Clásica');
});

test('NO SE EMITE A MEDIAS: un matrimonio sin el otro cónyuge se rechaza', () => {
  const r = emitir({ ...base, tipo: 'Matrimonio' });
  assert.match(String(r.error), /nombra a los dos cónyuges/);
});

test('ni una presentación sin ninguno de los padres', () => {
  const r = emitir({ ...base, tipo: 'Presentación de niños' });
  assert.match(String(r.error), /nombra a sus padres/);
});

test('con uno de los dos padres alcanza: hay niños con uno solo', () => {
  const r = emitir({ ...base, tipo: 'Presentación de niños', madre: 'Camila Alfaro' });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.madre, 'Camila Alfaro');
});

test('un niño no se presenta antes de nacer', () => {
  const r = emitir({
    ...base, tipo: 'Presentación de niños', padre: 'José Luis Solar',
    fecha_nacimiento: '2026-05-01', fecha_evento: '2026-03-21',
  });
  assert.match(String(r.error), /no puede ser posterior/);
});

test('cambiar el tipo suelta los datos que ya no son de esa hoja', () => {
  /*
   * Alguien empieza un certificado de matrimonio, escribe al cónyuge, y
   * después se da cuenta de que era uno de membresía. Ese nombre no puede
   * quedar guardado: no significa nada en la hoja nueva, y reaparece el día
   * que alguien vuelva a cambiarle el tipo.
   */
  const antes = { ...base, tipo: 'Matrimonio', conyuge: 'María Fernanda Rojas', disposicion: 'Matrimonio' };
  const r = emitir({ tipo: 'Membresía' }, { existing: antes });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.conyuge, null, 'el cónyuge de un certificado que ya no es de matrimonio');
  assert.equal(r.datos.disposicion, 'Clásica');
});

test('y al revés: el padrino no sobrevive a un cambio a matrimonio', () => {
  const antes = {
    ...base, tipo: 'Presentación de niños', disposicion: 'Presentación de niños',
    padre: 'José Luis Solar', madre: 'Camila Alfaro', padrino_1: 'Dangelo Reyes',
  };
  const r = emitir({ tipo: 'Matrimonio', conyuge: 'María Fernanda Rojas' }, { existing: antes });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.padrino_1, null);
  assert.equal(r.datos.padre, null);
  assert.equal(r.datos.conyuge, 'María Fernanda Rojas');
});

test('un tipo cuyo formato ya no existe cae a la hoja clásica, no revienta', () => {
  const r = emitir({ ...base, tipo: 'Un tipo que se borró' });
  assert.equal(r.error, undefined, String(r.error));
  assert.equal(r.datos.disposicion, 'Clásica');
});

/* ── El formato se guarda con lo que se puede imprimir ─────────────── */

test('una disposición inventada cae a la clásica', () => {
  const datos = { nombre: 'Inventado', disposicion: 'Con orla de flores' };
  const error = formatos.hooks.beforeSave(datos, { existing: null });
  assert.equal(error, null, String(error));
  assert.equal(datos.disposicion, 'Clásica');
});

test('el grosor del marco se acota: 400 px de borde no dejan hoja', () => {
  const datos = { nombre: 'Grueso', disposicion: 'Clásica', grosor_marco: 400 };
  formatos.hooks.beforeSave(datos, { existing: null });
  assert.equal(datos.grosor_marco, 12);

  const vacio = { nombre: 'Sin decir', disposicion: 'Clásica', grosor_marco: '' };
  formatos.hooks.beforeSave(vacio, { existing: null });
  assert.equal(vacio.grosor_marco, 3, 'en blanco es el de fábrica, no cero');
});

/* ── La actualización respeta lo que la iglesia ya editó ───────────── */

test('un formato con el texto ya cambiado NO se pisa al actualizar', () => {
  /*
   * Cambiar un formato cambia cómo se imprimen TAMBIÉN los certificados ya
   * emitidos. Una actualización no puede pasar por encima de una decisión que
   * la iglesia tomó.
   */
  db.prepare("DELETE FROM migraciones WHERE nombre = 'hojas de presentación y matrimonio'").run();
  db.prepare(
    `UPDATE formatos_certificado
        SET texto = 'Este texto lo escribió la iglesia y es suyo.', disposicion = 'Clásica',
            epigrafe = NULL, epigrafe_cita = NULL
      WHERE nombre = 'Matrimonio'`
  ).run();
  db.prepare(
    `UPDATE formatos_certificado
        SET texto = 'Certifica que fue presentado(a) al Señor el día {fecha_evento}, en {iglesia}, conforme a la enseñanza de las Sagradas Escrituras.',
            disposicion = 'Clásica', epigrafe = NULL, epigrafe_cita = NULL
      WHERE nombre = 'Presentación de niños'`
  ).run();

  hojasDePresentacionYMatrimonio();

  const editado = deLaIglesia('Matrimonio');
  assert.equal(editado.disposicion, 'Clásica', 'el que la iglesia editó se queda como está');
  assert.equal(editado.texto, 'Este texto lo escribió la iglesia y es suyo.');

  const intacto = deLaIglesia('Presentación de niños');
  assert.equal(intacto.disposicion, 'Presentación de niños', 'el que seguía como vino sí se arma');
});
