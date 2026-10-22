# 🎵 Jukebox

> **Jukebox 1.5.0** · doc rév. 8 · 22 octobre 2026

Jukebox web pour les soirées : un **écran de lecture** branché aux enceintes, un
**panneau admin** qui commande tout, une **page invité** où les personnes
autorisées ajoutent leurs morceaux sous quota.

<img width="750" height="375" alt="image" src="https://github.com/user-attachments/assets/17d80d3d-dadf-47f3-a842-3e5634607201" />


La musique vient de **Navidrome** ; à défaut, repli sur **Soulseek** (via
[sockseek](https://github.com/fiso64/sockseek), fichiers supprimés après lecture).
**Aucune base de données** : playlist, sessions et codes vivent en RAM et
disparaissent au redémarrage — c'est voulu, l'outil est fait pour une soirée.

## Tonton Jo  
### Join the community:
[![Youtube](https://badgen.net/badge/Youtube/Subscribe)](http://youtube.com/channel/UCnED3K6K5FDUp-x_8rwpsZw?sub_confirmation=1)
[![Discord Tonton Jo](https://badgen.net/discord/members/h6UcpwfGuJ?label=Discord%20Tonton%20Jo%20&icon=discord)](https://discord.gg/h6UcpwfGuJ)
### Support my work, give a thanks and help the youtube channel:
[![Ko-Fi](https://badgen.net/badge/Buy%20me%20a%20Coffee/Link?icon=buymeacoffee)](https://ko-fi.com/tontonjo)
[![Infomaniak](https://badgen.net/badge/Infomaniak/Affiliated%20link?icon=K)](https://www.infomaniak.com/goto/fr/home?utm_term=6151f412daf35)

[Tutoriel vidéo et démonstration](https://youtu.be/C2LB1vezhAY)

## Les trois pages

| Page | Rôle |
|------|------|
| `/` **lecteur** | Affiche et joue. Aucun bouton : pochette, paroles synchronisées (LRClib), playlist recentrée, QR code d'invitation |
| `/admin` **régie** | Seul poste de commande : lecture, playlist, invités, quotas, réglages à chaud |
| `/guest` **invité** | Recherche et ajout, réservés aux personnes inscrites, sous quota et cooldown |

Fondu enchaîné réglable, reprise auto après coupure de flux (3 tentatives puis
piste suivante), connexion invité par code unique sans nom à saisir, quota
glissant, refus des doublons (casse, accents et parenthèses ignorés), crédit
remboursé si un téléchargement échoue. Quotas et fondu modifiables sans
redémarrage.

## 🐳 Démarrage rapide avec Docker

Image publiée : [`tontonjo/jukebox`](https://hub.docker.com/r/tontonjo/jukebox),
avec **sockseek intégré** pour le repli Soulseek. Une seule commande, en
remplaçant les valeurs par les vôtres :

```bash
docker run -d --name jukebox --restart unless-stopped \
  -p 3000:3000 \
  -e ADMIN_PASSWORD=monmotdepasse \
  -e NAVIDROME_URL=http://192.168.1.100:4533 \
  -e NAVIDROME_USER=admin \
  -e NAVIDROME_PASS=password \
  -e SOULSEEK_USER=pseudo-soulseek \
  -e SOULSEEK_PASS=motdepasse-soulseek \
  -v jukebox-data:/app/data \
  tontonjo/jukebox:latest
```

Puis ouvrir `http://IP-DE-LA-MACHINE:3000` (lecteur), `/admin` et `/guest`.

- Adresse du QR code : automatique. Il reprend l'adresse par laquelle l'écran
  de lecture a été ouvert, il suffit donc de l'ouvrir par l'adresse réseau de
  la machine. Si l'écran est ouvert en `localhost`, ajouter
  `-e PUBLIC_URL=http://IP-DE-LA-MACHINE:3000` : sinon le conteneur ne connaît
  que son adresse interne Docker et le QR code serait faux.
- `NAVIDROME_URL` : un Navidrome sur la même machine se joint avec
  `http://host.docker.internal:4533`, en ajoutant
  `--add-host=host.docker.internal:host-gateway` sous Linux.
- **Soulseek** : le démon sockseek tourne dans le conteneur, démarré par le
  jukebox. Il suffit d'un compte Soulseek (`SOULSEEK_USER` / `SOULSEEK_PASS`).
  Sans compte, il suffit de retirer ces deux lignes.
- Sources automatiques : chacune s'active dès que ses identifiants sont
  fournis (`NAVIDROME_USER` + `NAVIDROME_PASS`, `SOULSEEK_USER` +
  `SOULSEEK_PASS`). Pour n'utiliser que l'une des deux, il suffit de ne pas
  renseigner l'autre. Les journaux l'indiquent au
  démarrage (`Sources: Navidrome=true, Soulseek=true`). `NAVIDROME_ENABLED` ou
  `SOULSEEK_ENABLED` à `true` / `false` forcent le choix.
- Le volume `jukebox-data` conserve la musique d'attente choisie et le cache
  Soulseek d'un redémarrage à l'autre.
- Toutes les variables de [Configuration](#configuration) s'utilisent de la
  même façon (`-e VARIABLE=valeur`), ou d'un bloc avec `--env-file .env`.
- Architectures : `amd64` et `arm` 32 bits. sockseek ne publie pas de version
  `arm64` ; sur cette architecture, l'image construite depuis les sources
  fonctionne sans Soulseek.

Commandes utiles :

```bash
docker logs -f jukebox                 # journal (sockseek préfixé « sockseek : »)
docker restart jukebox                 # redémarrer
docker pull tontonjo/jukebox:latest && docker rm -f jukebox   # mise à jour, puis relancer la commande ci-dessus
```

Équivalent Docker Compose (`docker-compose.yml`) :

```yaml
services:
  jukebox:
    image: tontonjo/jukebox:latest
    container_name: jukebox
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      ADMIN_PASSWORD: monmotdepasse
      NAVIDROME_URL: http://192.168.1.100:4533
      NAVIDROME_USER: admin
      NAVIDROME_PASS: password
      SOULSEEK_USER: pseudo-soulseek
      SOULSEEK_PASS: motdepasse-soulseek
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - jukebox-data:/app/data

volumes:
  jukebox-data:
```

```bash
docker compose up -d
```

## Installation

Node.js ≥ 18. Facultatifs : Navidrome joignable, `sockseek` dans le `PATH`,

```bash
git clone https://github.com/Tontonjo/jukebox && cd jukebox
npm ci
cp .env.example .env
nano .env              # au minimum : ADMIN_PASSWORD et les accès Navidrome
```

Test ou utilisation temporaire:
```bash
npm start              # port 3000 : / , /admin , /guest
```

Installation comme service:
Sysdemd
```bash
sudo cp jukebox.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jukebox
sudo systemctl start jukebox
sudo systemctl status jukebox

# Read the log
sudo journalctl -u jukebox.service -n 50 -f
```    
Docker Compose, en construisant l'image depuis les sources (voir aussi
[Démarrage rapide avec Docker](#-démarrage-rapide-avec-docker)) :

```bash
docker compose up -d --build
```

## Configuration

Tout dans `.env`, commenté en détail dans [`.env.example`](.env.example).
🔥 = modifiable en direct depuis `/admin`, sans redémarrage.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ADMIN_PASSWORD` | `admin123` | **À changer impérativement** |
| `PORT` / `NODE_ENV` | `3000` / `production` | Port d'écoute, mode d'exécution |
| `PUBLIC_URL` | *(vide)* | Adresse publique du QR code et du lien invité. À renseigner derrière un proxy ou un domaine ; sinon détectée |
| `NAVIDROME_ENABLED` | `false` *(Docker : automatique)* | Active la source principale. Sous Docker, vide = activée si `NAVIDROME_USER` et `NAVIDROME_PASS` sont renseignés |
| `NAVIDROME_URL` | `http://localhost:4533` | URL du serveur |
| `NAVIDROME_USER` / `NAVIDROME_PASS` | — | Identifiants |
| `MAX_SONGS_PER_USER` 🔥 | `3` | Titres par invité |
| `COOLDOWN_MINUTES` 🔥 | `5` | Délai entre deux ajouts |
| `QUOTA_WINDOW_MINUTES` 🔥 | `60` | Fenêtre glissante (`0` = quota définitif) |
| `FADE_SECONDS` 🔥 | `3` | Fondu entre morceaux (`0` = enchaînement sec) |
| `SESSION_DURATION` | `120` | Minutes avant remise à zéro des stats |
| `LRCLIB_BASE` | `https://lrclib.net` | Base de l'API de paroles |

Soirée permissive : `MAX_SONGS_PER_USER=5`, `COOLDOWN_MINUTES=2`.
Stricte : `1` et `15`.

### Soulseek (repli)

| Variable | Défaut | Description |
|----------|--------|-------------|
| `SOULSEEK_ENABLED` | `true` *(Docker : automatique)* | Active le repli. Sous Docker, vide = activé si `SOULSEEK_USER` et `SOULSEEK_PASS` sont renseignés |
| `SOULSEEK_USER` / `SOULSEEK_PASS` | — | Compte Soulseek, **image Docker uniquement** (hors Docker : `~/.config/sockseek/sockseek.conf`) |
| `SOCKSEEK_PATH` / `SOCKSEEK_REMOTE` | `sockseek` / `http://127.0.0.1:5030` | Exécutable et adresse du démon |
| `SOCKSEEK_AUTOSTART` | `true` | Démarre le démon s'il n'écoute pas déjà |
| `SOULSEEK_DOWNLOAD_DIR` | `./downloads` | Dossier temporaire, vidé au démarrage et à l'arrêt |
| `SOULSEEK_SEARCH_TIME` 🔥 | `20000` | Collecte des réponses des pairs (ms) |
| `SOULSEEK_MAX_RESULTS` | `10` | Résultats proposés aux invités |
| `SOULSEEK_DOWNLOAD_TIMEOUT` | `180` | Délai max d'un téléchargement (s) |
| `SOULSEEK_MAX_DOWNLOADS` | `2` | Téléchargements simultanés |
| `SOULSEEK_DELETE_AFTER_PLAY` | `true` | Supprime le fichier en fin de morceau |
| `SOULSEEK_RATE_LIMIT` | `30` | Recherches max par fenêtre (Soulseek bannit 30 min au-delà d'environ 34 / 220 s) |

### Musique d'attente

Ce que le jukebox joue quand plus aucune chanson d'invité n'attend son tour.
Tout se règle depuis `/admin` (panneau **Musique d'attente**) ; les variables
ci-dessous ne servent qu'au premier démarrage.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `FALLBACK_MODE` 🔥 | `off` | `off`, `radio` ou `playlist` |
| `FALLBACK_RADIO_URL` 🔥 | — | Adresse du **flux** (pas du site de la radio) — mp3, aac, ogg ou `.m3u8` |
| `FALLBACK_RADIO_HLS` 🔥 | `false` | Forcer le mode HLS si la détection automatique se trompe |
| `FALLBACK_RADIO_NAME` 🔥 | — | Nom affiché sur l'écran de lecture |
| `FALLBACK_PLAYLIST_ID` 🔥 | — | Playlist Navidrome (la liste déroulante admin le remplit) |
| `FALLBACK_SHUFFLE` 🔥 | `false` | Lire la playlist dans le désordre |
| `FALLBACK_STORE` | `./fallback.json` | Fichier où les choix faits depuis `/admin` sont conservés |

Deux comportements, selon ce qui est choisi :

- **Webradio** — coupée **sur-le-champ** dès qu'une chanson est ajoutée. Le flux
  passe par le jukebox : une seule adresse à joindre, et le visualiseur de
  l'écran de lecture continue de fonctionner. Les flux `mp3`, `aac`, `ogg` et
  **HLS (`.m3u8`)** sont acceptés ; la nature du flux est reconnue toute seule
  à l'enregistrement de l'adresse. Le HLS est lu par
  [hls.js](https://github.com/video-dev/hls.js), installé par `npm install` et
  servi par le jukebox — l'écran de lecture n'a donc pas besoin d'Internet.
- **Playlist Navidrome** — la piste en cours **va jusqu'au bout**, la chanson
  ajoutée démarre juste après. Les pistes s'enchaînent en boucle, avec leurs
  paroles et le fondu habituel.

Quand l'attente tient l'antenne, `⏭` et `⏮` font défiler ses pistes, et un
bandeau l'annonce en tête de la file sur l'écran de lecture.

## Utilisation

**Admin** — `/admin`, mot de passe, ajouter les invités (colonne de droite),
copier le lien invité, piloter la lecture, choisir la musique d'attente.

**Invité** — `/guest` ou QR code, saisir le code reçu, chercher, « Ajouter ».
Sans code valide : 403. Code insensible à la casse et aux espaces,
réinitialisable par l'admin.

**Lecteur** — ouvrir `/` sur la machine branchée aux enceintes, **par son adresse
réseau** et non `localhost`, sinon le QR code retombe sur une IP détectée. Un clic
sur le voile « Cliquez pour activer le son » débloque l'audio au premier
lancement.

## Déploiement

```bash
# systemd (ajuster User= et WorkingDirectory=)
sudo cp jukebox.service /etc/systemd/system/
sudo nano /etc/systemd/system/jukebox.service
sudo systemctl daemon-reload && sudo systemctl enable --now jukebox
sudo journalctl -u jukebox -f

# Nginx (remplacer jukebox.example.com)
sudo cp nginx.conf /etc/nginx/sites-available/jukebox
sudo nano /etc/nginx/sites-available/jukebox
sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox
sudo nginx -t && sudo systemctl reload nginx
```

Alternative à systemd : `pm2 start jukebox-server.js --name jukebox`, puis
`pm2 startup && pm2 save`.

## Architecture

```
Nginx (TLS, gzip) → Node.js / Express :3000
                    playlist en mémoire · auth invités
                    recherche · streaming · QR · paroles
                         ↓                    ↓
                    Navidrome            sockseek
                    (Subsonic)      (Soulseek, repli)
                         ↓                    ↓
                 flux audio + métadonnées + LRClib
```

```
jukebox-server.js     # backend Express (routes, playlist, sources, streaming)
qrcode.js             # QR code, sans dépendance ni réseau
public/               # player.html · admin.html · guest.html
nginx.conf            # reverse proxy HTTP
jukebox.service       # unité systemd             docker-compose.yml
Dockerfile            # image (sockseek intégré)  docker-entrypoint.sh
install.sh            # installation assistée     test-services.js
```


## Sécurité

- **Changez `ADMIN_PASSWORD`** — `admin123` est public.
- **HTTPS recommandé avec un reverse proxy
- Les codes invités sont en clair en mémoire, pour que l'organisateur puisse les
  relire. Rien sur disque, tout disparaît au redémarrage : ce sont des codes de
  soirée, pas des mots de passe personnels.
- N'exposez pas `/admin` publiquement sans restriction IP ou `auth_basic` Nginx.

## Dépannage

| Symptôme | Piste |
|----------|-------|
| Les musiques ne chargent pas | `curl "$NAVIDROME_URL/rest/ping.json?u=USER&p=PASS&c=jukebox&v=1.12.0"`, puis `journalctl -u jukebox -f` |
| Nginx 502 | `systemctl status jukebox`, `ss -tuln \| grep 3000` |
| Paroles absentes | LRClib n'a pas tous les titres — normal |
| QR vers `localhost` | Ouvrir l'écran par son adresse réseau, ou renseigner `PUBLIC_URL` |
| Lecture coupée en plein morceau | Console du navigateur sur l'écran de lecture → `dumpPlaybackLog()` |
| Soulseek ne renvoie rien | Monter `SOULSEEK_SEARCH_TIME` à 30000–40000 ; vérifier que le démon écoute |
| Port occupé | `lsof -i :3000`, ou changer `PORT` |

`node test-services.js` teste d'un coup Navidrome, sockseek et LRClib.
Dépannage complet : [DEPLOYMENT.md](DEPLOYMENT.md).

## Documentation et suite

[QUICK_START.md](QUICK_START.md) démarrer en 5 min ·
[DEPLOYMENT.md](DEPLOYMENT.md) production et dépannage détaillé ·

**Feuille de route** : Spotify · playlist persistante (optionnelle)

**Merci à** [Navidrome](https://www.navidrome.org/) ·
[sockseek](https://github.com/fiso64/sockseek) · [LRClib](https://lrclib.net/) ·
[Express](https://expressjs.com/) · [Nginx](https://nginx.org/) — licence
[MIT](LICENSE).
