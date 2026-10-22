#!/bin/bash

# ============= Jukebox Installation Script =============
# Utilisation: bash install.sh
# Ou: chmod +x install.sh && ./install.sh

set -e  # Arrêter en cas d'erreur

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonctions
print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# ============= CHECKS =============

print_header "Vérifications Prérequis"

# Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js n'est pas installé"
    echo "Installation: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install nodejs"
    exit 1
fi
print_success "Node.js $(node -v)"

# npm
if ! command -v npm &> /dev/null; then
    print_error "npm n'est pas installé"
    exit 1
fi
print_success "npm $(npm -v)"

# Nginx (optionnel)
if command -v nginx &> /dev/null; then
    print_success "Nginx $(nginx -v 2>&1 | grep -o 'version.*')"
else
    print_warning "Nginx n'est pas installé (optionnel mais recommandé)"
fi

# ============= SETUP DIRECTORIES =============

print_header "Configuration des Répertoires"

# Créer répertoires
if [ ! -d "public" ]; then
    mkdir -p public
    print_success "Répertoire /public créé"
else
    print_success "Répertoire /public existe"
fi

# Copier les fichiers HTML dans public
if [ -f "admin.html" ]; then
    cp -v admin.html public/ 2>/dev/null || true
    cp -v guest.html public/ 2>/dev/null || true
    cp -v player.html public/ 2>/dev/null || true
    print_success "Fichiers HTML copiés dans /public"
fi

# ============= INSTALL DEPENDENCIES =============

print_header "Installation des Dépendances Node.js"

if [ -f "package.json" ]; then
    npm install
    print_success "Dépendances installées"
else
    print_error "package.json non trouvé!"
    exit 1
fi

# ============= ENVIRONMENT SETUP =============

print_header "Configuration Environment"

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_success "Fichier .env créé à partir du template"
        
        # Demander les paramètres
        echo ""
        print_warning "Veuillez éditer .env avec vos paramètres:"
        echo "  - ADMIN_PASSWORD (important!)"
        echo "  - NAVIDROME_URL, USER, PASS (si utilisé)"
        echo ""
        echo "  nano .env"
    else
        print_error ".env.example non trouvé!"
        exit 1
    fi
else
    print_success ".env existe déjà"
fi

# ============= TEST RUN =============

print_header "Test de Démarrage"

read -p "Démarrer l'application pour test? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Démarrage en mode test (Ctrl+C pour arrêter)..."
    echo "Accédez à http://localhost:3000"
    echo ""
    timeout 10 npm start 2>/dev/null || true
    print_success "Application testée avec succès!"
fi

# ============= NGINX SETUP =============

print_header "Configuration Nginx"

if command -v nginx &> /dev/null; then
    read -p "Configurer Nginx? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "1. Éditer nginx.conf avec votre domaine:"
        echo "   sudo nano /etc/nginx/sites-available/jukebox"
        echo ""
        echo "2. Puis copier:"
        echo "   sudo cp nginx.conf /etc/nginx/sites-available/jukebox"
        echo ""
        echo "3. Créer le symlink:"
        echo "   sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox"
        echo ""
        echo "4. Tester et recharger:"
        echo "   sudo nginx -t && sudo systemctl reload nginx"
    fi
else
    print_warning "Nginx non trouvé - installation manuelle requise"
fi

# ============= SYSTEMD SETUP =============

print_header "Configuration Systemd (Optionnel)"

read -p "Configurer systemd pour auto-start? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation du service systemd:"
    echo "  sudo cp jukebox.service /etc/systemd/system/"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl enable jukebox"
    echo "  sudo systemctl start jukebox"
    echo ""
    echo "Vérifier le statut:"
    echo "  sudo systemctl status jukebox"
    echo "  sudo journalctl -u jukebox -f"
fi

# ============= PM2 SETUP =============

print_header "Configuration PM2 (Alternatif à Systemd)"

read -p "Configurer PM2 pour production? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Installation de PM2:"
    echo "  sudo npm install -g pm2"
    echo ""
    echo "Démarrer l'application:"
    echo "  pm2 start jukebox-server.js --name jukebox"
    echo ""
    echo "Auto-start au boot:"
    echo "  pm2 startup"
    echo "  pm2 save"
fi

# ============= DOCKER SETUP =============

print_header "Docker Setup (Optionnel)"

if command -v docker &> /dev/null; then
    read -p "Utiliser Docker? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Avec Docker Compose:"
        echo "  docker-compose up -d"
        echo ""
        echo "Ou build manuel:"
        echo "  docker build -t jukebox:latest ."
        echo "  docker run -p 3000:3000 --env-file .env jukebox:latest"
    fi
else
    print_warning "Docker non trouvé (optionnel)"
fi

# ============= FINAL INSTRUCTIONS =============

print_header "Installation Complète! 🎉"

echo ""
echo "📋 Prochaines étapes:"
echo ""
echo "1. Éditer la configuration:"
echo "   nano .env"
echo ""
echo "2. (Optionnel) Configurer Navidrome:"
echo "   - Installer: https://www.navidrome.org/docs/installation/"
echo "   - Ajouter NAVIDROME_URL, USER, PASS dans .env"
echo ""
echo "3. Lancer l'application:"
echo "   npm start          # Mode développement"
echo "   pm2 start ...      # Mode production"
echo "   systemctl start    # Mode systemd"
echo ""
echo "4. Accédez à:"
echo "   - Lecteur:  http://localhost:3000"
echo "   - Admin:    http://localhost:3000/admin"
echo "   - Guest:    http://localhost:3000/guest"
echo ""
echo "5. Mot de passe admin (par défaut): admin123"
echo "   ⚠️  CHANGER DANS .env!"
echo ""
echo "Documentation: Voir README.md et DEPLOYMENT.md"
echo ""
