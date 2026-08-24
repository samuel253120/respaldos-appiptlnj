/**
 * El código QR de la credencial: qué lleva adentro y de qué tamaño sale.
 *
 * El QR es lo que permite comprobar una credencial sin llamar por teléfono a
 * la oficina. Tiene dos modos, que se eligen en Configuración (punto 8.2):
 *
 *   EN LÍNEA .......  lleva una dirección corta que abre la página de
 *                     verificación de este sistema. Es el recomendado: muestra
 *                     el estado AL DÍA, así que una credencial revocada
 *                     aparece como revocada en el momento.
 *   SIN CONEXIÓN ...  lleva los datos del titular escritos adentro, para
 *                     verificar donde no hay internet. A cambio, el código no
 *                     puede saber si la credencial se revocó después de
 *                     imprimirse: dice lo que decía el día que se imprimió.
 *
 * EL TAMAÑO NO ES NEGOCIABLE
 *
 * El recuadro mide 12,2 mm y cada módulo —cada cuadradito— tiene que medir
 * 0,25 mm o más, o un teléfono no lo lee impreso. Eso da 41 módulos como
 * máximo. Cuando el contenido no cabe, NO se achica el recuadro ni se bajan
 * los módulos: se acorta el contenido por niveles (punto 8.6). El modo en
 * línea casi nunca lo necesita, por ser corto.
 *
 * El recuadro no se llena hasta el borde: tiene un relleno de 0,25 mm por
 * lado, así que el código dispone de 11,7 mm y no de 12,2. Parece un detalle
 * y no lo es: contar los 12,2 completos da un módulo un 4 % más grande del
 * que sale impreso, y ese 4 % es justo el margen con el que se decide si un
 * código pasa o no pasa el mínimo. Se descuenta.
 *
 * Y SIN LOS DATOS COMPLETOS NO HAY QR
 *
 * Una credencial a medio llenar que igual llevara un código parecería
 * verificada, que es lo contrario de lo que hace el QR. En su lugar va el
 * recuadro rayado con «DATOS INCOMPLETOS» (punto 8.4).
 */
const QRGen = require('./qrgen');
const codigo = require('./codigo');
const datos = require('./datos');
const serie = require('./serie');

/**
 * El recuadro del QR, tal como lo pinta la hoja de estilos.
 *
 * Estos dos números son los mismos que están en `.qr-holder`, en
 * public/credencial.css. Si allá cambian, acá tienen que cambiar: la prueba
 * pruebas/credencial-impresa.js mide el código sobre el papel y avisa si los
 * dos lados dejaron de decir lo mismo.
 */
const RECUADRO_MM = 12.2;
const RELLENO_MM = 0.25;
/** Lo que le queda al código después del relleno: 11,7 mm. */
const LADO_UTIL_MM = RECUADRO_MM - RELLENO_MM * 2;
/** Lo que mide un módulo como mínimo para que un teléfono lo lea impreso. */
const MINIMO_POR_MODULO_MM = 0.25;
/**
 * El máximo de módulos que caben conservando 0,25 mm cada uno.
 *
 * En los 11,7 mm útiles entrarían 46 módulos con zona de silencio incluida
 * —42 de código—, pero se deja en 41: un código más chico se lee de más lejos
 * y con peor luz, que es como se leen las credenciales de verdad.
 */
const MAX_MODULOS = 41;
/** Nivel de corrección de errores y zona de silencio (punto 8.7). */
const CORRECCION = 'M';
const SILENCIO = 2;
/** La personalidad jurídica va dentro del código, como marca de la institución. */
const PERSONALIDAD_JURIDICA = '7217';

/**
 * Sin tildes ni eñes, en mayúsculas.
 *
 * Cada carácter acentuado ocupa el doble dentro del código y lo agranda,
 * reduciendo el tamaño de cada módulo al imprimir. Es la misma limpieza que
 * hace el archivo de diseño.
 */
function limpiar(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * De una fecha del sistema a los cuatro dígitos de la vigencia: «2026-03-15»
 * pasa a «0326» (mes y año).
 *
 * El archivo de diseño interpretaba fechas escritas a mano en cualquier
 * formato, porque ahí se escribían a mano. Acá vienen de un campo de fecha,
 * siempre en el mismo formato, así que se convierten sin adivinar nada.
 */
function mesYAnio(iso) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso || ''));
  return m ? `${m[2]}${m[1].slice(2)}` : '';
}

/** «Juan Carlos» pasa a «J.C.» */
const iniciales = (nombres) =>
  limpiar(nombres).split(' ').filter(Boolean).map((n) => `${n[0]}.`).join('');

/** Recorta por palabras completas, sin cortar una a la mitad. */
function recorta(s, max) {
  if (s.length <= max) return s;
  let salida = '';
  for (const palabra of s.split(' ')) {
    if (`${salida} ${palabra}`.trim().length > max) break;
    salida = `${salida} ${palabra}`.trim();
  }
  return salida || s.slice(0, max);
}

/**
 * El contenido del QR en modo sin conexión, con el nivel de acortado pedido.
 *
 *   nivel 0 · completo
 *   nivel 1 · nombres en iniciales y grado abreviado
 *   nivel 2 · además recorta apellidos a 26 y el nombre de la iglesia a 20
 */
function sinConexion(fila, nivel) {
  const apellidos = limpiar(fila.snap_apellidos);
  const nombres = nivel >= 1 ? iniciales(fila.snap_nombres) : limpiar(fila.snap_nombres);
  let persona = `${apellidos} ${nombres}`.trim();

  let grado = limpiar(fila.snap_grado);
  if (nivel >= 1) grado = grado.replace(/^PASTOR\s+/, 'P.').replace(/^GUIA\s+DE\s+OBRA$/, 'G.OBRA');

  let iglesia = `${limpiar(fila.snap_categoria)} ${limpiar(fila.snap_iglesia)}`.trim();
  if (nivel >= 2) {
    persona = recorta(persona, 26);
    iglesia = recorta(iglesia, 20);
  }

  const rut = limpiar(fila.snap_rut).replace(/[^0-9K]/g, '');
  const numero = serie.conDigito(fila.serie, fila.serie_dv);
  const vigencia = `${mesYAnio(fila.fecha_emision)}-${mesYAnio(fila.fecha_vencimiento)}`;

  const base = `${persona}|${grado}|${rut}|${iglesia}|${numero}|${vigencia}|${PERSONALIDAD_JURIDICA}`;
  return `${base}|C:${codigo.firmar(base)}`;
}

/**
 * El contenido en modo en línea: la dirección de verificación.
 *
 * Ojo con una cosa que no es evidente: los dos modos firman cadenas DISTINTAS,
 * y tiene que ser así.
 *
 *   sin conexión .. quien verifica solo tiene lo que hay dentro del QR, así
 *                   que el código firma exactamente ese contenido —acortado y
 *                   todo—. Si firmara otra cosa, no habría con qué comprobarlo.
 *   en línea ...... quien verifica es el servidor, que tiene la ficha entera,
 *                   así que el código firma los datos completos sin acortar.
 *
 * En consecuencia, cambiar el modo en Configuración no invalida las
 * credenciales ya impresas —cada una se verifica como se imprimió—, pero el
 * código impreso en una y en otra no es el mismo número.
 */
function enLinea(fila, dominio) {
  const numero = serie.conDigito(fila.serie, fila.serie_dv);
  return `${dominio || ''}/v/${encodeURIComponent(numero)}?c=${queCodigoLeToca(fila)}`;
}

/**
 * El código de autenticidad para la verificación en línea.
 *
 * Firma los datos completos, sin acortar: el servidor los tiene todos, así que
 * no hay razón para verificar contra una versión recortada. El acortado es
 * cosa del tamaño impreso, no de qué credencial es esta.
 */
function queCodigoLeToca(fila) {
  const apellidos = limpiar(fila.snap_apellidos);
  const nombres = limpiar(fila.snap_nombres);
  const grado = limpiar(fila.snap_grado);
  const iglesia = `${limpiar(fila.snap_categoria)} ${limpiar(fila.snap_iglesia)}`.trim();
  const rut = limpiar(fila.snap_rut).replace(/[^0-9K]/g, '');
  const numero = serie.conDigito(fila.serie, fila.serie_dv);
  const vigencia = `${mesYAnio(fila.fecha_emision)}-${mesYAnio(fila.fecha_vencimiento)}`;
  return codigo.firmar(`${apellidos} ${nombres}|${grado}|${rut}|${iglesia}|${numero}|${vigencia}|${PERSONALIDAD_JURIDICA}`);
}

/**
 * El QR de una credencial, listo para dibujar.
 *
 * Devuelve el trazo del código y de qué tamaño quedó, o el motivo por el que
 * no se puede generar. Nunca devuelve un código a medias.
 */
function para(fila, { modo, dominio } = {}) {
  const falta = datos.loQueFalta(fila);
  if (!fila.serie) falta.push('el número de serie');
  if (falta.length) return { hay: false, falta };

  const enLineaDeVerdad = (modo || 'linea') === 'linea';
  let texto = enLineaDeVerdad ? enLinea(fila, dominio) : sinConexion(fila, 0);
  let dibujo = QRGen.svgPath(texto, CORRECCION, SILENCIO);
  let nivel = 0;

  // Si no cabe conservando 0,25 mm por módulo, se acorta el contenido —nunca
  // el recuadro— hasta que quepa (puntos 8.5 y 8.6)
  if (!enLineaDeVerdad) {
    for (let n = 1; n <= 2 && dibujo.size - SILENCIO * 2 > MAX_MODULOS; n++) {
      const otro = sinConexion(fila, n);
      const suyo = QRGen.svgPath(otro, CORRECCION, SILENCIO);
      if (suyo.size < dibujo.size) { texto = otro; dibujo = suyo; nivel = n; }
    }
  }

  const modulos = dibujo.size - SILENCIO * 2;
  /**
   * Y si ni acortando cabe, no se imprime ningún código.
   *
   * Con los recortes del nivel 2 el contenido queda acotado y esto no debería
   * pasar nunca; el único dato que no tiene tope propio es el grado. Pero un
   * código de más de 41 módulos sale con los cuadraditos por debajo de los
   * 0,25 mm y NO SE LEE impreso, y un código que no se lee es peor que no
   * tener código: parece verificable y no lo es. El punto 17.2 no admite
   * excepciones, así que acá se prefiere el recuadro rayado y decir por qué.
   */
  if (modulos > MAX_MODULOS) {
    return {
      hay: false,
      falta: [
        `acortar los datos: el código saldría de ${modulos} cuadraditos y no se leería impreso ` +
        `(el máximo es ${MAX_MODULOS}). Revise que el grado y el nombre de la iglesia no sean desmedidos`,
      ],
    };
  }
  return {
    hay: true,
    texto,
    nivel,
    modulos,
    // Los 11,7 mm útiles repartidos entre todos los módulos, zona de silencio
    // incluida: es la medida que hay que poder comprobar sobre el papel
    mm_por_modulo: Number((LADO_UTIL_MM / dibujo.size).toFixed(4)),
    size: dibujo.size,
    path: dibujo.path,
    codigo: queCodigoLeToca(fila),
  };
}

module.exports = {
  para, sinConexion, enLinea, queCodigoLeToca, limpiar, mesYAnio, iniciales, recorta,
  MAX_MODULOS, CORRECCION, SILENCIO, PERSONALIDAD_JURIDICA,
  RECUADRO_MM, RELLENO_MM, LADO_UTIL_MM, MINIMO_POR_MODULO_MM,
};
