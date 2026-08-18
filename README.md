# ⛪ Sistema de Gestión de Iglesias

Sistema web integral para administrar **varias iglesias** desde un solo lugar. Incluye 15 módulos completos, control de usuarios con roles y permisos, alcance multi-iglesia, carga de archivos, impresión de certificados / credenciales / actas y un panel de control con indicadores.

## Módulos incluidos

| Grupo | Módulos |
|---|---|
| **Organización** | Iglesias · Pastores / Guías · Cuerpos / Grupos |
| **Personas** | Miembros · Asistencias (con lista nominal de presentes) |
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

- **Usuario administrador**: `admin@iglesia.local` / `admin123` → **cambiar la contraseña de inmediato** (módulo Usuarios).
- Una iglesia de ejemplo ("Iglesia Central").

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |
| `DATA_DIR` | `./data` | Carpeta de la base de datos SQLite y archivos subidos |
| `JWT_SECRET` | (insegura) | **Definir en producción**: clave para firmar sesiones |

La base de datos es un único archivo SQLite (`data/iglesias.db`); para respaldar el sistema basta copiar la carpeta `data/`.

## Usuarios, roles y alcance por iglesia

Roles disponibles (editables en `server/permissions.js`):

- **Administrador** — acceso total, incluido el módulo Usuarios.
- **Pastor / Guía** — acceso total excepto Usuarios.
- **Secretario** — gestiona membresía, actas, documentos, certificados, etc.; sin acceso a Tesorería.
- **Tesorero** — gestiona Tesorería, Ayudas Sociales e Inventarios; consulta el resto.
- **Solo consulta** — lectura, sin Tesorería.

**Alcance multi-iglesia**: a cada usuario se le puede asignar una iglesia. Un usuario con iglesia asignada solo ve y modifica registros de esa iglesia (el sistema lo garantiza en el servidor, no solo en la interfaz). Un usuario sin iglesia asignada opera sobre todas.

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

`text` · `textarea` · `number` · `money` · `date` · `time` · `select` (con `options`) · `boolean` · `ref` (relación a otro módulo, con `ref`) · `multiref` (varias relaciones, ej. integrantes/asistentes) · `file` (adjuntos con carga) · `email` · `tel` · `password`

### Lógica propia por módulo

- `hooks.beforeSave(data, ctx)` — validar o transformar antes de guardar (ej.: Usuarios cifra la contraseña; Asistencias calcula el total).
- `hooks.beforeDelete(row, ctx)` — vetar eliminaciones (ej.: no eliminar el último administrador).
- `extraRoutes(router, ctx)` — endpoints propios (ej.: `GET /api/tesoreria/resumen`).
- `printable: true` — habilita la vista de impresión (Certificados, Credenciales y Actas ya traen plantillas elegantes; el resto usa una ficha genérica).

## API REST

Todas las rutas bajo `/api`, autenticadas con `Authorization: Bearer <token>`:

```
POST   /api/auth/login              { email, password } → { token, user }
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
2. Cambiar la contraseña del administrador.
3. Servir detrás de HTTPS (Railway/Render lo dan automático; en VPS usar Caddy o Nginx).
4. Respaldar la carpeta de datos (`data/` local o el volumen `/data`) periódicamente.
