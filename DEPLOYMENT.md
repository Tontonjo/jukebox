# 🎵 Jukebox - Guide de Déploiement

## Prérequis

- **Node.js** >= 14.0.0 et npm
- **Nginx** (ou autre serveur web reverse proxy)
- **Navidrome** (optionnel, pour la musique locale)
- **sockseek** (optionnel, pour le repli Soulseek)

## Installation

### 1. Cloner/Copier les fichiers

```bash
cd /home/jukebox
git clone https://github.com/Tontonjo/jukebox . # ou copier les fichiers
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env  # Éditer selon vos besoins
```

**Variables importantes:**

```env
# Adresse publique (proxy ou nom de domaine). Laisser vide en reseau local :
# l'adresse est deduite de la requete, avec repli sur l'IP locale du serveur.
# Elle alimente le QR code de l'ecran de lecture et le lien invite de /admin.
PUBLIC_URL=

# Admin
ADMIN_PASSWORD=votre_mot_de_passe_secure

# Navidrome (optionnel mais recommandé)
NAVIDROME_ENABLED=true
NAVIDROME_URL=http://192.168.1.100:4533  # IP locale Navidrome
NAVIDROME_USER=admin
NAVIDROME_PASS=votre_password_navidrome

# Soulseek (via sockseek)
SOULSEEK_ENABLED=true
SOCKSEEK_PATH=sockseek
SOCKSEEK_REMOTE=http://127.0.0.1:5030
SOCKSEEK_AUTOSTART=true     # demarre le demon avec le jukebox s'il n'ecoute pas deja
SOULSEEK_SEARCH_TIME=20000  # duree de collecte des reponses des pairs (reglable aussi depuis le panneau admin)
SOULSEEK_DELETE_AFTER_PLAY=true


# Settings Jukebox
FADE_SECONDS=3              # Fondu entre deux chansons, en secondes (0 = sec)
MAX_SONGS_PER_USER=3        # Nombre max de chansons par utilisateur (valeur de depart)
COOLDOWN_MINUTES=5          # Délai entre les ajouts
SESSION_DURATION=120        # Durée de session en minutes
```

### 4. Configurer Nginx

**Pour développement (localhost):**

```bash
# Test simple avec proxy_pass vers localhost:3000
# Les fichiers HTML et assets sont servis par Express
```

**Pour production (domaine public):**

```bash
# 1. Copier la configuration
sudo cp nginx.conf /etc/nginx/sites-available/jukebox

# 2. Éditer avec votre domaine
sudo nano /etc/nginx/sites-available/jukebox
# Remplacer "jukebox.example.com" par votre domaine

# 3. Créer le symlink
sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox

# 4. Retirer default si nécessaire
sudo rm /etc/nginx/sites-enabled/default

# 5. Tester la config
sudo nginx -t

# 6. Recharger Nginx
sudo systemctl reload nginx
```

### 5. Configuration SSL (Recommandé pour production)

```bash
# Installer Certbot
sudo apt-get install certbot python3-certbot-nginx -y

# Générer certificat SSL
sudo certbot certonly --nginx -d jukebox.example.com

# Décommenter les lignes SSL dans nginx.conf
sudo nano /etc/nginx/sites-available/jukebox
# Décommenter les sections "listen 443 ssl" et les certificats

# Recharger Nginx
sudo systemctl reload nginx

# Renouvellement automatique
sudo certbot renew --dry-run
```

## Lancer l'application

### Mode développement

```bash
npm run dev
# Accédez à http://localhost:3000
```

### Mode production (avec PM2)

```bash
# Installer PM2
npm install -g pm2

# Lancer l'application
pm2 start jukebox-server.js --name jukebox

# Démarrage automatique au boot
pm2 startup
pm2 save

# Monitoring
pm2 monit
pm2 logs jukebox
```

### Avec systemd (alternative)

```bash
# Créer un service systemd
sudo nano /etc/systemd/system/jukebox.service
```

```ini
[Unit]
Description=Jukebox Music Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/home/jukebox
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node /home/jukebox/jukebox-server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Activer et démarrer
sudo systemctl daemon-reload
sudo systemctl enable jukebox
sudo systemctl start jukebox

# Vérifier le statut
sudo systemctl status jukebox
```

## Configuration Navidrome

### Sur le serveur Navidrome

1. Aller dans Settings → Users
2. Créer un utilisateur pour Jukebox (ou réutiliser admin)
3. Vérifier que l'API Subsonic est activée
4. Tester la connexion via: `http://navidrome-url:4533/rest/ping?u=username&t=hash&s=salt&v=1.12.0&c=jukebox`

### Dans .env du Jukebox

```env
NAVIDROME_ENABLED=true
NAVIDROME_URL=http://192.168.1.50:4533  # IP LAN de Navidrome
NAVIDROME_USER=jukebox
NAVIDROME_PASS=password_secret
```

## Utilisation

### Admin Panel

1. Accéder à `https://jukebox.example.com/admin`
2. Entrer le mot de passe (depuis ADMIN_PASSWORD)
3. **Ajouter les utilisateurs autorisés** dans la colonne de droite
4. Contrôler la **playlist et la lecture**
5. Voir les **statistiques en temps réel**

### Écran de lecture

- Accès direct: `https://jukebox.example.com/`, sur la machine branchée aux enceintes
- Affiche la piste actuelle, les paroles synchronisées et la playlist, recentrée
  en permanence sur le morceau joué
- **Aucun contrôle** : lecture, pause et changement de piste viennent de `/admin`.
  Cet écran n'a donc besoin d'aucun mot de passe.
- Affiche un **QR code** vers la page invité. Il reprend l'adresse par laquelle
  l'écran est ouvert (utile derrière un domaine ou un port particulier) ; ouvert
  en `localhost`, il retombe sur l'adresse du réseau local. `PUBLIC_URL` prime.
- Les navigateurs bloquent le son tant qu'aucun geste n'a eu lieu : un voile
  « Cliquez pour activer le son » s'affiche au premier lancement.
- En cas de coupure de flux, la lecture reprend à la seconde où elle s'est
  arrêtée (3 tentatives, puis passage à la piste suivante).
- Fondu entre les chansons : le morceau sortant descend sur `FADE_SECONDS`
  secondes et le suivant remonte sur la même durée. Réglable en direct depuis
  /admin (encadré « Quotas généraux »), 0 pour un enchaînement sec.

> Derrière un reverse proxy, transmettez `X-Forwarded-Host` et
> `X-Forwarded-Proto` (le `nginx.conf` fourni le fait) pour que le QR code et
> le lien invité pointent sur le nom public et non sur l'adresse interne.

### Interface Invités

**Accès:**
1. L'organisateur ajoute la personne via Admin ; un **code** lui est attribué
   (choisi, ou tiré au sort : 6 caractères sans I, O, 0 ni 1)
2. La personne ouvre `https://jukebox.example.com/guest`, ou scanne le QR code
   affiché sur l'écran de lecture
3. Elle entre son code — rien d'autre : c'est lui qui l'identifie
   (casse et espaces de bord indifférents)

Le code est visible dans la liste des utilisateurs de /admin, se copie d'un clic
et se réinitialise avec le bouton 🔑 : l'ancien cesse aussitôt de fonctionner.
Les codes sont uniques, 4 caractères au minimum.

> Ils vivent en mémoire, en clair, pour que l'organisateur puisse les relire.
> Rien n'est écrit sur disque et tout disparaît au redémarrage : ce sont des
> codes de soirée, pas des mots de passe personnels.

> Ces limites sont modifiables en direct depuis /admin (encadre "Quotas generaux") :
> max chansons, delai entre deux ajouts, et fenetre glissante du quota.
> Avec MAX_SONGS_PER_USER=3 et QUOTA_WINDOW_MINUTES=60, chacun peut poser
> 3 chansons par heure ; chaque chanson libere sa place 60 min apres son ajout.
> La modification s'applique immediatement mais reste en memoire : apres un redemarrage,
> les valeurs du .env reprennent la main.

### Doublons

Une chanson déjà présente dans la playlist ne peut pas être ajoutée une seconde
fois : le serveur répond 409 et le quota de l'invité n'est pas entamé. Les
résultats de recherche portent déjà la mention « ✓ Déjà dans la liste ».

La comparaison porte sur la source et l'identifiant, puis sur l'artiste et le
titre normalisés : casse, accents, ponctuation et mentions entre parenthèses ou
crochets sont ignorés. Conséquence à connaître : « Bohemian Rhapsody »,
« Bohemian Rhapsody (Remastered 2011) » et « Bohemian Rhapsody [Live] » sont
considérés comme le même morceau. Pour rejouer un titre, le retirer d'abord de
la playlist depuis /admin.

### Limites par utilisateur

- **MAX_SONGS_PER_USER**: Nombre max de chansons
  - Par défaut: 3
  - Idée: 3-5 pour une soirée
  
- **COOLDOWN_MINUTES**: Délai entre les ajouts
  - Par défaut: 5 minutes
  - Idée: 2-10 selon taille événement

## Troubleshooting

### Les musiques ne chargent pas

```bash
# Vérifier la connexion Navidrome
curl "http://navidrome_url:4533/rest/ping.json?u=admin&p=password&c=jukebox&v=1.12.0"

# Vérifier Node.js logs
pm2 logs jukebox
# ou
sudo journalctl -u jukebox -f
```

### Les paroles ne s'affichent pas

- Vérifier que LRClib est accessible: `https://lrclib.net/api/search?track_name=test`
- Certaines chansons n'ont pas de paroles disponibles

### Nginx 502 Bad Gateway

```bash
# Vérifier que Node.js tourne
ps aux | grep jukebox-server
pm2 status

# Vérifier les logs Nginx
sudo tail -f /var/log/nginx/jukebox_error.log

# Vérifier que le port 3000 est accessible
netstat -tuln | grep 3000
```

### Permission denied avec systemd

```bash
# Vérifier les permissions des fichiers
ls -la /home/jukebox/
# Donner les droits
sudo chown -R www-data:www-data /home/jukebox/

# Vérifier le user dans jukebox.service
sudo nano /etc/systemd/system/jukebox.service
# User= doit être www-data ou jukebox
```

### La recherche Soulseek ne renvoie rien

- `node test-services.js` teste sockseek et affiche le premier résultat brut.
- sockseek introuvable : renseignez son chemin dans .env (`SOCKSEEK_PATH`).
- **`Bad request: This server is not configured for Soulseek login`** : le démon
  tourne mais n'a pas d'identifiants. Créez `~/.config/sockseek/sockseek.conf`
  (format INI) :

  ```ini
  username = votre-pseudo
  password = votre-mot-de-passe
  path = /var/lib/jukebox/soulseek
  ```

  puis redémarrez le démon. Les identifiants vont **là**, pas dans le .env du
  jukebox. Le jukebox impose de toute façon son propre dossier par téléchargement
  (`-p`), `path` ne sert que de valeur par défaut à sockseek.
- Le démon est démarré par le jukebox au lancement s'il n'écoute pas déjà à
  l'adresse `SOCKSEEK_REMOTE`, et arrêté en même temps que lui. Les journaux du
  démon apparaissent préfixés « sockseek : ». Pour le gérer soi-même (systemd,
  conteneur séparé), mettre `SOCKSEEK_AUTOSTART=false` puis le lancer avec
  `sockseek daemon --server-ip 127.0.0.1 --server-port 5030`. Sans démon du tout,
  mettre `SOCKSEEK_REMOTE=` (vide) : chaque recherche se reconnectera, c'est
  plus lent.
- Plus aucun résultat d'un coup : Soulseek bannit 30 min au-delà d'environ
  34 recherches par 220 s. Le serveur plafonne à `SOULSEEK_RATE_LIMIT` (30) et
  journalise « limite de recherches atteinte » quand il refuse.

### La recherche aboutit mais ne renvoie aucun résultat

Regardez le journal du démon sockseek. S'il affiche **`AlbumJob`**, il cherche
un album et renvoie des dossiers, pas des fichiers jouables. sockseek décide du
mode d'après la requête : `Artiste - Titre` est une recherche de morceau,
n'importe quoi d'autre est une recherche d'album.

Le jukebox force donc la recherche de morceau en envoyant `title=<requête>`
quand l'invité n'a pas mis de tiret. Le journal du serveur indique la requête
réellement transmise (« aucun résultat pour « title=... » »).

Si le journal sockseek montre bien une recherche de morceau et que rien ne
remonte quand même, deux pistes :

- **La recherche est trop courte.** sockseek attend les réponses des pairs
  pendant 6 s par défaut, ce qui est peu. Le jukebox impose 20 s par défaut
  (`SOULSEEK_SEARCH_TIME` en millisecondes, réglable aussi à chaud depuis le
  panneau admin — Réglages > Délai de recherche Soulseek) ; montez à 30000 ou
  40000 si les résultats restent maigres.
- **Les conditions de fichier filtrent tout** : vérifiez `pref-format`,
  `min-bitrate` et consorts dans `sockseek.conf`.

### Un morceau reste bloqué sur « Téléchargement en cours »

- Le pair est peut-être lent ou hors ligne. Au-delà de
  `SOULSEEK_DOWNLOAD_TIMEOUT` (180 s), la piste passe en échec.
- Une piste dont le téléchargement échoue est **retirée de la playlist** et le
  crédit est rendu à l'invité, prévenu sur sa page (message conservé 30 min).
  Une piste déjà jouée n'est ni retirée ni remboursée.
- L'état de chaque piste est visible dans /admin, sous le titre.

### La lecture s'arrête en plein morceau

- Sur l'écran de lecture, ouvrir la console du navigateur et taper
  `dumpPlaybackLog()` : heure, morceau, position et cause de chaque incident.
- Côté serveur, le relais Navidrome n'impose plus de timeout et relaie les
  requêtes `Range` : sans cela, un navigateur qui cesse de lire le temps de
  vider son tampon voyait son flux coupé au bout de 30 s, en plein morceau.
- Si un reverse proxy est en place, vérifier qu'il ne coupe pas les réponses
  longues (`proxy_read_timeout`) et qu'il laisse passer les requêtes `Range`.

### Les fichiers téléchargés

Ils vivent dans `SOULSEEK_DOWNLOAD_DIR` (par défaut `downloads/` dans le
projet) et sont supprimés dès la fin de la lecture du morceau, au retrait de
la piste, au vidage de la playlist, ainsi qu'au démarrage et à l'arrêt du
serveur. Pour les conserver le temps de la soirée :
`SOULSEEK_DELETE_AFTER_PLAY=false`.

## Sécurité

### Recommandé pour production

1. **SSL/HTTPS obligatoire** - Utiliser Certbot
2. **ADMIN_PASSWORD fort** - Minimum 16 caractères
3. **Firewall** - N'ouvrir que ports 80/443
4. **Reverse proxy** - Nginx protection supplémentaire
5. **Rate limiting** - Activé dans nginx.conf (décommenter)
6. **Mise à jour régulière** - `npm audit fix`

### Exemple .htpasswd (optionnel)

Pour ajouter une couche d'authentification HTTP Basic avant Nginx:

```bash
sudo apt-get install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

Puis dans nginx.conf:
```nginx
auth_basic "Admin Area";
auth_basic_user_file /etc/nginx/.htpasswd;
```

## Performance

### Optimisations Nginx

- ✓ Gzip compression activé
- ✓ Keepalive connections
- ✓ Buffering pour le streaming audio
- ✓ Cache des requêtes (si configuré)

### Optimisations Node.js

- Utiliser PM2 avec clustering: `pm2 start jukebox-server.js -i 2`
- Augmenter les limites de fichiers ouverts
- Utiliser Redis pour le cache (futur)

## Logs

### Vérifier les logs

```bash
# Node.js + PM2
pm2 logs jukebox
pm2 logs jukebox --err

# Nginx
sudo tail -f /var/log/nginx/jukebox_access.log
sudo tail -f /var/log/nginx/jukebox_error.log

# Systemd
sudo journalctl -u jukebox -f

# Toutes les sources
sudo journalctl -xe
```

## Backup & Maintenance

### Base de données

⚠️ **Attention**: Cette application utilise **ZÉRO base de données** - tout est en mémoire!

- Les listes de chansons ne sont **pas persistées** entre redémarrages
- Aucune sauvegarde à faire
- Idéal pour événements ponctuels

### Mise à jour

```bash
cd /home/jukebox
git pull origin main  # ou télécharger les fichiers
npm install  # au cas où nouvelles dépendances
sudo systemctl restart jukebox
```

## Support Sources Musicales

### Navidrome ✓
- ✓ Local library
- ✓ API Subsonic
- ✓ Artwork
- ✓ Synchronized lyrics

### Soulseek ✓ (repli)
- ✓ Recherche et téléchargement via sockseek
- ✓ Interrogé seulement si Navidrome ne trouve rien
- ✓ Téléchargement anticipé dès l'ajout à la playlist
- ✓ Fichiers supprimés dès la fin de la lecture

### Possibilités futures
- Spotify API
- Deezer API
- Apple Music

## Ressources

- **Navidrome**: https://www.navidrome.org/
- **sockseek**: https://github.com/fiso64/sockseek
- **LRClib**: https://lrclib.net/
- **Nginx**: https://nginx.org/
- **Express.js**: https://expressjs.com/

## Support

Pour les problèmes, vérifiez:
1. Les logs (voir section Logs)
2. Les variables .env
3. La connectivité réseau vers Navidrome, et sockseek via test-services.js
4. Les permissions des fichiers
5. Les ports ouverts dans le firewall
