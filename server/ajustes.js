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

db.exec(`CREATE TABLE IF NOT EXISTS configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  actualizado_en TEXT DEFAULT (datetime('now','localtime')),
  actualizado_por INTEGER
)`);

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
