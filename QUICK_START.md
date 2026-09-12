# 🚀 Jukebox - Quick Start Guide

## 📦 Fichiers Fournis

Votre application Jukebox complète incluant:

### 🎯 Core Application
- **jukebox-server.js** - Backend Node.js/Express principal
- **qrcode.js** - Générateur du QR code d'invitation (sans dépendance)
- **public/admin.html** - Interface administrateur, seul poste de commande
- **public/guest.html** - Interface utilisateur (saisie du nom + recherche)
- **public/player.html** - Écran de lecture : il affiche et il joue, rien d'autre

### ⚙️ Configuration
- **.env.example** - Template variables d'environnement
- **package.json** - Dépendances Node.js
- **nginx.conf** - Configuration reverse proxy Nginx

### 🐳 Docker
- **Dockerfile** - Container image pour Docker
- **docker-compose.yml** - Configuration multi-containers (Jukebox + Navidrome + Nginx)

### 📋 Documentation
- **README.md** - Vue d'ensemble complète
- **DEPLOYMENT.md** - Guide de déploiement détaillé
- **DEVELOPMENT.md** - Guide pour développeurs
- **QUICK_START.md** - Ce fichier ✓

### 🔧 Setup & Test
- **install.sh** - Script d'installation automatisée
- **test-services.js** - Test de connectivité services
- **jukebox.service** - Service Systemd pour auto-start

### 📂 Autres
- **.gitignore** - Fichiers à ignorer en git

## ⚡ Installation Ultra-Rapide

### Méthode 1: Script Automatisé (Recommandé)

```bash
# 1. Donner les permissions
chmod +x install.sh

# 2. Lancer l'installation
./install.sh

# 3. Configurer
nano .env

# 4. Tester les services (optionnel)
node test-services.js

# 5. Démarrer
npm start
```

### Méthode 2: Docker Compose (Most Simple)

```bash
# 1. Éditer config
cp .env.example .env
nano .env

# 2. Créer dossier musique (optionnel)
mkdir -p music
# Copier mp3/flac dans ./music

# 3. Lancer
docker-compose up -d

# 4. Accéder
# Jukebox: http://localhost
# Admin: http://localhost/admin
# Navidrome: http://localhost:4533
```

### Méthode 3: Manuel

```bash
# 1. Installer Node.js 14+
# https://nodejs.org/

# 2. Installer dépendances
npm install

# 3. Configurer
cp .env.example .env
nano .env

# 4. Lancer
npm start

# 5. Ouvrir
# http://localhost:3000
```

## 🔐 Configuration de Base

### .env (Minimal)

```env
# Super important!
ADMIN_PASSWORD=votrePasswordSecure123

# Navidrome (si vous l'avez)
NAVIDROME_ENABLED=true
NAVIDROME_URL=http://192.168.1.100:4533
NAVIDROME_USER=admin
NAVIDROME_PASS=votre_password

```

## 🎯 Utilisation Immédiate

### 1️⃣ Accédez au Lecteur
```
http://localhost:3000
```
Vous verrez:
- Album art au centre
- Playlist à droite, toujours recentrée sur la piste en cours
- Paroles synchronisées à gauche
- Un QR code à faire scanner aux invités

Cet écran n'a aucun bouton : lecture, pause et changement de piste se
commandent depuis `/admin`. Si le navigateur bloque le son au démarrage, un
voile « Cliquez pour activer le son » s'affiche — un seul clic, une seule fois.

> Ouvrez-le par son adresse réseau (`http://192.168.1.50:3000`) plutôt que par
> `localhost` : le QR code reprend l'adresse de la page.

### 2️⃣ Allez à l'Admin
```
http://localhost:3000/admin
```
Entrez le mot de passe (par défaut: admin123)

**Ajoutez les utilisateurs autorisés** (colonne "Utilisateurs autorisés").
Chacun reçoit un **code** : saisissez-le, ou laissez le champ vide pour qu'il
soit tiré au sort. Il s'affiche ensuite sous le nom, et un clic dessus le copie.
→ puis partagez le lien affiché en bas de cette colonne (bouton « Copier le
lien »), ou laissez les invités scanner le QR code de l'écran de lecture.

### 3️⃣ Les Utilisateurs Ajoutent
- Ouvrent `/guest` (ou scannent le QR code de l'écran de lecture)
- Entrent leur code — pas de nom à taper, le code les identifie
- Cherchent une chanson et l'ajoutent

> Sans code valide, impossible de chercher ou d'ajouter de la musique.

## 🎵 Contrôles Admin

```
▶ Lecture / ⏸ Pause - Un seul bouton, qui affiche l'action à venir
⏮ Précédent - Piste précédente
⏭ Suivant   - Piste suivante
▶ (sur une piste) - Lire directement ce morceau
▲ ▼         - Réordonner la file
🗑 Clear    - Vider toute la playlist (remet aussi les quotas à zéro)
Quotas      - Max chansons, délai entre ajouts et fenêtre glissante, appliqués immédiatement
Fondu       - Durée du fondu entre deux chansons, en secondes (0 = enchaînement sec)
+ Ajouter   - Ajouter un utilisateur (code choisi, ou tiré au sort si vide)
🔑          - Lui donner un nouveau code (l'ancien cesse de fonctionner)
↺           - Réinitialiser le quota d'un utilisateur
✎           - Renommer un utilisateur
×           - Retirer un utilisateur (accès révoqué immédiatement)
```

## 📱 Interface Utilisateur

**Recherche:**
- Tapez artiste/chanson
- Résultats de la bibliothèque Navidrome ; si elle ne contient rien, repli sur Soulseek
- Soulseek nécessite sockseek (https://github.com/fiso64/sockseek) et un compte
  Soulseek, configurés dans sockseek.conf. Son démon est démarré automatiquement
  par `npm start` (et arrêté avec le jukebox) ; mettez `SOCKSEEK_AUTOSTART=false`
  si vous préférez le gérer vous-même.
- Une recherche Soulseek peut durer une vingtaine de secondes : une barre de
  progression l'indique, et un second clic sur le bouton l'annule
- Les fichiers Soulseek sont temporaires : supprimés dès la fin de leur lecture
- Cliquez "+ Ajouter" : le bouton passe à « ✓ Ajouté » en vert
- Sur téléphone, un résultat tient sur une ligne : titre, artiste, durée, source

**Limitations:**
- Max 3 chansons (configurable)
- Cooldown 5 min entre ajouts (configurable)
- Visible en temps réel sur le panel

**Si un téléchargement échoue**, la chanson est retirée de la playlist et le
crédit est rendu à l'invité, qui en est prévenu sur sa page.

**Pas de doublons** : une chanson déjà dans la playlist apparaît grisée dans les
résultats (« ✓ Déjà dans la liste ») et son ajout est refusé — sans consommer le
quota de l'invité. La comparaison ignore la casse, les accents et les mentions
entre parenthèses, donc « Bohemian Rhapsody (Remastered 2011) » et « Bohemian
Rhapsody » comptent pour le même morceau. Pour rejouer un titre, l'admin le
retire d'abord de la playlist.

## 🔧 Commandes Utiles

### Lancer l'app

```bash
# Mode développement (auto-reload)
npm run dev

# Mode production simple
npm start

# Avec PM2 (recommandé)
pm2 start jukebox-server.js --name jukebox
pm2 logs jukebox
```

### Arrêter l'app

```bash
# Ctrl+C (mode dev/prod simple)

# PM2
pm2 stop jukebox
pm2 delete jukebox

# Docker
docker-compose down
```

### Vérifier logs

```bash
# Direct
npm start 2>&1 | tail -f

# PM2
pm2 logs jukebox --err

# Docker
docker-compose logs -f jukebox

# Systemd (si installé)
sudo journalctl -u jukebox -f
```

## ✅ Troubleshooting Express

### "Port déjà utilisé"
```bash
# Tuer process sur port 3000
lsof -i :3000 | grep LISTEN | awk '{print $2}' | xargs kill -9

# Ou changer le port
PORT=3001 npm start
```

### "Cannot find module"
```bash
# Réinstaller dépendances
rm -rf node_modules package-lock.json
npm install
```

### "Navidrome no connection"
```bash
# Vérifier URL et identifiants dans .env
# Tester manuelle:
curl "http://navidrome:4533/rest/ping.json?u=admin&p=admin&c=jukebox&v=1.12.0"

# Vérifier firewall
netstat -tuln | grep 4533
```

### "Admin password not working"
- Par défaut: `admin123`
- Changer dans .env: `ADMIN_PASSWORD=votrePassword`

## 📊 Configuration Paramètres

```env
# Nombre max chansons par utilisateur, dans la fenêtre glissante
MAX_SONGS_PER_USER=3          # 1 (strict) à 10 (permissif)

# Fenêtre glissante du quota (minutes) : 60 = "3 chansons par heure"
# 0 = quota définitif, seul l'admin réinitialise
QUOTA_WINDOW_MINUTES=60

# Délai entre les ajouts
COOLDOWN_MINUTES=5            # 0 (pas de délai) à 60

# Durée avant réinitialisation session
SESSION_DURATION=120          # en minutes
```

## 🌐 Déploiement Nginx

Si vous voulez accéder via domaine public:

```bash
# 1. Copier config
sudo cp nginx.conf /etc/nginx/sites-available/jukebox

# 2. Éditer avec votre domaine
sudo nano /etc/nginx/sites-available/jukebox
# Remplacer: jukebox.example.com → votre-domaine.com

# 3. Activer
sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox
sudo rm /etc/nginx/sites-enabled/default

# 4. Tester et recharger
sudo nginx -t
sudo systemctl reload nginx

# 5. (Optionnel) SSL avec Certbot
sudo certbot certonly --nginx -d votre-domaine.com
# Décommenter les lignes SSL dans nginx.conf
# sudo systemctl reload nginx
```

## 🐳 Docker Compose Setup

Le `docker-compose.yml` inclut:
- **Jukebox** (application)
- **Navidrome** (musique locale)
- **Nginx** (reverse proxy)

### Démarrer tout

```bash
# Créer dossier musique et copier MP3/FLAC
mkdir -p music
# Copier vos chansons dans ./music

# Lancer
docker-compose up -d

# Vérifier
docker-compose ps

# Logs
docker-compose logs -f

# Arrêter
docker-compose down
```

### Accès

- **Jukebox**: http://localhost
- **Admin**: http://localhost/admin
- **Navidrome**: http://localhost:4533

## 🔐 Sécurité Importantes

**AVANT la production:**

1. ✅ Changer `ADMIN_PASSWORD` dans .env
   ```env
   ADMIN_PASSWORD=SuperPassword123!@#$%
   ```

2. ✅ Configurer SSL/HTTPS
   - Utiliser Certbot + Nginx
   - Voir DEPLOYMENT.md

3. ✅ Ne créer que les utilisateurs nécessaires
   - La liste est vide au démarrage : personne ne peut ajouter de musique
   - La liste est en mémoire, elle est perdue au redémarrage du serveur

4. ✅ Activer rate limiting (Nginx)
   - Voir nginx.conf section "Rate limiting"

## 📈 Performances

- Pas de base de données = ultra rapide ⚡
- Playlist en RAM
- Recherches temps réel
- Streaming proxy efficace

## 🆘 Aide Rapide

| Problème | Solution |
|----------|----------|
| Port 3000 occupé | `PORT=3001 npm start` |
| Navidrome no connection | Vérifier NAVIDROME_URL dans .env |
| Paroles manquantes | Service LRClib peut être down (normal) |
| Admin password oublié | Éditer ADMIN_PASSWORD dans .env |
| "Vous n'êtes pas autorisé" | Ajouter la personne dans /admin → Utilisateurs autorisés |
| Liste d'utilisateurs vide après restart | Normal : la liste est en mémoire, la recréer |

**Plus d'aide:** Voir DEPLOYMENT.md (Troubleshooting section)

## 📚 Documentation Complète

- **README.md** - Features complètes et architecture
- **DEPLOYMENT.md** - Installation production, SSL, Nginx, Systemd
- **DEVELOPMENT.md** - Guide pour développeurs/contribution
- **QUICK_START.md** - Ce guide ✓

## 🎉 Vous êtes Prêt!

```bash
npm start
# Ouvrez http://localhost:3000
```

Amusez-vous bien! 🎵

---

**Besoin d'aide?**
1. Vérifier les logs: `npm start`
2. Lire le DEPLOYMENT.md (Troubleshooting)
3. Vérifier les variables .env
4. Consulter les commentaires du code

Bon streaming! 🎵
