/**
 * Qué pasa con lo que colgaba de un registro cuando ese registro se borra.
 *
 * Hasta acá, nada. La base tiene treinta y nueve tablas y ninguna declara una
 * llave foránea, así que borrar una ficha dejaba en pie todo lo que la
 * nombraba, apuntando a un número que ya no existe. Trece módulos tenían un
 * `beforeDelete` escrito a mano que limpiaba lo suyo, y funcionan bien; el
 * problema era que eran trece de treinta y dos.
 *
 * Se midió lo que costaba: borrar UN cuerpo y UN miembro dejó 231 filas
 * colgando. Entre ellas, doce fichas de integrante marcadas «Activo» en un
 * cuerpo que ya no existe —que es exactamente por qué un cuerpo borrado seguía
 * diciendo que tenía quince personas—, doscientas una marcas de asistencia que
 * seguían sumando en los porcentajes, y doce entradas de bitácora con el
 * teléfono y la dirección de alguien que pidió que lo borraran.
 *
 * Este archivo pone eso en un solo lugar. Para cada referencia entre dos
 * módulos hay una de tres respuestas, y se piensan en este orden:
 *
 *   FRENA     Lo que cuelga es constancia de algo que pasó y no se deshace:
 *             dinero, un certificado emitido, un acta firmada, una identidad
 *             que vive en otra parte del sistema. No se borra en silencio: se
 *             frena el borrado, se dice cuántos son y qué hacer en cambio.
 *
 *   ARRASTRA  Lo que cuelga solo existe para describir al que se borra y no
 *             significa nada sin él: su bitácora, sus documentos, su ficha de
 *             integrante, sus marcas de asistencia, sus evaluaciones. Se va
 *             con él, y sus archivos también.
 *
 *   SUELTA    Lo que cuelga es una cosa por derecho propio que apenas lo
 *             menciona: el cuerpo que lo tenía de líder, la directiva donde
 *             era tesorero, el servicio donde predicó. El registro se queda;
 *             lo que se va es el enlace.
 *
 * La regla por defecto sale del propio módulo y casi siempre acierta: si la
 * referencia es OBLIGATORIA, la fila no puede existir sin su destino, así que
 * ARRASTRA; si es opcional, la fila vive igual sin ella, así que SUELTA. Abajo
 * solo están las excepciones a esa regla, que son las que hay que pensar.
 *
 * Las cadenas se siguen hasta el final: borrar un cuerpo arrastra sus fichas
 * de integrante, y cada una de esas mira si tiene cuotas pagadas —que sí
 * frenan—. Si algo frena en cualquier eslabón, no se borra nada: se explica
 * dónde estaba el problema.
 *
 * Sobre los permisos: lo que se arrastra NO vuelve a pedir permiso módulo por
 * módulo. Un secretario que puede borrar una ficha de miembro se lleva con
 * ella su bitácora, aunque no pueda borrar entradas de bitácora sueltas. Es a
 * propósito: no son dos actos, es la consecuencia del que ya se autorizó, y
 * exigir permiso sobre los veintinueve módulos que nombran a un miembro
 * dejaría el borrado en manos del administrador y de nadie más. El alcance sí
 * se respeta solo: lo que cuelga de una ficha es de esa ficha, y la ficha ya
 * pasó por la comprobación de alcance antes de llegar acá.
 */
const { allModules, getModule, displayOf } = require('./registry');

const FRENA = 'frena';
const ARRASTRA = 'arrastra';
const SUELTA = 'suelta';

/**
 * Cuántas filas puede llegar a tocar un borrado antes de que se considere que
 * algo va mal. No es un límite que se espere alcanzar: es la red por si una
 * referencia mal declarada convierte un borrado en una tala.
 */
const TOPE_DE_CASCADA = 10000;

/**
 * Módulos de los que no se arrastra nada.
 *
 * Una iglesia no se borra: se marca inactiva. Tiene veintiocho módulos
 * colgando —su gente, su dinero, sus actas, sus documentos— y no existe un
 * caso legítimo en que borrarla deba llevárselos. Si algo cuelga de ella, se
 * frena y se dice qué es.
 */
const NO_SE_ARRASTRA_NADA = ['iglesias'];

/**
 * Las excepciones a la regla por defecto. Cada una dice qué son las filas que
 * cuelgan, en palabras, para poder escribir el aviso.
 */
const EXCEPCIONES = {
  // ---- Dinero: no se borra junto con otra cosa ----
  'tesoreria.cuenta_id':            [FRENA, 'movimiento(s) de tesorería', 'Ciérrela en vez de eliminarla y su historial queda intacto.'],
  'traspasos.cuenta_origen_id':     [FRENA, 'traspaso(s) que salen de ella', 'Ciérrela en vez de eliminarla.'],
  'traspasos.cuenta_destino_id':    [FRENA, 'traspaso(s) que llegan a ella', 'Ciérrela en vez de eliminarla.'],
  'cuotas_cuerpo.integrante_id':    [FRENA, 'cuota(s) pagada(s)', 'Márquelo como «Retirado» en vez de eliminarlo, y su historial queda intacto.'],
  'ayudas_sociales.miembro_id':     [FRENA, 'ayuda(s) social(es) registrada(s)', 'Esa ayuda es constancia de dinero entregado: no se borra con la ficha.'],
  'ayudas_sociales.no_miembro_id':  [FRENA, 'ayuda(s) social(es) registrada(s)', 'Esa ayuda es constancia de dinero entregado: no se borra con la ficha.'],

  // ---- Documentos emitidos: llevan número y salieron firmados ----
  'certificados.miembro_id':        [FRENA, 'certificado(s) emitido(s)', 'Un certificado emitido no se borra con la ficha de su titular.'],
  'certificados.oficiante_id':      [FRENA, 'certificado(s) que oficia', 'Cambie el oficiante de esos certificados antes de eliminar la ficha.'],
  'credenciales.pastor_id':         [FRENA, 'credencial(es) emitida(s)', 'Revóquela en vez de borrar la ficha de su titular: una credencial emitida es un documento y no se borra.'],

  // ---- Actas: son constancia de una reunión que ocurrió ----
  'actas_reuniones.cuerpo_id':      [FRENA, 'acta(s) de reunión', 'Las actas son constancia de reuniones que se hicieron. Marque el cuerpo como inactivo.'],

  // ---- Identidades que viven en otra parte del sistema ----
  'usuarios.miembro_id':            [FRENA, 'usuario(s) del sistema enlazado(s)', 'Elimine o desenlace primero ese usuario.'],
  'pastores.miembro_id':            [FRENA, 'ficha(s) en Pastores / Guías', 'Elimine primero la ficha de pastor, o desenlácela de esta.'],
  'usuarios.perfil_id':             [FRENA, 'usuario(s) con este perfil', 'Cámbieles el perfil primero, o archívelo en vez de eliminarlo.'],

  // ---- La cuenta de un cuerpo existe POR el cuerpo, así que se va con él...
  //      y si esa cuenta tiene movimientos, la regla de arriba lo frena ----
  'cuentas_tesoreria.cuerpo_id':    [ARRASTRA, 'cuenta(s) de tesorería del cuerpo'],
};

/**
 * Los campos multiref guardan una lista de ids. Que uno de esos ids desaparezca
 * nunca puede borrar la fila entera —una actividad convocaba a tres cuerpos y
 * se eliminó uno—, así que siempre se suelta: se saca de la lista y se deja el
 * resto.
 */
function reglaDe(campo) {
  const excepcion = EXCEPCIONES[campo.clave];
  if (excepcion) return { que: excepcion[0], son: excepcion[1], enCambio: excepcion[2] };
  if (campo.tipo === 'multiref') return { que: SUELTA };
  return { que: campo.obligatorio ? ARRASTRA : SUELTA };
}

/** Todas las referencias que apuntan a cada módulo, calculadas una sola vez. */
let mapa = null;
function referenciasHacia(nombre) {
  if (!mapa) {
    mapa = new Map();
    for (const def of allModules()) {
      for (const f of def.fields) {
        if ((f.type !== 'ref' && f.type !== 'multiref') || !f.ref) continue;
        const campo = {
          clave: `${def.name}.${f.name}`,
          def,
          nombre: f.name,
          tipo: f.type,
          obligatorio: !!f.required,
          etiqueta: f.label,
        };
        campo.regla = reglaDe(campo);
        if (!mapa.has(f.ref)) mapa.set(f.ref, []);
        mapa.get(f.ref).push(campo);
      }
    }
  }
  return mapa.get(nombre) || [];
}

/** Cuántas filas de este módulo apuntan a este id. */
function cuantasApuntan(db, campo, id) {
  if (campo.tipo === 'multiref') {
    return db
      .prepare(
        `SELECT COUNT(*) AS c FROM "${campo.def.name}"
          WHERE EXISTS (SELECT 1 FROM json_each("${campo.def.name}"."${campo.nombre}") WHERE value = ?)`
      )
      .get(id).c;
  }
  return db.prepare(`SELECT COUNT(*) AS c FROM "${campo.def.name}" WHERE "${campo.nombre}" = ?`).get(id).c;
}

/**
 * Cómo se llama un registro en pantalla, para poder nombrarlo en el aviso.
 *
 * No todos los módulos tienen un nombre que sirva suelto: el de una ficha de
 * integrante es «13 — 2», que son dos números y no le dice nada a nadie. Si el
 * texto no tiene ninguna letra, no se usa.
 */
function comoSeLlama(def, fila) {
  try {
    const texto = String(displayOf(def, fila) || '').trim();
    return /\p{L}/u.test(texto) ? `«${texto}»` : `#${fila.id}`;
  } catch (e) {
    return `#${fila.id}`;
  }
}

/**
 * El aviso de una iglesia, que no se lleva nada consigo.
 *
 * Se cuentan TODOS sus módulos y no solo el primero que aparezca: quien va a
 * borrar una iglesia necesita ver el tamaño de lo que estaba por hacer, no
 * enterarse de a un módulo por vez.
 */
function frenoDeIglesia(db, def, fila) {
  const cuentas = [];
  for (const campo of referenciasHacia(def.name)) {
    const n = cuantasApuntan(db, campo, fila.id);
    if (n) cuentas.push({ label: campo.def.label, n });
  }
  if (!cuentas.length) return null;

  const juntos = new Map();
  for (const c of cuentas) juntos.set(c.label, (juntos.get(c.label) || 0) + c.n);
  const orden = [...juntos.entries()].sort((a, b) => b[1] - a[1]);
  const total = orden.reduce((s, [, n]) => s + n, 0);
  const primeros = orden.slice(0, 4).map(([label, n]) => `${n.toLocaleString('es-CL')} en ${label}`);
  const resto = orden.length > 4 ? `, y ${orden.length - 4} módulo(s) más` : '';

  return (
    `No se puede eliminar ${comoSeLlama(def, fila)}: cuelgan de ella ` +
    `${total.toLocaleString('es-CL')} registro(s) — ${primeros.join(', ')}${resto}. ` +
    'Una iglesia no se borra con su gente y su historia adentro: márquela como inactiva.'
  );
}

/**
 * Arma el plan de un borrado, sin tocar nada.
 *
 * Devuelve `{ freno, arrastrar, soltar }`. Si `freno` viene con algo, el
 * borrado no se puede hacer y ese texto explica por qué; los otros dos no se
 * miran. Si no, `arrastrar` trae las filas que se van —de las hojas hacia
 * arriba, para que nada quede apuntando a algo ya borrado mientras se hace— y
 * `soltar` las referencias que hay que dejar en nulo.
 */
function planDe(db, def, fila) {
  const arrastrar = [];
  const soltar = [];
  const vistas = new Set([`${def.name}:${fila.id}`]);
  const cola = [{ def, fila }];
  let tocadas = 0;

  while (cola.length) {
    const actual = cola.shift();

    // Una iglesia no se lleva nada consigo: si algo cuelga de ella, no se
    // borra, y el aviso los cuenta todos de una vez.
    if (NO_SE_ARRASTRA_NADA.includes(actual.def.name)) {
      const freno = frenoDeIglesia(db, actual.def, actual.fila);
      if (freno) return { freno };
      continue;
    }

    for (const campo of referenciasHacia(actual.def.name)) {
      const regla = campo.regla;
      const que = regla.que;

      if (que === SUELTA) {
        soltar.push({ campo, id: actual.fila.id });
        continue;
      }

      if (que === FRENA) {
        const cuantas = cuantasApuntan(db, campo, actual.fila.id);
        if (!cuantas) continue;
        const son = regla.son || `registro(s) en ${campo.def.label}`;
        // Cuando el freno no cuelga de la ficha misma sino de algo que ella
        // arrastraba, se dice por dónde: si no, el aviso habla de cuotas
        // pagadas al borrar un cuerpo y nadie entiende de dónde salieron.
        const deQuien =
          actual.fila.id === fila.id && actual.def.name === def.name
            ? ''
            : ` (a través de su ficha en ${actual.def.label})`;
        return {
          freno:
            `No se puede eliminar ${comoSeLlama(def, fila)}: tiene ${cuantas} ${son}${deQuien}. ` +
            (regla.enCambio || 'Quite primero esos registros, o deje esta ficha como inactiva.'),
        };
      }

      // ARRASTRA: se traen las filas y cada una entra a la cola, porque lo que
      // colgaba de ellas también hay que resolverlo.
      const hijas = db
        .prepare(`SELECT * FROM "${campo.def.name}" WHERE "${campo.nombre}" = ?`)
        .all(actual.fila.id);
      for (const hija of hijas) {
        const marca = `${campo.def.name}:${hija.id}`;
        if (vistas.has(marca)) continue; // un cónyuge que se apunta a sí mismo, y parecidos
        vistas.add(marca);
        if (++tocadas > TOPE_DE_CASCADA) {
          return {
            freno:
              `No se puede eliminar ${comoSeLlama(def, fila)}: se llevaría por delante más de ` +
              `${TOPE_DE_CASCADA.toLocaleString('es-CL')} registros. Eso no parece un borrado sino un accidente; ` +
              'revíselo antes de seguir.',
          };
        }
        arrastrar.push({ def: campo.def, fila: hija });
        cola.push({ def: campo.def, fila: hija });
      }
    }
  }

  // De las hojas hacia arriba: lo último que se encontró es lo más profundo.
  arrastrar.reverse();
  return { freno: null, arrastrar, soltar };
}

/**
 * Deja el enlace en nulo sin tocar el resto de la fila.
 *
 * No pasa por el guardado normal a propósito: no es un cambio que alguien
 * hizo, es la consecuencia de un borrado que ya quedó anotado. Pasarlo por el
 * guardado dispararía validaciones, cálculos y una entrada de historial por
 * cada fila, para decir lo mismo que ya dice la entrada del borrado.
 */
function soltarEnlace(db, campo, id) {
  if (campo.tipo === 'multiref') {
    const filas = db
      .prepare(
        `SELECT id, "${campo.nombre}" AS lista FROM "${campo.def.name}"
          WHERE EXISTS (SELECT 1 FROM json_each("${campo.def.name}"."${campo.nombre}") WHERE value = ?)`
      )
      .all(id);
    const poner = db.prepare(`UPDATE "${campo.def.name}" SET "${campo.nombre}" = ? WHERE id = ?`);
    for (const f of filas) {
      let lista;
      try {
        lista = JSON.parse(f.lista || '[]');
      } catch (e) {
        continue;
      }
      if (!Array.isArray(lista)) continue;
      poner.run(JSON.stringify(lista.filter((v) => Number(v) !== Number(id))), f.id);
    }
    return filas.length;
  }
  return db
    .prepare(`UPDATE "${campo.def.name}" SET "${campo.nombre}" = NULL WHERE "${campo.nombre}" = ?`)
    .run(id).changes;
}

/**
 * Aplica el plan. Se llama DENTRO de la transacción del borrado y ANTES del
 * DELETE del registro principal.
 *
 * Si algo frena, lanza el error para que la transacción se deshaga entera y el
 * motivo llegue a la pantalla. Si no, devuelve el resumen de lo que se llevó
 * consigo, para poder anotarlo junto al borrado.
 */
function resolver(db, def, fila, { alBorrarFila } = {}) {
  const plan = planDe(db, def, fila);
  if (plan.freno) {
    const error = new Error(plan.freno);
    error.esDeDatos = true;
    throw error;
  }

  const resumen = new Map();
  for (const { def: hijaDef, fila: hijaFila } of plan.arrastrar) {
    if (alBorrarFila) alBorrarFila(hijaDef, hijaFila);
    db.prepare(`DELETE FROM "${hijaDef.name}" WHERE id = ?`).run(hijaFila.id);
    resumen.set(hijaDef.label, (resumen.get(hijaDef.label) || 0) + 1);
  }

  let sueltas = 0;
  for (const { campo, id } of plan.soltar) sueltas += soltarEnlace(db, campo, id);

  return {
    arrastradas: plan.arrastrar.length,
    sueltas,
    detalle: [...resumen.entries()].map(([label, n]) => `${n} en ${label}`),
  };
}

/**
 * Lo que ya quedó colgando de antes, sin tocar nada: para poder mirarlo antes
 * de decidir qué hacer con ello.
 */
function huerfanas(db) {
  const encontrado = [];
  for (const def of allModules()) {
    for (const f of def.fields) {
      if (f.type !== 'ref' || !f.ref) continue;
      const destino = getModule(f.ref);
      if (!destino) continue;
      let cuantas;
      try {
        cuantas = db
          .prepare(
            `SELECT COUNT(*) AS c FROM "${def.name}"
              WHERE "${f.name}" IS NOT NULL
                AND "${f.name}" NOT IN (SELECT id FROM "${destino.name}")`
          )
          .get().c;
      } catch (e) {
        continue; // una tabla que aún no existe no impide revisar las demás
      }
      if (cuantas) {
        encontrado.push({
          modulo: def.name,
          moduloLabel: def.label,
          campo: f.name,
          campoLabel: f.label,
          apuntaA: destino.label,
          cuantas,
        });
      }
    }
  }
  encontrado.sort((a, b) => b.cuantas - a.cuantas);
  return { total: encontrado.reduce((s, x) => s + x.cuantas, 0), donde: encontrado };
}

module.exports = { resolver, planDe, huerfanas, referenciasHacia, FRENA, ARRASTRA, SUELTA };
