/**
 * Datos iniciales: crea el usuario administrador si no existe ninguno.
 *
 * Credenciales por defecto (CAMBIAR tras el primer inicio de sesión):
 *   correo:     admin@iglesia.local
 *   contraseña: admin123
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');

function ensureSeed() {
  const usuarios = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (usuarios === 0) {
    db.prepare(
      `INSERT INTO usuarios (nombre, email, password, rol, activo) VALUES (?, ?, ?, 'admin', 1)`
    ).run('Administrador', 'admin@iglesia.local', bcrypt.hashSync('admin123', 10));
    console.log('👤 Usuario administrador creado: admin@iglesia.local / admin123 (cambiar la contraseña)');
  }

  const iglesias = db.prepare('SELECT COUNT(*) AS c FROM iglesias').get().c;
  if (iglesias === 0) {
    db.prepare(
      `INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')`
    ).run('Iglesia Central', 'IG-001');
    console.log('⛪ Iglesia de ejemplo creada: Iglesia Central (IG-001)');
  }
}

if (require.main === module) {
  ensureSeed();
  console.log('Semilla aplicada.');
}

module.exports = { ensureSeed };
