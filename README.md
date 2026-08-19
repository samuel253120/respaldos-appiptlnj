# Sistema de Gestión — Iglesia Pentecostal Triunfante «La Nueva Jerusalén»

<img src="public/img/logo-128.png" alt="Emblema de la iglesia" width="110" align="right" />

Sistema web integral para administrar **varias iglesias** desde un solo lugar. Incluye 15 módulos completos, control de usuarios con roles y permisos, alcance multi-iglesia, carga de archivos, impresión de certificados / credenciales / actas y un panel de control con indicadores.

## Identidad institucional

El emblema de la iglesia se usa en la pantalla de acceso, el menú, el ícono de la aplicación y los documentos impresos (certificados, credenciales y actas). Los colores del sistema —azul `#16265c` y dorado `#e8b52c`— se tomaron del propio emblema.

Los archivos están en `public/img/logo.png` (con fondo transparente) y `public/icons/`. Para cambiarlos, reemplace esas imágenes; el nombre y el lema se editan en la constante `IGLESIA` al inicio de `public/app.js`.

## Módulos incluidos

| Grupo | Módulos |
|---|---|
| **Organización** | Iglesias · Pastores / Guías · Cuerpos / Grupos · Directivas de Cuerpos |
| **Servicios** | Registro de Servicios (cultos: salmo, mensaje, asistencia y ofrenda) |
| **Personas** | Miembros · Asistencias (con lista nominal de presentes) · Bitácora de Miembros · Documentos de Miembros |
| **Finanzas** | Tesorería (ingresos/egresos con resumen y balance) · Ayudas Sociales · Inventarios (de iglesia y de cuerpos) |
| **Documentación** | Actas de Reuniones de Cuerpos · Actas de Asambleas · Documentos · Certificados · Credenciales · Solicitudes |
| **Administración** | Usuarios (roles y permisos) |

Todos los módulos tienen: listado con búsqueda, filtros, ordenamiento y paginación; formularios generados automáticamente; y (donde aplica) filtro por rango de fechas, adjuntos y vista de impresión.

## Requisitos

- Node.js 18 o superior

## Instalación y arranque

```bash
npm install
npm start          # inicia en http://localhost:3000
# o en desarrollo (reinicio automático al editar):
npm run dev
```

Al primer arranque se crean automáticamente:

- **Usuario administrador**: RUT `11.111.111-1` / contraseña `admin123` → **cambiar la contraseña de inmediato** (módulo Usuarios).
- Una iglesia de ejemplo ("Iglesia Central").

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DATA_DIR` | `./data` | Carpeta de la base de datos SQLite y archivos subidos |
| `JWT_SECRET` | (insegura) | **Definir en producción**: clave para firmar sesiones |

La base de datos es un único archivo SQLite (`data/iglesias.db`); para respaldar el sistema basta copiar la carpeta `data/`.

## Acceso por RUT

El identificador de acceso es el **RUT**, no el correo: no cambia y es único por persona (el correo es solo un dato de contacto opcional). Se puede escribir con o sin puntos —`12.345.678-5`, `12345678-5` o `123456785` son equivalentes— y el sistema valida el **dígito verificador** e impide RUT repetidos.

> Cuentas creadas antes de este cambio que aún no tengan RUT pueden seguir entrando con su correo hasta que se les asigne uno desde el módulo Usuarios (el servidor lo avisa al iniciar).

**Miembros y Pastores** también se identifican por RUT, con la misma validación y sin repetidos (evita registrar dos veces a la misma persona). Para quienes no tengan RUT —extranjeros recién llegados, por ejemplo— existe el campo *Otro documento (pasaporte / extranjero)*.

Al actualizar un sistema que ya tenía datos, los valores del antiguo campo "Documento de identidad" se convierten solos: los que son RUT válidos pasan al campo RUT y el resto se conserva en *Otro documento*. La conversión se informa al iniciar y no repite trabajo.

## Importar datos desde otro sistema o desde Excel 📥

Cada módulo tiene el botón **⬆️ Importar** (junto a "Nuevo"), que carga datos masivamente desde un archivo **CSV**:

1. **Descargar plantilla** — genera un CSV con las columnas correctas del módulo.
2. **Elegir el archivo** — se aceptan separadores `,` `;` o tabulador, con o sin comillas, en UTF-8.
3. **Indicar a qué campo corresponde cada columna** — el sistema propone la correspondencia comparando los encabezados; se puede corregir a mano y descartar columnas que no interesen.
4. **Revisar** — valida todo *sin guardar nada* e informa fila por fila qué está mal.
5. **Importar** — guarda solo las filas correctas; las que tienen problemas se omiten y quedan listadas para corregirlas y reintentar.

Facilidades pensadas para archivos venidos de otros sistemas:

| Dato | Cómo se acepta |
|---|---|
| Relaciones (iglesia, cuerpo, miembro…) | Por **nombre** ("Iglesia Central") o por número interno |
| Varias relaciones (integrantes, asistentes) | Separados por `\|` o `;` — "Juan Pérez\|Ana Soto" |
| Fechas | `dd/mm/aaaa` o `aaaa-mm-dd` |
| Montos | `1.250.500`, `45.990,50`, `$ 25.000` o `1234.56` |
| Sí/No | sí, si, no, 1, 0, true, false, x |
| RUT | Con o sin puntos; se valida el dígito verificador |

Límite: 5.000 filas por archivo (divida el archivo si tiene más). La importación se hace dentro de una transacción: si algo falla a mitad de camino, no queda información a medias.

**Si el sistema de origen no exporta CSV**, casi siempre se puede: copiar la tabla en pantalla y pegarla en Excel o Google Sheets, y desde ahí *Guardar como CSV*.

## Usuarios, roles y alcance por iglesia

Roles disponibles (editables en `server/permissions.js`):

- **Administrador** — acceso total, incluido el módulo Usuarios.
- **Pastor / Guía** — acceso total excepto Usuarios.
- **Secretario** — gestiona membresía, servicios, actas, documentos, certificados, etc.; sin acceso a Tesorería.
- **Tesorero** — gestiona Tesorería, Ayudas Sociales e Inventarios; consulta el resto.
- **Solo consulta** — lectura, sin Tesorería.

**Iglesia local a la vista**: la barra superior y el panel de control muestran siempre en qué congregación se está trabajando — la asignada al usuario o, si administra varias, "Todas las iglesias". Cuando el sistema administra una sola iglesia, se muestra su nombre aunque el usuario no tenga ninguna asignada.

**Alcance multi-iglesia**: a cada usuario se le puede asignar una iglesia. Un usuario con iglesia asignada solo ve y modifica registros de esa iglesia (el sistema lo garantiza en el servidor, no solo en la interfaz). Un usuario sin iglesia asignada opera sobre todas.

## Cuerpos y Grupos: dos realidades distintas 👥

La organización distingue:

- **Cuerpo** — entidad **formal**: tiene reglamento, deberes y derechos, y su propia directiva (ej. Damas, Caballeros, Jóvenes).
- **Grupo** — agrupación de **servicio o ayuda**, sin reglamento ni obligaciones formales (ej. equipo de aseo, apoyo social).

El campo **Nombre** guarda el nombre propio (Damas, Coro, Escuela Dominical…) y **Tipo** solo distingue entre esas dos realidades.

Al elegir **Cuerpo** aparecen los campos que solo tienen sentido en una entidad formal, y al elegir **Grupo** desaparecen:

| Campo | Para qué |
|---|---|
| Fecha de constitución formal | Cuándo se constituyó |
| Reglamento (documento) + fecha de aprobación | El reglamento vigente, adjunto |

La directiva no se guarda en el cuerpo, sino en su propio módulo, para conservar también las anteriores (ver más abajo).

### Histórico de directivas 🏅

Cada cuerpo elige su directiva por períodos, y el módulo **Directivas de Cuerpos** guarda todas: la vigente y las anteriores, con su período, sus fechas, sus integrantes y el acta de elección adjunta.

Una directiva se compone de:

| Cargo | Se elige entre | Obligatorio |
|---|---|---|
| Oficial supervisor(a) | Integrantes del **cuerpo de oficiales** | No |
| Primer jefe / Primera jefa | Miembros | No |
| Segundo jefe / Segunda jefa | Miembros | No |
| Secretario(a) | Miembros | No |
| Tesorero(a) | Miembros | No |
| Consejero(a) | Miembros | No — cargo adicional, no siempre se designa |

Además hay un campo **Otros cargos** en texto libre, por si el cuerpo designa alguno más.

**El oficial supervisor(a)** no es un cargo interno del cuerpo: es un integrante del **cuerpo de oficiales** designado para supervisar a los demás cuerpos. Por eso su selector no ofrece a todos los miembros, sino solo a los de ese cuerpo (sus integrantes y su líder).

- El cuerpo de oficiales es un cuerpo más, que se crea en *Cuerpos / Grupos* como cualquier otro; sus integrantes son los oficiales.
- Su nombre se define en **Configuración → Organización → Cuerpo de oficiales** (por defecto «Oficiales»), y se reconoce sin distinguir mayúsculas ni tildes.
- Mientras ese cuerpo no exista o no tenga integrantes, el selector ofrece a todos los miembros, para no dejar el campo bloqueado.
- Si quien figuraba como supervisor deja el cuerpo de oficiales, **su nombre se conserva** en las directivas ya registradas.

- Al marcar una directiva como **Vigente**, las demás de ese cuerpo pasan solas a *Finalizada*: nunca hay dos vigentes a la vez.
- El histórico se ve al pie de la ficha del cuerpo, con la vigente destacada, y desde ahí se registra una nueva con el cuerpo ya seleccionado.
- Cada persona que asume un cargo queda anotada en su **bitácora** ("Asume como Primer jefe / Primera jefa de «Damas» — período 2026 – 2027").

### Estado de cumplimiento ✅

Los cuerpos, por ser entidades formales, muestran un indicador calculado —en el listado y detallado en su ficha— que revisa:

| Requisito | Se cumple cuando |
|---|---|
| Reglamento adjunto | El cuerpo tiene cargado su reglamento |
| Directiva vigente registrada | Existe una directiva en estado Vigente |
| Directiva dentro de su período | No pasó su fecha de término |
| Cuerpo activo | Su estado es Activo |

El resultado es **Al día**, **Observado** (falta un requisito) o **Pendiente** (faltan dos o más). Los grupos muestran *No aplica*, porque no tienen exigencias formales.

Este indicador usa otra capacidad general del motor: un módulo puede declarar `computed` —campos que no se guardan, sino que se calculan al leer cada registro— y usarlos en sus listados como cualquier otro campo.

Esto usa una capacidad general del motor: cualquier campo puede declarar `showIf: { field: 'otro_campo', equals: 'valor' }` (o `in: [...]`) para mostrarse solo cuando corresponda. El servidor tampoco exige los campos obligatorios que no apliquen.

## Ficha del miembro 🧍

### Edad al día

Basta con la **fecha de nacimiento**: la edad aparece al lado mientras se escribe y se muestra en el listado. No se guarda —se calcula cada vez que se lee la ficha—, así que nunca queda desactualizada. A los menores de un año se les muestra la edad en meses.

### Estado civil y matrimonio

Al elegir **Casado(a)** aparecen dos campos más: **fecha de matrimonio civil** y **fecha de matrimonio por la iglesia**. Con cualquier otro estado civil no se muestran. Si más adelante cambia el estado, las fechas no se pierden: quedan guardadas, solo dejan de mostrarse.

### Fotos y documentos que suben rápido

Al subir una **imagen** —la foto del miembro, la foto de un carnet— el sistema la **ajusta de tamaño antes de enviarla**: la deja con su lado mayor en 1600 píxeles conservando el detalle a simple vista. Una foto de teléfono de varios MB queda en unos cientos de KB y sube en un instante, aun con señal mala. Debajo del archivo se indica lo que pasó: *«imagen ajustada a 1600×1200 — de 4,2 MB a 180 KB»*.

El tamaño y la calidad se cambian en **Configuración → Preferencias**. Los archivos que no son imágenes (PDF, Word) suben tal cual.

### Documentos del miembro 🗂️

Cada miembro puede tener **todos los documentos que hagan falta**: carnet de identidad, ficha de registro, ficha de actualización, certificados, cartas de traslado o cualquier otro. Cada documento guarda **el archivo y su nombre**, para reconocerlo sin abrirlo, más su tipo, su fecha y observaciones.

Se ven y se agregan **al pie de la ficha del miembro**, con la miniatura de cada uno; al agregar uno, el miembro viene puesto. Cada documento adjuntado queda anotado solo en el **historial del miembro**.

## Registro de Servicios 🕊️

Deja constancia de cada servicio (culto) realizado: cuándo empezó y terminó, quién coordinó, quién leyó el salmo y cuál fue, quién predicó y sobre qué pasaje, cuánta gente asistió y cuánto se ofrendó.

### Personas que pueden o no estar registradas

**Coordinador(a)**, **salmista** y **predicador(a)** se escriben en un campo que sugiere a los miembros registrados mientras se escribe:

- Si la persona **está registrada**, se elige de la lista y el registro queda enlazado a su ficha (aparece marcada con ✓ *registrado*). Si más adelante cambia su nombre en Miembros, el servicio muestra el nombre actualizado.
- Si **no está registrada** (una visita, un predicador invitado), se escribe el nombre y queda guardado igual, sin enlace.
- Si se escribe a mano un nombre que coincide exactamente con un miembro —y con uno solo—, el enlace se hace igual, sin tener que elegirlo de la lista. Esto vale también al importar desde CSV.

Esto usa otra capacidad general del motor: el tipo de campo **`persona`**, disponible para cualquier módulo. Guarda el nombre en su columna y el enlace en `<campo>_id`, que el sistema agrega solo.

### Salmo y mensaje

Ambos se citan igual: **libro** (los 66 de la Reina-Valera 1960, en orden del canon), **capítulo**, **versículo inicial** y **versículo final**. En el listado y al imprimir se muestran armados: *Salmos 23:1-6*, *Juan 10:11-18*.

### Asistencia y ofrenda

| Campo | Cómo se obtiene |
|---|---|
| Asistencia de adultos / de niños | Se escriben |
| **Total general de asistencia** | Se suma solo |
| Ofrenda recibida (total) | Se escribe |
| **Aparte para el fondo** | El porcentaje configurado (10% por defecto), calculado solo — es lo que va al otro fondo de tesorería |
| **Queda para la iglesia** | El total menos lo apartado |

Los tres campos calculados se actualizan **mientras se escribe** y no se pueden editar a mano: el servidor los vuelve a calcular al guardar, así que nunca quedan descuadrados. El porcentaje se cambia en **Configuración → Organización → Porcentaje de la ofrenda que se aparta**.

> El sistema calcula y deja registrada la separación, pero **no crea movimientos en Tesorería por su cuenta**, para no duplicar lo que se registre allí a mano.

Esta es también una capacidad general del motor: cualquier campo puede declarar `calcula` —`suma`, `resta` o `porcentaje` (fijo o tomado de una opción de configuración)— y el sistema lo resuelve en el servidor y en pantalla.

### Al imprimir

Cada servicio tiene su hoja con el membrete de la iglesia, los datos agrupados (salmo, mensaje, asistencia, ofrenda) y espacio para las firmas del coordinador y del predicador.

## Configuración del sistema ⚙️

Los administradores tienen en el menú la entrada **Configuración**, con opciones agrupadas:

- **Mantenimiento** — deja el sistema en mantenimiento y define el aviso que verán los usuarios.
- **Identidad** — nombre y lema de la institución.
- **Organización** — nombre del cuerpo de oficiales (de donde salen los oficiales supervisores de los cuerpos) y porcentaje de la ofrenda que se aparta para el otro fondo.
- **Preferencias** — símbolo de moneda, registros por página, duración de la sesión, tamaño y calidad de las imágenes al subirlas, y si la bitácora registra automáticamente.

### Modo mantenimiento

Al activarlo, **solo los administradores pueden ingresar**. A los demás:

- Se les impide iniciar sesión, mostrando el aviso configurado.
- Si estaban trabajando, la siguiente acción los devuelve a la pantalla de acceso con ese mismo aviso (la restricción se aplica en el servidor, no solo en la interfaz).

Para agregar más opciones, añadirlas al arreglo `OPCIONES` de `server/ajustes.js`: aparecen solas en la pantalla, con su tipo de campo y valor por defecto.

## Permisos personalizados por usuario 🔑

Además del rol, cada usuario puede tener permisos propios. En su ficha hay una tabla de **módulos × acciones** (ver, crear, editar, eliminar):

- Los módulos sin marcar siguen lo que otorga el rol.
- Al marcar **Personalizar** en un módulo, ese usuario pasa a regirse por lo que se marque ahí — sirve tanto para **dar** permisos que el rol no da (ej. un secretario que sí puede ver Tesorería) como para **quitar** los que sí da.
- Todo se verifica en el servidor en cada petición.

## Bitácora de miembros 🗒️

Cada miembro tiene un **historial** que se ve al pie de su ficha, con dos tipos de registro:

**Automáticos** (mientras la opción esté activa en Configuración):

| Hecho | Queda registrado como |
|---|---|
| Alta del miembro | Anotación |
| Cambio de sus datos | Cambio de datos (detalla campo, valor anterior y nuevo) |
| Cambio de estado | Cambio de estado |
| Entrada o salida de un cuerpo | Ingreso / Salida de cuerpo |
| Queda como líder de un cuerpo | Anotación |
| Solicitud, ayuda social, certificado o credencial | Su tipo correspondiente (al crearse y al cambiar de estado) |

**Manuales**: el botón *Agregar anotación* permite registrar visitas, disciplinas, reconocimientos u observaciones, con su fecha y tipo.

El módulo **Bitácora de Miembros** también aparece en el menú, con búsqueda y filtros sobre todos los registros.

## Arquitectura (expandible y modificable)

```
server/
  index.js         Servidor Express, metadatos, panel, carga de archivos
  registry.js      Carga los módulos declarados en server/modules/
  db.js            SQLite + AUTO-MIGRACIÓN (crea tablas y columnas nuevas)
  crud.js          Motor CRUD genérico (API REST para todos los módulos)
  auth.js          Login con JWT y middleware de autorización
  permissions.js   Roles y matriz de permisos (editable)
  seed.js          Datos iniciales (admin + iglesia de ejemplo)
  modules/         ★ UN ARCHIVO POR MÓDULO ★
public/
  index.html, app.js, styles.css   Interfaz (se autogenera desde los metadatos)
```

El sistema está **dirigido por esquemas**: cada módulo es un archivo declarativo. El servidor crea su tabla, publica su API y el frontend genera su menú, listado, filtros y formulario **sin escribir más código**.

### Agregar un módulo nuevo

Crear `server/modules/mi_modulo.js`:

```js
module.exports = {
  name: 'eventos',
  label: 'Eventos',
  labelSingular: 'Evento',
  icon: '🎉',
  group: 'Organización',
  order: 15,
  display: '{nombre}',
  dateField: 'fecha',
  searchFields: ['nombre', 'lugar'],
  listFields: ['nombre', 'fecha', 'iglesia_id', 'estado'],
  fields: [
    { name: 'nombre', label: 'Nombre', type: 'text', required: true },
    { name: 'fecha', label: 'Fecha', type: 'date', required: true },
    { name: 'iglesia_id', label: 'Iglesia', type: 'ref', ref: 'iglesias', required: true },
    { name: 'lugar', label: 'Lugar', type: 'text' },
    { name: 'estado', label: 'Estado', type: 'select', options: ['Programado', 'Realizado', 'Cancelado'], default: 'Programado' },
    { name: 'notas', label: 'Notas', type: 'textarea' },
  ],
};
```

Reiniciar el servidor: la tabla se crea sola y el módulo aparece en el menú con su listado, búsqueda, formulario y permisos.

### Modificar un módulo existente

Agregar el campo al arreglo `fields` del módulo y reiniciar: la columna se crea automáticamente **sin perder datos**. (Eliminar o renombrar columnas sí requiere migración manual.)

### Tipos de campo disponibles

`text` · `textarea` · `number` · `money` · `date` · `time` · `select` (con `options`) · `boolean` · `ref` (relación a otro módulo, con `ref`) · `multiref` (varias relaciones, ej. integrantes/asistentes) · `file` (adjuntos con carga) · `email` · `tel` · `password` · `rut` (valida dígito verificador y guarda normalizado)

Cualquier campo acepta además:

- `unique: true` — impide valores repetidos.
- `showIf: { field, equals }` o `showIf: { field, in: [...] }` — el campo se muestra (y se exige, si es obligatorio) solo cuando otro campo tenga ese valor.

### Lógica propia por módulo

- `hooks.beforeSave(data, ctx)` — validar o transformar antes de guardar (ej.: Usuarios cifra la contraseña; Asistencias calcula el total).
- `hooks.beforeDelete(row, ctx)` — vetar eliminaciones (ej.: no eliminar el último administrador).
- `extraRoutes(router, ctx)` — endpoints propios (ej.: `GET /api/tesoreria/resumen`).
- `printable: true` — habilita la vista de impresión (Certificados, Credenciales y Actas ya traen plantillas elegantes; el resto usa una ficha genérica).

## API REST

Todas las rutas bajo `/api`, autenticadas con `Authorization: Bearer <token>`:

```
POST   /api/auth/login              { rut, password } → { token, user }
GET    /api/meta                    módulos y esquemas visibles para el usuario
GET    /api/dashboard               indicadores del panel
POST   /api/upload                  carga de archivos (multipart, campo "archivo")
GET    /api/<modulo>                ?q=&page=&sort=&dir=&f_<campo>=&desde=&hasta=
GET    /api/<modulo>/options        opciones {id, label} para selectores
GET    /api/<modulo>/:id
POST   /api/<modulo>
PUT    /api/<modulo>/:id
DELETE /api/<modulo>/:id
GET    /api/tesoreria/resumen       ingresos, egresos, balance y por categoría
POST   /api/importar/<modulo>       { filas: [...], prueba: true|false } importación masiva
```

## Seguridad

- Contraseñas cifradas con bcrypt; sesiones JWT de 12 h.
- Permisos verificados **en el servidor** en cada petición (la interfaz solo refleja lo permitido).
- Alcance por iglesia aplicado en el servidor (lectura y escritura).
- Protecciones: no eliminar el propio usuario ni el último administrador; correo de usuario único.

## Uso en teléfonos móviles 📱

La interfaz es totalmente adaptable (menú lateral táctil, formularios de una columna, tablas con desplazamiento) y puede **instalarse como aplicación** en el teléfono: en Android (Chrome) menú ⋮ → *Agregar a la pantalla principal*; en iPhone (Safari) Compartir → *Agregar a pantalla de inicio*.

## Publicar en internet 🌐

Para que el equipo acceda desde cualquier lugar (computador o celular), vea la guía paso a paso en **[DESPLIEGUE.md](DESPLIEGUE.md)** — incluye Railway, Render y servidor propio con Docker (`Dockerfile` y `docker-compose.yml` ya incluidos).

## Producción (resumen)

1. Definir `JWT_SECRET` con un valor largo y aleatorio.
2. Cambiar la contraseña del administrador (entra con RUT `11.111.111-1`).
3. Servir detrás de HTTPS (Railway/Render lo dan automático; en VPS usar Caddy o Nginx).
4. Respaldar la carpeta de datos (`data/` local o el volumen `/data`) periódicamente.
