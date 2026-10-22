# Jukebox - Docker Image
# Build: docker build -t jukebox:latest .
# Run: docker run -p 3000:3000 --env-file .env jukebox:latest

FROM node:18-alpine

# Installer dépendances système
RUN apk add --no-cache \
    ca-certificates \
    curl \
    tzdata

# Définir le répertoire de travail
WORKDIR /app

# Dépendances d'abord : cette couche est réutilisée tant que package.json
# ne change pas
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Puis le code. qrcode.js est requis par le serveur (QR de la page invité).
COPY jukebox-server.js qrcode.js ./
COPY public ./public

# Note : sockseek n'est pas fourni dans cette image. Sans lui, seule la
# bibliothèque Navidrome est disponible (le serveur le signale au démarrage).
# Pour Soulseek, faire tourner le démon sockseek à côté et pointer
# SOCKSEEK_REMOTE dessus, avec SOCKSEEK_AUTOSTART=false.

# Exposer le port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/config || exit 1

# Lancer l'application
CMD ["node", "jukebox-server.js"]
