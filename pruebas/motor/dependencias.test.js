/**
 * Lo que cuelga de una ficha cuando esa ficha se borra.
 *
 * Se midió el problema antes de arreglarlo: borrar UN cuerpo y UN miembro
 * dejaba 231 filas apuntando a números que ya no existían. Doce de ellas eran
 * fichas de integrante marcadas «Activo» en un cuerpo borrado, que es por qué
 * un cuerpo que ya no estaba seguía diciendo que tenía quince personas.
 *
 * Estas pruebas fijan las tres respuestas posibles para que no se muevan sin
 * que alguien se entere: lo que frena el borrado, lo que se va con él y lo
 * que solo pierde el enlace.
 *
 * No tocan la base: le pasan una de mentira, porque lo que se está probando
 * es la decisión, no el SQL.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const dependencias = require('../../server/dependencias');
const { getModule } = require('../../server/registry');

/**
 * Una base de mentira que responde las dos únicas preguntas que hace el plan:
 * cuántas filas apuntan a un id, y cuáles son.
 *
 * `tablas` es { nombreDeTabla: [filas] }. Las filas se filtran por la columna
 * que aparezca en el WHERE, o por estar el id dentro de la lista JSON cuando
 * la consulta usa json_each (que es como se guardan los multiref).
 */
function baseCon(tablas) {
  return {
    prepare(sql) {
      const tabla = (sql.match(/FROM "([a-z_]+)"/) || [])[1];
      const filas = tablas[tabla] || [];
      const columna = (sql.match(/WHERE "[a-z_]+"\."([a-z_]+)"|WHERE "([a-z_]+)" =/) || []).filter(Boolean)[1];
      const esLista = /json_each/.test(sql);
      const columnaLista = (sql.match(/json_each\("[a-z_]+"\."([a-z_]+)"\)/) || [])[1];

      const calzan = (id) =>
        filas.filter((f) => {
          if (esLista) {
            try {
              return (JSON.parse(f[columnaLista] || '[]') || []).map(Number).includes(Number(id));
            } catch (e) {
              return false;
            }
          }
          return columna && Number(f[columna]) === Number(id);
        });

      return {
        get: (id) => ({ c: calzan(id).length }),
        all: (id) => calzan(id),
        run: () => ({ changes: 0 }),
      };
    },
  };
}

const plan = (tabla, fila, tablas) => dependencias.planDe(baseCon(tablas), getModule(tabla), fila);

// ---------------------------------------------------------------- FRENA ----

test('una cuenta con movimientos no se borra, y se dice cuántos son', () => {
  const r = plan('cuentas_tesoreria', { id: 7, nombre: 'Tesorería general' }, {
    tesoreria: [{ id: 1, cuenta_id: 7 }, { id: 2, cuenta_id: 7 }],
  });
  assert.ok(r.freno, 'tendría que haber frenado');
  assert.match(r.freno, /2 movimiento/);
  assert.match(r.freno, /Tesorería general/);
  assert.match(r.freno, /Ciérrela/, 'tiene que decir qué hacer en cambio');
});

test('un miembro con un certificado emitido no se borra', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    certificados: [{ id: 1, miembro_id: 3 }],
  });
  assert.match(r.freno, /certificado/);
});

test('un miembro que además es usuario del sistema no se borra', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    usuarios: [{ id: 9, miembro_id: 3 }],
  });
  assert.match(r.freno, /usuario/);
});

test('el freno de una cuota llega aunque cuelgue a dos saltos de la persona', () => {
  // miembro → su ficha de integrante → la cuota que esa ficha tiene pagada
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4, miembro_id: 3 }],
    cuotas_cuerpo: [{ id: 80, integrante_id: 50 }],
  });
  assert.match(r.freno, /cuota/);
  assert.match(r.freno, /Integrantes de Cuerpos/, 'tiene que decir por dónde llegó');
});

test('y desde el CUERPO ni siquiera hace falta llegar tan lejos', () => {
  /*
   * El ejemplo de este archivo era el cuerpo, y dejó de servir en la 1.250.0:
   * un cuerpo ya no arrastra sus fichas de integrante, así que el freno llega
   * en el primer salto y no en el segundo. Se conserva la prueba de los dos
   * saltos con el miembro —que sí las arrastra— y acá queda dicho por qué el
   * cuerpo ya no sirve de ejemplo.
   */
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4, miembro_id: 3 }],
    cuotas_cuerpo: [{ id: 80, integrante_id: 50 }],
  });
  assert.match(r.freno, /1 en Integrantes de Cuerpos/);
  assert.doesNotMatch(r.freno, /a través de/, 'no llegó a dos saltos: frena en el primero');
});

test('una iglesia con cualquier cosa adentro no se borra, y se cuentan todas', () => {
  const r = plan('iglesias', { id: 1, nombre: 'Iglesia Central' }, {
    miembros: [{ id: 1, iglesia_id: 1 }, { id: 2, iglesia_id: 1 }, { id: 3, iglesia_id: 1 }],
    cuerpos: [{ id: 4, iglesia_id: 1 }],
  });
  assert.match(r.freno, /4 registro/, 'suma los de todos los módulos, no el primero que aparezca');
  assert.match(r.freno, /3 en Miembros/);
  assert.match(r.freno, /inactiva/, 'tiene que ofrecer la salida');
});

// ------------------------------------------------------------- ARRASTRA ----

test('un miembro se lleva su bitácora, sus marcas y sus documentos', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    bitacora: [{ id: 1, miembro_id: 3 }, { id: 2, miembro_id: 3 }],
    asistencia_detalle: [{ id: 10, miembro_id: 3 }],
    documentos_miembros: [{ id: 20, miembro_id: 3 }],
  });
  assert.equal(r.freno, null);
  const tablas = r.arrastrar.map((x) => x.def.name).sort();
  assert.deepEqual(tablas, ['asistencia_detalle', 'bitacora', 'bitacora', 'documentos_miembros']);
});

test('una persona se lleva sus fichas de integrante, y cada una sus evaluaciones', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    integrantes_cuerpo: [{ id: 50, miembro_id: 3 }],
    evaluaciones_integrantes: [{ id: 90, integrante_id: 50 }],
  });
  assert.equal(r.freno, null);
  const tablas = r.arrastrar.map((x) => x.def.name);
  assert.ok(tablas.includes('evaluaciones_integrantes') && tablas.includes('integrantes_cuerpo'));
});

test('lo que se arrastra viene de las hojas hacia arriba', () => {
  // Si se borrara primero el integrante, su evaluación quedaría apuntando a
  // algo que ya no está durante el rato que dura el borrado.
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    integrantes_cuerpo: [{ id: 50, miembro_id: 3 }],
    evaluaciones_integrantes: [{ id: 90, integrante_id: 50 }],
  });
  const cuales = r.arrastrar.map((x) => x.def.name);
  assert.ok(cuales.indexOf('evaluaciones_integrantes') < cuales.indexOf('integrantes_cuerpo'));
});

test('pero un CUERPO no se lleva a su gente: se frena (1.250.0)', () => {
  /*
   * Éste era el ejemplo de ARRASTRA en cadena de este archivo, y era también
   * el defecto: borrar un cuerpo con seis integrantes desde 2019 contestaba
   * 200 sin preguntar y las seis fichas dejaban de existir. Ahora el cuerpo
   * está entre los que no arrastran nada (ver server/cuerpo-vacio.js).
   */
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4 }],
    evaluaciones_integrantes: [{ id: 90, integrante_id: 50 }],
  });
  assert.match(String(r.freno), /No se puede eliminar el cuerpo/);
  assert.equal(r.arrastrar, undefined, 'frenado, no hay nada que arrastrar');
});

// --------------------------------------------------------------- SUELTA ----

test('el cuerpo que lo tenía de líder se queda, sin líder', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    cuerpos: [{ id: 4, lider_id: 3 }],
  });
  assert.equal(r.freno, null);
  assert.equal(r.arrastrar.length, 0, 'un cuerpo no se borra porque se fue su líder');
  assert.ok(r.soltar.some((s) => s.campo.clave === 'cuerpos.lider_id'));
});

test('la directiva donde era tesorero se queda, sin tesorero', () => {
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    directivas: [{ id: 6, tesorero_id: 3 }],
  });
  assert.equal(r.arrastrar.length, 0);
  assert.ok(r.soltar.some((s) => s.campo.clave === 'directivas.tesorero_id'));
});

test('un acta que nombraba a varios asistentes no se borra con uno de ellos', () => {
  /*
   * Que uno de los ids de una lista desaparezca nunca puede borrar la fila
   * entera: se saca de la lista y se deja el resto.
   */
  const r = plan('miembros', { id: 3, nombres: 'Ana', apellidos: 'Díaz' }, {
    actas_reuniones: [{ id: 11, asistentes: '[3,5]' }],
  });
  assert.equal(r.freno, null);
  assert.equal(r.arrastrar.length, 0, 'el acta sigue: todavía nombra al otro');
  assert.ok(r.soltar.some((s) => s.campo.clave === 'actas_reuniones.asistentes'));
});

test('y un cuerpo que fue convocado a una actividad no se borra', () => {
  /*
   * Con el cuerpo el ejemplo cambió de sentido en la 1.250.0: la actividad ya
   * no pierde el enlace, porque el cuerpo no llega a borrarse. Haber sido
   * convocado a una reunión es parte de lo que ese cuerpo hizo, y soltarle el
   * enlace dejaría la actividad diciendo que convocó a menos cuerpos de los
   * que convocó.
   */
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    asistencias: [{ id: 11, cuerpos: '[4,5]' }],
  });
  assert.match(String(r.freno), /No se puede eliminar el cuerpo/);
});

// ------------------------------------------------------------- LA REGLA ----

test('la regla por defecto sale de si la referencia es obligatoria', () => {
  // Obligatoria: la fila no puede existir sin su destino, así que se va con él.
  const seVa = plan('asistencias', { id: 11 }, { asistencia_detalle: [{ id: 1, asistencia_id: 11 }] });
  assert.equal(seVa.arrastrar.length, 1);

  // Opcional: la fila vive igual sin ella, así que solo pierde el enlace.
  // El ejemplo era «solicitudes.miembro_id» y dejó de servir: una solicitud
  // pasó a decir de qué registro salió quien la presentó, así que soltarle el
  // enlace la dejaría diciendo «Miembro» y apuntando a nadie. Ahora frena, y
  // el ejemplo de referencia opcional es el líder de un cuerpo, que sí puede
  // quedarse sin nadie: el cuerpo sigue existiendo mientras se nombra a otro.
  const seQueda = plan('miembros', { id: 3, nombres: 'A', apellidos: 'B' }, {
    cuerpos: [{ id: 1, lider_id: 3, nombre: 'Coro' }],
  });
  assert.equal(seQueda.arrastrar.length, 0);
  assert.ok(seQueda.soltar.some((s) => s.campo.clave === 'cuerpos.lider_id'));
});

test('un cónyuge que se apunta a su propio módulo no da vueltas para siempre', () => {
  const r = plan('miembros', { id: 3, nombres: 'Juan', apellidos: 'Pérez' }, {
    miembros: [{ id: 4, conyuge_id: 3 }],
  });
  assert.equal(r.freno, null);
  assert.equal(r.arrastrar.length, 0, 'el cónyuge sobrevive: solo pierde el enlace');
});

test('una ficha sin nada colgando se borra sin más', () => {
  const r = plan('miembros', { id: 3, nombres: 'Sin', apellidos: 'Nada' }, {});
  assert.equal(r.freno, null);
  assert.equal(r.arrastrar.length, 0);
});

// ──────────────────────────── que no quede ninguna sin decidir (1.97.3) ───
/*
 * POR QUÉ ESTAS TRES PRUEBAS, Y POR QUÉ ACÁ.
 *
 * La auditoría hizo notar que server/db.js ejecuta `PRAGMA foreign_keys = ON`
 * y que esa línea no hace nada: ninguna de las 36 tablas declara una llave
 * foránea, así que no hay nada que hacer cumplir. Eso está bien —es una
 * decisión, no un olvido: la integridad se cuida acá, donde se puede decir
 * «esto FRENA el borrado» y no solo «esto existe o no»— pero deja una promesa
 * apoyada en el aire: si la base no lo cuida y el código sí, más vale que el
 * código las cubra TODAS.
 *
 * Las catorce pruebas de arriba miran casos concretos: la cuenta con
 * movimientos, el miembro con certificado, la cuota que cuelga a dos saltos.
 * Ninguna miraba el conjunto. Estas sí, y son las que se caen el día que
 * alguien agregue un módulo con una referencia que nadie clasificó: no rompen
 * ninguna pantalla, solo dejan filas colgando en silencio, que es exactamente
 * lo que una llave foránea habría atrapado.
 */
const { allModules } = require('../../server/registry');

/** Todas las referencias del sistema, con el módulo del que salen. */
function todasLasReferencias() {
  const todas = [];
  for (const def of allModules()) {
    for (const campo of dependencias.referenciasHacia(def.name)) {
      todas.push({ hacia: def.name, ...campo });
    }
  }
  return todas;
}

test('toda referencia entre módulos tiene decidido qué pasa al borrar', () => {
  const sinDecidir = todasLasReferencias()
    .filter((c) => !c.regla || !c.regla.que)
    .map((c) => c.clave);
  assert.deepEqual(sinDecidir, [],
    `sin regla: ${sinDecidir.join(', ')}. Toda referencia tiene que frenar el borrado, irse con él o soltar el enlace.`);
});

test('y esa decisión es una de las tres, no cualquier cosa', () => {
  const LAS_TRES = [dependencias.FRENA, dependencias.ARRASTRA, dependencias.SUELTA];
  const raras = todasLasReferencias()
    .filter((c) => !LAS_TRES.includes(c.regla.que))
    .map((c) => `${c.clave} → ${c.regla.que}`);
  assert.deepEqual(raras, [], `reglas que no son ninguna de las tres: ${raras.join(', ')}`);
});

test('ninguna referencia apunta a un módulo que no existe', () => {
  // Una que apuntara a un módulo inexistente se saltaría el plan entera y sin
  // ruido: nadie frenaría, nadie arrastraría, y lo que colgara quedaría ahí.
  const alVacio = [];
  for (const def of allModules()) {
    for (const f of def.fields) {
      if ((f.type !== 'ref' && f.type !== 'multiref') || !f.ref) continue;
      if (!getModule(f.ref)) alVacio.push(`${def.name}.${f.name} → «${f.ref}»`);
    }
  }
  assert.deepEqual(alVacio, [], `referencias a módulos que no existen: ${alVacio.join(', ')}`);
});

test('el sistema tiene tantas referencias como para que esto valga la pena', () => {
  // Si esta cuenta se desploma, es que referenciasHacia dejó de encontrarlas y
  // las tres pruebas de arriba estarían pasando por no mirar nada.
  const cuantas = todasLasReferencias().length;
  assert.ok(cuantas >= 80, `solo se encontraron ${cuantas} referencias: la búsqueda dejó de funcionar`);
});
