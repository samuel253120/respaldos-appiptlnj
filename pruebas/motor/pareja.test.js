/**
 * La ficha que no se dejaba guardar.
 *
 * Vincular el matrimonio de un pastor y registrarlo en Pastores / Guías son
 * dos actos distintos, y entre uno y otro pueden pasar meses. En ese rato la
 * pareja queda a medias: él figura como pastor y ella sigue con trato de
 * hermana.
 *
 * La regla que exige que los dos tengan trato de Pastor o Pastora se aplicaba
 * en TODO guardado, así que desde ese momento la ficha de ella no se dejaba
 * guardar más: ni para corregirle el teléfono, ni la dirección, ni nada. Se
 * topó tres veces probando otras cosas, así que en el uso real aparece. Y
 * castigaba a quien venía a arreglar algo distinto por una situación que no
 * creó y que a lo mejor ni sabía.
 *
 * El criterio ahora: una comprobación frena el guardado que EMPEORA las
 * cosas, no el que simplemente no arregla algo que ya estaba. Lo que ya
 * estaba se avisa arriba de la ficha, que es donde alguien puede hacer algo.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const miembros = require('../../server/modules/miembros');

/** La base de mentira que la comprobación consulta. */
function baseCon(fichas, pastores) {
  return {
    prepare(sql) {
      return {
        get(...p) {
          if (/FROM miembros/.test(sql)) return fichas.find((f) => Number(f.id) === Number(p[0])) || undefined;
          if (/FROM pastores/.test(sql)) {
            return pastores.find((x) => p.some((v) => v != null && (x.rut === v || Number(x.miembro_id) === Number(v)))) || undefined;
          }
          return undefined;
        },
        all: () => [],
      };
    },
  };
}

const ELLA = { id: 604, nombres: 'Ana', apellidos: 'Díaz', genero: 'Femenino', rut: '16111223-2', conyuge_id: 605 };
const EL = { id: 605, nombres: 'Juan', apellidos: 'Pérez', genero: 'Masculino', rut: '16111222-4', conyuge_id: 604 };
const EL_ES_PASTOR = [{ rut: '16111222-4', cargo: 'Pastor Diácono', miembro_id: 605 }];

test('una ficha ya vinculada se puede seguir guardando', () => {
  // Lo que estaba roto: cambiarle el teléfono a ella se rechazaba
  const problema = miembros.hooks.beforeSave(
    { telefono: '+56944445555' },
    { id: 604, existing: ELLA, db: baseCon([ELLA, EL], EL_ES_PASTOR) }
  );
  assert.ok(!problema, `no debería frenar y dijo: ${problema}`);
});

test('ni guardándola tal como está', () => {
  const problema = miembros.hooks.beforeSave(
    { nombres: 'Ana', apellidos: 'Díaz' },
    { id: 604, existing: ELLA, db: baseCon([ELLA, EL], EL_ES_PASTOR) }
  );
  assert.ok(!problema, `no debería frenar y dijo: ${problema}`);
});

test('pero sí se frena al ARMAR el vínculo', () => {
  // Acá el guardado es el que está creando la situación: ahí sí corresponde
  const sinVinculo = { ...ELLA, conyuge_id: null };
  const problema = miembros.hooks.beforeSave(
    { conyuge_id: 605 },
    { id: 604, existing: sinVinculo, db: baseCon([sinVinculo, EL], EL_ES_PASTOR) }
  );
  assert.match(String(problema), /todavía no tiene trato de Pastora/);
});

test('y al cambiarlo por otro', () => {
  const otro = { id: 700, nombres: 'Pedro', apellidos: 'Soto', genero: 'Masculino', rut: '17111222-3' };
  const esPastor = [{ rut: '17111222-3', cargo: 'Pastor', miembro_id: 700 }];
  const problema = miembros.hooks.beforeSave(
    { conyuge_id: 700 },
    { id: 604, existing: ELLA, db: baseCon([ELLA, otro], esPastor) }
  );
  assert.match(String(problema), /todavía no tiene trato de Pastor/);
});

test('y al crear la ficha ya vinculada', () => {
  const problema = miembros.hooks.beforeSave(
    { nombres: 'Nueva', apellidos: 'Hermana', genero: 'Femenino', conyuge_id: 605 },
    { id: null, existing: null, db: baseCon([EL], EL_ES_PASTOR) }
  );
  assert.match(String(problema), /todavía no tiene trato de Pastora/);
});

test('nadie puede figurar como su propio cónyuge, se toque o no el vínculo', () => {
  // Esta sí vale siempre: no depende de otra ficha ni de Pastores
  const problema = miembros.hooks.beforeSave(
    { telefono: '+56911112222' },
    { id: 604, existing: { ...ELLA, conyuge_id: 604 }, db: baseCon([ELLA], []) }
  );
  assert.match(String(problema), /su propio cónyuge/);
});

test('el aviso dice qué falta y a quién', () => {
  const campo = miembros.computed.find((c) => c.name === 'pareja_pendiente');
  const texto = campo.calc(ELLA, { db: baseCon([ELLA, EL], EL_ES_PASTOR) });
  assert.match(texto, /todavía no tiene trato de Pastora/);
  assert.match(texto, /Pastores \/ Guías/, 'y dónde arreglarlo');
});

test('una ficha sin cónyuge no da aviso ni consulta la base', () => {
  const campo = miembros.computed.find((c) => c.name === 'pareja_pendiente');
  let consultas = 0;
  const base = { prepare() { consultas++; return { get: () => undefined, all: () => [] }; } };
  assert.equal(campo.calc({ id: 1, conyuge_id: null }, { db: base }), '');
  assert.equal(consultas, 0, 'la ficha sin cónyuge —que son casi todas— no debería costar nada');
});

test('una pareja en regla no da aviso', () => {
  const campo = miembros.computed.find((c) => c.name === 'pareja_pendiente');
  const losDos = [{ rut: '16111222-4', cargo: 'Pastor Diácono', miembro_id: 605 },
                  { rut: '16111223-2', cargo: 'Pastora', miembro_id: 604 }];
  assert.equal(campo.calc(ELLA, { db: baseCon([ELLA, EL], losDos) }), '');
});
