# Sistema de Gestión de Iglesias — imagen de producción
#
# Construcción en dos etapas:
#  1. "build" usa la imagen completa de Node 22, que ya trae las herramientas
#     necesarias por si la base de datos tuviera que compilarse.
#  2. La imagen final es liviana y solo lleva lo indispensable para ejecutar.

FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app

# El puerto lo define la plataforma con la variable PORT; el sistema la respeta.
ENV NODE_ENV=production \
    DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# Los datos del sistema anterior NO viajan en la imagen: se suben desde
# Configuración → Traspaso y quedan en /data, junto a la base. Así una versión
# publicada no lleva adentro los datos de nadie.

# /data guarda la base de datos y los archivos subidos. NO se declara aquí
# con VOLUME: Railway rechaza esa instrucción y exige que el volumen se
# conecte desde su panel (Mount Path /data). Con Docker Compose el volumen
# se define en docker-compose.yml.

CMD ["node", "server/index.js"]
