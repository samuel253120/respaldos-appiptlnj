/**
 * El sistema andando de verdad, dentro de una prueba del motor.
 *
 * POR QUÉ EXISTE. Las pruebas del motor miran las piezas por dentro, y eso
 * deja fuera lo único que la persona ve: que el MOTOR corra la regla al
 * guardar o al borrar. Se notó al revés, escribiendo la regla de la iglesia
 * inactiva: borrando de server/crud.js la línea que lanzaba su aviso, las
 * diecisiete pruebas seguían pasando en verde, porque todas llamaban a la
 * regla a mano. La regla estaba escrita, comprobada y desconectada.
 *
 * Acá se levanta el MISMO router que usa el servidor —server/crud.js
 * `buildRouter`, con su autenticación de siempre— y se le mandan peticiones
 * HTTP como las manda el navegador. No hay nada simulado: el pase se firma con
 * la llave del sistema, el usuario existe en la base, y el guardado pasa por
 * las mismas comprobaciones que en producción.
 *
 * Se usa así:
 *
 *   const { elSistemaAndando, cerrarElSistema } = require('./andando');
 *   test.after(cerrarElSistema);
 *   const api = await elSistemaAndando();
 *   const r = await api('POST', '/miembros', { ... });   // { estado, texto, json }
 *
 * `comoOtroUsuario(fila)` devuelve lo mismo para una cuenta cualquiera de la
 * base, que es lo que hace falta para comprobar el alcance y los permisos: una
 * regla que solo se prueba con el administrador general no se prueba, porque él
 * lo alcanza todo y nunca choca con ninguna.
 *
 * Cada archivo de prueba corre en su propio proceso, así que cada uno levanta
 * el suyo en un puerto libre y con su propia cuenta de administrador.
 */
const express = require('express');
const jwt = require('jsonwebtoken');

const { db } = require('../../server/db');
const { buildRouter } = require('../../server/crud');
const { JWT_SECRET } = require('../../server/auth');
const { digitoVerificador } = require('../../server/rut');

let servidor = null;
let pedir = null;
let puertoDelSistema = 0;

/** Una sesión abierta para una cuenta cualquiera, en el mismo sistema andando. */
function comoOtroUsuario(usuarioId) {
  if (!puertoDelSistema) throw new Error('llame antes a elSistemaAndando()');
  const fila = db.prepare('SELECT id, rol FROM usuarios WHERE id = ?').get(usuarioId);
  if (!fila) throw new Error(`no hay ninguna cuenta con el id ${usuarioId}`);
  const pase = jwt.sign({ id: fila.id, rol: fila.rol }, JWT_SECRET, { expiresIn: '1h' });
  return async (metodo, ruta, cuerpo) => {
    const r = await fetch(`http://127.0.0.1:${puertoDelSistema}/api${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${pase}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    return { estado: r.status, texto, json };
  };
}

/** El sistema andando, con una sesión de administrador general ya abierta. */
async function elSistemaAndando() {
  if (pedir) return pedir;

  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter());
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((listo) => servidor.once('listening', listo));
  const puerto = servidor.address().port;
  puertoDelSistema = puerto;

  // Un RUT propio de este proceso: los archivos del motor corren en paralelo
  // sobre una misma base y el RUT no se repite.
  const numero = `${90000000 + (process.pid % 9000000)}`;
  const quien = db
    .prepare('INSERT INTO usuarios (rut, nombre, rol, activo, debe_cambiar_password) VALUES (?,?,?,1,0)')
    .run(`${numero}-${digitoVerificador(numero)}`, `Administradora de prueba ${process.pid}`, 'admin');
  const pase = jwt.sign({ id: quien.lastInsertRowid, rol: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

  pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${pase}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* no era JSON */ }
    return { estado: r.status, texto, json };
  };
  return pedir;
}

/** Se pasa a `test.after` para que el proceso termine. */
function cerrarElSistema() {
  if (servidor) servidor.close();
  servidor = null;
  puertoDelSistema = 0;
}

module.exports = { elSistemaAndando, comoOtroUsuario, cerrarElSistema };
