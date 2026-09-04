/**
 * Importación masiva de datos.
 *
 * POST /api/importar/:modulo   { filas: [ {campo: valor, ...} ], prueba: true|false }
 *
 * - `prueba: true` valida todo y NO guarda nada (revisión previa).
 * - Devuelve cuántas filas quedarían bien y el detalle de los errores por fila.
 *
 * Lo que entra por acá pasa por lo mismo que lo que se escribe a mano: los
 * campos obligatorios, el RUT, los duplicados, los rangos de las fechas, los
 * topes de los montos, EL ALCANCE —la iglesia de la fila, aquello a lo que
 * apunta y el nivel de tesorería—, las reglas propias del módulo, lo que el
 * módulo hace después de guardar —las cuentas de un cuerpo, la ofrenda de un
 * servicio— y el rastro en el historial. Durante un tiempo no fue así, y por
 * acá entraban cosas que el formulario ya no dejaba entrar.
 *
 * Comodidades pensadas para archivos exportados de otros sistemas:
 * - Los campos de relación (iglesia, cuerpo, miembro…) aceptan el NOMBRE en
 *   vez del número interno: "Iglesia Central" en lugar de 3.
 * - Los campos de varias relaciones aceptan valores separados por | o ;
 * - Los campos Sí/No aceptan sí, si, no, 1, 0, true, false, x.
 * - Las fechas aceptan dd/mm/aaaa además de aaaa-mm-dd.
 * - El RUT se valida y normaliza igual que en los formularios.
 */
const express = require('express');
const { db } = require('./db');
const { getModule, displayOf } = require('./registry');
const { authRequired, requirePerm } = require('./auth');
const {
  coerce, aplicarDefectos, sincronizarPersonas, aplicarCalculos, revisarLimites, dondeEsUnico,
  buscarDuplicado, avisoDeDuplicado, referenciasFueraDeAlcance, seAplica,
} = require('./crud');
const rut = require('./rut');
const bitacora = require('./bitacora');
const sensibles = require('./sensibles');

const MAX_FILAS = 5000;

/** Convierte fechas dd/mm/aaaa (o dd-mm-aaaa) al formato aaaa-mm-dd. */
function normalizarFecha(valor) {
  const v = String(valor).trim();
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return v.slice(0, 10);
  const [, d, mes, a] = m;
  return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Lee un número escrito como se acostumbra en Chile o en inglés:
 * "1.250.500" → 1250500 · "45.990,50" → 45990.5 · "1234.56" → 1234.56
 * Devuelve null si no es un número.
 */
function normalizarNumero(valor) {
  let s = String(valor).replace(/[\s$]/g, '');
  if (!s) return null;
  const punto = s.lastIndexOf('.');
  const coma = s.lastIndexOf(',');

  if (punto !== -1 && coma !== -1) {
    // El separador que aparece más a la derecha es el decimal
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma !== -1) {
    s = s.replace(',', '.'); // coma decimal (uso chileno)
  } else if (punto !== -1) {
    const partes = s.split('.');
    // Varios puntos, o grupo final de 3 dígitos → separador de miles
    if (partes.length > 2 || partes[partes.length - 1].length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * EL NOMBRE ESCRITO EN LA PLANILLA, LLEVADO AL REGISTRO QUE NOMBRA.
 *
 * Es la comodidad que este archivo anuncia primero —«los campos de relación
 * aceptan el NOMBRE en vez del número interno»— y estaba resuelta de la peor
 * manera posible: trayendo la tabla entera desde la base y recorriéndola en
 * memoria UNA VEZ POR CADA CELDA, con un tope de cinco mil filas. Las dos
 * mitades de esa frase eran un problema distinto, y las dos se midieron en la
 * v1.384.0 sobre una base con 5.601 miembros:
 *
 *   · **El tope mentía.** El 5.000.º miembro de la tabla entraba por su nombre
 *     y el 5.001.º contestaba «no se encontró "Miembro4399 Grande4399" en
 *     Miembros», siendo que estaba ahí y que por su número entraba. No
 *     dependía de la persona sino del orden en que fue inscrita, así que el
 *     día que la membresía pasara de cinco mil las planillas iban a empezar a
 *     rechazar gente de a poco —los últimos inscritos primero— con un mensaje
 *     que invita a corregir el archivo, que es lo único que no estaba mal.
 *
 *   · **Y costaba 165 veces más.** Las mismas 500 filas: por número 202 ms,
 *     por nombre 33.401 ms —67 ms por celda—. Llevado al tope de cinco mil
 *     filas por archivo, cinco minutos y medio por una sola columna, con el
 *     sistema entero detenido todo ese rato, que es como trabaja esta puerta.
 *
 * AHORA se arma UN ÍNDICE por módulo y por importación: se recorre la tabla
 * una sola vez —sin tope— y queda un mapa de «texto de presentación → número».
 * Buscar deja de costar una consulta y pasa a costar nada, y alcanza a todos.
 *
 * Se conservan dos cosas del comportamiento anterior a propósito:
 *
 *   · **Gana el primero.** Si dos registros se presentan con el mismo texto
 *     —dos personas homónimas—, el nombre resuelve al de menor número, que es
 *     lo que devolvía el `find` de antes. Que sea ambiguo es un problema de la
 *     planilla, no de acá, y cambiar a cuál apunta sería cambiar callado lo
 *     que un archivo de años importaba.
 *
 *   · **Lo que se acaba de importar se puede nombrar.** La búsqueda anterior
 *     consultaba la base en cada celda, así que una fila podía nombrar por su
 *     texto a otra creada más arriba en el mismo archivo. Un índice armado una
 *     vez lo habría roto, y por eso el índice se ACTUALIZA con cada fila que
 *     entra (ver más abajo, en la ruta).
 */
function indiceDeNombres(refDef) {
  const indice = new Map();
  for (const fila of db.prepare(`SELECT * FROM "${refDef.name}"`).all()) {
    const texto = displayOf(refDef, fila).trim().toLowerCase();
    if (!texto || indice.has(texto)) continue;   // gana el primero
    indice.set(texto, fila.id);
  }
  return indice;
}

/** El número del registro que se presenta con ese texto, o null. */
function idDelQueSeLlama(refDef, texto, indices) {
  let indice = indices && indices.get(refDef.name);
  if (!indice) {
    indice = indiceDeNombres(refDef);
    if (indices) indices.set(refDef.name, indice);
  }
  const id = indice.get(String(texto).trim().toLowerCase());
  return id === undefined ? null : id;
}

/** Deja en los índices ya armados la fila que se acaba de crear. */
function anotarEnLosIndices(indices, def, fila) {
  const indice = indices && indices.get(def.name);
  if (!indice) return;                            // no se armó: se armará al día
  const texto = displayOf(def, fila).trim().toLowerCase();
  if (texto && !indice.has(texto)) indice.set(texto, fila.id);
}

/** Prepara y valida una fila; devuelve { datos, errores }. */
function prepararFila(def, fila, user, indices) {
  const datos = {};
  const errores = [];

  for (const f of def.fields) {
    /*
     * UN CAMPO DE SOLO LECTURA NO SE ESCRIBE POR PLANILLA. La misma línea que
     * tiene el formulario (ver crud.js), que acá faltaba.
     *
     * Un campo así lo escribe el sistema, y el propio motor lo dice con todas
     * sus letras: «aceptarlo del formulario sería dejar que cualquiera se
     * invente el número de serie de una credencial». El formulario lo cumplía y
     * esta puerta no, así que el mismo dato entraba por una y no por la otra.
     *
     * MEDIDO en la v1.381.0, los mismos dos campos y los mismos valores:
     *
     *   «Marcada el» / «Marcada por»   formulario: descartados, quedan en nulo
     *                                  planilla:   «01-01-2020 08:00», y
     *                                              apuntando a otra persona
     *
     * Y esos dos son justamente la constancia de quién pasó la lista y cuándo,
     * que el sistema agregó para poder responder por ella. Contando lo que hay
     * declarado hoy, la puerta alcanzaba 97 campos en 27 módulos: la serie, el
     * correlativo, el estado y los nueve datos congelados de una credencial;
     * los enlaces que hacen que un movimiento de tesorería sea el espejo de
     * otro; quién firmó un acta y cuándo.
     *
     * `soloAlCrear` es la única excepción, y es la misma del formulario: se
     * acepta al CREAR y nunca más. Importar CREA, así que acá aplica siempre.
     */
    if (f.readonly && !f.soloAlCrear) continue;

    let valor = fila[f.name];
    if (valor === undefined || valor === null) continue;
    if (typeof valor === 'string') valor = valor.trim();
    if (valor === '') continue;

    if (f.type === 'ref') {
      const refDef = getModule(f.ref);
      if (!refDef) continue;
      if (/^\d+$/.test(String(valor))) {
        const existe = db.prepare(`SELECT id FROM "${refDef.name}" WHERE id = ?`).get(Number(valor));
        if (!existe) {
          errores.push(`${f.label}: no existe el registro #${valor} en ${refDef.label}`);
          continue;
        }
        valor = Number(valor);
      } else {
        const encontrado = idDelQueSeLlama(refDef, valor, indices);
        if (!encontrado) {
          errores.push(`${f.label}: no se encontró "${valor}" en ${refDef.label}`);
          continue;
        }
        valor = encontrado;
      }
    } else if (f.type === 'multiref') {
      const refDef = getModule(f.ref);
      const partes = String(valor).split(/[|;]/).map((p) => p.trim()).filter(Boolean);
      const ids = [];
      for (const parte of partes) {
        if (/^\d+$/.test(parte)) {
          ids.push(Number(parte));
          continue;
        }
        const encontrado = refDef && idDelQueSeLlama(refDef, parte, indices);
        if (!encontrado) {
          errores.push(`${f.label}: no se encontró "${parte}"`);
          continue;
        }
        ids.push(encontrado);
      }
      valor = ids;
    } else if (f.type === 'boolean') {
      valor = /^(s[ií]|1|true|verdadero|x|activo)$/i.test(String(valor)) ? 1 : 0;
    } else if (f.type === 'date') {
      valor = normalizarFecha(valor);
    } else if (f.type === 'money' || f.type === 'number') {
      valor = normalizarNumero(valor);
      if (valor === null) {
        errores.push(`${f.label}: "${fila[f.name]}" no es un número válido`);
        continue;
      }
    }

    /*
     * La conversión puede negarse, y acá eso es un error DE LA FILA.
     *
     * Desde la 1.96.2, un campo de varios que no traiga una lista se rechaza
     * en vez de guardarse vacío (ver comoListaDeIds en server/crud.js). En una
     * importación eso tiene que salir en el informe junto a las demás filas
     * con problemas, y no tumbar la petición entera: quien está importando
     * quiere ver de una vez todo lo que hay que corregir.
     */
    let convertido;
    try {
      convertido = coerce(f, valor);
    } catch (e) {
      errores.push(`${f.label}: ${e.message}`);
      continue;
    }
    if (convertido !== undefined) datos[f.name] = convertido;
  }

  // Alcance por iglesia: se fuerza la del usuario si tiene una asignada
  const alcance = require('./alcance');
  const principal = alcance.iglesiaPrincipal(user);
  if (principal && def.fields.some((f) => f.name === 'iglesia_id') && !datos.iglesia_id) {
    datos.iglesia_id = principal;
  }
  if (datos.iglesia_id && !alcance.alcanzaIglesia(user, datos.iglesia_id)) {
    errores.push('Esa iglesia no está entre las que tiene asignadas');
  }

  /*
   * Y AQUELLO A LO QUE LA FILA APUNTA, que es la otra mitad del alcance.
   *
   * La iglesia de arriba no basta: un registro no es solo su iglesia, es
   * también el cuerpo, la persona y la cuenta que nombra. El motor lo comprueba
   * desde la 1.98.1 —«no se puede referenciar lo que no se puede ver»— y esta
   * puerta no lo preguntaba. El formulario y la planilla decían cosas distintas
   * sobre la misma fila, y la que decía que sí era la que no mira a nadie.
   *
   * Medido sobre una tesorera acotada a la Iglesia Central, con plata de sobra
   * en la cuenta de origen para que ninguna otra comprobación tapara el
   * resultado:
   *
   *   hacia una cuenta de la Iglesia Norte ... formulario 403 · planilla ENTRÓ
   *   hacia la cuenta de la corporación ...... formulario 403 · planilla ENTRÓ
   *
   * y $ 150.000 aparecieron en cada una de esas dos cuentas ajenas.
   *
   * Y lo mismo por el NIVEL de tesorería: una tesorera de cuerpo sin la llave
   * «Tesorería de la iglesia y la corporación» le sacó $ 90.000 a la cuenta
   * general de su iglesia por planilla —el formulario le contesta 403— y
   * después no veía el traspaso que acababa de anotar, porque el listado sí
   * aplica el nivel. Anotó plata que no puede ver.
   *
   * Las dos comprobaciones son las MISMAS del formulario, llamadas desde acá:
   * no hay una regla de planilla y otra de pantalla, hay una sola.
   */
  const ajenas = referenciasFueraDeAlcance(def, datos, user);
  for (const cual of ajenas) errores.push(cual);

  const nivel = require('./tesorerias').alGuardar(def, datos, user, db);
  if (nivel) errores.push(nivel);

  for (const f of def.fields) {
    const valor = datos[f.name];
    /*
     * Los obligatorios, con la MISMA regla del formulario: un campo cuya
     * condición no se cumple no se exige. Se pedían todos a secas, y por eso
     * una fila con un par de campos excluyentes —«Miembro» / «No Miembro»—
     * pedía los dos y no había manera de que entrara.
     */
    if (f.required && seAplica(f, datos, null, def.fields)
        && (valor === undefined || valor === null || valor === '')) {
      errores.push(`Falta ${f.label}`);
    }
    if (valor == null || valor === '') continue;
    if (f.type === 'rut' && !rut.validar(valor)) {
      errores.push(`${f.label}: "${valor}" no es válido (dígito verificador)`);
    }
    // Las mismas reglas de fecha que el formulario: que sea una fecha, que
    // esté en un rango con sentido y que no llegue del futuro cuando el campo
    // anota algo que ya pasó (ver server/fechas.js). Sin esto, la planilla
    // metía por la puerta de atrás lo que el formulario ya no deja entrar.
    if (f.type === 'date') {
      const problema = require('./fechas').revisar(f, valor);
      if (problema) errores.push(problema);
    }
    // Y los mismos topes de los montos. Se comprobó que sin esto entraba por
    // planilla un movimiento de 1e308 y el saldo de la iglesia pasaba a decir
    // «1e+308»: no es que quedara grande, es que dejaba de ser un número con
    // el que se pueda trabajar.
    if (f.type === 'money' || f.type === 'number') {
      const problema = revisarLimites(f, valor);
      if (problema) errores.push(problema);
    }
    if (f.unique) {
      // La misma regla que el formulario, incluida la unicidad acotada a la
      // iglesia (ver buscarDuplicado en server/crud.js).
      const dup = buscarDuplicado(def, f, valor, null, datos, null);
      if (dup) {
        errores.push(`${avisoDeDuplicado(def, f, dondeEsUnico(def, f, datos, null))}: "${valor}" (registro #${dup.id})`);
      }
    }
  }

  const seContradicen = require('./fechas').revisarCoherencia(def, datos, null);
  if (seContradicen) errores.push(seContradicen);

  // Quien no alcanza los datos de salud tampoco los escribe por planilla:
  // si no, bastaba con importar para dejar anotado en una ficha algo que esa
  // persona no puede ni leer (ver server/sensibles.js).
  sensibles.protegerAlGuardar(def, datos, user, null);

  aplicarDefectos(def, datos);
  sincronizarPersonas(def, datos, null);
  aplicarCalculos(def, datos, null);

  if (!errores.length && def.hooks && def.hooks.beforeSave) {
    /**
     * El hook puede devolver un texto —rechaza— o un objeto con `confirmar`
     * —pregunta—. En un formulario la pregunta se contesta; en una planilla de
     * quinientas filas no hay a quién preguntarle quinientas veces, así que se
     * marca la fila y quien importa la revisa en la vista previa. Es lo
     * correcto: un egreso que deja una cuenta en rojo puede ser cierto, pero
     * no es algo que deba pasar sin que nadie lo mire.
     */
    const err = def.hooks.beforeSave(datos, { user, isNew: true, id: null, existing: null, db, confirmado: false });
    if (err) errores.push(typeof err === 'string' ? err : err.error);
  }

  return { datos, errores };
}

const router = express.Router();
router.use(authRequired);

router.post('/:modulo', (req, res) => {
  const def = getModule(req.params.modulo);
  if (!def) return res.status(404).json({ error: 'Módulo no encontrado' });
  /*
   * Un módulo que se escribe solo no se llena con una planilla. Se contesta
   * ANTES de mirar las filas: rechazar quinientas una por una diría quinientas
   * veces lo mismo, y lo que hay que decir es que por acá no se entra.
   */
  if (def.soloLectura && def.soloLectura.alGuardar) {
    return res.status(400).json({ error: def.soloLectura.alGuardar });
  }

  requirePerm(def.name, 'create')(req, res, () => {
    const filas = Array.isArray(req.body && req.body.filas) ? req.body.filas : null;
    if (!filas || !filas.length) return res.status(400).json({ error: 'No se recibió ninguna fila' });
    if (filas.length > MAX_FILAS) {
      return res.status(400).json({ error: `Máximo ${MAX_FILAS} filas por importación; divida el archivo` });
    }
    const prueba = req.body.prueba !== false; // por seguridad, revisión previa salvo que se pida guardar

    const errores = [];
    let listas = 0;
    /*
     * Los índices de nombres, uno por módulo referido, armados a lo más una vez
     * cada uno y compartidos por todas las filas del archivo (ver
     * `indiceDeNombres`). Viven lo que dura esta importación: la de al lado
     * arma los suyos, porque entremedio la base pudo cambiar.
     */
    const indices = new Map();

    const ejecutar = db.transaction(() => {
      filas.forEach((fila, i) => {
        const { datos, errores: errFila } = prepararFila(def, fila, req.user, indices);
        if (errFila.length) {
          errores.push({ fila: i + 1, errores: errFila });
          return;
        }
        const claves = Object.keys(datos);
        if (!claves.length) {
          errores.push({ fila: i + 1, errores: ['La fila está vacía'] });
          return;
        }
        const info = db
          .prepare(
            `INSERT INTO "${def.name}" (${claves.map((k) => `"${k}"`).join(',')}, created_by)
             VALUES (${claves.map(() => '?').join(',')}, ?)`
          )
          .run(...claves.map((k) => datos[k]), req.user.id);

        /**
         * Y lo que el módulo hace DESPUÉS de guardar, que antes no se hacía.
         *
         * No es un detalle: `afterSave` es donde una iglesia y un cuerpo crean
         * sus cuentas de tesorería, donde la ofrenda de un servicio se anota
         * en los libros y donde un traspaso genera sus dos movimientos. Se
         * comprobó que sin esto un cuerpo importado nacía sin ninguna cuenta y
         * un servicio con cien mil pesos de ofrenda no ponía un peso en la
         * tesorería. La fila quedaba guardada y a medias.
         */
        const guardada = db.prepare(`SELECT * FROM "${def.name}" WHERE id = ?`).get(info.lastInsertRowid);
        // Y queda nombrable por las filas de más abajo, igual que cuando cada
        // celda consultaba la base (ver `indiceDeNombres`).
        if (guardada) anotarEnLosIndices(indices, def, guardada);
        if (guardada && def.hooks && def.hooks.afterSave) {
          def.hooks.afterSave(guardada, { user: req.user, isNew: true, db });
        }

        // El rastro, igual que cualquier otra alta. El Registro de Cambios
        // existe para responder quién tocó el dinero y los permisos, y por
        // planilla se puede tocar tanto o más que a mano: sin esto, podían
        // entrar movimientos a los libros sin que quedara quién los puso.
        if (guardada) {
          bitacora.registrarGuardado(def, {
            isNew: true, antes: {}, despues: guardada, datos, user: req.user,
          });
        }
        listas++;
      });
      if (prueba) throw new Error('__revision__'); // deshace todo: solo era una revisión
    });

    try {
      ejecutar.immediate();
    } catch (e) {
      if (e.message !== '__revision__') {
        console.error('Error importando:', e);
        return res.status(500).json({ error: 'Error al importar: ' + e.message });
      }
    }

    res.json({
      prueba,
      total: filas.length,
      correctas: listas,
      conError: errores.length,
      errores: errores.slice(0, 100),
    });
  });
});

/*
 * `prepararFila` se exporta para poder exigirle a las pruebas del motor lo que
 * de verdad importa de esta puerta: que le aplique a una fila de planilla las
 * mismas reglas que el formulario le aplica a la misma fila escrita a mano.
 */
module.exports = { router, prepararFila, anotarEnLosIndices };
