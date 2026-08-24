/**
 * La verificación pública de una credencial: qué se contesta y qué no.
 *
 * Alguien escanea el código QR de una credencial impresa y llega a
 * `/v/<serie>?c=<codigo>` sin tener cuenta en el sistema. Este archivo decide
 * dos cosas: si esa credencial es de verdad, y qué se puede mostrar de ella.
 *
 * DOS REGLAS QUE MANDAN SOBRE TODO LO DEMÁS
 *
 * 1 · SIN CÓDIGO CORRECTO NO SE MUESTRA NADA (punto 9.2). Ni el nombre, ni si
 *     esa serie existe, ni por qué falló. Da exactamente la misma respuesta un
 *     número inventado que un número real con el código cambiado. Si dijera
 *     «esa serie no existe» frente a «el código no calza», bastaría con probar
 *     números para averiguar qué credenciales hay emitidas.
 *
 * 2 · EL RUT NO SALE ENTERO (punto 9.4). Esta página la abre cualquiera con un
 *     teléfono; el RUT completo de un pastor no tiene por qué quedar expuesto.
 *     Van los últimos tres dígitos y el verificador, que es lo justo para
 *     comparar con la tarjeta que se tiene en la mano.
 *
 * Lo que sí se dice sin reservas es el ESTADO, y al día: una credencial
 * revocada esta mañana aparece revocada esta tarde (punto 10.6). Ese es todo
 * el sentido de que el QR lleve una dirección en vez de los datos adentro.
 */
const codigo = require('./codigo');
const serie = require('./serie');
const qr = require('./qr');
const rut = require('../rut');

/** El texto que va al pie, siempre igual (punto 9.3). */
const LEYENDA =
  'Datos oficiales de la Iglesia Pentecostal Triunfante La Nueva Jerusalén. ' +
  'Personalidad Jurídica 7217.';

/** Los colores de cada estado, para la página (punto 9.3). */
const COLORES = {
  Vigente: 'verde',
  'Por vencer': 'amarillo',
  Vencida: 'gris',
  Revocada: 'rojo',
  Reemplazada: 'gris',
  Borrador: 'gris',
};

/**
 * El RUT con casi todo tapado: «12.345.678-5» queda en «••.•••.678-5».
 *
 * Se conserva la forma de un RUT chileno —con sus puntos y su guion— para que
 * quien compara reconozca de inmediato dónde mirar, pero de los dígitos solo
 * se ven los tres últimos y el verificador.
 */
function rutTapado(valor) {
  const limpio = rut.limpiar(valor);
  if (limpio.length < 2) return '';
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const visibles = cuerpo.slice(-3);
  const tapados = '•'.repeat(Math.max(0, cuerpo.length - visibles.length));
  /**
   * Y se puntúa igual que un RUT: los puntos caen donde caerían.
   *
   * Se agrupa de a tres contando desde el final. No sirve el `\B` de la
   * función que formatea un RUT normal: acá la mitad de los caracteres son
   * bolitas, y entre una bolita y un dígito el navegador ve un límite de
   * palabra, así que justo ahí —donde va el punto que más se nota— no lo
   * ponía. Salía «••.•••678-5» en vez de «••.•••.678-5».
   */
  return `${(tapados + visibles).replace(/(.)(?=(.{3})+$)/g, '$1.')}-${dv}`;
}

/**
 * De «0012026-1» a las dos partes con que se busca en la base.
 *
 * Se acepta también sin el dígito verificador, porque alguien puede escribir
 * la dirección a mano mirando la tarjeta y saltárselo.
 */
function partirSerie(texto) {
  const limpio = String(texto || '').trim().toUpperCase().replace(/[^0-9-]/g, '');
  const [numero, dv] = limpio.split('-');
  if (!numero) return null;
  return { numero, dv: dv || null };
}

/**
 * ¿Es de verdad esta credencial? Y si lo es, ¿qué se muestra?
 *
 * Devuelve siempre la misma forma de respuesta cuando algo falla, sea cual sea
 * el motivo: `{ valida: false }`. Quien llame no tiene con qué distinguir un
 * número que no existe de un código equivocado, y esa es la idea.
 *
 * `buscar` es la función que trae la fila de la base, y `situacionDe` la que
 * dice en qué está. Se reciben de fuera para que este archivo se pueda probar
 * solo, sin base de datos ni servidor.
 */
function verificar(serieDeLaUrl, codigoDeLaUrl, { buscar, situacionDe }) {
  const partes = partirSerie(serieDeLaUrl);
  if (!partes) return { valida: false };

  const fila = buscar(partes.numero);
  if (!fila || !fila.serie) return { valida: false };

  // El dígito verificador, cuando viene, también tiene que calzar
  if (partes.dv && String(fila.serie_dv || '') !== partes.dv) return { valida: false };

  // Un borrador no es una credencial: no salió en papel y no tiene número
  if ((fila.estado || 'Borrador') === 'Borrador') return { valida: false };

  // Y el sello: acá es donde se cae quien inventó el número
  if (!codigo.corresponde(qr.datosQueSeFirman(fila), codigoDeLaUrl)) return { valida: false };

  const situacion = situacionDe(fila);
  return {
    valida: true,
    situacion,
    color: COLORES[situacion] || 'gris',
    /**
     * Una credencial revocada, vencida o reemplazada SE MUESTRA, con su estado
     * bien grande. No se esconde: quien la está verificando necesita saber que
     * la tarjeta que tiene delante existió y ya no vale, que es distinto de
     * que sea falsa.
     */
    sirve: situacion === 'Vigente' || situacion === 'Por vencer',
    datos: {
      nombres: fila.snap_nombres || '',
      apellidos: fila.snap_apellidos || '',
      grado: fila.snap_grado || '',
      cargo: fila.snap_funcion || '',
      categoria: fila.snap_categoria || '',
      iglesia: fila.snap_iglesia || '',
      comuna: fila.snap_comuna || '',
      rut_tapado: rutTapado(fila.snap_rut),
      serie: serie.conDigito(fila.serie, fila.serie_dv),
      emitida: fila.fecha_emision || '',
      vence: fila.fecha_vencimiento || '',
      motivo_revocacion: situacion === 'Revocada' ? fila.motivo_revocacion || '' : '',
      hay_foto: !!fila.snap_foto,
    },
    /** El archivo de la foto no viaja en los datos: se pide aparte y con código. */
    foto: fila.snap_foto || null,
  };
}

module.exports = { verificar, rutTapado, partirSerie, LEYENDA, COLORES };
