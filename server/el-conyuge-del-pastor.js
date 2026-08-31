/**
 * El matrimonio de un pastor, escrito en las dos fichas.
 *
 * El pastor y la pastora se vinculan entre sí, y de ese vínculo sale algo que
 * se lee todos los días: «A cargo de la iglesia» nombra al pastor Y A SU
 * CÓNYUGE —«Pastor Marcos Uno y Pastora Sara Vega»—, porque de una
 * congregación responden los dos.
 *
 * El módulo ya cuidaba lo obvio: nadie es su propio cónyuge, el cónyuge es del
 * sexo opuesto, y si el cargo es pastoral tiene que tener trato de Pastor o
 * Pastora por su propio registro. Faltaba lo más simple. Medido:
 *
 *   casar a Marcos con Sara ................ 200, y queda recíproco
 *   casar a LUCAS con la MISMA Sara ........ 200, aceptado
 *   Marcos.conyuge_id / Lucas.conyuge_id ... 626 / 626, los dos
 *
 * Y no se queda en la base. El desplegable de «A cargo de la iglesia» pasaba a
 * ofrecer DOS opciones que nombran a la misma esposa —«Pastor Lucas Dos y
 * Pastora Sara Vega» y «Pastor Marcos Uno y Pastora Sara Vega»—, así que quien
 * elige una de las dos para una iglesia deja anotado, y después impreso, un
 * matrimonio que no es.
 *
 * SE PREGUNTA, NO SE PROHÍBE. Hay viudez, hay segundas nupcias y hay
 * correcciones de un dato que se escribió mal; el sistema no lleva estado
 * civil y no le toca deducirlo. El aviso dice CON QUIÉN figura casada ya esa
 * persona, que es el dato con que se decide, y al confirmar se suelta el
 * vínculo anterior —que es lo que uno espera al contestar que sí—.
 *
 * Y EL VÍNCULO SE ESCRIBE EN UN SOLO LUGAR. Antes la mitad estaba en el gancho
 * del módulo: soltaba el vínculo viejo del lado de las fichas de MIEMBRO y se
 * olvidaba del lado de Pastores / Guías, que es justamente donde quedaban los
 * dos apuntando a la misma persona. Acá se hacen las dos cosas juntas, o no se
 * hace ninguna.
 */

/** Cómo se llama alguien en un aviso. */
const comoSeLlama = (f) => `${f.nombres || ''} ${f.apellidos || ''}`.trim();

/**
 * Con quién figura casada ya esta persona, sin contar a quien la está
 * eligiendo ahora. Mira los dos lados, porque el vínculo está escrito dos
 * veces: las fichas de Pastores / Guías que la nombran, y su propia ficha de
 * miembro si apunta a alguien más.
 */
function conQuienFiguraCasada(db, miembroId, exceptoPastorId) {
  if (!miembroId) return [];
  const otros = db
    .prepare('SELECT id, nombres, apellidos FROM pastores WHERE conyuge_id = ? AND id IS NOT ?')
    .all(miembroId, exceptoPastorId || 0);

  const suya = db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(miembroId);
  if (suya && suya.conyuge_id) {
    // El marido puede no tener ficha de pastor: entonces el vínculo solo
    // existe del lado de las fichas de miembro, y hay que mirarlo ahí
    const suPareja = db
      .prepare('SELECT id, nombres, apellidos FROM miembros WHERE id = ?')
      .get(suya.conyuge_id);
    const yaNombrado = otros.some((p) => {
      const suFicha = db.prepare('SELECT miembro_id FROM pastores WHERE id = ?').get(p.id);
      return suFicha && Number(suFicha.miembro_id) === Number(suya.conyuge_id);
    });
    const esElQueElige = exceptoPastorId
      && Number((db.prepare('SELECT miembro_id FROM pastores WHERE id = ?').get(exceptoPastorId) || {}).miembro_id)
         === Number(suya.conyuge_id);
    if (suPareja && !yaNombrado && !esElQueElige) otros.push(suPareja);
  }
  return otros;
}

/**
 * El aviso de que esa persona ya figura casada con otro, o null.
 *
 * Solo cuando ESTE guardado cambia el cónyuge: volver a preguntarlo cada vez
 * que alguien le corrige el teléfono a un pastor casado no es cuidar el dato,
 * es enseñar a apretar «Está bien» sin leer.
 */
function avisoSiYaEstaCasada(db, pastorId, { data, existing, confirmado }) {
  if (confirmado) return null;
  /*
   * Las tres maneras de no estar poniendo un cónyuge nuevo —que este guardado
   * no lo toque, que se lo estén quitando, y que sea el que ya tenía— salen
   * todas por la misma puerta: sin persona a quien chocarle, o siendo él mismo
   * el que ya figuraba, `conQuienFiguraCasada` no devuelve a nadie. Estaban
   * escritas aparte, una por caso, y romperlas una a una no rompía ninguna
   * prueba: eran la misma pregunta escrita cuatro veces.
   */
  const quien = data.conyuge_id;
  if (existing && String(existing.conyuge_id || '') === String(quien)) return null;

  const otros = conQuienFiguraCasada(db, quien, pastorId);
  if (!otros.length) return null;

  const ella = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(quien);
  const conQuien = otros.map((o) => `«${comoSeLlama(o)}»`).join(' y ');
  return {
    error:
      `${comoSeLlama(ella)} ya figura casada con ${conQuien}. Si confirma, ese vínculo se suelta y `
      + 'queda el nuevo: de este campo sale «A cargo de la iglesia», que nombra al pastor y a su '
      + 'cónyuge, y con los dos puestos habría dos congregaciones nombrando a la misma persona como '
      + 'esposa de gente distinta. Si hubo viudez o segundas nupcias, o el vínculo anterior estaba '
      + 'mal escrito, confirme; si no, revise a quién está eligiendo.',
    confirmar: 'conyuge_ya_casada',
  };
}

/**
 * Deja el vínculo escrito en las dos fichas, y suelta el anterior.
 *
 * Lo anterior se suelta por los DOS lados —las fichas de miembro y las de
 * Pastores / Guías—, que es lo que faltaba: sin la segunda, dos pastores
 * quedaban apuntando a la misma esposa aunque en las fichas de miembro el
 * vínculo ya se hubiera corregido.
 */
function anotarElVinculo(db, pastor, suFichaDeMiembro) {
  const conyugeId = pastor.conyuge_id || null;
  if (!conyugeId) return;

  // Ningún OTRO pastor puede quedar nombrando a esta persona como su cónyuge
  db.prepare('UPDATE pastores SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
    .run(conyugeId, pastor.id);

  if (!suFichaDeMiembro || Number(suFichaDeMiembro.id) === Number(conyugeId)) return;

  // Y del lado de las fichas de miembro, los dos vínculos que quedaran colgando
  db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE conyuge_id = ? AND id != ?')
    .run(suFichaDeMiembro.id, conyugeId);
  const otro = db.prepare('SELECT conyuge_id FROM miembros WHERE id = ?').get(conyugeId);
  if (otro && otro.conyuge_id && Number(otro.conyuge_id) !== Number(suFichaDeMiembro.id)) {
    db.prepare('UPDATE miembros SET conyuge_id = NULL WHERE id = ?').run(otro.conyuge_id);
  }
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(conyugeId, suFichaDeMiembro.id);
  db.prepare('UPDATE miembros SET conyuge_id = ? WHERE id = ?').run(suFichaDeMiembro.id, conyugeId);
}

module.exports = { conQuienFiguraCasada, avisoSiYaEstaCasada, anotarElVinculo };
