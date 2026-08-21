/**
 * Las cuentas de tesorería que le corresponden a cada cuerpo.
 *
 * Un cuerpo maneja dos bolsillos distintos y conviene no mezclarlos:
 *
 *   Tesorería       lo que el cuerpo recauda y gasta en su trabajo
 *   Cuotas          lo que sus integrantes pagan mes a mes
 *
 * Las dos se crean solas: al crear el cuerpo y, para los que ya existían, al
 * arrancar el sistema. Además de esas dos, cada cuerpo puede abrir las que
 * necesite para trabajos específicos.
 */
const LAS_DOS = [
  {
    tipo: 'General',
    nombre: (c) => `Tesorería — ${c.nombre}`,
    descripcion: 'Tesorería general del cuerpo: lo que recauda y gasta en su trabajo.',
  },
  {
    tipo: 'Cuotas de integrantes',
    nombre: (c) => `Cuotas — ${c.nombre}`,
    descripcion: 'Las cuotas mensuales de los integrantes, que se manejan aparte de la tesorería general.',
  },
];

/** Le crea a un cuerpo las cuentas que le falten. Devuelve cuántas creó. */
function crearLasQueFalten(db, cuerpo) {
  const yaTiene = db.prepare('SELECT id FROM cuentas_tesoreria WHERE cuerpo_id = ? AND tipo = ?');
  const crear = db.prepare(
    `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, cuerpo_id, tipo, estado, saldo_inicial, descripcion)
     VALUES (?, 'Cuerpo / Grupo', ?, ?, ?, 'Activa', 0, ?)`
  );
  let creadas = 0;
  for (const cual of LAS_DOS) {
    if (yaTiene.get(cuerpo.id, cual.tipo)) continue;
    crear.run(cual.nombre(cuerpo), cuerpo.iglesia_id, cuerpo.id, cual.tipo, cual.descripcion);
    creadas++;
  }
  return creadas;
}

module.exports = { LAS_DOS, crearLasQueFalten };
