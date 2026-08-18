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
7. Abra esa dirección, entre con `admin@iglesia.local` / `admin123` y **cambie la contraseña de inmediato** (módulo Usuarios).

Cada vez que suba cambios al repositorio, Railway vuelve a desplegar solo.

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
