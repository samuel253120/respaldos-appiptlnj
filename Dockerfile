# Sistema de Gestión de Iglesias — imagen de producción
FROM node:22-slim

WORKDIR /app

# Instalar dependencias primero (aprovecha la caché de capas)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# /data guarda la base de datos SQLite y los archivos subidos:
# SIEMPRE montar un volumen persistente en esta ruta.
VOLUME /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
