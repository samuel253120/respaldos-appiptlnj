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

  // Tesorería: la cuenta general de la corporación y la de cada iglesia, para
  // que se pueda registrar el primer movimiento sin tener que crearlas a mano.
  const cuentas = db.prepare('SELECT COUNT(*) AS c FROM cuentas_tesoreria').get().c;
  if (cuentas === 0) {
    const crear = db.prepare(
      `INSERT INTO cuentas_tesoreria (nombre, ambito, iglesia_id, tipo, estado, saldo_inicial, descripcion)
       VALUES (?, ?, ?, ?, 'Activa', 0, ?)`
    );
    crear.run('Tesorería general de la corporación', 'Corporación', null, 'General', 'Tesorería general de toda la organización.');
    let creadas = 1;
    for (const ig of db.prepare('SELECT id, nombre FROM iglesias').all()) {
      crear.run(`Tesorería general — ${ig.nombre}`, 'Iglesia local', ig.id, 'General', 'Tesorería general de la iglesia local.');
      crear.run(
        `Fondo para la corporación — ${ig.nombre}`, 'Iglesia local', ig.id, 'Fondo para la corporación',
        'Donde la iglesia aparta lo que le corresponde a la corporación, hasta traspasarlo.'
      );
      creadas += 2;
    }
    console.log(`🏦 ${creadas} cuenta(s) de tesorería creadas (generales y fondos para la corporación).`);
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
