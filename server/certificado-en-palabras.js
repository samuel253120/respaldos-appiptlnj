/**
 * Lo que dice un certificado, con sus datos ya puestos.
 *
 * El texto de un certificado viene con los datos entre llaves —«…el día
 * {fecha_evento}, en {iglesia}»— y hay que rellenarlos para poder leerlo. Eso
 * lo hacía SOLO el navegador, al armar la hoja de impresión, y mientras el
 * certificado únicamente se imprimía desde la pantalla alcanzaba.
 *
 * Desde la v1.301.0 hay una segunda manera de sacarlo del sistema —el PDF de la
 * constancia— y entonces son dos lugares que rellenan lo mismo. Es exactamente
 * el problema que dejó el libro de partes en la v1.291.0 con las palabras de su
 * cierre: dos redacciones separadas dicen cosas distintas el día que una
 * cambia. Acá se resuelve igual — la tabla de qué significa cada llave se
 * escribe una vez— con una diferencia que conviene decir de frente: el
 * navegador NO puede pedirle esta función al servidor, así que su copia sigue
 * viviendo en public/app.js (`certDatos`).
 *
 * LO QUE ATA LAS DOS COPIAS es una prueba que compara las dos listas de llaves
 * y falla si una tiene alguna que la otra no (pruebas/motor/el-certificado-en-
 * pdf.test.js). Es la misma manera con que se atan las medidas del papel, que
 * también viven en los dos lados por la misma razón.
 */
const formato = require('./formato');

/** Los meses como los escriben estas hojas: en mayúsculas y sin abreviar. */
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** Una fecha partida en día, mes y año, que es lo que pide la frase con espacios. */
function enPartes(iso) {
  const t = String(iso || '').slice(0, 10);
  const [a, m, d] = t.split('-');
  return Number(a) && Number(m) && Number(d)
    ? { dia: d, mes: MESES[Number(m) - 1] || '', anio: a }
    : { dia: '', mes: '', anio: '' };
}

/**
 * Qué vale cada llave, para este certificado.
 *
 * `iglesia` e `institucion` se reciben ya resueltos: el nombre de la iglesia
 * local sale de su ficha y el de la institución de la configuración, y las dos
 * cosas las sabe quien llama.
 */
function losDatos(fila, { iglesia = '', institucion = '', oficiante = '' } = {}) {
  const nace = enPartes(fila.fecha_nacimiento);
  const evento = enPartes(fila.fecha_evento);
  const emite = enPartes(fila.fecha_emision);

  return {
    titular: fila.nombre_titular || '',
    conyuge: fila.conyuge || '',
    padre: fila.padre || '',
    madre: fila.madre || '',
    tipo: fila.tipo || '',
    numero: fila.numero || '',
    iglesia,
    institucion,
    ciudad: fila.ciudad || '',
    fecha_nacimiento: fila.fecha_nacimiento ? formato.fechaLarga(fila.fecha_nacimiento) : '',
    fecha_evento: fila.fecha_evento ? formato.fechaLarga(fila.fecha_evento) : '',
    fecha_emision: fila.fecha_emision ? formato.fechaLarga(fila.fecha_emision) : '',
    nac_dia: nace.dia, nac_mes: nace.mes, nac_anio: nace.anio,
    ev_dia: evento.dia, ev_mes: evento.mes, ev_anio: evento.anio,
    em_dia: emite.dia, em_mes: emite.mes, em_anio: emite.anio,
    oficiante,
    rut: fila.rut ? String(fila.rut) : '',
  };
}

/**
 * El texto con sus llaves rellenadas.
 *
 * La llave que no conoce se deja tal cual —«{loquesea}»— y no se borra: si
 * alguien escribió un dato que no existe, la hoja tiene que mostrarlo para que
 * se note, en vez de tragárselo y dejar la frase coja sin decir por qué.
 */
function rellenar(texto, datos) {
  if (!texto) return '';
  return String(texto).replace(/\{(\w+)\}/g, (entero, clave) =>
    (Object.prototype.hasOwnProperty.call(datos, clave) ? datos[clave] : entero));
}

/** Las llaves que este módulo sabe rellenar. */
function lasLlaves() {
  return Object.keys(losDatos({}, {}));
}

module.exports = { MESES, enPartes, losDatos, rellenar, lasLlaves };
