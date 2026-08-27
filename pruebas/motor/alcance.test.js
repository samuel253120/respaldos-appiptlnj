/**
 * Hasta dónde llega cada usuario.
 *
 * Sin iglesias asignadas se ve todo; con algunas, solo esas; y si además se
 * le asignaron cuerpos, dentro de sus iglesias solo lo de esos cuerpos.
 *
 * En este archivo ya aparecieron cuatro agujeros reales, todos de la misma
 * forma: una consulta que no pasaba por acá y entregaba de más. Así que las
 * pruebas insisten en dos cosas que son las que fallan: que **vacío
 * significa todas** (y no «ninguna», que cerraría el sistema) y que la
 * elección de con qué iglesia trabajar **nunca amplía** lo asignado.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const alcance = require('../../server/alcance');

/**
 * Un usuario de mentira.
 *
 * Lleva rol a propósito: desde que la tesorería se permite por nivel —la de la
 * iglesia y la de los cuerpos son dos llaves distintas—, `condiciones` también
 * consulta los permisos, y un objeto sin rol no alcanza ninguna de las dos. En
 * el sistema eso no pasa (el rol es obligatorio en la ficha del usuario), pero
 * la prueba tiene que parecerse a un usuario de verdad para medir lo que dice
 * que mide, que es el alcance por iglesia y por cuerpo.
 */
const usuario = (extra) => ({ rol: 'tesorero', ...extra });

/** Un módulo de mentira, con los campos que la lógica mira. */
const modulo = (name, campos = []) => ({ name, fields: campos.map((n) => ({ name: n })) });
const MIEMBROS = modulo('miembros', ['iglesia_id', 'nombres']);
const IGLESIAS = modulo('iglesias', ['nombre']);
const TESORERIA = modulo('tesoreria', ['iglesia_id', 'monto']);
const CUERPOS = modulo('cuerpos', ['iglesia_id', 'nombre']);
const ACTAS = modulo('actas_reuniones', ['iglesia_id', 'cuerpo_id']);

test('leer una lista de ids aguanta cualquier forma', () => {
  assert.deepEqual(alcance.lista('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(alcance.lista([1, 2]), [1, 2]);
  assert.deepEqual(alcance.lista('[]'), []);
  // y lo escrito mal no revienta ni inventa
  for (const roto of [null, undefined, '', 'no es json', '{}', '[null,0,"x"]']) {
    assert.deepEqual(alcance.lista(roto), [], `«${roto}» debería dar lista vacía`);
  }
});

test('sin iglesias asignadas, alcanza todas', () => {
  // Vacío es «todas», no «ninguna». Si se invirtiera, el administrador
  // general se quedaría sin ver nada.
  assert.deepEqual(alcance.iglesiasAsignadas({ iglesias: '[]' }), []);
  assert.equal(alcance.alcanzaIglesia({ iglesias: '[]' }, 7), true);
  assert.equal(alcance.alcanza(MIEMBROS, { id: 1, iglesia_id: 9 }, { iglesias: '[]' }), true);
});

test('la iglesia principal por sí sola NO acota', () => {
  // Fue un error real: tener puesta la iglesia principal contaba como
  // asignación, y el botón para elegir iglesia desaparecía sin motivo.
  const soloPrincipal = { iglesias: '[]', iglesia_id: 3 };
  assert.deepEqual(alcance.iglesiasAsignadas(soloPrincipal), []);
  assert.equal(alcance.alcanzaIglesia(soloPrincipal, 8), true, 'con solo la principal puesta, alcanza a todas');
});

test('la iglesia principal sí cuenta cuando ya está entre las asignadas', () => {
  const u = { iglesias: '[2,5]', iglesia_id: 2 };
  assert.deepEqual(alcance.iglesiasAsignadas(u).sort(), [2, 5]);
});

test('con iglesias asignadas, lo de otra queda afuera', () => {
  const u = usuario({ iglesias: '[2,5]' });
  assert.equal(alcance.alcanzaIglesia(u, 2), true);
  assert.equal(alcance.alcanzaIglesia(u, 5), true);
  assert.equal(alcance.alcanzaIglesia(u, 9), false);
  assert.equal(alcance.alcanzaIglesia(u, null), false);
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: 9 }, u), false);
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: 2 }, u), true);
});

test('un registro sin iglesia no es de nadie acotado', () => {
  const u = { iglesias: '[2]' };
  assert.equal(alcance.alcanza(TESORERIA, { id: 1, iglesia_id: null }, u), false);
});

test('en el módulo de iglesias, lo que se mira es su propio id', () => {
  const u = { iglesias: '[2,5]' };
  assert.equal(alcance.alcanza(IGLESIAS, { id: 2 }, u), true);
  assert.equal(alcance.alcanza(IGLESIAS, { id: 9 }, u), false);
});

test('elegir con qué iglesia trabajar acota, pero nunca amplía', () => {
  const asignadas = { iglesias: '[2,5]' };
  assert.deepEqual(alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[5]' }), [5], 'acota a la elegida');
  // La parte que importa: elegir una que no le tocó no le sirve de nada
  assert.deepEqual(
    alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[9]' }).sort(),
    [2, 5],
    'elegir una ajena tiene que volver a las suyas, no darle la ajena'
  );
  assert.deepEqual(
    alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[5,9]' }),
    [5],
    'de una elección mixta solo vale la parte que le corresponde'
  );
  assert.deepEqual(alcance.iglesiasDe({ ...asignadas, iglesias_trabajando: '[]' }).sort(), [2, 5], 'en blanco: todas las suyas');
});

test('quien no tiene ninguna asignada sí puede elegir con cuál trabajar', () => {
  const general = { iglesias: '[]', iglesias_trabajando: '[4]' };
  assert.deepEqual(alcance.iglesiasDe(general), [4]);
});

test('sin cuerpos asignados, alcanza todos', () => {
  const u = { iglesias: '[2]', cuerpos: '[]' };
  assert.deepEqual(alcance.cuerposDe(u), []);
  assert.equal(alcance.alcanzaCuerpo(u, 7), true);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 7 }, u), true);
});

test('con cuerpos asignados, lo de otro cuerpo queda afuera', () => {
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanzaCuerpo(u, 3), true);
  assert.equal(alcance.alcanzaCuerpo(u, 4), false);
  assert.equal(alcance.alcanzaCuerpo(u, null), false);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 3 }, u), true);
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 2, cuerpo_id: 4 }, u), false);
  assert.equal(alcance.alcanza(CUERPOS, { id: 3, iglesia_id: 2 }, u), true);
  assert.equal(alcance.alcanza(CUERPOS, { id: 4, iglesia_id: 2 }, u), false);
});

test('la iglesia manda antes que el cuerpo', () => {
  // Aunque el cuerpo sea de los suyos, si la iglesia no lo es, no alcanza
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanza(ACTAS, { id: 1, iglesia_id: 9, cuerpo_id: 3 }, u), false);
});

test('una asistencia se alcanza si convoca a alguno de sus cuerpos', () => {
  const ASISTENCIAS = modulo('asistencias', ['iglesia_id', 'cuerpos']);
  const u = { iglesias: '[2]', cuerpos: '[3]' };
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[3,4]' }, u), true);
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[4,5]' }, u), false);
  assert.equal(alcance.alcanza(ASISTENCIAS, { id: 1, iglesia_id: 2, cuerpos: '[]' }, u), false);
});

test('en Usuarios, uno siempre se ve a sí mismo', () => {
  // Fue un error real: el alcance filtraba Usuarios por la «iglesia
  // principal», que en una cuenta es solo un valor por omisión y que muchas
  // tienen en blanco. Quien tenía iglesias asignadas veía la lista VACÍA,
  // porque su propia cuenta tampoco calzaba.
  const USUARIOS = modulo('usuarios', ['iglesia_id', 'iglesias', 'nombre']);
  const yo = { id: 16, iglesias: '[2]' };
  assert.equal(
    alcance.alcanza(USUARIOS, { id: 16, iglesia_id: null, iglesias: '[2]' }, yo),
    true,
    'la cuenta propia tiene que alcanzarse siempre'
  );
});

test('en Usuarios se alcanza a quien administra alguna de sus iglesias', () => {
  const USUARIOS = modulo('usuarios', ['iglesia_id', 'iglesias', 'nombre']);
  const yo = { id: 16, iglesias: '[2]' };
  // Por su asignación, aunque no tenga iglesia principal puesta
  assert.equal(alcance.alcanza(USUARIOS, { id: 40, iglesia_id: null, iglesias: '[2,5]' }, yo), true);
  // Por su iglesia principal, que es el caso de las cuentas creadas desde una ficha
  assert.equal(alcance.alcanza(USUARIOS, { id: 41, iglesia_id: 2, iglesias: '[]' }, yo), true);
  // Y no a los de otra iglesia
  assert.equal(alcance.alcanza(USUARIOS, { id: 42, iglesia_id: 3, iglesias: '[3]' }, yo), false);
});

test('quien administra una iglesia NO alcanza las cuentas globales', () => {
  // A propósito: esas cuentas ven toda la organización, y quien administra
  // una sola iglesia no tiene por qué poder abrirlas ni cambiarles la clave.
  const USUARIOS = modulo('usuarios', ['iglesia_id', 'iglesias', 'nombre']);
  const yo = { id: 16, iglesias: '[2]' };
  assert.equal(alcance.alcanza(USUARIOS, { id: 1, iglesia_id: null, iglesias: '[]' }, yo), false);
});

test('el administrador general alcanza todas las cuentas', () => {
  const USUARIOS = modulo('usuarios', ['iglesia_id', 'iglesias', 'nombre']);
  const general = { id: 16, iglesias: '[]' };
  for (const cuenta of [
    { id: 1, iglesia_id: null, iglesias: '[]' },
    { id: 40, iglesia_id: 2, iglesias: '[2]' },
    { id: 41, iglesia_id: 3, iglesias: '[3]' },
  ]) {
    assert.equal(alcance.alcanza(USUARIOS, cuenta, general), true, `debería alcanzar la cuenta ${cuenta.id}`);
  }
});

test('la condición SQL de Usuarios incluye la cuenta propia', () => {
  const USUARIOS = modulo('usuarios', ['iglesia_id', 'iglesias', 'nombre']);
  const params = [];
  const sql = alcance.condiciones(USUARIOS, { id: 16, iglesias: '[2]' }, params);
  assert.match(sql, /usuarios\.id = \?/, 'sin esto, quien tiene iglesias asignadas no se ve a sí mismo');
  assert.match(sql, /json_each/, 'tiene que mirar las iglesias asignadas, no solo la principal');
  assert.ok(params.includes(16), 'el id propio tiene que ir entre los parámetros');
});

test('una fila que no existe nunca se alcanza', () => {
  assert.equal(alcance.alcanza(MIEMBROS, null, { iglesias: '[]' }), false);
  assert.equal(alcance.alcanza(MIEMBROS, undefined, { iglesias: '[]' }), false);
});

test('la iglesia por omisión es la principal, o la única que tenga', () => {
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[2,5]', iglesia_id: 5 }), 5);
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[7]' }), 7, 'con una sola, es esa');
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[2,5]' }), null, 'con varias y sin principal, ninguna');
  assert.equal(alcance.iglesiaPrincipal({ iglesias: '[]' }), null);
});

test('las condiciones SQL llevan sus parámetros en orden', () => {
  const params = [];
  const sql = alcance.condiciones(TESORERIA, { iglesias: '[2,5]' }, params);
  assert.match(sql, /iglesia_id IN \(\?,\?\)/);
  assert.deepEqual(params, [2, 5]);
});

test('sin nada asignado no se agrega ninguna condición', () => {
  const params = [];
  assert.equal(alcance.condiciones(TESORERIA, usuario({ iglesias: '[]', cuerpos: '[]' }), params), null);
  assert.deepEqual(params, []);
});

test('y alguien sin un rol que el sistema conozca no alcanza ninguna tesorería', () => {
  // No debería llegar a pasar —el rol es obligatorio— pero si pasara, lo que
  // corresponde es no entregar nada, no entregarlo todo.
  const sql = alcance.condiciones(TESORERIA, { iglesias: '[]', cuerpos: '[]' }, []);
  assert.ok(sql && sql.includes('IS NULL') && sql.includes('IS NOT NULL'),
    `tendría que quedar sin ninguna fila, y quedó: ${sql}`);
});

test('un usuario que no existe no alcanza nada', () => {
  assert.deepEqual(alcance.iglesiasAsignadas(null), []);
  assert.deepEqual(alcance.cuerposDe(null), []);
  assert.deepEqual(alcance.iglesiasDe(null), []);
});

/* ─────────────────────────────────────────────────────────────────────
   CUANDO EL `miembro_id` NO DICE DE QUIÉN ES EL REGISTRO

   El alcance por cuerpo tiene una regla general que casi siempre acierta:
   si un módulo lleva `miembro_id`, ese campo dice de quién es la ficha, y a
   quien tiene cuerpos asignados se le muestra solo lo de su gente. Vale para
   la bitácora de un miembro, para sus documentos, para sus certificados.

   Hay tres módulos donde no vale, y en los tres el resultado era el mismo:
   datos que desaparecían sin que nada lo dijera.

     SOLICITUDES          su `miembro_id` es quien la PRESENTÓ; de la solicitud
                          responde otra persona. Se le escondían a quien las
                          llevaba, y el sistema igual le avisaba y le ponía un
                          enlace que contestaba 403.
     LO QUE CUELGA DE     las personas, los documentos y el seguimiento de una
     UNA SOLICITUD        solicitud se acotaban mirando a la persona que
                          aparece dentro, no al trámite del que cuelgan.
     NO MIEMBROS          su `miembro_id` dice en qué ficha de miembro se
                          convirtió al inscribirse. Con la regla general se
                          escondía el registro entero.

   Lo que se cuida acá es que la excepción sea EXACTAMENTE esa: que se deje de
   esconder lo que ya era suyo, y que no se abra nada más.
   ───────────────────────────────────────────────────────────────────── */

const SOLICITUDES = {
  ...modulo('solicitudes', ['iglesia_id', 'miembro_id', 'responsable_id', 'asunto']),
  alcance: { tambienSuyo: 'responsable_id' },
};
const PERSONAS_SOL = {
  ...modulo('personas_solicitud', ['iglesia_id', 'miembro_id', 'solicitud_id']),
  alcance: { comoSuPadre: { modulo: 'solicitudes', campo: 'solicitud_id' } },
};
const NO_MIEMBROS = {
  ...modulo('no_miembros', ['iglesia_id', 'miembro_id', 'nombres']),
  alcance: { porMiembro: false },
};
const BITACORA = modulo('bitacora', ['iglesia_id', 'miembro_id', 'descripcion']);

const conCuerpo = usuario({ id: 7, iglesias: '[1]', cuerpos: '[3]' });

test('una solicitud también es suya si la tiene a cargo', () => {
  const params = [];
  const sql = alcance.condiciones(SOLICITUDES, conCuerpo, params);
  assert.ok(/responsable_id" = \?/.test(sql), `falta la parte de «o la llevo yo»: ${sql}`);
  assert.ok(/ OR /.test(sql), 'tiene que SUMARSE a lo de su gente, no reemplazarlo');
  assert.equal(params[params.length - 1], 7, 'el último parámetro es su id de usuario');
});

test('y fila por fila dice lo mismo que el listado', () => {
  // Si acá dijera otra cosa, se vería en la lista algo que no se deja abrir
  const deSuGente = { iglesia_id: 1, miembro_id: 999, responsable_id: 99 };
  const suya = { iglesia_id: 1, miembro_id: 999, responsable_id: 7 };
  const ajena = { iglesia_id: 1, miembro_id: 999, responsable_id: 99 };
  assert.equal(alcance.alcanza(SOLICITUDES, suya, conCuerpo), true, 'la que lleva él, sí');
  assert.equal(alcance.alcanza(SOLICITUDES, ajena, conCuerpo), false, 'la que no es suya ni de su gente, no');
  assert.equal(alcance.alcanza(SOLICITUDES, deSuGente, conCuerpo), false);
});

test('NO SE ABRE NADA MÁS: sin cuerpos asignados nada de esto cambia', () => {
  const params = [];
  const sinCuerpos = usuario({ id: 7, iglesias: '[1]', cuerpos: '[]' });
  const sql = alcance.condiciones(SOLICITUDES, sinCuerpos, params);
  assert.ok(!/responsable_id/.test(sql), 'sin cuerpos no hace falta la excepción');
});

test('la regla general sigue valiendo donde sí acierta', () => {
  /*
   * La bitácora de un miembro SÍ se acota por su miembro. En esta base el
   * cuerpo 3 no tiene a nadie, así que la condición correcta es «ninguna
   * fila» —no «todas»—: es la misma regla, con la lista vacía.
   */
  const params = [];
  const sql = alcance.condiciones(BITACORA, conCuerpo, params);
  assert.ok(/"miembro_id" IN|1 = 0/.test(sql), `tendría que acotar por su gente, y quedó: ${sql}`);
  assert.ok(!/responsable_id/.test(sql), 'la bitácora no tiene responsable: la excepción no le toca');
  assert.equal(alcance.alcanza(BITACORA, { iglesia_id: 1, miembro_id: 999 }, conCuerpo), false,
    'un miembro que no es de sus cuerpos sigue quedando fuera');
});

test('lo que cuelga de una solicitud se ve donde se ve su solicitud', () => {
  const params = [];
  const sql = alcance.condiciones(PERSONAS_SOL, conCuerpo, params);
  assert.ok(/solicitud_id" IN \(SELECT id FROM "solicitudes"/.test(sql),
    `tendría que seguir a su solicitud, y quedó: ${sql}`);
  // Y NO por la persona que aparece dentro
  assert.ok(!/"miembro_id" IN/.test(sql),
    'acotarlo por la persona escondía a los involucrados de una solicitud que sí se puede abrir');
});

test('el registro de No Miembros no se acota por su ficha de miembro', () => {
  const params = [];
  const sql = alcance.condiciones(NO_MIEMBROS, conCuerpo, params);
  assert.ok(/iglesia_id/.test(sql), 'por iglesia sí, como siempre');
  assert.ok(!/"miembro_id" IN|1 = 0/.test(sql),
    `su miembro_id dice en qué ficha se convirtió al inscribirse, no de quién es: ${sql}`);
  // La que nunca se inscribió, y la que se inscribió en un cuerpo ajeno: las dos se ven
  assert.equal(alcance.alcanza(NO_MIEMBROS, { iglesia_id: 1, miembro_id: null }, conCuerpo), true);
  assert.equal(alcance.alcanza(NO_MIEMBROS, { iglesia_id: 1, miembro_id: 999 }, conCuerpo), true,
    'con la regla general puesta, esta ficha desaparecía del registro');
});
