/**
 * Los archivos grandes del sistema, apretados de verdad.
 *
 * El programa de la pantalla (app.js) pesa cerca de medio mega y la hoja de
 * estilos pasa los cien kilos. Van comprimidos —eso ya estaba— pero se
 * comprimen de nuevo en cada pedido, y por eso se comprimen «rápido y flojo»:
 * apretar bien cuesta casi un segundo de trabajo, y nadie puede pagar eso en
 * cada visita.
 *
 * Solo que estos archivos NO cambian entre un pedido y otro: son los mismos
 * hasta que se publique una versión nueva. Así que acá se aprietan UNA VEZ,
 * con la fuerza máxima, y esa copia queda guardada en memoria para todos. La
 * diferencia no es poca:
 *
 *     app.js       135 KB  ->  110 KB
 *     styles.css    27 KB  ->   22 KB
 *
 * Treinta kilos menos en cada primera visita, que con señal de teléfono en un
 * templo alejado son varios segundos de diferencia.
 *
 * El apretado se hace al arrancar, en segundo plano y sin frenar nada: mientras
 * no esté listo, el pedido sigue de largo y lo atiende el reparto de siempre,
 * comprimiendo al vuelo como hasta ahora. O sea que nadie espera nunca a que
 * esto termine; cuando termina, simplemente empieza a llegar más liviano.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** Qué vale la pena apretar así: texto, y de los que pesan. */
const EXTENSIONES = new Set(['.js', '.css']);
const DESDE = 8 * 1024;
/**
 * El ayudante de los avisos queda fuera a propósito: pesa nueve kilos —lo que
 * se ganaría no se nota— y es el único que se pide sin versión en la dirección,
 * así que es el que más conviene dejar por el camino de siempre.
 */
const FUERA = new Set(['avisos-sw.js']);

/** Lo apretado, por ruta: { largo, apretado, etiqueta, cuando } */
const GUARDADOS = new Map();

/** Fuerza máxima. Se paga una vez, no en cada pedido. */
const aPretar = (datos) =>
  new Promise((listo, falla) => {
    zlib.brotliCompress(
      datos,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: datos.length,
        },
      },
      (err, salida) => (err ? falla(err) : listo(salida))
    );
  });

/** Los archivos de una carpeta que corresponde apretar. */
function cualesApretar(carpeta) {
  let nombres;
  try {
    nombres = fs.readdirSync(carpeta);
  } catch (e) {
    return [];
  }
  return nombres.filter((nombre) => {
    if (FUERA.has(nombre)) return false;
    if (!EXTENSIONES.has(path.extname(nombre).toLowerCase())) return false;
    let ficha;
    try {
      ficha = fs.statSync(path.join(carpeta, nombre));
    } catch (e) {
      return false;
    }
    return ficha.isFile() && ficha.size >= DESDE;
  });
}

/**
 * Aprieta en segundo plano lo que haya que apretar.
 *
 * De a uno y con un respiro entre medio: el trabajo es pesado y no tiene
 * ninguna prisa, así que no se le quita el turno a quien esté entrando al
 * sistema en ese mismo momento.
 */
async function prepararApretados(carpeta) {
  for (const nombre of cualesApretar(carpeta)) {
    const ruta = path.join(carpeta, nombre);
    try {
      const ficha = fs.statSync(ruta);
      const datos = fs.readFileSync(ruta);
      const apretado = await aPretar(datos);
      GUARDADOS.set(`/${nombre}`, {
        largo: apretado.length,
        apretado,
        // La etiqueta es la del contenido apretado: no es la misma respuesta
        // que la sin apretar, así que no puede llevar la misma etiqueta.
        etiqueta: `W/"br-${ficha.size.toString(16)}-${ficha.mtimeMs.toString(16)}"`,
        cuando: ficha.mtime.toUTCString(),
        marca: `${ficha.size}-${ficha.mtimeMs}`,
      });
    } catch (e) {
      // Si uno falla, se sigue con los demás: lo peor que pasa es que ese
      // archivo se siga mandando como hasta ahora.
      console.error(`No se pudo apretar ${nombre}:`, e.message);
    }
  }
}

/**
 * El reparto de lo ya apretado.
 *
 * Se pone ANTES del reparto normal de archivos. Si tiene la copia lista y quien
 * pide entiende brotli, la manda; si no, deja pasar el pedido y lo atiende el
 * de siempre. `ponerCabeceras` es la MISMA función que usa el reparto normal,
 * para que las reglas de guardado en el navegador no se digan en dos partes y
 * se contradigan.
 */
function servidorApretado(carpeta, ponerCabeceras) {
  return function apretados(req, res, siguiente) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return siguiente();

    let ruta;
    try {
      ruta = decodeURIComponent(req.path);
    } catch (e) {
      return siguiente(); // dirección mal escrita: que la conteste el de siempre
    }
    const guardado = GUARDADOS.get(ruta);
    if (!guardado) return siguiente();

    // Si el archivo cambió después de haberlo apretado —solo pasa mientras se
    // programa—, la copia guardada ya no sirve.
    try {
      const ficha = fs.statSync(path.join(carpeta, path.basename(ruta)));
      if (`${ficha.size}-${ficha.mtimeMs}` !== guardado.marca) {
        GUARDADOS.delete(ruta);
        return siguiente();
      }
    } catch (e) {
      GUARDADOS.delete(ruta);
      return siguiente();
    }

    // Quien no entienda brotli recibe lo de siempre
    const acepta = String(req.headers['accept-encoding'] || '');
    if (!/\bbr\b/i.test(acepta)) return siguiente();

    res.setHeader('Content-Type', ruta.endsWith('.css') ? 'text/css; charset=UTF-8' : 'text/javascript; charset=UTF-8');
    // Sin esto, un intermediario podría guardar la copia apretada y dársela a
    // quien no entiende brotli.
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', guardado.etiqueta);
    res.setHeader('Last-Modified', guardado.cuando);
    ponerCabeceras(res, path.join(carpeta, path.basename(ruta)));

    // Si el navegador ya lo tiene y solo está preguntando, se le dice que sigue
    // igual y no se manda nada.
    const tiene = req.headers['if-none-match'];
    if (tiene && tiene.split(',').some((x) => x.trim() === guardado.etiqueta)) {
      return res.status(304).end();
    }

    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Content-Length', String(guardado.largo));
    if (req.method === 'HEAD') return res.end();
    return res.end(guardado.apretado);
  };
}

module.exports = { prepararApretados, servidorApretado, GUARDADOS };
