# Sistema de Gestión de Iglesias — imagen de producción
FROM node:22-slim

WORKDIR /app

# Instalar dependencias primero (aprovecha la caché de capas).
# Las herramientas de compilación se instalan y se retiran en el mismo paso:
# solo hacen falta si la base de datos no tuviera binario precompilado.
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY server ./server
COPY public ./public

# El puerto lo define la plataforma con la variable PORT; el sistema la respeta.
ENV NODE_ENV=production \
    DATA_DIR=/data

# /data guarda la base de datos SQLite y los archivos subidos:
# SIEMPRE montar un volumen persistente en esta ruta.
VOLUME /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
