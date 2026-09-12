# 🎵 Jukebox — déploiement et dépannage

> **Jukebox 1.2.0** · doc rév. 2 — 12 septembre 2026
> Prérequis : Node.js ≥ 18, Nginx, en option Navidrome et `sockseek` (à installer
> séparément). Démarrage express : [QUICK_START.md](QUICK_START.md) · HTTPS :
> [SSL.md](SSL.md) · toutes les variables : [`.env.example`](.env.example)

## 1. Installer

```bash
cd /home/jukebox
git clone https://github.com/Tontonjo/jukebox .
npm ci
cp .env.example .env && nano .env
```

Variables à ne pas manquer :

```env
PUBLIC_URL=                 # adresse publique (proxy/domaine). Vide en LAN : déduite
                            # de la requête, repli sur l'IP locale. Alimente le QR
                            # code et le lien invité.
ADMIN_PASSWORD=votre_mot_de_passe_secure

NAVIDROME_ENABLED=true
NAVIDROME_URL=http://192.168.1.100:4533
NAVIDROME_USER=jukebox
NAVIDROME_PASS=password_secret

SOULSEEK_ENABLED=true
SOCKSEEK_PATH=sockseek
SOCKSEEK_REMOTE=http://127.0.0.1:5030
SOCKSEEK_AUTOSTART=true     # démarre le démon s'il n'écoute pas déjà
SOULSEEK_SEARCH_TIME=20000  # collecte des réponses des pairs (ms), réglable à chaud
SOULSEEK_DELETE_AFTER_PLAY=true

FADE_SECONDS=3              # fondu entre chansons (0 = sec)
MAX_SONGS_PER_USER=3
COOLDOWN_MINUTES=5
SESSION_DURATION=120        # minutes
```

## 2. Lancer en service

Un `jukebox.service` est fourni (ajuster `User=` et `WorkingDirectory=`) ; à
défaut, `/etc/systemd/system/jukebox.service` :

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
sudo systemctl daemon-reload && sudo systemctl enable --now jukebox
sudo systemctl status jukebox

# Alternative PM2
sudo npm install -g pm2
pm2 start jukebox-server.js --name jukebox
pm2 startup && pm2 save      # pm2 monit / pm2 logs jukebox
```

## 3. Nginx et HTTPS

```bash
sudo cp nginx.conf /etc/nginx/sites-available/jukebox
sudo nano /etc/nginx/sites-available/jukebox   # jukebox.example.com → votre domaine
sudo ln -s /etc/nginx/sites-available/jukebox /etc/nginx/sites-enabled/jukebox
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS : **[SSL.md](SSL.md)** (Certbot, `nginx.ssl.conf`, renouvellement, durcissement).

> Derrière un reverse proxy, transmettez `X-Forwarded-Host` et
> `X-Forwarded-Proto` — le `nginx.conf` fourni le fait — sinon le QR code et le
> lien invité pointent sur l'adresse interne.

## 4. Navidrome

Créer un utilisateur pour le jukebox (ou réutiliser `admin`), vérifier que l'API
Subsonic est active, puis tester :

```bash
curl "http://192.168.1.50:4533/rest/ping.json?u=jukebox&p=password&c=jukebox&v=1.12.0"
```

## Comportements à connaître

**Écran de lecture** — aucun contrôle, donc aucun mot de passe : tout vient de
`/admin`. Le **QR code** reprend l'adresse par laquelle l'écran est ouvert
(`PUBLIC_URL` prime ; en `localhost`, repli sur l'IP du LAN). Le son est bloqué
avant tout geste : voile « Cliquez pour activer le son » au premier lancement.
Après une coupure de flux, la lecture reprend à la seconde où elle s'est arrêtée
(3 tentatives, puis piste suivante).

**Codes invités** — attribués par l'admin, choisis ou tirés au sort (6 caractères
sans I, O, 0 ni 1 ; 4 minimum, uniques). L'invité entre **seulement** ce code
(casse et espaces de bord indifférents). Visible dans /admin, copiable d'un clic,
régénérable avec 🔑 — l'ancien cesse aussitôt de fonctionner. Ils vivent en
mémoire, en clair, pour que l'organisateur puisse les relire : rien sur disque,
tout disparaît au redémarrage. Ce sont des codes de soirée, pas des mots de passe
personnels.

**Quotas** — `MAX_SONGS_PER_USER` (3 par défaut, viser 3–5 en soirée),
`COOLDOWN_MINUTES` (5 par défaut, 2–10 selon la taille) et `QUOTA_WINDOW_MINUTES`
se modifient en direct dans /admin (encadré « Quotas généraux »). Avec `3` et `60`,
chacun pose 3 chansons par heure, chaque chanson libérant sa place 60 min après
son ajout. La modification est immédiate mais en mémoire : après redémarrage, le
`.env` reprend la main.

**Doublons** — refusés (409) sans entamer le quota ; les résultats portent
« ✓ Déjà dans la liste ». La comparaison porte sur source + identifiant, puis sur
artiste + titre normalisés (casse, accents, ponctuation, parenthèses et crochets
ignorés) : « Bohemian Rhapsody », « … (Remastered 2011) » et « … [Live] » comptent
pour un seul morceau. Pour rejouer un titre, le retirer d'abord depuis /admin.

**Fichiers Soulseek** — dans `SOULSEEK_DOWNLOAD_DIR` (`downloads/` par défaut),
supprimés en fin de lecture, au retrait de la piste, au vidage de la playlist, au
démarrage et à l'arrêt du serveur. `SOULSEEK_DELETE_AFTER_PLAY=false` pour les
garder le temps de la soirée.

---

# Dépannage

**Les musiques ne chargent pas**

```bash
curl "http://navidrome_url:4533/rest/ping.json?u=admin&p=password&c=jukebox&v=1.12.0"
pm2 logs jukebox            # ou: sudo journalctl -u jukebox -f
```

**Paroles absentes** — tester `https://lrclib.net/api/search?track_name=test` ;
toutes les chansons n'ont pas de paroles, c'est fréquent et sans conséquence.

**Nginx 502**

```bash
systemctl status jukebox    # ou: pm2 status
sudo tail -f /var/log/nginx/jukebox_error.log
ss -tuln | grep 3000
```

**Permission denied (systemd)** — `sudo chown -R www-data:www-data /home/jukebox/`
et vérifier que `User=` dans `jukebox.service` correspond.

### La recherche Soulseek ne renvoie rien

- `node test-services.js` teste sockseek et affiche le premier résultat brut.
- sockseek introuvable → renseigner `SOCKSEEK_PATH`.
- **`Bad request: This server is not configured for Soulseek login`** : le démon
  tourne sans identifiants. Créer `~/.config/sockseek/sockseek.conf` (INI) :

  ```ini
  username = votre-pseudo
  password = votre-mot-de-passe
  path = /var/lib/jukebox/soulseek
  ```

  puis redémarrer le démon. Les identifiants vont **là**, pas dans le `.env` ; le
  jukebox impose de toute façon son propre dossier par téléchargement (`-p`),
  `path` n'est qu'un défaut sockseek.
- Le démon est lancé par le jukebox s'il n'écoute pas déjà sur `SOCKSEEK_REMOTE`,
  et arrêté avec lui ; ses journaux sont préfixés « sockseek : ». Pour le gérer
  soi-même : `SOCKSEEK_AUTOSTART=false` puis
  `sockseek daemon --server-ip 127.0.0.1 --server-port 5030`. Sans démon du tout,
  `SOCKSEEK_REMOTE=` (vide) : chaque recherche se reconnecte, c'est plus lent.
- Plus aucun résultat d'un coup : Soulseek bannit 30 min au-delà d'environ
  34 recherches / 220 s. Le serveur plafonne à `SOULSEEK_RATE_LIMIT` (30) et
  journalise « limite de recherches atteinte ».

### La recherche aboutit mais rien ne remonte

Journal sockseek affichant **`AlbumJob`** = il cherche un album et renvoie des
dossiers, pas des fichiers jouables ; sockseek choisit d'après la requête
(`Artiste - Titre` = morceau, tout le reste = album). Le jukebox force donc
`title=<requête>` sans tiret et journalise la requête transmise. Si c'est bien une
recherche de morceau : soit la collecte est trop courte (sockseek n'attend les
pairs que 6 s, le jukebox impose 20 s via `SOULSEEK_SEARCH_TIME` — monter à
30000–40000, aussi à chaud dans /admin → Réglages), soit les filtres de fichier
sont trop stricts (`pref-format`, `min-bitrate` dans `sockseek.conf`).

### Un morceau bloqué sur « Téléchargement en cours »

Pair lent ou hors ligne : au-delà de `SOULSEEK_DOWNLOAD_TIMEOUT` (180 s) la piste
passe en échec, est **retirée de la playlist** et le crédit est rendu à l'invité
(message conservé 30 min). Une piste déjà jouée n'est ni retirée ni remboursée.
L'état de chaque piste est visible dans /admin, sous le titre.

### La lecture s'arrête en plein morceau

`dumpPlaybackLog()` dans la console du navigateur de l'écran de lecture donne
heure, morceau, position et cause de chaque incident. Côté serveur, le relais
Navidrome n'impose plus de timeout et relaie les requêtes `Range` — sans cela un
navigateur qui vide son tampon voyait son flux coupé au bout de 30 s. Derrière un
reverse proxy, vérifier `proxy_read_timeout` et le passage des requêtes `Range`.

### Logs

```bash
pm2 logs jukebox --err
sudo journalctl -u jukebox -f
sudo tail -f /var/log/nginx/jukebox_access.log /var/log/nginx/jukebox_error.log
```

---

## Production

1. **HTTPS obligatoire** ([SSL.md](SSL.md)) · 2. **`ADMIN_PASSWORD` ≥ 16
caractères** · 3. **Firewall** : n'ouvrir que 80/443 · 4. **Rate limiting** : à
décommenter dans `nginx.conf` · 5. `npm audit fix` régulièrement.

HTTP Basic devant `/admin`, au besoin :

```bash
sudo apt-get install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

```nginx
auth_basic "Admin Area";
auth_basic_user_file /etc/nginx/.htpasswd;
```

`nginx.conf` active déjà gzip, keepalive et le buffering du streaming. Côté Node,
PM2 sait faire du clustering (`pm2 start jukebox-server.js -i 2`) ; penser aussi
aux limites de fichiers ouverts.

⚠️ **Zéro base de données** : playlist, invités et quotas sont en RAM et ne
survivent pas à un redémarrage. Aucune sauvegarde à faire — c'est le compromis
assumé d'un outil d'événement ponctuel.

```bash
cd /home/jukebox && git pull origin main && npm ci
sudo systemctl restart jukebox
```

En cas de blocage, vérifier dans l'ordre : les logs, les variables `.env`, la
joignabilité de Navidrome et sockseek (`node test-services.js`), les permissions
de fichiers, les ports ouverts. Ressources :
[Navidrome](https://www.navidrome.org/) ·
[sockseek](https://github.com/fiso64/sockseek) · [LRClib](https://lrclib.net/) ·
[Nginx](https://nginx.org/) · [Express](https://expressjs.com/)
