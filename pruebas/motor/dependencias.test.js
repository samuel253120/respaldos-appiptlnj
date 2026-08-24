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

test('el freno de una cuota llega aunque cuelgue a dos saltos del cuerpo', () => {
  // cuerpo → su ficha de integrante → la cuota que esa ficha tiene pagada
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4, miembro_id: 3 }],
    cuotas_cuerpo: [{ id: 80, integrante_id: 50 }],
  });
  assert.match(r.freno, /cuota/);
  assert.match(r.freno, /Integrantes de Cuerpos/, 'tiene que decir por dónde llegó');
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

test('un cuerpo se lleva sus integrantes, y cada integrante sus evaluaciones', () => {
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4 }],
    evaluaciones_integrantes: [{ id: 90, integrante_id: 50 }],
  });
  assert.equal(r.freno, null);
  assert.deepEqual(r.arrastrar.map((x) => x.def.name), ['evaluaciones_integrantes', 'integrantes_cuerpo']);
});

test('lo que se arrastra viene de las hojas hacia arriba', () => {
  // Si se borrara primero el integrante, su evaluación quedaría apuntando a
  // algo que ya no está durante el rato que dura el borrado.
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    integrantes_cuerpo: [{ id: 50, cuerpo_id: 4 }],
    evaluaciones_integrantes: [{ id: 90, integrante_id: 50 }],
  });
  assert.equal(r.arrastrar[0].def.name, 'evaluaciones_integrantes');
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

test('una actividad que convocaba a varios cuerpos no se borra con uno de ellos', () => {
  const r = plan('cuerpos', { id: 4, nombre: 'Coro' }, {
    asistencias: [{ id: 11, cuerpos: '[4,5]' }],
  });
  assert.equal(r.freno, null);
  assert.equal(r.arrastrar.length, 0, 'la actividad sigue: todavía convoca al otro cuerpo');
  assert.ok(r.soltar.some((s) => s.campo.clave === 'asistencias.cuerpos'));
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
