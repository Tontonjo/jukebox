# 🎵 Jukebox

## Tonton Jo  
### Join the community:
[![Youtube](https://badgen.net/badge/Youtube/Subscribe)](http://youtube.com/channel/UCnED3K6K5FDUp-x_8rwpsZw?sub_confirmation=1)
[![Discord Tonton Jo](https://badgen.net/discord/members/h6UcpwfGuJ?label=Discord%20Tonton%20Jo%20&icon=discord)](https://discord.gg/h6UcpwfGuJ)
### Support my work, give a thanks and help the youtube channel:
[![Ko-Fi](https://badgen.net/badge/Buy%20me%20a%20Coffee/Link?icon=buymeacoffee)](https://ko-fi.com/tontonjo)
[![Infomaniak](https://badgen.net/badge/Infomaniak/Affiliated%20link?icon=K)](https://www.infomaniak.com/goto/fr/home?utm_term=6151f412daf35)


## Related video tutorials
[Jukebox - deploiement et démo](https://www.youtube.com/watch?v=TBD) 

> **Version 1.2.0** — dernière mise à jour : 11 septembre 2026

Jukebox web collaboratif pour les soirées : un écran de lecture branché aux
enceintes, un panneau d'administration qui commande tout, et une page invité où
les personnes autorisées cherchent et ajoutent leurs morceaux — avec quotas.

La musique vient de votre bibliothèque **Navidrome** ; si un titre n'y est pas,
le jukebox interroge **Soulseek** en repli. Aucune base de données : la playlist
vit en mémoire et disparaît au redémarrage.

![Status](https://img.shields.io/badge/status-production%20ready-brightgreen)
![Node](https://img.shields.io/badge/node-%E2%89%A518-blue)
![Licence](https://img.shields.io/badge/licence-MIT-lightgrey)

---

## Sommaire

- [Aperçu](#aperçu)
- [Fonctionnalités](#fonctionnalités)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [Déploiement en production](#déploiement-en-production)
- [Architecture](#architecture)
- [API](#api)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)
- [Documentation](#documentation)
- [Licence](#licence)

---

## Aperçu

Trois pages, trois rôles bien séparés :

| Page | Rôle |
|------|------|
| `/` — **lecteur** | Affiche et joue. Aucun bouton : pochette, paroles synchronisées, playlist recentrée sur la piste en cours, QR code d'invitation |
| `/admin` — **régie** | Seul poste de commande : lecture/pause, piste suivante, playlist, utilisateurs, quotas, réglages à chaud |
| `/guest` — **invité** | Recherche et ajout, réservés aux personnes inscrites par l'admin, avec quota et cooldown |

## Fonctionnalités

**Écran de lecture**

- Paroles synchronisées (LRClib), pochettes, playlist visuelle
- QR code d'invitation généré localement, sans appel réseau
- Fondu enchaîné réglable entre les morceaux (`FADE_SECONDS`, modifiable à chaud)
- Reprise automatique après une coupure de flux (3 tentatives, puis piste suivante)
- Responsive : desktop, tablette, mobile

**Invités**

- Connexion par code unique — aucun nom à saisir
- Recherche Navidrome, repli Soulseek, annulable, avec barre de progression
- Quota glissant (ex. 3 titres par heure), cooldown entre deux ajouts, compte à rebours à la seconde
- Refus des doublons ; crédit remboursé si un téléchargement échoue

**Admin**

- Contrôle complet de la lecture et de la playlist (réordonner, retirer, vider)
- Ajout de morceaux sans quota
- Gestion des invités : ajouter, renommer, retirer, réinitialiser le quota, régénérer un code
- Quotas et fondu modifiables sans redémarrer
- Lien invité copiable, y compris en `http://` sur le réseau local

**Sources musicales**

| Source | État | Détail |
|--------|------|--------|
| Navidrome / Subsonic | ✅ principale | Bibliothèque locale, pochettes, métadonnées |
| Soulseek (via [sockseek](https://github.com/fiso64/sockseek)) | ✅ repli | Interrogé si Navidrome ne trouve rien ; fichiers supprimés après lecture |
| Spotify | 📋 envisagé | — |

## Prérequis

- **Node.js ≥ 18** et npm
- **Navidrome** accessible depuis le serveur (facultatif mais recommandé)
- **sockseek** dans le `PATH` si vous voulez le repli Soulseek (facultatif)
- **Nginx** + un nom de domaine si vous déployez en HTTPS (voir [SSL.md](SSL.md))

## Installation

```bash
sudo apt update && sudo apt install git nano
git clone https://github.com/Tontonjo/jukebox
cd jukebox

npm ci                 # ou: npm install
cp .env.example .env
nano .env              # au minimum : ADMIN_PASSWORD et les accès Navidrome

npm start
```

Le jukebox écoute sur <http://localhost:3000> :

- lecteur → <http://localhost:3000>
- admin → <http://localhost:3000/admin>
- invités → <http://localhost:3000/guest>

<details>
<summary><strong>Script d'installation assisté</strong></summary>

```bash
chmod +x install.sh && ./install.sh
```

Il vérifie les prérequis, installe les dépendances, crée le `.env` et affiche
les commandes Nginx / systemd / PM2 adaptées à votre machine.
</details>

<details>
<summary><strong>Docker Compose</strong> (jukebox + Navidrome + Nginx)</summary>

```bash
cp .env.example .env && nano .env
mkdir -p ./music        
docker compose up -d
```

`sockseek` n'est pas embarqué dans l'image : pour Soulseek, faites tourner le
démon à côté et pointez `SOCKSEEK_REMOTE` dessus avec `SOCKSEEK_AUTOSTART=false`.
</details>

## Configuration

Tout se règle dans `.env` (voir [`.env.example`](.env.example) pour les
commentaires détaillés). Les variables marquées 🔥 sont aussi modifiables en
direct depuis `/admin`, sans redémarrage.

### Serveur

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port d'écoute |
| `NODE_ENV` | `production` | Mode d'exécution |
| `PUBLIC_URL` | *(vide)* | Adresse publique utilisée par le QR code et le lien invité. À renseigner derrière un proxy ou un domaine ; sinon détectée automatiquement |

### Admin

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ADMIN_PASSWORD` | `admin123` | **À changer impérativement** |

### Navidrome / Subsonic

| Variable | Défaut | Description |
|----------|--------|-------------|
| `NAVIDROME_ENABLED` | `true` | Active la source Navidrome |
| `NAVIDROME_URL` | `http://localhost:4533` | URL du serveur |
| `NAVIDROME_USER` / `NAVIDROME_PASS` | — | Identifiants |

### Soulseek (repli, via sockseek)

| Variable | Défaut | Description |
|----------|--------|-------------|
| `SOULSEEK_ENABLED` | `true` | Active le repli Soulseek |
| `SOCKSEEK_PATH` | `sockseek` | Chemin de l'exécutable |
| `SOCKSEEK_REMOTE` | `http://127.0.0.1:5030` | Adresse du démon sockseek |
| `SOCKSEEK_AUTOSTART` | `true` | Démarre le démon avec le serveur s'il n'écoute pas déjà |
| `SOULSEEK_DOWNLOAD_DIR` | `./downloads` | Dossier temporaire, vidé au démarrage et à l'arrêt |
| `SOULSEEK_MAX_RESULTS` | `10` | Résultats proposés aux invités |
| `SOULSEEK_SEARCH_TIME` 🔥 | `20000` | Temps de collecte des réponses des pairs (ms) |
| `SOULSEEK_DOWNLOAD_TIMEOUT` | `180` | Délai max d'un téléchargement (s) |
| `SOULSEEK_MAX_DOWNLOADS` | `2` | Téléchargements simultanés |
| `SOULSEEK_DELETE_AFTER_PLAY` | `true` | Supprime le fichier dès la fin du morceau |
| `SOULSEEK_RATE_LIMIT` | `30` | Recherches max par fenêtre (Soulseek bannit 30 min au-delà d'environ 34 / 220 s) |

### Quotas et lecture

| Variable | Défaut | Description |
|----------|--------|-------------|
| `MAX_SONGS_PER_USER` 🔥 | `3` | Titres qu'un invité peut ajouter |
| `COOLDOWN_MINUTES` 🔥 | `5` | Délai entre deux ajouts |
| `QUOTA_WINDOW_MINUTES` 🔥 | `60` | Fenêtre glissante du quota (`0` = quota définitif) |
| `SESSION_DURATION` | `120` | Durée de session avant réinitialisation des stats (min) |
| `FADE_SECONDS` 🔥 | `3` | Fondu entre deux morceaux (`0` = enchaînement sec) |
| `LRCLIB_BASE` | `https://lrclib.net` | Base de l'API de paroles |

<details>
<summary>Deux profils tout prêts</summary>

```env
# Soirée permissive
MAX_SONGS_PER_USER=5
COOLDOWN_MINUTES=2

# Soirée stricte
MAX_SONGS_PER_USER=1
COOLDOWN_MINUTES=15
```
</details>

## Utilisation

**Admin** — ouvrez `/admin`, entrez le mot de passe, ajoutez les invités
autorisés (colonne de droite), copiez le lien invité et pilotez la lecture.

**Invité** — ouvrez `/guest` ou scannez le QR code de l'écran de lecture,
entrez le code donné par l'organisateur, cherchez un titre, cliquez « Ajouter ».
Sans code valide, la recherche est refusée (403). Le code est insensible à la
casse et aux espaces ; l'admin peut le réinitialiser à tout moment.

**Lecteur** — ouvrez `/` sur la machine branchée aux enceintes, par son adresse
réseau (pas `localhost`, sinon le QR code retombe sur une IP détectée). Au
premier lancement le navigateur peut bloquer le son : un clic sur le voile
« Cliquez pour activer le son » suffit.

## Déploiement en production

### 1. Service systemd

Editer le fichier jukebox.service: les chemins doivent correspondre à votre installation.

```bash
sudo cp jukebox.service /etc/systemd/system/
sudo nano /etc/systemd/system/jukebox.service   # ajuster User= et WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now jukebox
sudo journalctl -u jukebox -f
```

<details>
<summary>Alternative : PM2</summary>

```bash
sudo npm install -g pm2
pm2 start jukebox-server.js --name jukebox
pm2 startup && pm2 save
```
</details>

### 2. Reverse proxy Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/jukebox
sudo nano /etc/nginx/sites-available/jukebox   # remplacer jukebox.example.com
sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox
sudo nginx -t && sudo systemctl reload nginx
```

### 3. HTTPS

👉 **[SSL.md](SSL.md) — guide pas à pas pour activer un certificat Let's Encrypt
avec Certbot et Nginx**, y compris le renouvellement automatique et le
dépannage. Une configuration Nginx HTTPS prête à l'emploi est fournie dans
[`nginx.ssl.conf`](nginx.ssl.conf).

Le HTTPS n'est pas cosmétique ici : le bouton « copier le lien invité » et
plusieurs API navigateur sont réservés aux origines sécurisées.

## Architecture

```
                 ┌─────────────────────────┐
                 │   Nginx (TLS, gzip)     │
                 └────────────┬────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        │        Node.js / Express (port 3000)      │
        │  playlist en mémoire · auth invités       │
        │  recherche · streaming · QR · paroles     │
        └───────┬───────────────────────┬───────────┘
                │                       │
        ┌───────▼────────┐     ┌────────▼─────────┐
        │   Navidrome    │     │ sockseek         │
        │   (Subsonic)   │     │ (Soulseek, repli)│
        └────────────────┘     └──────────────────┘
                │                       │
        ┌───────▼───────────────────────▼──────────┐
        │  flux audio + métadonnées + LRClib       │
        └──────────────────────────────────────────┘
```

**Aucune base de données.** Playlist, sessions et codes invités vivent en RAM et
sont perdus au redémarrage — c'est voulu : l'outil est fait pour une soirée, pas
pour du stockage durable.

### Structure du dépôt

```
jukebox/
├── jukebox-server.js     # backend Express (routes, playlist, sources, streaming)
├── qrcode.js             # générateur de QR code, sans dépendance ni réseau
├── public/
│   ├── player.html       # écran de lecture (affichage seul)
│   ├── admin.html        # panneau d'administration
│   └── guest.html        # interface invité
├── nginx.conf            # reverse proxy HTTP
├── nginx.ssl.conf        # reverse proxy HTTPS (Certbot)
├── jukebox.service       # unité systemd
├── docker-compose.yml    # jukebox + Navidrome + Nginx
├── install.sh            # installation assistée
├── test-services.js      # vérification des services externes
└── docs : README · SSL · QUICK_START · DEPLOYMENT · DEVELOPMENT · CONTRIBUTING
```

## API

| Méthode | Route | Rôle |
|---------|-------|------|
| `GET` | `/api/config` | Configuration publique |
| `GET` | `/api/search` | Recherche (invité) |
| `GET` | `/api/playlist` | Playlist courante |
| `POST` | `/api/playlist/add` | Ajouter un titre (quota appliqué) |
| `POST` | `/api/guest/login` | Connexion invité par code |
| `GET` | `/api/guest/info/:userId` | Statut d'un invité |
| `GET` | `/api/stream/:source/:id` | Flux audio (relaie les requêtes Range) |
| `GET` | `/api/qr` | QR code SVG de la page invité |
| `POST` | `/api/player/event` | Compte rendu du lecteur : `ended` / `failed` / `position` |
| `POST` | `/api/admin/auth` | Connexion admin |
| `GET`/`POST` | `/api/admin/search`, `/api/admin/playlist/add` | Recherche et ajout sans quota |
| `POST` | `/api/admin/playback` | Lecture / pause / suivant / précédent |
| `DELETE` | `/api/admin/playlist/:index` | Retirer un titre |
| `POST` | `/api/admin/playlist/clear` | Vider la playlist |
| `GET`/`POST` | `/api/admin/users` | Lister / ajouter un invité |
| `PUT`/`DELETE` | `/api/admin/users/:id` | Renommer / retirer |
| `POST` | `/api/admin/users/:id/reset` | Réinitialiser le quota |
| `POST` | `/api/admin/users/:id/password` | Nouveau code d'accès |
| `GET`/`PUT` | `/api/admin/settings` | Lire / modifier les quotas à chaud |

> `/api/player/event` n'est pas une commande : le serveur n'accepte que les
> évènements concernant la piste réellement en cours et ignore une fin de
> morceau annoncée moins de 3 s après son démarrage.

Détail des payloads dans [DEVELOPMENT.md](DEVELOPMENT.md).

## Sécurité

- **Ne committez jamais votre `.env`** — il est déjà dans `.gitignore`. Si un
  mot de passe s'est retrouvé dans l'historique git, changez-le et réécrivez
  l'historique.
- **Changez `ADMIN_PASSWORD`** : la valeur par défaut `admin123` est publique.
- **Passez en HTTPS** dès que le jukebox sort du réseau local ([SSL.md](SSL.md)).
- Les codes invités sont gardés **en clair en mémoire** pour que l'organisateur
  puisse les relire. Rien n'est écrit sur disque et tout disparaît au
  redémarrage. Ce sont des codes de soirée : ne réutilisez pas un mot de passe
  personnel.
- Le panneau `/admin` ne doit pas être exposé publiquement sans protection
  supplémentaire (restriction IP ou `auth_basic` Nginx).

Voir [SECURITY.md](SECURITY.md) pour signaler une faille.

## Dépannage

| Symptôme | Piste |
|----------|-------|
| Les musiques ne chargent pas | `curl "$NAVIDROME_URL/rest/ping.json?u=USER&p=PASS&c=jukebox&v=1.12.0"`, puis les logs (`journalctl -u jukebox -f`) |
| Nginx 502 | Le serveur Node tourne-t-il ? `systemctl status jukebox`, `ss -tuln \| grep 3000` |
| Paroles absentes | LRClib n'a pas toujours le titre — c'est normal |
| Le QR renvoie vers `localhost` | Ouvrez l'écran par son adresse réseau, ou renseignez `PUBLIC_URL` |
| La lecture s'arrête en plein morceau | Console du navigateur sur l'écran de lecture → `dumpPlaybackLog()` |
| Soulseek ne renvoie rien | Montez `SOULSEEK_SEARCH_TIME` à 30000–40000 ; vérifiez que le démon sockseek écoute |
| Port déjà utilisé | `lsof -i :3000`, ou changez `PORT` |

`node test-services.js` vérifie d'un coup la joignabilité de Navidrome, de
sockseek et de LRClib. Dépannage complet dans [DEPLOYMENT.md](DEPLOYMENT.md).

## Documentation

| Fichier | Contenu |
|---------|---------|
| [QUICK_START.md](QUICK_START.md) | Démarrer en cinq minutes |
| [SSL.md](SSL.md) | Activer HTTPS avec Certbot et Nginx |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Déploiement complet et dépannage détaillé |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture du code, API interne, contribution technique |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Comment proposer une modification |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |

## Feuille de route

- [ ] Intégration Spotify
- [ ] Playlist persistante (optionnelle)
- [ ] Historique et statistiques admin
- [ ] Mode « vote » entre invités
- [ ] Recherche vocale

## Remerciements

[Navidrome](https://www.navidrome.org/) · [sockseek](https://github.com/fiso64/sockseek) ·
[LRClib](https://lrclib.net/) · [Express](https://expressjs.com/) · [Nginx](https://nginx.org/)

## Licence

[MIT](LICENSE) — libre d'utilisation et de modification.

---

*Fait pour les soirées mémorables. 🎉*
