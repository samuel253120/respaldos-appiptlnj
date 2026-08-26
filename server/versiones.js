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
  { version: "1.111.0", fecha: "2026-08-26", titulo: "Vista previa del certificado, en el formato y al emitirlo, sin guardar nada" },
  { version: "1.110.0", fecha: "2026-08-26", titulo: "Los formatos de los certificados los mantiene la iglesia: su texto, qué muestra la hoja y su diseño" },
  { version: "1.109.0", fecha: "2026-08-26", titulo: "La asistencia se lleva por cuerpo: quien está en dos puede quedar justificado en uno y ausente en el otro" },
  { version: "1.108.0", fecha: "2026-08-26", titulo: "Al pasar lista, filtrar por un cuerpo ya no esconde a quien está además en otro" },
  { version: "1.107.2", fecha: "2026-08-26", titulo: "La reparación de la directiva no devolvía a nadie: pedía una fecha de ingreso que esas fichas nunca tuvieron" },
  { version: "1.107.1", fecha: "2026-08-26", titulo: "Se devuelve a los integrantes que la regla de la directiva había retirado por error, y ahora solo maneja a los líderes" },
  { version: "1.107.0", fecha: "2026-08-26", titulo: "Los miembros líderes entran y salen solos de la directiva de su iglesia" },
  { version: "1.106.0", fecha: "2026-08-26", titulo: "El panel ya no muestra las últimas asistencias, y la barra de arriba cabe hasta en un teléfono de 320 px" },
  { version: "1.105.0", fecha: "2026-08-26", titulo: "Revisión de todas las pantallas en el teléfono: 540 cosas que se veían mal, y una prueba nueva que las vigila" },
  { version: "1.104.1", fecha: "2026-08-26", titulo: "El editor de permisos cabía a medias en el teléfono: faltaban las cuatro columnas de acciones" },
  { version: "1.104.0", fecha: "2026-08-26", titulo: "En el teléfono, los botones ya no tapan la fecha y los filtros dejan ver los registros" },
  { version: "1.103.0", fecha: "2026-08-26", titulo: "Optimización completa: entrar pesa 155 KB menos y con señal mala el panel aparece antes" },
  { version: "1.102.0", fecha: "2026-08-25", titulo: "Tres permisos nuevos, cinco ajustes nuevos, y los tipos de actividad y motivos de ausencia los mantiene la iglesia" },
  { version: "1.101.1", fecha: "2026-08-25", titulo: "Tres llaves que se podían conceder y no servían de nada: ahora sí" },
  { version: "1.101.0", fecha: "2026-08-25", titulo: "El menú tiene su buscador de secciones, y el número de acta lo propone el sistema" },
  { version: "1.100.0", fecha: "2026-08-25", titulo: "El acta de reunión se descarga como PDF, con todo lo que tiene y el membrete de la institución" },
  { version: "1.99.1", fecha: "2026-08-25", titulo: "Los asistentes del acta salen de la lista que se pasó, y no de un campo que ofrecía a toda la iglesia" },
  { version: "1.99.0", fecha: "2026-08-25", titulo: "El acta trae el texto del documento adjunto y se enlaza con la lista de asistencia de esa reunión" },
  { version: "1.98.1", fecha: "2026-08-25", titulo: "No se puede apuntar a lo que no se alcanza: se cierra la escritura que ampliaba el propio alcance" },
  { version: "1.98.0", fecha: "2026-08-25", titulo: "Auditoría de aislamiento: diez rutas entregaban datos de otra iglesia, y una dejaba entrar a una cuenta ajena" },
  { version: "1.97.5", fecha: "2026-08-25", titulo: "El archivo del sistema anterior se puede sacar del servidor: terminado el traspaso, ya no tiene para qué quedarse" },
  { version: "1.97.4", fecha: "2026-08-25", titulo: "En las planillas los teléfonos bajan sin el «+», que Excel podía comerse" },
  { version: "1.97.3", fecha: "2026-08-25", titulo: "Queda dicho quién cuida la integridad de los datos, y vigilado que no se le escape ninguna referencia" },
  { version: "1.97.2", fecha: "2026-08-25", titulo: "No se guarda una referencia a un registro que no existe" },
  { version: "1.97.1", fecha: "2026-08-25", titulo: "Cada campo dice cómo se llama: el sistema se puede usar sin ver la pantalla" },
  { version: "1.97.0", fecha: "2026-08-25", titulo: "El informe de asistencia abre en el año en curso, y la base ya sabe buscar por fecha" },
  { version: "1.96.3", fecha: "2026-08-25", titulo: "Una dirección mal escrita ya no deja sin listados a todo el mundo" },
  { version: "1.96.2", fecha: "2026-08-25", titulo: "Una asignación de iglesias mal escrita ya no se guarda vacía: se rechaza y se dice por qué" },
  { version: "1.96.1", fecha: "2026-08-25", titulo: "Una etiqueta sin cerrar ya no se cuela en un acta, y un «<» escrito a mano ya no se come la frase" },
  { version: "1.96.0", fecha: "2026-08-25", titulo: "Los números de las planillas bajan como números, y dos guardados a la vez ya no se traban" },
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
