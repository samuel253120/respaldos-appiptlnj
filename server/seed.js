/**
 * Datos iniciales: crea el usuario administrador si no existe ninguno.
 *
 * Credenciales por defecto (CAMBIAR tras el primer inicio de sesión):
 *   RUT:        11.111.111-1
 *   contraseña: admin123
 *
 * Además avisa si quedan usuarios sin RUT (cuentas creadas antes de que el
 * acceso fuera por RUT): esas personas entran con su correo hasta que se les
 * asigne uno desde el módulo Usuarios.
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');

function ensureSeed() {
  const usuarios = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (usuarios === 0) {
    db.prepare(
      `INSERT INTO usuarios (rut, nombre, password, rol, activo) VALUES (?, ?, ?, 'admin', 1)`
    ).run('11111111-1', 'Administrador', bcrypt.hashSync('admin123', 10));
    console.log('👤 Usuario administrador creado: RUT 11.111.111-1 / admin123 (cambiar la contraseña)');
  }

  const iglesias = db.prepare('SELECT COUNT(*) AS c FROM iglesias').get().c;
  if (iglesias === 0) {
    db.prepare(
      `INSERT INTO iglesias (nombre, codigo, estado) VALUES (?, ?, 'Activa')`
    ).run('Iglesia Central', 'IG-001');
    console.log('⛪ Iglesia de ejemplo creada: Iglesia Central (IG-001)');
  }

  const sinRut = db.prepare("SELECT nombre, email FROM usuarios WHERE rut IS NULL OR rut = ''").all();
  if (sinRut.length) {
    console.log(
      `ℹ️  ${sinRut.length} usuario(s) sin RUT: ` +
        sinRut.map((u) => `${u.nombre}${u.email ? ` (${u.email})` : ''}`).join(', ') +
        '\n   Pueden entrar con su correo hasta que se les asigne un RUT en el módulo Usuarios.'
    );
  }
}

if (require.main === module) {
  ensureSeed();
  console.log('Semilla aplicada.');
}

module.exports = { ensureSeed };
