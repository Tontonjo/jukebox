# 🎵 Jukebox

> **Jukebox 1.2.0** · doc rév. 2 — 12 septembre 2026

Jukebox web pour les soirées : un **écran de lecture** branché aux enceintes, un
**panneau admin** qui commande tout, une **page invité** où les personnes
autorisées ajoutent leurs morceaux sous quota.

<img width="550" height="500" alt="Capture d&#39;écran 2026-09-12 104623" src="https://github.com/user-attachments/assets/bf983656-8d96-43ec-a55f-3866007b4374" />

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

[tutoriel vidéo](https://www.youtube.com/watch?v=TBD)

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
sudo journalctl -u jukebox -f
```    
Docker Compose:

```bash
docker compose up -d
```

## Configuration

Tout dans `.env`, commenté en détail dans [`.env.example`](.env.example).
🔥 = modifiable en direct depuis `/admin`, sans redémarrage.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `ADMIN_PASSWORD` | `admin123` | **À changer impérativement** |
| `PORT` / `NODE_ENV` | `3000` / `production` | Port d'écoute, mode d'exécution |
| `PUBLIC_URL` | *(vide)* | Adresse publique du QR code et du lien invité. À renseigner derrière un proxy ou un domaine ; sinon détectée |
| `NAVIDROME_ENABLED` | `true` | Active la source principale |
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
| `SOULSEEK_ENABLED` | `true` | Active le repli |
| `SOCKSEEK_PATH` / `SOCKSEEK_REMOTE` | `sockseek` / `http://127.0.0.1:5030` | Exécutable et adresse du démon |
| `SOCKSEEK_AUTOSTART` | `true` | Démarre le démon s'il n'écoute pas déjà |
| `SOULSEEK_DOWNLOAD_DIR` | `./downloads` | Dossier temporaire, vidé au démarrage et à l'arrêt |
| `SOULSEEK_SEARCH_TIME` 🔥 | `20000` | Collecte des réponses des pairs (ms) |
| `SOULSEEK_MAX_RESULTS` | `10` | Résultats proposés aux invités |
| `SOULSEEK_DOWNLOAD_TIMEOUT` | `180` | Délai max d'un téléchargement (s) |
| `SOULSEEK_MAX_DOWNLOADS` | `2` | Téléchargements simultanés |
| `SOULSEEK_DELETE_AFTER_PLAY` | `true` | Supprime le fichier en fin de morceau |
| `SOULSEEK_RATE_LIMIT` | `30` | Recherches max par fenêtre (Soulseek bannit 30 min au-delà d'environ 34 / 220 s) |

## Utilisation

**Admin** — `/admin`, mot de passe, ajouter les invités (colonne de droite),
copier le lien invité, piloter la lecture.

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
