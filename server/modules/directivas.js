/**
 * Módulo: Directivas de Cuerpos (histórico).
 *
 * Cada cuerpo formal elige su directiva por períodos. Aquí queda el registro
 * de todas: la vigente y las anteriores, con sus cargos y el acta de elección.
 *
 * La directiva se compone de: oficial supervisor(a), primer jefe / primera
 * jefa, segundo jefe / segunda jefa, secretario(a), tesorero(a) y, cuando se
 * designa, consejero(a).
 *
 * El oficial supervisor(a) es un integrante del cuerpo de oficiales (su
 * nombre se define en Configuración → Organización) designado para supervisar
 * a los demás cuerpos. Por eso su selector no ofrece todos los miembros, sino
 * los de ese cuerpo; mientras no exista, ofrece a todos para no bloquear.
 *
 * Regla: un cuerpo tiene como máximo UNA directiva vigente. Al marcar una
 * como vigente, las demás de ese cuerpo pasan a "Finalizada" automáticamente.
 */
const { cuerpoDeOficiales } = require('../oficiales');

/**
 * Miembros que pueden ser oficial supervisor(a): los del cuerpo de oficiales.
 * Si ese cuerpo todavía no existe o no tiene integrantes, se devuelven todos
 * los miembros, para no dejar el campo sin opciones.
 */
function oficialesDisponibles(db, usuario) {
  const { getModule, displayOf } = require('../registry'); // tardío: evita ciclo con el registro
  const miembros = getModule('miembros');

  const iglesiaId = usuario && usuario.iglesia_id;
  const filas = db
    .prepare(`SELECT * FROM miembros ${iglesiaId ? 'WHERE iglesia_id = ?' : ''} ORDER BY id DESC LIMIT 1000`)
    .all(...(iglesiaId ? [iglesiaId] : []));

  const cuerpo = cuerpoDeOficiales(db);
  let permitidos = null;
  if (cuerpo) {
    let ids = [];
    try {
      ids = JSON.parse(cuerpo.integrantes || '[]');
    } catch (e) {
      ids = [];
    }
    if (cuerpo.lider_id) ids.push(cuerpo.lider_id);
    ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
    if (ids.length) permitidos = new Set(ids);
  }

  return filas
    .filter((f) => !permitidos || permitidos.has(f.id))
    .map((f) => ({ id: f.id, label: displayOf(miembros, f) }));
}

module.exports = {
  name: 'directivas',
  label: 'Directivas de Cuerpos',
  labelSingular: 'Directiva',
  icon: '🏅',
  group: 'Organización',
  order: 13,
  display: '{periodo}',
  dateField: 'fecha_inicio',
  printable: true,
  searchFields: ['periodo', 'otros_cargos', 'notas'],
  listFields: ['cuerpo_id', 'periodo', 'primer_jefe_id', 'secretario_id', 'fecha_inicio', 'fecha_termino', 'estado'],
  defaultSort: { field: 'fecha_inicio', dir: 'desc' },
  fields: [
    { name: 'cuerpo_id', label: 'Cuerpo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'periodo', label: 'Período', type: 'text', required: true, help: 'Ej: 2026 – 2027' },
    { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true },
    { name: 'fecha_termino', label: 'Fecha de término', type: 'date', help: 'Al llegar esta fecha, la directiva figura como vencida en el estado de cumplimiento.' },
    // --- Integrantes de la directiva ---
    {
      name: 'oficial_supervisor_id', label: 'Oficial supervisor(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/oficiales',
      help: 'Integrante del cuerpo de oficiales designado para supervisar este cuerpo.',
    },
    { name: 'primer_jefe_id', label: 'Primer jefe / Primera jefa', type: 'ref', ref: 'miembros' },
    { name: 'segundo_jefe_id', label: 'Segundo jefe / Segunda jefa', type: 'ref', ref: 'miembros' },
    { name: 'secretario_id', label: 'Secretario(a)', type: 'ref', ref: 'miembros' },
    { name: 'tesorero_id', label: 'Tesorero(a)', type: 'ref', ref: 'miembros' },
    { name: 'consejero_id', label: 'Consejero(a)', type: 'ref', ref: 'miembros', help: 'Cargo adicional, no siempre se designa.' },
    { name: 'otros_cargos', label: 'Otros cargos', type: 'textarea', help: 'Opcional. Ej: Directora de música: Ana Soto' },
    { name: 'acta_eleccion', label: 'Acta de elección', type: 'file' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Vigente',
      options: ['Vigente', 'Finalizada'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  extraRoutes(router, { db, base }) {
    // Opciones del selector "Oficial supervisor(a)" (ver optionsRoute del campo).
    router.get(`${base}/oficiales`, (req, res) => {
      res.json(oficialesDisponibles(db, req.user));
    });
  },
  hooks: {
    beforeSave(data, { db, id, existing }) {
      const cuerpoId = data.cuerpo_id !== undefined ? data.cuerpo_id : existing && existing.cuerpo_id;
      if (!cuerpoId) return null;

      // Heredar la iglesia del cuerpo
      if (data.iglesia_id === undefined || data.iglesia_id === null) {
        const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
        if (cuerpo) data.iglesia_id = cuerpo.iglesia_id;
      }

      // Una sola directiva vigente por cuerpo
      const estado = data.estado !== undefined ? data.estado : existing && existing.estado;
      if (estado === 'Vigente') {
        db.prepare(
          `UPDATE directivas SET estado = 'Finalizada' WHERE cuerpo_id = ? AND id != ? AND estado = 'Vigente'`
        ).run(cuerpoId, id || 0);
      }
      return null;
    },
  },
};
