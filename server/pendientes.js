/**
 * Lo que falta por llenar en las fichas.
 *
 * Una base traída de otro sistema llega siempre con huecos: gente sin
 * teléfono, sin fecha de nacimiento, sin a quién llamar si algo pasa. No es un
 * error del programa —esos datos nunca se cargaron— pero mientras nadie los
 * vea, nadie los llena, y el día que hay que avisarle a alguien no hay por
 * dónde.
 *
 * Lo que se pide acá es lo que se puede conseguir preguntando. Un dato que la
 * congregación no tiene por cómo es —el correo de una membresía mayor— no es
 * una tarea pendiente: es ruido que tapa las que sí lo son. Está dicho abajo,
 * en la línea donde estaba.
 *
 * Esto los pone a la vista y, sobre todo, los deja **abrir**: cada línea
 * lleva al listado de Miembros filtrado justo por los que a quienes les falta
 * ese dato, para ir completándolos. De ahí se puede bajar la planilla y salir
 * a pedirlos, que es como se llenan de verdad.
 *
 * Se cuenta sobre **todas** las fichas, sin distinguir por estado. La
 * tentación era contar solo los activos —a quien se trasladó no hay que
 * perseguirlo para pedirle el teléfono—, pero entonces el número no calzaría
 * con la lista que se abre al tocarlo, y un conteo que no se puede abrir es
 * justo lo que se quería evitar. Además, un dato que falta sigue faltando
 * aunque la persona ya no esté: el día que pida un certificado, no está.
 *
 * Respeta el alcance de quien pregunta: el secretario de un cuerpo ve lo que
 * falta en su cuerpo, no en toda la organización.
 */
const { db } = require('./db');
const { getModule } = require('./registry');
const alcance = require('./alcance');

/**
 * Los datos que se echan de menos, y por qué importa cada uno.
 *
 * No están todos los campos de la ficha a propósito: una lista con cuarenta
 * líneas no se mira. Están los que sirven para algo concreto —ubicar a la
 * persona, saludarla, atenderla— y por eso cada uno dice para qué es.
 */
const LO_QUE_IMPORTA = [
  { campo: 'telefono', label: 'Teléfono', para: 'Para poder ubicarlos y avisarles de las actividades.' },
  { campo: 'fecha_nacimiento', label: 'Fecha de nacimiento', para: 'Sin ella no aparecen en los cumpleaños ni se sabe su edad.' },
  { campo: 'direccion', label: 'Dirección', para: 'Para las visitas y para saber quién vive cerca de quién.' },
  /*
   * El CORREO ELECTRÓNICO no está, y no es un olvido.
   *
   * Esta lista existe para que alguien salga a pedir lo que falta. Un dato que
   * la mayoría de la congregación no tiene ni va a tener no se pide: se
   * arrastra. Medido en la Iglesia Matriz: de 179 fichas, 109 sin correo —el
   * 61%—, y la razón no es que nadie lo haya cargado, es que buena parte de la
   * membresía es gente mayor que no usa correo. Puesto acá, encabezaba la
   * tarjeta con la cifra más alta y empujaba hacia abajo los que sí se pueden
   * conseguir preguntando, como el teléfono y el contacto de emergencia.
   *
   * Peor todavía en el número de arriba: al contar para «tienen todos estos
   * datos puestos», esas 109 fichas quedaban incompletas por lo único que no se
   * les va a poder llenar, y el avance de las demás no se notaba nunca.
   *
   * El campo sigue en la ficha y se guarda igual; quien quiera ver a quiénes
   * les falta, la dirección #/m/miembros?sin=email lo sigue contestando. Lo que
   * deja de hacer es ocupar un renglón de una lista que es para salir a pedir.
   */
  { campo: 'genero', label: 'Sexo', para: 'De ahí sale el trato con que el sistema se dirige a cada persona.' },
  { campo: 'fecha_ingreso', label: 'Fecha de ingreso a la iglesia', para: 'Para saber desde cuándo son parte y calcular antigüedad.' },
  { campo: 'emergencia_telefono', label: 'Contacto de emergencia', para: 'A quién llamar si algo pasa en una actividad.' },
  { campo: 'estado', label: 'Estado', para: 'Sin él no se sabe si la persona sigue en la iglesia, se trasladó o falleció.' },
  /*
   * De este cuelga quién entra solo a la directiva de la iglesia, y estaba en
   * blanco en las 603 fichas de la base cargada sin que nada lo dijera. Un
   * campo del que depende una regla automática y que nadie llena es una regla
   * que no se está aplicando.
   */
  { campo: 'tipo_miembro', label: 'Tipo de miembro', para: 'De él sale quién compone la directiva de la iglesia.' },
];

/** Los miembros que alcanza quien pregunta, como trozo de SQL. */
function acotar(usuario, params) {
  return alcance.condiciones(getModule('miembros'), usuario, params) || null;
}

/**
 * El resumen: cuántas fichas activas hay y a cuántas les falta cada dato.
 */
function resumen(usuario) {
  const def = getModule('miembros');
  const campos = new Set(db.prepare('PRAGMA table_info("miembros")').all().map((c) => c.name));

  const params = [];
  const donde = [];
  const scope = acotar(usuario, params);
  if (scope) donde.push(scope);
  const whereSql = donde.length ? 'WHERE ' + donde.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM miembros ${whereSql}`).get(...params).c;

  const faltas = [];
  for (const dato of LO_QUE_IMPORTA) {
    if (!campos.has(dato.campo)) continue;
    const cuantos = db
      .prepare(
        `SELECT COUNT(*) AS c FROM miembros ${whereSql} ${whereSql ? 'AND' : 'WHERE'} ` +
          `("${dato.campo}" IS NULL OR TRIM("${dato.campo}") = '')`
      )
      .get(...params).c;
    if (cuantos) faltas.push({ ...dato, cuantos, porcentaje: total ? Math.round((cuantos / total) * 100) : 0 });
  }
  faltas.sort((a, b) => b.cuantos - a.cuantos);

  // Los menores sin adulto responsable van aparte: no es un dato que falte por
  // completar la ficha, es una obligación de la propia iglesia.
  let menoresSinResponsable = 0;
  // Se cuenta al que no tiene NINGUNO de los dos: ni la ficha elegida ni el
  // nombre escrito. Mirando solo el nombre, a todo menor con su adulto
  // elegido de la membresía se le contaba como si no tuviera a nadie.
  if (campos.has('fecha_nacimiento') && campos.has('responsable_nombre')) {
    menoresSinResponsable = db
      .prepare(
        `SELECT COUNT(*) AS c FROM miembros ${whereSql} ${whereSql ? 'AND' : 'WHERE'}
           fecha_nacimiento IS NOT NULL AND fecha_nacimiento <> ''
           AND CAST((julianday('now') - julianday(fecha_nacimiento)) / 365.25 AS INTEGER) < 18
           AND (responsable_nombre IS NULL OR TRIM(responsable_nombre) = '')
           AND (responsable_id IS NULL OR responsable_id = '')`
      )
      .get(...params).c;
  }

  // Cuántas fichas tienen puestos todos los datos de la lista: es el número
  // que dice si esto va avanzando o sigue igual.
  const puestos = LO_QUE_IMPORTA.filter((d) => campos.has(d.campo)).map(
    (d) => `"${d.campo}" IS NOT NULL AND TRIM("${d.campo}") <> ''`
  );
  const conTodo = total
    ? db
        .prepare(
          `SELECT COUNT(*) AS c FROM miembros ${whereSql} ` +
            (puestos.length ? `${whereSql ? 'AND' : 'WHERE'} ${puestos.join(' AND ')}` : '')
        )
        .get(...params).c
    : 0;

  return {
    total,
    conTodo,
    faltas,
    menoresSinResponsable,
    alDia: !faltas.length && !menoresSinResponsable,
  };
}

module.exports = { resumen, LO_QUE_IMPORTA };
