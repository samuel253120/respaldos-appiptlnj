/**
 * Qué trajo cada versión del sistema.
 *
 * La fase 6 de la especificación de credenciales pide «dejar el registro en el
 * módulo de Historial de Versiones». Este sistema no tenía uno: el número de
 * versión vivía en package.json y se veía de refilón en la pantalla de acceso,
 * y lo que había cambiado había que ir a buscarlo al repositorio, donde no
 * entra quien usa el sistema.
 *
 * Así que el registro vive acá y se ve en Configuración. Sirve para lo que de
 * verdad se necesita en el día a día: comprobar que el servidor ya se actualizó
 * y saber qué se supone que trae esta versión.
 *
 * AL PUBLICAR UNA VERSIÓN NUEVA se agrega su línea arriba de todo, con la misma
 * frase con que se describió el cambio. Si falta, la pantalla lo dice: muestra
 * la versión que está corriendo y avisa de que no está en esta lista, que es
 * mejor que callarse.
 *
 * Las versiones anteriores a la 1.58.0 son de antes de este registro.
 */
const VERSIONES = [
  { version: "1.95.0", fecha: "2026-08-25", titulo: "Todo lo que se imprime identifica a la institución, dice quién lo emitió y sale sin restos de pantalla" },
  { version: "1.94.0", fecha: "2026-08-25", titulo: "El menú se reordenó por lo que más se usa, y sus grupos se pliegan" },
  { version: "1.93.0", fecha: "2026-08-25", titulo: "Al aprobar una solicitud de ayuda social, la ayuda queda registrada sola" },
  { version: "1.92.1", fecha: "2026-08-25", titulo: "El texto de los botones anchos ya no queda pegado a la izquierda" },
  { version: "1.92.0", fecha: "2026-08-25", titulo: "La base se compacta sola: el espacio de lo borrado vuelve al disco" },
  { version: "1.91.0", fecha: "2026-08-25", titulo: "Cuatro permisos nuevos: mantenimiento, RUT y fecha de nacimiento, imprimir, y tramitar solicitudes de otros" },
  { version: "1.90.0", fecha: "2026-08-25", titulo: "Siete ajustes nuevos: plazos, vigencia de credenciales y valores por defecto al pasar lista" },
  { version: "1.89.0", fecha: "2026-08-25", titulo: "El sistema anotaba con la hora del servidor, no con la de Chile: ahora la zona horaria se elige" },
  { version: "1.88.0", fecha: "2026-08-25", titulo: "La aplicación ahora abre aunque no haya señal, y avisa que no la hay" },
  { version: "1.87.3", fecha: "2026-08-25", titulo: "Apagar los avisos de un aparato ya no falla, y se pueden apagar los huérfanos" },
  { version: "1.87.2", fecha: "2026-08-25", titulo: "El icono de la aplicación ya no sale con el nombre de la iglesia cortado" },
  { version: "1.87.1", fecha: "2026-08-24", titulo: "El aviso de prueba dice de verdad qué falló, y la campanita lleva a sus preferencias" },
  { version: "1.87.0", fecha: "2026-08-24", titulo: "Avisos: la campanita del sistema y los avisos en el teléfono" },
  { version: "1.86.0", fecha: "2026-08-24", titulo: "Las solicitudes ahora se siguen: número, responsable, traslados e historial" },
  { version: "1.85.0", fecha: "2026-08-24", titulo: "La planilla mensual de asistencia de cada cuerpo, para imprimir y firmar" },
  { version: "1.84.1", fecha: "2026-08-24", titulo: "En el teléfono, el aviso de que no hay respaldo ya no se sale de la pantalla" },
  { version: "1.84.0", fecha: "2026-08-24", titulo: "Un registro aparte para las personas que no son de la iglesia y reciben ayuda" },
  { version: "1.83.0", fecha: "2026-08-24", titulo: "El panel abre cuatro veces más rápido cuando la iglesia ya tiene datos" },
  { version: "1.82.0", fecha: "2026-08-24", titulo: "Seis cosas que encontró la revisión del código, y sus arreglos" },
  { version: "1.81.0", fecha: "2026-08-24", titulo: "Cifrar una contraseña ya no deja frenado al resto del sistema" },
  { version: "1.80.0", fecha: "2026-08-24", titulo: "La configuración del sistema, en pestañas" },
  { version: "1.79.0", fecha: "2026-08-24", titulo: "Una imagen con transparencia ya no se sube con el fondo relleno de blanco" },
  { version: "1.78.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 6: permisos, auditoría e historial de versiones" },
  { version: "1.77.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 5: la verificación pública y el aviso de vencimiento" },
  { version: "1.76.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 4: el diseño, la impresión y el QR leído del papel" },
  { version: "1.75.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 3: crear, emitir y revocar" },
  { version: "1.74.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 2: los recursos institucionales y la clave del QR" },
  { version: "1.73.0", fecha: "2026-08-24", titulo: "Credenciales · Fase 1: la base, el número de serie y la limpieza" },
  { version: "1.72.1", fecha: "2026-08-23", titulo: "El sistema se llama «Gestión de Iglesias»" },
  { version: "1.72.0", fecha: "2026-08-23", titulo: "Un buscador general, arriba de todo" },
  { version: "1.71.0", fecha: "2026-08-23", titulo: "Más cosas que se deciden en Configuración y no en el código" },
  { version: "1.70.0", fecha: "2026-08-23", titulo: "Las secciones de una ficha, en pestañas" },
  { version: "1.69.0", fecha: "2026-08-23", titulo: "La tesorería de un cuerpo, aparte de la de la iglesia" },
  { version: "1.68.0", fecha: "2026-08-23", titulo: "Que se pueda personalizar todo lo que el sistema comprueba" },
  { version: "1.67.0", fecha: "2026-08-23", titulo: "Que el editor de permisos muestre todo lo que el sistema comprueba" },
  { version: "1.66.0", fecha: "2026-08-23", titulo: "Ver en qué se está usando el disco" },
  { version: "1.65.0", fecha: "2026-08-23", titulo: "Avisar cuando hace mucho que nadie se baja el respaldo" },
  { version: "1.64.0", fecha: "2026-08-23", titulo: "Que se pueda usar sin ver la pantalla, y cuatro detalles menores" },
  { version: "1.63.0", fecha: "2026-08-23", titulo: "Contraseñas que protejan, subida con permiso y números que no se repiten" },
  { version: "1.62.0", fecha: "2026-08-23", titulo: "Que solo se pueda pasar lista a quien está convocado" },
  { version: "1.61.0", fecha: "2026-08-23", titulo: "Que la planilla entre por la misma puerta que el formulario" },
  { version: "1.60.0", fecha: "2026-08-23", titulo: "Que las fechas y los montos tengan sentido antes de guardarse" },
  { version: "1.59.0", fecha: "2026-08-23", titulo: "Que borrar no deje datos colgando" },
  { version: "1.58.0", fecha: "2026-08-23", titulo: "Cerrar la lista de opciones de los módulos que no se pueden ver" },
];

module.exports = { VERSIONES };
