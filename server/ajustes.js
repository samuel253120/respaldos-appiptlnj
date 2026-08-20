/**
 * Ajustes del sistema: definición, lectura y escritura de las opciones
 * globales (tabla `configuracion`).
 *
 * Este archivo no depende de Express ni de la autenticación, para que
 * cualquier parte del servidor pueda consultar una opción sin crear
 * dependencias circulares. La interfaz web se atiende en configuracion.js.
 *
 * PARA AGREGAR UNA OPCIÓN: añadirla a OPCIONES y queda disponible en la
 * pantalla de configuración, con su tipo de campo y su valor por defecto.
 */
const { db } = require('./db');

// Si no se puede crear (volumen lleno o de solo lectura), se anota y se sigue:
// el sistema tiene que levantar aunque los ajustes queden con sus valores por
// defecto, para poder entrar a ver qué pasa.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT,
    actualizado_en TEXT DEFAULT (datetime('now','localtime')),
    actualizado_por INTEGER
  )`);
} catch (e) {
  console.error(`⚠️  No se pudo preparar la tabla de configuración: ${e.message}`);
}

const OPCIONES = [
  {
    grupo: 'Mantenimiento',
    items: [
      {
        clave: 'mantenimiento_activo', label: 'Sistema en mantenimiento', tipo: 'boolean', defecto: '0',
        publica: true,
        ayuda: 'Mientras esté activo, solo los administradores pueden ingresar. El resto verá el aviso de abajo.',
      },
      {
        clave: 'mantenimiento_mensaje', label: 'Aviso que verán los usuarios', tipo: 'textarea',
        defecto: 'El sistema está en mantenimiento. Volveremos en unos minutos.',
        publica: true,
      },
    ],
  },
  {
    grupo: 'Identidad',
    items: [
      { clave: 'iglesia_nombre', label: 'Nombre de la institución', tipo: 'text', defecto: 'Iglesia Pentecostal Triunfante', publica: true },
      { clave: 'iglesia_lema', label: 'Lema', tipo: 'text', defecto: '«La Nueva Jerusalén»', publica: true },
    ],
  },
  {
    grupo: 'Organización',
    items: [
      {
        clave: 'cuerpo_oficiales', label: 'Cuerpo de oficiales', tipo: 'text', defecto: 'Oficiales',
        ayuda:
          'Nombre del cuerpo cuyos integrantes pueden ser designados oficial supervisor(a) de los demás ' +
          'cuerpos. Mientras ese cuerpo no exista o no tenga integrantes, se puede elegir a cualquier miembro.',
      },
      {
        clave: 'ofrenda_porcentaje_fondo', label: 'Porcentaje de la ofrenda que se aparta', tipo: 'number', defecto: '10',
        ayuda:
          'En el Registro de Servicios, de cada ofrenda se aparta este porcentaje para el fondo de la ' +
          'corporación y el resto queda para la iglesia local.',
      },
      {
        clave: 'ofrenda_registra_tesoreria', label: 'Registrar la ofrenda en tesorería', tipo: 'boolean', defecto: '1',
        ayuda:
          'Al guardar un servicio con ofrenda, el sistema anota solo dos ingresos: el porcentaje apartado en el ' +
          '«Fondo para la corporación» de esa iglesia y el resto en su tesorería general. Apáguelo si prefiere ' +
          'ingresar las ofrendas a mano en Tesorería.',
      },
    ],
  },
  {
    grupo: 'Acceso',
    items: [
      {
        clave: 'password_inicial', label: 'Contraseña inicial', tipo: 'text', defecto: 'Iglesia2026',
        ayuda:
          'La que se le entrega a cada cuenta nueva y la que restablece el administrador cuando alguien ' +
          'olvida la suya. Al entrar con ella, el sistema obliga a cambiarla por una propia.',
      },
      {
        clave: 'password_minimo', label: 'Largo mínimo de la contraseña', tipo: 'number', defecto: '6',
        ayuda: 'Cuántos caracteres debe tener, como mínimo, la contraseña que elija cada persona (entre 4 y 40).',
      },
      {
        clave: 'recuperacion_activa', label: 'Permitir recuperar la contraseña con una pregunta', tipo: 'boolean', defecto: '1',
        publica: true,
        ayuda:
          'Cada persona define una pregunta secreta desde «Mi cuenta»; si olvida su contraseña, la responde ' +
          'en la pantalla de acceso y elige una nueva. Apagado, solo el administrador puede restablecerla.',
      },
    ],
  },
  {
    grupo: 'Preferencias',
    items: [
      {
        clave: 'moneda_simbolo', label: 'Símbolo de moneda', tipo: 'text', defecto: '$',
        ayuda: 'Se usa al mostrar montos en tesorería, ayudas sociales e inventarios.',
      },
      {
        clave: 'registros_por_pagina', label: 'Registros por página', tipo: 'number', defecto: '25',
        ayuda: 'Cantidad de filas que muestran los listados (entre 10 y 200).',
      },
      {
        clave: 'sesion_horas', label: 'Duración de la sesión (horas)', tipo: 'number', defecto: '12',
        ayuda: 'Tras ese tiempo sin renovar, se pide iniciar sesión nuevamente.',
      },
      {
        clave: 'imagen_lado_maximo', label: 'Tamaño máximo de las imágenes (píxeles)', tipo: 'number', defecto: '1600',
        ayuda:
          'Al subir una foto (de un miembro, de un documento), el sistema la reduce hasta ese lado mayor ' +
          'antes de enviarla: carga mucho más rápido y se ve igual. Entre 600 y 4000.',
      },
      {
        clave: 'imagen_calidad', label: 'Calidad de las imágenes (%)', tipo: 'number', defecto: '88',
        ayuda: 'Qué tanto detalle conserva la foto reducida. 88 conserva la calidad a simple vista; 100 no comprime.',
      },
      {
        clave: 'cumpleanos_cantidad', label: 'Cumpleaños que muestra el panel', tipo: 'number', defecto: '4',
        ayuda: 'Cuántos miembros próximos a cumplir años aparecen en la pantalla de inicio (entre 1 y 20).',
      },
      {
        clave: 'bitacora_automatica', label: 'Registrar automáticamente en la bitácora', tipo: 'boolean', defecto: '1',
        ayuda: 'Anota por sí solo los cambios de datos de miembros, ingresos a cuerpos, solicitudes, ayudas y certificados.',
      },
    ],
  },
];

const PLANOS = OPCIONES.flatMap((g) => g.items);
const POR_CLAVE = Object.fromEntries(PLANOS.map((o) => [o.clave, o]));

/** Valor actual de una opción (o su valor por defecto). */
function obtener(clave) {
  const fila = db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
  if (fila && fila.valor !== null && fila.valor !== undefined) return fila.valor;
  return POR_CLAVE[clave] ? POR_CLAVE[clave].defecto : null;
}

/** Igual que obtener(), pero para opciones de Sí/No. */
function activo(clave) {
  return String(obtener(clave)) === '1';
}

/** Número con límites, para opciones numéricas. */
function numero(clave, minimo, maximo) {
  const n = Number(obtener(clave));
  if (!Number.isFinite(n)) return Number(POR_CLAVE[clave].defecto);
  return Math.min(maximo, Math.max(minimo, n));
}

function todas() {
  return Object.fromEntries(PLANOS.map((o) => [o.clave, obtener(o.clave)]));
}

function guardar(clave, valor, usuarioId) {
  if (!POR_CLAVE[clave]) return;
  db.prepare(
    `INSERT INTO configuracion (clave, valor, actualizado_por) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor,
       actualizado_en = datetime('now','localtime'), actualizado_por = excluded.actualizado_por`
  ).run(clave, String(valor), usuarioId || null);
}

module.exports = { OPCIONES, POR_CLAVE, obtener, activo, numero, todas, guardar };
