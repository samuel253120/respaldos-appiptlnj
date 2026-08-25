/**
 * El buscador general: una sola caja para encontrar cualquier cosa.
 *
 * Hasta ahora, para dar con algo había que saber de antemano dónde estaba:
 * entrar a Miembros y buscar ahí, o a Tesorería, o a Documentos. Quien atiende
 * el teléfono no razona así —le dicen un nombre, un RUT, el número de un
 * certificado— y tenía que ir probando módulo por módulo.
 *
 * Acá se pregunta en todos a la vez, y se responde con lo mismo que la persona
 * podría abrir por su cuenta. Eso es lo que cuesta hacer bien, y son cuatro
 * cosas que se aplican todas o no sirve ninguna:
 *
 *   1. **Solo los módulos que puede ver.** Se pregunta por `can(view)`, así que
 *      a quien no tiene Tesorería no le aparece un movimiento.
 *   2. **Solo lo que alcanza.** Cada consulta lleva las mismas condiciones de
 *      iglesia, cuerpo y nivel de tesorería que el listado del módulo
 *      (ver server/alcance.js). Un buscador que se saltara el alcance sería la
 *      puerta de atrás más grande del sistema.
 *   3. **Solo por los datos que ve.** No se busca por un teléfono reservado que
 *      esa persona no alcanza: si se pudiera, probando números se averiguaría
 *      de quién es cada uno (ver server/sensibles.js).
 *   4. **Sin datos reservados en la respuesta.** Lo que sale en pantalla pasa
 *      por la misma limpieza que una ficha.
 *
 * Y una decisión de forma: cada resultado dice POR QUÉ salió. Buscar «Pérez» y
 * recibir una lista de nombres se entiende solo; buscar un número y recibir
 * tres fichas, no. Cuando lo que coincidió no es lo que se muestra, se muestra
 * también el dato que coincidió.
 */
const { db } = require('./db');
const { allModules, displayOf } = require('./registry');
const { can } = require('./permissions');
const alcance = require('./alcance');
const sensibles = require('./sensibles');

/** Cuántos se traen de cada módulo y cuántos se muestran en total. */
const POR_MODULO = () => require('./ajustes').numero('buscador_por_modulo', 1, 30);
const EN_TOTAL = () => require('./ajustes').numero('buscador_total', 5, 200);

/** Menos de esto no se busca: dos letras traen media iglesia. */
const MINIMO = 2;

/**
 * Los módulos donde tiene sentido buscar, en el orden en que se muestran.
 *
 * Se respeta el orden del menú: quien busca «Pérez» espera ver primero a las
 * personas, no una anotación de bitácora que lo menciona.
 */
function dondeBuscar(usuario) {
  return allModules()
    .filter((m) => (m.searchFields || []).length && can(usuario, m.name, 'view'))
    .sort((a, b) => (a.order || 100) - (b.order || 100) || a.name.localeCompare(b.name));
}

/**
 * Cómo se lee un valor en una línea de resultado.
 *
 * Una fecha en 2026-08-03 y un monto en 1000 son datos crudos: acá se leen
 * como se leen en el resto del sistema. Los Sí/No se dejan fuera —un «Sí»
 * suelto, sin su etiqueta, no dice nada— y lo mismo los archivos y las listas.
 */
function comoSeLee(f, v) {
  if (f.type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(v);
  }
  if (f.type === 'money' || f.type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('es-CL') : String(v);
  }
  return String(v);
}

/** Los campos que se muestran como pista bajo el título de un resultado. */
function pistasDe(def, fila) {
  const enElTitulo = new Set((def.display.match(/\{(\w+)/g) || []).map((x) => x.slice(1)));
  const sirve = (f) =>
    !enElTitulo.has(f.name) &&
    !f.oculto &&
    !['file', 'password', 'permisos', 'ref', 'multiref', 'textarea', 'richtext', 'boolean'].includes(f.type);

  const salida = [];
  for (const nombre of def.listFields || []) {
    const f = (def.fields || []).find((x) => x.name === nombre);
    if (!f || !sirve(f)) continue;
    const v = fila[f.name];
    if (v === null || v === undefined || v === '') continue;
    salida.push(comoSeLee(f, v));
    if (salida.length === 3) break;
  }
  return salida;
}

/**
 * Qué campo coincidió, cuando no se ve en lo que se muestra.
 *
 * Es la diferencia entre una lista que se entiende y una que hay que adivinar:
 * buscar un número de teléfono y ver «Ana Díaz» a secas no dice nada; ver
 * «Ana Díaz · +56 9 1111 2222» dice todo.
 */
function porQueSalio(def, fila, buscables, texto, titulo, pistas) {
  const enPantalla = `${titulo} ${pistas.join(' ')}`.toLowerCase();
  const q = texto.toLowerCase();
  if (enPantalla.includes(q)) return null;
  for (const nombre of buscables) {
    const v = fila[nombre];
    if (v === null || v === undefined) continue;
    if (String(v).toLowerCase().includes(q)) {
      const f = (def.fields || []).find((x) => x.name === nombre);
      return { campo: (f && f.label) || nombre, valor: f ? comoSeLee(f, v) : String(v) };
    }
  }
  return null;
}

/**
 * Busca el texto en todo lo que esta persona puede ver.
 *
 * Devuelve los resultados agrupados por módulo, en el orden del menú.
 */
function buscar(texto, usuario) {
  const q = String(texto || '').trim();
  if (q.length < MINIMO) return { q, grupos: [], total: 0, corto: true };

  const grupos = [];
  let total = 0;

  for (const def of dondeBuscar(usuario)) {
    if (total >= EN_TOTAL()) break;

    // Por los campos que esta persona alcanza, y nada más
    const buscables = sensibles.buscablesPara(def, usuario);
    if (!buscables.length) continue;

    const params = [];
    const donde = [];

    const like = buscables.map((f) => `"${f}" LIKE ?`).join(' OR ');
    donde.push(`(${like})`);
    for (const _ of buscables) params.push(`%${q}%`);

    // El mismo alcance del listado: iglesias, cuerpos y nivel de tesorería
    const suyo = alcance.condiciones(def, usuario, params);
    if (suyo) donde.push(suyo);

    let filas;
    try {
      filas = db
        .prepare(
          `SELECT * FROM "${def.name}" WHERE ${donde.join(' AND ')}
             ORDER BY id DESC LIMIT ${POR_MODULO() + 1}`
        )
        .all(...params);
    } catch (e) {
      continue; // una tabla que aún no existe no impide buscar en las demás
    }
    if (!filas.length) continue;

    const hayMas = filas.length > POR_MODULO();
    const limpias = sensibles.limpiarVarias(def, filas.slice(0, POR_MODULO()), usuario);

    const resultados = limpias.map((fila) => {
      const titulo = displayOf(def, fila) || `#${fila.id}`;
      const pistas = pistasDe(def, fila);
      return {
        id: fila.id,
        titulo,
        pistas,
        porque: porQueSalio(def, fila, buscables, q, titulo, pistas),
      };
    });

    total += resultados.length;
    grupos.push({
      modulo: def.name,
      label: def.label,
      labelSingular: def.labelSingular,
      icon: def.icon,
      hay_mas: hayMas,
      resultados,
    });
  }

  return { q, grupos, total, corto: false };
}

module.exports = { buscar, MINIMO, POR_MODULO, EN_TOTAL };
