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
 * Las excepciones a la regla por defecto. Cada una dice qué son las filas que
 * cuelgan, en palabras, para poder escribir el aviso.
 */
const EXCEPCIONES = {
  // ---- Dinero: no se borra junto con otra cosa ----
  'tesoreria.cuenta_id':            [FRENA, 'movimiento(s) de tesorería', 'Ciérrela en vez de eliminarla y su historial queda intacto.'],
  /*
   * Una deuda es un compromiso, no un dato de la caja: borrar la caja no puede
   * hacer desaparecer lo que la organización debe. La regla por defecto la
   * habría ARRASTRADO —la referencia es obligatoria— y con eso una caja
   * eliminada se habría llevado consigo la constancia de una deuda viva.
   */
  'deudas.cuenta_id':               [FRENA, 'deuda(s) o compromiso(s) anotado(s)', 'Ciérrela en vez de eliminarla, o pase esas deudas a otra caja: una deuda no se borra con la caja.'],
  // El plan de cuotas no significa nada sin su deuda: se va con ella. Los
  // PAGOS no, y por eso la deuda con pagos no se deja borrar (ver su gancho).
  'cuotas_deuda.deuda_id':          [ARRASTRA, 'cuota(s) del plan de pagos'],
  'traspasos.cuenta_origen_id':     [FRENA, 'traspaso(s) que salen de ella', 'Ciérrela en vez de eliminarla.'],
  'traspasos.cuenta_destino_id':    [FRENA, 'traspaso(s) que llegan a ella', 'Ciérrela en vez de eliminarla.'],
  'cuotas_cuerpo.integrante_id':    [FRENA, 'cuota(s) pagada(s)', 'Márquelo como «Retirado» en vez de eliminarlo, y su historial queda intacto.'],
  'ayudas_sociales.miembro_id':     [FRENA, 'ayuda(s) social(es) registrada(s)', 'Esa ayuda es constancia de dinero entregado: no se borra con la ficha.'],
  'ayudas_sociales.no_miembro_id':  [FRENA, 'ayuda(s) social(es) registrada(s)', 'Esa ayuda es constancia de dinero entregado: no se borra con la ficha.'],
  // Una solicitud es un trámite que la iglesia recibió y respondió: borrar la
  // ficha de quien la presentó no puede llevarse el trámite por delante.
  'solicitudes.miembro_id':         [FRENA, 'solicitud(es) presentada(s)', 'La solicitud es constancia de un trámite: no se borra con la ficha de quien la presentó.'],
  'solicitudes.no_miembro_id':      [FRENA, 'solicitud(es) presentada(s)', 'La solicitud es constancia de un trámite: no se borra con la ficha de quien la presentó.'],

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
 * Módulos de los que no se arrastra nada.
 *
 * Son DOS, y por la misma razón: de una iglesia y de un cuerpo cuelga la gente
 * y la historia de una parte de la organización, y no existe un caso legítimo
 * en que borrarlos deba llevárselas por delante. La del cuerpo es de la
 * 1.250.0 y está explicada en server/cuerpo-vacio.js; medido antes, borrar un
 * cuerpo con seis integrantes desde 2019 y su directiva vigente contestaba 200
 * sin preguntar nada y se llevaba las seis fichas, la directiva y sus dos
 * cajas.
 *
 * Una iglesia no se lleva por delante lo que cuelga de ella. Tiene treinta y
 * tres referencias apuntándole —su gente, su dinero, sus actas, sus
 * documentos— y no existe un caso legítimo en que borrarla deba llevárselos:
 * si algo hay dentro, se frena y se dice qué es.
 *
 * La única excepción es el RASTRO DE HABERLA CREADO —sus cuentas recién
 * abiertas y sin un peso, sus anotaciones automáticas de historial, sus líneas
 * de auditoría—, que lo escribió el sistema y no una persona. Eso no la
 * protege de nada: la protegía de ser borrada por errores propios. Qué cuenta
 * como rastro y qué no está en server/iglesia-vacia.js, y desde ahí lo leen
 * los dos que tienen que estar de acuerdo: este archivo, que arma el plan del
 * borrado, y el gancho del módulo, que hace la pregunta.
 *
 * Con el cuerpo pasa lo mismo y su rastro son sus dos cajas recién abiertas,
 * que el módulo le crea al guardarlo.
 */

/*
 * ── Y DÓNDE ESTÁ ESCRITA LA REGLA DE CADA UNO ──
 *
 * Las dos contestan lo mismo —`loQueCuelga`, `avisoDeQueNoSeBorra`,
 * `preguntaDeBorrado`— así que este archivo y el gancho de cada módulo las
 * piden por acá y no eligen a mano. Y ésta es además LA LISTA: quién no
 * arrastra nada se sabe por estar acá, para que no haya una segunda lista con
 * los mismos nombres que un día diga otra cosa.
 */
const SIN_ARRASTRE = {
  iglesias: () => require('./iglesia-vacia'),
  cuerpos: () => require('./cuerpo-vacio'),
};

/** ¿Este módulo es de los que no se llevan nada consigo? */
const noArrastraNada = (nombre) => Object.prototype.hasOwnProperty.call(SIN_ARRASTRE, nombre);

/**
 * Qué cuelga de una iglesia o de un cuerpo, separado en lo que ÉL TIENE y lo
 * que el sistema ESCRIBIÓ al crearlo. El porqué de la distinción está en
 * server/iglesia-vacia.js y en server/cuerpo-vacio.js, que es de donde sale.
 */
function loQueCuelgaDe(db, nombreDelModulo, fila) {
  return SIN_ARRASTRE[nombreDelModulo]()
    .loQueCuelga(db, fila.id, referenciasHacia(nombreDelModulo), cuantasApuntan);
}

/**
 * El plan del borrado de una iglesia o de un cuerpo.
 *
 * Devuelve `{ freno }` si tiene algo dentro —y ahí se cuentan TODOS sus
 * módulos y no solo el primero que aparezca, porque quien va a borrarlo
 * necesita ver el tamaño de lo que estaba por hacer—, o el rastro que se va
 * con él y los enlaces que hay que soltar.
 *
 * No pregunta nada: la pregunta la hace el gancho del módulo, que es el que
 * sabe si la persona ya contestó (ver server/modules/iglesias.js y
 * server/modules/cuerpos.js). Acá se llega cuando esa pregunta ya está
 * contestada.
 */
function frenoDelQueNoArrastra(db, def, fila) {
  const regla = SIN_ARRASTRE[def.name]();
  const { contenido, rastro } = loQueCuelgaDe(db, def.name, fila);
  if (contenido.length) {
    /*
     * El aviso lo escribe cada regla con sus propias palabras: la iglesia
     * recibe su nombre ya armado y el cuerpo la fila entera, porque necesita
     * el tipo para decir «el cuerpo» o «el grupo».
     */
    const como = def.name === 'cuerpos' ? fila : comoSeLlama(def, fila);
    return { freno: regla.avisoDeQueNoSeBorra(como, contenido) };
  }

  const arrastrar = [];
  const soltar = [];
  for (const r of rastro) {
    if (r.que === regla.SE_QUEDA) {
      soltar.push({ campo: r.campo, id: fila.id });
      continue;
    }
    const hijas = db
      .prepare(`SELECT * FROM "${r.campo.def.name}" WHERE "${r.campo.nombre}" = ?`)
      .all(fila.id);
    for (const hija of hijas) arrastrar.push({ def: r.campo.def, fila: hija });
  }
  return { freno: null, arrastrar, soltar };
}

/**
 * Qué se va a llevar consigo este borrado, en palabras, ANTES de hacerlo.
 *
 * El motor ya sabía contar esto: la línea del Registro de Cambios termina en
 * «Se llevó consigo 11 registro(s): 8 en Historial de Pastores, 3 en Documentos
 * de Pastores» desde la 1.59.0. Lo que faltaba era decirlo del otro lado del
 * borrado, que es el único momento en que sirve para decidir.
 *
 * Devuelve `null` si no se lleva nada —y entonces no hay nada que preguntar—,
 * o `{ cuantas, detalle, enPalabras }`. Sale del MISMO plan que después
 * ejecuta el borrado, así que la pregunta de antes y la constancia de después
 * no pueden decir cosas distintas: si un día se separan, es porque alguien
 * cambió el plan, y las dos cambian juntas.
 *
 * No mira `freno`: si el borrado está frenado, quien decide es el freno y este
 * texto no llega a usarse.
 */
function loQueSeLleva(db, def, fila) {
  let plan;
  try {
    plan = planDe(db, def, fila);
  } catch (e) {
    return null; // ante la duda no se inventa un aviso: manda el camino de siempre
  }
  if (plan.freno || !plan.arrastrar || !plan.arrastrar.length) return null;

  const juntos = new Map();
  for (const { def: hijaDef } of plan.arrastrar) {
    juntos.set(hijaDef.label, (juntos.get(hijaDef.label) || 0) + 1);
  }
  const detalle = [...juntos.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n.toLocaleString('es-CL')} en ${label}`);

  return {
    cuantas: plan.arrastrar.length,
    detalle,
    enPalabras: detalle.length > 1
      ? `${detalle.slice(0, -1).join(', ')} y ${detalle[detalle.length - 1]}`
      : detalle[0],
  };
}

/**
 * La pregunta de antes de un borrado que se lleva cosas por delante.
 *
 * La escribe el motor y no cada módulo, que es el punto: el sistema tenía la
 * regla escrita dos veces —«quien va a borrar una iglesia necesita ver el
 * tamaño de lo que estaba por hacer» (server/iglesia-vacia.js) y «quien borra
 * tiene que saber qué se lleva ANTES» (la 1.376.0, al hacérselo decir a una
 * actividad de asistencia)— y la aplicaba módulo por módulo, a los que alguien
 * se acordó de ir a escribírsela.
 *
 * MEDIDO en la v1.431.0, borrando sin confirmar por las tres puertas:
 *
 *   DELETE /miembros      (2 papeles, 3 líneas de bitácora)  ....  200, sin decir nada
 *   DELETE /solicitudes   (2 papeles, 3 líneas de trámite)   ....  200, sin decir nada
 *   DELETE /pastores      (3 papeles, 8 líneas de historial) ....  200, sin decir nada
 *
 * No es un papel cualquiera: es el carnet escaneado de una persona, su
 * certificado de ordenación y el registro de su recorrido en la organización.
 */
function preguntaDeLoQueSeLleva(db, def, fila) {
  const lleva = loQueSeLleva(db, def, fila);
  if (!lleva) return null;
  /*
   * No se ofrece «márquela como inactiva» acá, aunque sea el consejo correcto
   * para una iglesia y para un cuerpo: este texto lo usan los nueve módulos que
   * arrastran algo, y una solicitud no se marca inactiva —se cierra— ni una
   * actividad de asistencia tampoco. Un aviso que manda a una puerta que no
   * existe es peor que no decir nada. El módulo que sí tiene otra salida la
   * ofrece en su propio gancho, que es donde se sabe cuál es.
   */
  return (
    `Al eliminar ${comoSeLlama(def, fila)} se van con esa ficha `
    + `${lleva.cuantas.toLocaleString('es-CL')} registro(s) más: ${lleva.enPalabras}. `
    + 'Eso no se recupera.'
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

    // Una iglesia y un cuerpo no se llevan nada consigo: si algo cuelga de
    // ellos, no se borran, y el aviso los cuenta todos de una vez.
    if (noArrastraNada(actual.def.name)) {
      const suyo = frenoDelQueNoArrastra(db, actual.def, actual.fila);
      if (suyo.freno) return { freno: suyo.freno };
      soltar.push(...suyo.soltar);
      // Lo que se va con ella entra a la cola como cualquier otra cosa que se
      // arrastra: una cuenta vacía no debería tener nada colgando, y si un día
      // lo tuviera, el que decide es el mismo camino de siempre y no éste.
      for (const hija of suyo.arrastrar) {
        const marca = `${hija.def.name}:${hija.fila.id}`;
        if (vistas.has(marca)) continue;
        vistas.add(marca);
        tocadas++;
        arrastrar.push(hija);
        cola.push(hija);
      }
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

  /*
   * Y qué enlaces quedaron vacíos, en palabras y no solo contados.
   *
   * `sueltas` se venía calculando y nadie lo miraba: la entrada del Registro de
   * Cambios decía lo que el borrado se llevó consigo y callaba lo que dejó a
   * medias. Medido: eliminando a la persona que era consejera de una directiva,
   * la directiva quedó sin consejera y ni su ficha ni el registro lo decían en
   * ninguna parte. SUELTA es la respuesta correcta —la directiva es una cosa por
   * derecho propio y no se borra porque se borre uno de sus nombres, y así está
   * escrito arriba—, pero silenciosa no: quien mañana mire esa directiva tiene
   * que poder saber por qué le falta un cargo que nadie quitó a mano.
   *
   * Se dice el módulo Y el campo, que es lo que hace útil la línea: «1 en
   * Directivas de Cuerpos (Tesorero(a))» responde la pregunta, «1 en Directivas
   * de Cuerpos» obliga a ir a mirar cuál de los seis.
   */
  let sueltas = 0;
  const vaciados = new Map();
  for (const { campo, id } of plan.soltar) {
    const cuantas = soltarEnlace(db, campo, id);
    if (!cuantas) continue;
    sueltas += cuantas;
    const donde = `${campo.def.label}${campo.etiqueta ? ` (${campo.etiqueta})` : ''}`;
    vaciados.set(donde, (vaciados.get(donde) || 0) + cuantas);
  }

  return {
    arrastradas: plan.arrastrar.length,
    sueltas,
    detalle: [...resumen.entries()].map(([label, n]) => `${n} en ${label}`),
    detalleSueltas: [...vaciados.entries()].map(([donde, n]) => `${n} en ${donde}`),
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

module.exports = {
  resolver, planDe, huerfanas, referenciasHacia, FRENA, ARRASTRA, SUELTA,
  // Lo que un borrado se lleva, dicho ANTES de hacerlo: lo usa el motor para
  // preguntar, y el gancho de Pastores / Guías para meterlo en su propia
  // pregunta, que habla de otra cosa y tiene que decir las dos.
  loQueSeLleva, preguntaDeLoQueSeLleva,
  // Se exporta para que el gancho de borrado de Iglesias pregunte sobre
  // exactamente lo mismo que después mira el plan (ver server/iglesia-vacia.js)
  cuantasApuntan,
};
