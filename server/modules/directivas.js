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
 * Los cargos los ocupan **integrantes del propio cuerpo**: sus selectores
 * ofrecen solo a quienes pertenecen al cuerpo elegido, y el servidor lo
 * verifica al guardar.
 *
 * El oficial supervisor(a) es la excepción: viene del cuerpo de oficiales (su
 * nombre se define en Configuración → Organización), porque supervisa a los
 * demás cuerpos desde fuera. Mientras ese cuerpo no exista, ofrece a todos
 * los miembros para no bloquear.
 *
 * Regla: un cuerpo tiene como máximo UNA directiva vigente. Al marcar una
 * como vigente, las demás de ese cuerpo pasan a "Finalizada" automáticamente.
 */
const { cuerpoDeOficiales } = require('../oficiales');
const { idsDeIntegrantes: idsDelCuerpo } = require('../integrantes');

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
    const ids = idsDelCuerpo(db, cuerpo.id);
    if (ids.length) permitidos = new Set(ids);
  }

  return filas
    .filter((f) => !permitidos || permitidos.has(f.id))
    .map((f) => ({ id: f.id, label: displayOf(miembros, f) }));
}

/** Integrantes de un cuerpo (los que pertenecen hoy, más su líder), como opciones. */
function integrantesDeCuerpo(db, cuerpoId) {
  const { getModule, displayOf } = require('../registry'); // tardío: evita ciclo con el registro
  const miembros = getModule('miembros');
  if (!cuerpoId) return [];

  return idsDelCuerpo(db, cuerpoId)
    .map((id) => db.prepare('SELECT * FROM miembros WHERE id = ?').get(id))
    .filter(Boolean)
    .map((f) => ({
      id: f.id,
      label: displayOf(miembros, f),
      buscar: `${displayOf(miembros, f)} ${f.rut || ''} ${f.telefono || ''}`.trim(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Ids de quienes pueden ocupar un cargo en la directiva de este cuerpo. */
function idsDeIntegrantes(db, cuerpoId) {
  return new Set(integrantesDeCuerpo(db, cuerpoId).map((o) => o.id));
}

const CARGOS_DEL_CUERPO = [
  ['primer_jefe_id', 'Primer jefe / Primera jefa'],
  ['segundo_jefe_id', 'Segundo jefe / Segunda jefa'],
  ['secretario_id', 'Secretario(a)'],
  ['tesorero_id', 'Tesorero(a)'],
  ['consejero_id', 'Consejero(a)'],
];

module.exports = {
  name: 'directivas',
  label: 'Directivas de Cuerpos',
  labelSingular: 'Directiva',
  icon: '🏅',
  group: 'Organización',
  order: 53,
  display: '{periodo}',
  dateField: 'fecha_inicio',
  printable: true,
  searchFields: ['periodo', 'otros_cargos', 'notas'],
  listFields: ['cuerpo_id', 'periodo', 'primer_jefe_id', 'secretario_id', 'fecha_inicio', 'fecha_termino', 'estado'],
  defaultSort: { field: 'fecha_inicio', dir: 'desc' },
  fields: [
    { name: 'cuerpo_id', label: 'Cuerpo', type: 'ref', ref: 'cuerpos', required: true },
    { name: 'periodo', label: 'Período', type: 'text', required: true, help: 'Ej: 2026 – 2027' },
    // Una directiva puede quedar electa para asumir más adelante.
    { name: 'fecha_inicio', label: 'Fecha de inicio', type: 'date', required: true, futuro: true },
    { name: 'fecha_termino', label: 'Fecha de término', type: 'date', futuro: true, noAntesDe: 'fecha_inicio', help: 'Al llegar esta fecha, la directiva figura como vencida en el estado de cumplimiento.' },
    // --- Integrantes de la directiva ---
    {
      name: 'oficial_supervisor_id', label: 'Oficial supervisor(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/oficiales',
      help: 'Integrante del cuerpo de oficiales designado para supervisar este cuerpo.',
    },
    {
      name: 'primer_jefe_id', label: 'Primer jefe / Primera jefa', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}',
      help: 'Se elige entre los integrantes del cuerpo.',
    },
    { name: 'segundo_jefe_id', label: 'Segundo jefe / Segunda jefa', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'secretario_id', label: 'Secretario(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'tesorero_id', label: 'Tesorero(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}' },
    { name: 'consejero_id', label: 'Consejero(a)', type: 'ref', ref: 'miembros',
      optionsRoute: '/directivas/integrantes?cuerpo_id={cuerpo_id}', help: 'Cargo adicional, no siempre se designa.' },
    { name: 'otros_cargos', label: 'Otros cargos', type: 'textarea', help: 'Opcional. Ej: Directora de música: Ana Soto' },
    { name: 'acta_eleccion', label: 'Acta de elección', type: 'file' },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias' },
    {
      name: 'estado', label: 'Estado', type: 'select', required: true, default: 'Vigente',
      options: ['Vigente', 'Finalizada'],
    },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
  extraRoutes(router, { db, base, requirePerm }) {
    // Las dos rutas de acá llenan selectores del formulario de directivas, así
    // que hay que poder ver directivas para pedirlas. Antes solo comprobaban el
    // alcance —de qué iglesia y de qué cuerpo—, no el permiso, y eso dejaba que
    // alguien a quien se le hubiera cerrado el módulo igual leyera sus listas.
    router.get(`${base}/oficiales`, requirePerm('directivas', 'view'), (req, res) => {
      res.json(oficialesDisponibles(db, req.user));
    });

    // Integrantes del cuerpo elegido: de ahí salen los cargos de su directiva.
    // Sin cuerpo no hay a quién ofrecer, y el selector lo dice.
    router.get(`${base}/integrantes`, requirePerm('directivas', 'view'), (req, res) => {
      const cuerpoId = Number(req.query.cuerpo_id) || null;
      if (!cuerpoId) return res.json([]);
      const cuerpo = db.prepare('SELECT iglesia_id FROM cuerpos WHERE id = ?').get(cuerpoId);
      if (!cuerpo) return res.json([]);
      const alcance = require('../alcance');
      // La iglesia y el cuerpo: quien tiene asignado un cuerpo no puede
      // listar la gente de otro, aunque sea de la misma iglesia.
      if (!alcance.alcanzaIglesia(req.user, cuerpo.iglesia_id) || !alcance.alcanzaCuerpo(req.user, cuerpoId)) {
        return res.status(403).json({ error: 'Ese cuerpo está fuera de lo que tiene asignado' });
      }
      res.json(integrantesDeCuerpo(db, cuerpoId));
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

      // Los cargos los ocupan integrantes del propio cuerpo. Solo se revisa lo
      // que se está cambiando ahora: si alguien salió del cuerpo después de
      // haber sido electo, su directiva anterior se puede seguir corrigiendo.
      const permitidos = idsDeIntegrantes(db, cuerpoId);
      for (const [campo, cargo] of CARGOS_DEL_CUERPO) {
        const valor = data[campo];
        if (valor === undefined || valor === null || valor === '') continue;
        const cambia = !existing || String(existing[campo] || '') !== String(valor);
        if (!cambia) continue;
        if (!permitidos.has(Number(valor))) {
          const cuerpo = db.prepare('SELECT nombre FROM cuerpos WHERE id = ?').get(cuerpoId);
          const persona = db.prepare('SELECT nombres, apellidos FROM miembros WHERE id = ?').get(valor);
          const quien = persona ? `${persona.nombres} ${persona.apellidos}`.trim() : `#${valor}`;
          return `${quien} no es integrante de "${cuerpo ? cuerpo.nombre : 'ese cuerpo'}", así que no puede ser ${cargo} de su directiva. Agréguelo primero al cuerpo.`;
        }
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
