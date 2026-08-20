# 🌐 Guía de despliegue — acceso desde cualquier parte

Esta guía explica cómo publicar el sistema en internet para que usted y su equipo entren desde **cualquier computador o teléfono móvil**, cada uno con su usuario y contraseña.

> **Dato clave**: toda la información vive en la carpeta `/data` (base de datos SQLite + archivos subidos). En cualquier plataforma debe montarse un **disco/volumen persistente** en esa ruta; de lo contrario los datos se pierden en cada reinicio.

---

## Opción A — Railway (recomendada: la más sencilla, ~5 USD/mes)

1. Cree una cuenta en https://railway.app e inicie sesión con GitHub.
2. **New Project → Deploy from GitHub repo** → elija `samuel253120/respaldos-appiptlnj`.
   - Si el código aún está en la rama `claude/church-management-system-ux1p6v`, en **Settings → Source** seleccione esa rama (o fusiónela antes a `main`).
3. Railway detecta el `Dockerfile` automáticamente y construye la imagen.
4. Agregue el volumen de datos: clic derecho sobre el servicio → **Attach Volume** → *Mount path*: `/data`.
5. En **Variables** agregue:
   - `JWT_SECRET` = una clave larga y aleatoria. Genérela en su computador con:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
6. En **Settings → Networking → Generate Domain** obtenga la dirección pública, algo como `https://respaldos-appiptlnj-production.up.railway.app`.
7. Abra esa dirección, entre con RUT `11.111.111-1` y contraseña `admin123`, y **cambie la contraseña de inmediato** (módulo Usuarios).

Cada vez que suba cambios al repositorio, Railway vuelve a desplegar solo.

### Terminar la configuración desde la terminal (alternativa al panel)

Si el panel web se le dificulta (por ejemplo desde un celular), los pasos 4-6 también pueden hacerse con el CLI de Railway desde cualquier computador con Node.js:

```bash
npm install -g @railway/cli
railway login                 # abre el navegador para iniciar sesión
railway link                  # seleccione su proyecto y servicio
railway volume add -m /data   # crea el volumen persistente
railway variables --set "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
railway domain                # genera la URL pública
```

### Si la construcción falla

Abra la pestaña **Build Logs** del despliegue: la última línea en rojo dice la causa. Casos ya resueltos en este proyecto, por si reaparecen:

| Mensaje | Causa | Solución |
|---|---|---|
| `docker VOLUME ... is not supported, use Railway Volumes` | El Dockerfile declaraba `VOLUME` | Railway administra los volúmenes desde su panel; el Dockerfile no debe declararlos |
| `npm ci can only install packages when package.json and package-lock.json are in sync` | Se editó `package.json` sin regenerar el candado | Ejecutar `npm install --package-lock-only` y subir el cambio |
| Error compilando `better-sqlite3` | El constructor eligió una versión de Node sin binario precompilado | `engines.node` fijado en `22.x` en `package.json` |

### Si el despliegue se queda en «Performing healthchecks…»

Un despliegue puede quedarse ahí cuarenta minutos o más sin terminar. Mientras eso pasa, el dominio responde *«Application failed to respond»* aunque el sistema esté bien.

Por eso **este proyecto no declara `healthcheckPath`** en `railway.json`: el despliegue queda en línea apenas arranca el contenedor, sin depender de esa comprobación. La verificación de salud sigue existiendo en el sistema —abra `/health` cuando quiera—, pero ya no puede bloquear un despliegue.

Si ve varios despliegues detenidos en ese paso:

1. En cada uno, menú **⋮ → Remove** (o *Cancel*), para que el que está **ACTIVE** vuelva a atender el dominio.
2. Revise el aviso del panel: si dice **«Deploys have been paused due to an upstream issue»**, es una avería de Railway. Nada que arreglar de este lado; espere a que se restablezca (https://status.railway.com).
3. Cuando se restablezca, haga **Redeploy** del último despliegue.

### Cómo saber si el sistema está sano

Abra `https://SU-DOMINIO/health`. Responde algo así:

```json
{ "ok": true, "version": "1.26.2", "base": "ok", "disco": "820 MB libres" }
```

- `base` distinto de `"ok"` → la base de datos no contesta (volumen sin conectar).
- `disco` con pocos MB → **el volumen se está llenando**; agrándelo desde *Settings → Volumes* antes de que el sistema no pueda guardar.
- Si en vez del sistema aparece una página que dice *«El sistema no pudo abrir su base de datos»*, ahí mismo está explicado qué revisar: los datos no se han perdido, están en el volumen.

### Verificación final (muy recomendada)

1. Abra la URL, entre y cree un registro de prueba (ej. un miembro).
2. En Railway haga **Redeploy** del servicio.
3. Vuelva a entrar: si el registro de prueba sigue ahí, el volumen quedó bien y ya puede registrar información real. Si desapareció, el volumen no está montado en `/data`.

## Opción B — Render (~7 USD/mes con disco persistente)

1. Cree una cuenta en https://render.com e inicie sesión con GitHub.
2. **New → Web Service** → conecte el repositorio y elija la rama.
3. *Language*: **Docker** (detecta el `Dockerfile` solo).
4. Elija el plan **Starter** (el plan gratuito no permite discos persistentes: perdería los datos).
5. En **Disks** agregue un disco: *Mount path*: `/data`, tamaño 1 GB (ampliable).
6. En **Environment** agregue `JWT_SECRET` (igual que en la opción A).
7. Cree el servicio; al terminar tendrá una URL `https://….onrender.com`.

## Opción C — Servidor propio / VPS con Docker (control total, dominio propio)

Para un VPS (Hetzner, DigitalOcean, Contabo… desde ~4 USD/mes) con Docker instalado:

```bash
git clone https://github.com/samuel253120/respaldos-appiptlnj.git
cd respaldos-appiptlnj
cp .env.ejemplo .env        # editar y poner un JWT_SECRET aleatorio
docker compose up -d        # la app queda en el puerto 3000
```

Para HTTPS con dominio propio (ej. `iglesias.midominio.com`), instale [Caddy](https://caddyserver.com) en el mismo servidor — obtiene y renueva el certificado SSL automáticamente. `/etc/caddy/Caddyfile`:

```
iglesias.midominio.com {
    reverse_proxy localhost:3000
}
```

Y apunte el DNS del dominio (registro A) a la IP del servidor.

**Respaldo** (recomendado programarlo a diario con `cron`):

```bash
docker run --rm -v respaldos-appiptlnj_iglesias_data:/data -v $PWD:/backup \
  alpine tar czf /backup/respaldo-$(date +%F).tar.gz -C /data .
```

---

## 📱 Uso en teléfonos móviles

La interfaz es adaptable: funciona en el navegador del teléfono con menú lateral táctil.

Además puede **instalarse como aplicación** (ícono propio, pantalla completa):

- **Android (Chrome)**: abrir la dirección del sistema → menú ⋮ → **Agregar a la pantalla principal** (o "Instalar aplicación").
- **iPhone (Safari)**: abrir la dirección → botón Compartir → **Agregar a pantalla de inicio**.

## ✅ Lista de verificación de seguridad

1. `JWT_SECRET` definido con un valor aleatorio y largo (nunca el de por defecto).
2. Contraseña del administrador cambiada tras el primer ingreso.
3. Acceso siempre por **HTTPS** (Railway y Render lo dan automático; en VPS lo da Caddy).
4. Crear un usuario propio para cada persona, con el **rol mínimo necesario** y su **iglesia asignada** (así cada quien solo ve su congregación).
5. Respaldos periódicos de `/data`.
