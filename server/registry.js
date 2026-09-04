/**
 * Registro de módulos.
 *
 * Cada archivo en server/modules/ define un módulo del sistema (esquema de
 * campos, etiquetas, permisos de listado, etc.). Este registro los carga y
 * los expone al resto del sistema: la base de datos crea/migra sus tablas,
 * el CRUD genérico publica su API REST y el frontend genera su interfaz.
 *
 * Un módulo puede declarar `computed`: campos que no se guardan en la base,
 * sino que se calculan al leer cada registro (p. ej. un estado de
 * cumplimiento). Se pueden mostrar en los listados como cualquier otro campo.
 *
 * Un campo puede declarar `showIf: { field, equals | in }` para mostrarse solo
 * cuando otro campo tenga cierto valor (p. ej. datos que solo aplican a los
 * cuerpos formales y no a los grupos de servicio), o `showIf: { field,
 * menorDe }` para mostrarse según la edad que da una fecha (los datos del
 * adulto responsable, que solo aplican a los menores de 18 años).
 *
 * Un campo puede declarar `seccion` para abrir con él un bloque de la ficha
 * («Contacto de emergencia», «Información médica»…), `destacado` para que se
 * vea resaltado, y `sensible` para que el historial deje constancia de que
 * cambió sin copiar su contenido.
 *
 * Un campo de tipo `ref` puede declarar `optionsRoute` para que su selector se
 * llene desde una ruta propia del módulo (definida en `extraRoutes`) en vez de
 * ofrecer todos los registros referenciados: sirve para acotar la lista a los
 * que corresponden (p. ej. solo los integrantes del cuerpo de oficiales).
 *
 * Un módulo puede declarar `filterFields`: los campos que aparecen como
 * filtros en la barra del listado (de tipo select o ref). Si no se declara,
 * se usan los primeros campos de tipo select.
 *
 * Un campo de tipo `persona` guarda el nombre de alguien que puede o no estar
 * registrado: se busca en el módulo indicado en `ref` (normalmente miembros),
 * pero también admite un nombre escrito a mano. Se guarda en dos columnas: el
 * nombre en `<campo>` y, cuando la persona sí está registrada, su enlace en
 * `<campo>_id` (columna que este registro agrega sola).
 *
 * Un campo puede declarar `calcula` para obtener su valor de otros campos al
 * guardar: `{ tipo: 'suma' | 'resta', campos: [...] }` o
 * `{ tipo: 'porcentaje', campo, porcentaje | opcion }` (donde `opcion` es una
 * clave de Configuración). Conviene marcarlos también como `readonly`.
 *
 * PARA AGREGAR UN MÓDULO NUEVO: crear un archivo en server/modules/ que
 * exporte la definición (ver cualquier módulo existente como plantilla) y
 * reiniciar el servidor. Tabla, API e interfaz se generan automáticamente.
 */
const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join(__dirname, 'modules');

const modules = {};

for (const file of fs.readdirSync(MODULES_DIR).sort()) {
  if (!file.endsWith('.js')) continue;
  const def = require(path.join(MODULES_DIR, file));
  if (!def || !def.name) continue;
  normalize(def);
  modules[def.name] = def;
}

// Una vez montados todos: lo que un módulo dice copiar de otro (más abajo).
for (const def of Object.values(modules)) revisarDeQuienCopia(def);

function normalize(def) {
  def.label = def.label || def.name;
  def.labelSingular = def.labelSingular || def.label;
  def.icon = def.icon || '📄';
  def.group = def.group || 'General';
  def.order = def.order == null ? 100 : def.order;
  // `menu: false` deja al módulo fuera del menú: se maneja desde la ficha de
  // otro (los documentos y el historial de una iglesia o de un pastor).
  def.menu = def.menu !== false;
  def.fields = def.fields || [];
  // Los campos "persona" necesitan una columna extra para enlazar al registro
  // cuando esa persona sí está en el sistema. Se agrega sola, oculta: no se
  // muestra como un campo más, la maneja el propio campo persona.
  const conCompaneros = [];
  for (const f of def.fields) {
    conCompaneros.push(f);
    if (f.type !== 'persona') continue;
    const enlace = `${f.name}_id`;
    if (def.fields.some((o) => o.name === enlace)) continue;
    conCompaneros.push({
      name: enlace,
      label: `${f.label || f.name} (registro enlazado)`,
      type: 'ref',
      ref: f.ref || 'miembros',
      oculto: true,
      companeroDe: f.name,
    });
  }
  def.fields = conCompaneros;
  def.computed = (def.computed || []).map((c) => ({
    ...c,
    label: c.label || c.name,
    type: c.type || 'badge',
    computed: true,
  }));
  def.searchFields = def.searchFields || def.fields.filter((f) => f.type === 'text' && !f.oculto).slice(0, 3).map((f) => f.name);
  def.listFields = def.listFields || def.fields.filter((f) => !f.oculto).slice(0, 5).map((f) => f.name);
  // Filtros de la barra del listado: los declarados, o los primeros select
  def.filterFields = def.filterFields
    || def.fields.filter((f) => f.type === 'select' && !f.oculto).slice(0, 3).map((f) => f.name);
  def.display = def.display || '{' + (def.fields[0] ? def.fields[0].name : 'id') + '}';
  def.defaultSort = def.defaultSort || { field: 'id', dir: 'desc' };
  for (const f of def.fields) {
    f.label = f.label || f.name;
    f.type = f.type || 'text';
  }
  /*
   * Un trozo de `buscaTambien` puede venir como texto —el caso corriente— o
   * como { sql, reservado }, cuando lo que busca es un dato de un grupo
   * reservado: el monto de un movimiento, que solo alcanza quien tiene su
   * llave. Se normalizan todos a la forma larga para no preguntarlo dos veces
   * más adelante.
   */
  def.buscaTambien = (def.buscaTambien || []).map((t) =>
    (typeof t === 'string' ? { sql: t, reservado: null } : { sql: t.sql, reservado: t.reservado || null }));
  revisarLoReservado(def);
  revisarLoQueSeBuscaDeMas(def);
}

/**
 * Lo que un módulo agrega a la búsqueda no puede abrir un dato reservado.
 *
 * `buscaTambien` son trozos de SQL que se pegan a lo buscable para encontrar
 * por algo que no es una columna —la cita bíblica de un servicio, que se arma
 * con tres—. Quien no alcanza un grupo reservado tampoco puede dar con alguien
 * buscando por un dato de ese grupo: es la regla de server/sensibles.js, y un
 * trozo de SQL escrito acá se la saltaría entera, porque el motor le quita los
 * campos reservados a la lista de buscables pero no puede leer adentro de una
 * expresión.
 *
 * Así que se revisa al cargar y el servidor no parte si alguien lo intenta. Es
 * un error de programación, no de datos: mejor que reviente al arrancar y no
 * que se descubra el día que un dato de salud aparezca en un resultado.
 */
function revisarLoQueSeBuscaDeMas(def) {
  if (!def.buscaTambien.length) return;
  const sensibles = require('./sensibles');
  const reservados = [...sensibles.gruposDe(def).values()].flat();
  const grupos = sensibles.gruposDe(def);
  for (const trozo of def.buscaTambien) {
    for (const campo of reservados) {
      if (!new RegExp(`\\b${campo}\\b`).test(trozo.sql)) continue;
      /*
       * Salvo que el trozo diga a qué grupo pertenece, y sea el del campo que
       * usa: entonces el motor sabe a quién ofrecérselo y a quién no, igual que
       * hace campo por campo. Buscar un movimiento por su monto es legítimo
       * para quien puede ver los montos.
       */
      const suGrupo = [...grupos.entries()].find(([, campos]) => campos.includes(campo));
      if (trozo.reservado && suGrupo && trozo.reservado === suGrupo[0]) continue;
      throw new Error(
        `El módulo ${def.name} busca de más por «${campo}», que es un campo reservado. ` +
        `Quien no tiene su llave no puede encontrar a nadie por ese dato, y una expresión en ` +
        `buscaTambien se saltaría el recorte que el motor hace campo por campo. ` +
        `Si de verdad corresponde, declare el trozo como { sql, reservado: '${suGrupo ? suGrupo[0] : 'grupo'}' }.`
      );
    }
  }
}

/**
 * Un campo reservado tiene que apuntar a una llave declarada.
 *
 * `reservado: 'la_llave'` esconde ese campo de quien no tenga esa llave. Si la
 * llave no está declarada en LLAVES, la matriz de permisos no la escribe rol
 * por rol y entonces la reparte el comodín '*': todos los roles que puedan ver
 * algo se la llevarían, y el campo quedaría reservado de mentira. Es el mismo
 * error que se corrigió con los datos de salud —el comodín se los regalaba al
 * secretario— y no puede volver por otra puerta.
 *
 * Se revienta al arrancar, y no en silencio: un permiso que parece estar y no
 * está es peor que no tenerlo, porque nadie va a ir a mirar.
 */
function revisarLoReservado(def) {
  const { LLAVES } = require('./permissions');
  const declaradas = new Set(LLAVES.map((l) => l.name));
  // Los calculados también: un saldo se reserva igual que un monto guardado
  for (const f of [...def.fields, ...(def.computed || [])]) {
    const llave = f.reservado;
    if (!llave || declaradas.has(llave)) continue;
    throw new Error(
      `El campo "${f.name}" de ${def.name} se declara reservado a «${llave}», que no existe como llave. ` +
      `Agréguela a LLAVES en server/permissions.js con su valor de fábrica; si no, el comodín de la matriz ` +
      `se la daría a todos y el campo quedaría reservado solo de nombre.`
    );
  }
}

/**
 * Un campo que copia de otro módulo tiene que nombrar un módulo que exista.
 *
 * `copiaDe: 'miembros'` es lo que hace que la bitácora tape el RUT y el
 * teléfono que quedaron escritos en su descripción. Si el nombre está mal
 * escrito, el campo se leería y se buscaría entero creyendo que está
 * resguardado, y nadie iría a mirarlo.
 *
 * Se revisa DESPUÉS de montarlos todos, y no al normalizar cada uno: los
 * módulos se cargan por orden alfabético, así que la bitácora se monta antes
 * que miembros y ahí todavía no se le puede preguntar al registro por él.
 */
function revisarDeQuienCopia(def) {
  for (const f of def.fields) {
    if (!f.copiaDe || f.copiaDe === '*' || modules[f.copiaDe]) continue;
    throw new Error(
      `El campo "${f.name}" de ${def.name} dice copiar de «${f.copiaDe}», que no es un módulo. ` +
      `Corrija el nombre o use '*' si de verdad puede traer datos de cualquiera: tal como está, el ` +
      `campo se leería y se buscaría entero creyendo que está resguardado.`
    );
  }
}

/**
 * Texto de presentación de una fila según la plantilla display del módulo.
 *
 * La plantilla admite un recorte detrás de dos puntos, para nombrar a una
 * persona como se la nombra en el día a día y no con todo lo que tiene escrito
 * en su ficha (ver server/nombres.js):
 *
 *   {nombres}          Juan Carlos Alberto
 *   {nombres:primero}  Juan
 *   {nombre:persona}   de «Juan Carlos Pérez Soto», «Juan Pérez Soto»
 *
 * UNA FECHA SE LEE COMO FECHA. La plantilla pegaba el valor guardado tal cual,
 * y como las fechas se guardan al modo del computador —2026-06-10— el título de
 * la ficha decía «2026-06-10 — Aporte de junio» mientras el campo «Fecha del
 * traspaso», dos centímetros más abajo, decía «10-06-2026». El mismo dato al
 * derecho y al revés en la misma pantalla; en Chile el día va primero.
 *
 * No es de un módulo: seis pegan una fecha en su título —traspasos, servicios,
 * asistencias, las dos clases de acta y las evaluaciones—, así que se arregla
 * donde se arma el texto y no seis veces.
 *
 * Se mira el TIPO del campo y no su nombre: `fecha_apertura` es una fecha y
 * `numero_acta` no, aunque las dos podrían llamarse parecido. Lo que no sea un
 * campo declarado del módulo —`{persona}` de un enlace, una columna calculada—
 * se pega igual que antes.
 *
 * ── UN REGISTRO SE PUEDE NOMBRAR POR AQUELLO DE LO QUE CUELGA ──
 *
 * `{cuerpo_id_label}` trae el nombre del cuerpo al que apunta `cuerpo_id`. Hace
 * falta para los registros que por sí solos no se distinguen: una directiva se
 * llamaba «2026 – 2027», y dos directivas de dos cuerpos distintos con el mismo
 * período eran el mismo texto en el listado, en el Registro de Cambios y en la
 * hoja impresa. Con esto se llama «Damas — 2026 – 2027», que es como la nombra
 * cualquiera.
 *
 * El valor se BUSCA solo si la fila no lo trae ya puesto: las que salen de un
 * listado vienen con sus etiquetas resueltas de una vez (ver `expandRow`), y
 * ahí esto no consulta nada. La consulta aparece cuando se nombra una fila
 * suelta —al anotarla en el Registro de Cambios, por ejemplo— y es una sola,
 * por clave primaria.
 *
 * Se baja UN SOLO NIVEL, a propósito: el nombre del cuerpo sale de la
 * plantilla del cuerpo, y si esa plantilla pidiera a su vez otra etiqueta, esa
 * segunda no se resuelve. Alcanza para lo que hace falta y no deja que una
 * cadena de plantillas se convierta en una cadena de consultas.
 */
function displayOf(def, row, sinBajarMas) {
  if (!row) return '';
  const nombres = require('./nombres');
  const { comoSeLee } = require('./fechas');
  const recortes = { primero: nombres.primerNombre, persona: nombres.acortar };
  const tipoDe = {};
  const refDe = {};
  for (const f of def.fields || []) {
    tipoDe[f.name] = f.type;
    if (f.type === 'ref' && f.ref) refDe[f.name] = f.ref;
  }

  /** El nombre de aquello a lo que apunta `campo_id`, buscándolo si hace falta. */
  const etiquetaDeSuReferencia = (campo, hondo) => {
    const dueno = campo.slice(0, -'_label'.length);
    if (hondo || !refDe[dueno] || !row[dueno]) return '';
    const otro = modules[refDe[dueno]];
    if (!otro) return '';
    const { db } = require('./db');   // tardío: db.js no sabe de módulos
    let fila;
    try {
      fila = db.prepare(`SELECT * FROM "${otro.name}" WHERE id = ?`).get(row[dueno]);
    } catch (e) {
      return '';
    }
    return fila ? displayOf(otro, fila, true) : '';
  };

  return def.display
    .replace(/\{(\w+)(?::(\w+))?\}/g, (_, campo, recorte) => {
      let valor = row[campo] == null ? '' : String(row[campo]);
      if (!valor && campo.endsWith('_label')) valor = etiquetaDeSuReferencia(campo, sinBajarMas);
      const corta = recorte && recortes[recorte];
      if (corta) return corta(valor);
      if (tipoDe[campo] === 'date' && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
        return comoSeLee(valor.slice(0, 10));
      }
      return valor;
    })
    /*
     * Una etiqueta que no se pudo resolver deja la plantilla con su separador
     * colgando —«— 2026 – 2027»—, y eso es peor que no ponerla: parece un dato
     * perdido. Se limpian los guiones y espacios sueltos de las puntas.
     */
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–-]+|[\s—–-]+$/g, '')
    .trim() || `#${row.id}`;
}

function getModule(name) {
  return modules[name] || null;
}

function allModules() {
  return Object.values(modules).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * ¿A este módulo se le puede acotar por rango de montos?
 *
 * Cuando tiene un campo de dinero que además se ve en el listado: acotar por
 * una cifra que no está a la vista sería pedirle a alguien que adivine. Vive
 * acá y no escrito dos veces —en la descripción del sistema y en el motor—
 * para que la pantalla ofrezca exactamente lo que el listado sabe hacer.
 */
function tieneRangoDeMonto(def) {
  return (def.fields || []).some((f) => f.type === 'money' && (def.listFields || []).includes(f.name));
}

module.exports = {
  tieneRangoDeMonto,
  modules, getModule, allModules, displayOf,
  // Para poder comprobar desde las pruebas que un módulo mal declarado no pasa
  normalizarParaPruebas: normalize,
  revisarDeQuienCopiaParaPruebas: revisarDeQuienCopia,
};
