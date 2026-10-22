# 🔧 Jukebox - Guide de Développement

## Architecture Générale

```
Frontend (HTML/CSS/JS)
    ↓
Express.js Backend
    ↓
Service APIs (Navidrome, Soulseek, LRClib)
```

## Structure du Code

### Backend (jukebox-server.js)

#### Modules principaux

```javascript
// Configuration
const CONFIG = { ... }

// État en mémoire
const state = {
  playlist: [],
  currentTrackIndex: 0,
  isPlaying: false,
  users: new Map(),
  playbackTime: 0,
  seekSeq: 0,          // incremente a chaque saut demande par l'admin
  trackStartedAt: 0    // garde-fou contre les fins de piste envoyees en rafale
}

// Utilitaires
function generateUserId() { ... }
function findUserById(userId) { ... }
function nameKey(name) { ... }        // casse/accents/espaces normalises
function findUserByName(name) { ... }
function generatePassword(n) { ... }  // code sans I, O, 0 ni 1
function findUserByPassword(p) { ... } // le code identifie l'invite : unique
function prepareUserPassword(demande, utilisateurCourant) { ... }
function createUser(name, password) { ... }
function canUserAddSong(user) { ... }
function requireAdmin(req, res, next) { ... }  // protege /api/admin/*

// APIs
searchNavidrome(query)
searchSoulseek(query, signal)          // signal : annulation cote client
queueDownload(track) / discardPlayedTrack(track)
findPlaylistDuplicate(song)            // meme piste deja en file ? (titre normalise)
handleFailedDownload(track, raison)    // retire la piste et rembourse l'invite
refundUserCredit(track, message)       // quota, compteur, cooldown, notification
getLyrics(title, artist)

// Lecture
applyPlaybackAction(action, trackIndex, time)  // partagee admin / ecran de lecture
removePlaylistIndex(index)                     // recale currentTrackIndex

// Demon sockseek (demarre avec le serveur, arrete avec lui)
startSockseekDaemon() / stopSockseekDaemon() / portOuvert(host, port)

// Adresse publique et QR code
lanAddress() / guestUrl(req)           // req : l'adresse utilisee par le navigateur
qrSvg(texte, taille)                   // ./qrcode.js, sans dependance

// Routes HTTP
POST /api/admin/auth
GET  /api/search
POST /api/playlist/add
GET  /api/playlist
POST /api/player/event
GET  /api/qr
// ... voir jukebox-server.js pour liste complète
```

#### `qrcode.js`

Encodeur QR autonome : mode octet, correction d'erreur niveau M, versions 1 à 10
(213 caractères au plus), choix du masque par les quatre règles de pénalité de la
norme, sortie SVG. Aucune dépendance, aucun appel réseau — le jukebox doit
fonctionner sans internet. `qrMatrix(texte)` renvoie la matrice brute si besoin
de la rendre autrement.

### Frontend

#### `admin.html` - Admin Interface

Seule page qui commande la lecture ; l'écran `/player` ne fait qu'obéir.

- Login panel
- Bouton unique Lecture/Pause reflétant `isPlaying`, précédent/suivant, « ▶ » par piste
- Gestion de la liste d'utilisateurs autorisés
- Lien invité + copie compatible http:// (voir `copyGuestLink()`)
- Stats en temps réel

**Key Functions:**
- `adminLogin()` - Authentification
- `loadPlaylist()` - Récupérer playlist courante, recale le bouton Lecture/Pause
- `togglePlayback()` - Bascule lecture/pause
- `controlPlayback(action, trackIndex)` - Contrôler la lecture
- `copyGuestLink()` - Presse-papier, avec repli `execCommand` hors HTTPS
- `loadUsers()` / `addUser()` / `renameUser()` / `deleteUser()` / `resetUser()` - Gestion des utilisateurs
- `removeTrack(index)` - Retirer une chanson

#### `guest.html` - Guest Interface
- Saisie du code, vérifiée côté serveur : il identifie la personne, sans nom
- Music search (Navidrome, puis Soulseek en repli)
- Add songs with limits
- User stats

**Key Functions:**
- `joinByCode()` - Connexion avec le seul code
- `joinSession(userId)` - Créer/rejoindre session
- `searchSongs(relaunch)` - Chercher ; un second appel annule la recherche en cours
- `cancelSearch(message)` - Interrompt la requête (AbortController + compteur `searchSeq`)
- `startSearchProgress()` - Barre de progression calée sur `config.searchMaxMs`
- `addSong(index, btn)` - Ajouter à playlist, bouton « ✓ Ajouté »
- `renderNotices()` - Messages laissés par le serveur (chanson retirée, crédit rendu)

#### `player.html` - Écran de lecture

Affichage seul : aucun contrôle. Il suit l'état du serveur et lui rend compte.

- Album art, paroles synchronisées, playlist recentrée sur la piste en cours
- QR code d'invitation (`/api/qr`) et adresse en clair
- Voile « Cliquez pour activer le son » quand le navigateur refuse l'autoplay
- Surveillance de la lecture : reprise à la position exacte après une coupure

**Key Functions:**
- `loadTrack(index)` - Charger une piste
- `syncWithServer(data)` - Applique lecture/pause et les sauts demandés par l'admin
- `reportPlayerEvent(type, extra)` / `askNextTrack(type)` - Compte rendu au serveur
- `watchPlayback()` - Chien de garde : détecte une lecture figée
- `resumePlayback(position, raison)` - Reprend le flux à la seconde près (3 essais)
- `demarrerFonduEntree()` / `tickFondu()` - Fondu d'entrée et de sortie (50 ms)
- `renderPlaylist(data)` / `scrollPlaylistToCurrent(force)` - Liste recentrée
- `renderLyrics(lrcContent)` / `updateLyricsHighlight()` - Paroles
- `dumpPlaybackLog()` - Journal des incidents, depuis la console du navigateur

## API Endpoints

### Admin Only

```bash
POST /api/admin/auth
  Body: { password: string }
  Returns: { success: bool, token: string }

POST /api/admin/playback
  Body: { action: 'play'|'pause'|'next'|'prev'|'goto'|'seek', trackIndex?: number, time?: number }
  Returns: { success: bool, state: {...} }

GET /api/admin/search?q=query
  Returns: { results: Track[], searchedSoulseek: bool } | 400 { error }
  // Memes sources que /api/search, mais sans utilisateur : l'admin n'a
  // ni code ni quota. Les resultats portent inPlaylist / alreadyPlayed.

POST /api/admin/playlist/add
  Body: { song: Track }
  Returns: { success: bool, playlistLength: number, title: string }
         | 409 { duplicate: true, error }   // deja dans la playlist
         | 400 { error }                    // resultat Soulseek expire
  // Aucun quota ni cooldown : l'admin ajoute autant de titres qu'il veut.
  // La piste est creditee a « Admin » (addedById: null), donc elle ne
  // consomme le quota de personne. Le doublon reste refuse : deux entrees
  // partageraient le meme telechargement, que la suppression de l'une
  // effacerait sous l'autre.

DELETE /api/admin/playlist/:index
  Returns: { success: bool }

POST /api/admin/playlist/clear
  Returns: { success: bool }

GET /api/admin/users
  Returns: { users: User[], maxSongs: number, cooldownMinutes: number }

POST /api/admin/users
  Body: { name: string }
  Returns: { success: bool, user: User } | 400 { error }

PUT /api/admin/users/:id
  Body: { name: string }
  Returns: { success: bool, user: User }

DELETE /api/admin/users/:id
  Returns: { success: bool }   // acces revoque immediatement

POST /api/admin/users/:id/reset
  Returns: { success: bool, user: User }

GET /api/admin/settings
  Returns: { maxSongsPerUser: number, cooldownMinutes: number }

PUT /api/admin/settings
  Body: { maxSongsPerUser?, cooldownMinutes?, quotaWindowMinutes? }
  Returns: { success: bool, maxSongsPerUser, cooldownMinutes, quotaWindowMinutes } | 400 { error }
  // Applique immediatement, y compris aux cooldowns deja en cours.
  // En memoire : au redemarrage, les valeurs du .env reprennent la main.
```

> Toutes les routes `/api/admin/*` (sauf `/api/admin/auth`) exigent
> l'en-tete `Authorization: Bearer <token>` obtenu via `/api/admin/auth`.
> Les tokens sont en memoire et invalides apres un redemarrage.

### Public

```bash
GET /api/config
  Returns: {
    maxSongsPerUser: number,
    cooldownMinutes: number,
    quotaWindowMinutes: number,
    searchMaxMs: number,      // duree max d'une recherche, pour la barre de progression
    fadeSeconds: number,      // fondu entre deux chansons (0 = enchainement sec)
    guestUrl: string,         // adresse invite deduite de la requete (ou PUBLIC_URL)
    sources: { navidrome: bool, soulseek: bool }
  }

GET /api/qr
  Returns: image/svg+xml — QR code de guestUrl(req)
  Query: size (120 a 600, defaut 320)

POST /api/guest/login
  Body: { password: string }        // le code seul identifie la personne
  Returns: { userId, name, canAdd, addedSongs, maxSongs } | 403 { error }
  // Comparaison insensible a la casse et aux espaces de bord.
  // La reponse ne renvoie jamais le code.

GET /api/search?q=query&userId=required   // 403 si userId absent de la liste
  Returns: { 
    results: Song[],
    canAdd: { allowed: bool, reason?: string },
    userAddedCount: number
  }

POST /api/playlist/add
  Body: { song: Song, userId: string }
  Returns: { success: bool, playlistLength: number, yourSongsCount: number }
          | 409 { duplicate: true, error }   // deja dans la playlist
          | 429 { error }                    // quota ou cooldown
  // Le doublon est verifie avant le quota : un refus ne consomme rien.
  // findPlaylistDuplicate() compare source+id, puis artiste et titre
  // normalises (casse, accents, ponctuation et mentions entre parentheses
  // ignorees). Les resultats de /api/search portent inPlaylist / alreadyPlayed.

GET /api/playlist
  Returns: {
    playlist: Song[],
    currentIndex: number,
    isPlaying: bool,
    playbackTime: number,
    seekSeq: number,      // change => l'ecran de lecture se recale sur playbackTime
    fadeSeconds: number   // relu a chaque sondage : le reglage s'applique a chaud
  }

POST /api/player/event    // l'ecran de lecture rend compte, il ne commande pas
  Body: { type: 'ended' | 'failed' | 'position', index: number, time?: number }
  Returns: { success: bool, state? } | { ignored: true, currentIndex }
  // index doit designer la piste en cours ; une fin annoncee moins de 3 s
  // apres le demarrage du morceau est ignoree.

GET /api/guest/info/:userId
  Returns: {
    canAdd: {
      allowed: bool,
      reason?: string,
      limit?: 'cooldown' | 'quota',
      waitSeconds?: number      // secondes restantes, pour le compte a rebours client
    },
    addedSongs: number,
    maxSongs: number,
    cooldownMinutes: number,
    notices: [{ id, message, at }]   // ex: chanson retiree, credit rendu (30 min)
  }

GET /api/stream/:source/:id
  Returns: Audio stream (proxy Navidrome, ou fichier Soulseek local)
          425 si le telechargement Soulseek est encore en cours
  // L'en-tete Range est relaye tel quel a Navidrome (206 + Content-Range) et
  // le relais n'a pas de timeout : le navigateur cesse de lire des que son
  // tampon est plein, parfois plusieurs minutes, et un timeout de socket
  // coupait alors le morceau en pleine lecture.
```

## Structures de Données

### Song Object

```javascript
{
  id: string,
  title: string,
  artist: string,
  album?: string,
  duration: number,      // en secondes
  coverArt?: string,     // URL image
  source: 'navidrome' | 'soulseek',
  streamUrl: string,
  lyrics?: string,       // Format LRC
  metadata: any,
  addedBy: string,       // userId
  addedAt: number,       // timestamp
  played: boolean
}
```

### User Session

```javascript
{
  id: string,            // identifiant interne
  name: string,          // nom affiché
  password: string,      // code de connexion, unique, saisi seul sur /guest
  addedSongs: [{ id, at }],  // ajouts encore dans la fenêtre glissante (purgés au fil de l'eau)
  totalAdded: number,    // compteur cumulé, informatif
  notices: [{ id, message, at }],  // messages a afficher a l'invite (30 min)
  lastAddTime: number,   // timestamp du dernier ajout
  createdAt: number      // timestamp de création
}

// Le quota compte les entrees de addedSongs encore dans la fenetre.
// canUserAddSong() renvoie waitSeconds dans les deux cas de blocage :
//   limit 'cooldown' -> delai minimum entre deux ajouts
//   limit 'quota'    -> moment ou la plus ancienne chanson libere sa place
//                       (absent si quotaWindowMinutes vaut 0)

// Stockée dans state.users (Map), en mémoire : perdue au redémarrage.
```

## Navidrome/Subsonic API

### Authentication

Les requêtes utilisent le protocole Subsonic (version 1.12.0)

```bash
# Paramètres requis
u=username           # Utilisateur
t=hex_hash          # MD5(password + salt)
s=salt              # Hex random string
v=1.12.0            # Version API
c=jukebox           # Client name
f=json              # Format réponse
```

### Hash Calculation

```javascript
const crypto = require('crypto');
const salt = crypto.randomBytes(8).toString('hex');
const hash = crypto.createHash('md5')
  .update(password + salt)
  .digest('hex');
```

### Endpoints Utilisés

- `/rest/ping` - Test connexion
- `/rest/search3` - Chercher chansons
- `/rest/getCoverArt` - Image d'album
- `/rest/stream` - Streamer audio

## Intégration Soulseek (repli)

Soulseek n'est interrogé **que si Navidrome ne renvoie aucun résultat**.
Tout passe par [sockseek](https://github.com/fiso64/sockseek), appelé en
sous-processus.

**Démon** : au démarrage, si `SOCKSEEK_REMOTE` désigne une adresse locale et que
rien n'y répond, le serveur lance `sockseek daemon` lui-même et attend que le
port réponde (20 s au plus). Il l'arrête en quittant — mais laisse tranquille un
démon qu'il a trouvé déjà en route (systemd, lancement manuel). Sa sortie est
reprise dans les logs, préfixée « sockseek : ». `SOCKSEEK_AUTOSTART=false`
désactive ce comportement.

**Recherche** : `sockseek "<requête>" --print json-all [--remote <démon>]`.
La sortie JSON est normalisée : le format exact de sockseek peut évoluer, donc
`normalizeSoulseekResult()` accepte plusieurs noms de champs et le premier
résultat brut est journalisé une fois au démarrage pour faciliter un
réajustement. Les fichiers non audio sont écartés, et `guessMetadata()` déduit
artiste et titre du chemin partagé.

**Téléchargement** : déclenché dès l'ajout à la playlist, pas au moment de la
lecture — un morceau doit être prêt quand son tour arrive.
`sockseek "<lien slsk://>" -p downloads/<id>`, deux téléchargements en
parallèle au plus.

**Lecture** : `/api/stream/soulseek/:id` sert le fichier local via
`res.sendFile`, qui gère l'en-tête `Range`. Tant que le fichier n'est pas là,
la route renvoie **425 Too Early** et le lecteur affiche « Téléchargement en
cours » puis réessaie.

**Suppression** : c'est le cœur du dispositif. Un fichier disparaît dès que la
lecture du morceau se termine (passage au suivant, y compris en fin de
playlist), quand la piste est retirée, quand la playlist est vidée, au
démarrage du serveur et à son arrêt (SIGINT/SIGTERM). Rejouer un morceau
supprimé le retélécharge automatiquement.

```javascript
// jukebox-server.js
startSockseekDaemon()       // lance le demon si besoin, arrete avec le serveur
searchSoulseek(query, sig)  // -> résultats normalisés, lien slsk:// gardé côté serveur
                            //    sig : AbortSignal, tue sockseek si le client annule
queueDownload(track)        // file d'attente, SOULSEEK_MAX_DOWNLOADS en parallèle
handleFailedDownload(track) // retire la piste de la playlist et rembourse l'invité
discardPlayedTrack(track)   // suppression après lecture (jamais le morceau en cours)
publicTrack(track)          // masque slskLink, expose downloadStatus
```

**Limite de débit** : Soulseek bannit 30 minutes au-delà d'environ 34
recherches par 220 s. `searchAllowed()` plafonne à 30 par fenêtre et refuse
les recherches au-delà plutôt que de risquer le bannissement.

### Limites connues

- Le lien `slsk://` n'est jamais exposé aux clients : il contient le pseudo
  d'un pair. Les identifiants manipulés côté navigateur sont des hachés courts.
- Un résultat de recherche expire avec la mémoire du serveur : ajouter une
  piste après un redémarrage renvoie « Résultat Soulseek expiré ».
- La disponibilité dépend des pairs connectés. Un morceau trouvé n'est pas
  garanti téléchargeable dans le délai imparti (`SOULSEEK_DOWNLOAD_TIMEOUT`) ;
  en cas d'échec la piste quitte la playlist et l'invité récupère son crédit.
- Une recherche annulée côté navigateur coupe aussi le processus sockseek, mais
  la requête a déjà été comptée dans le quota anti-bannissement.

## LRClib Integration

Service public gratuit pour les paroles synchronisées

### API

```bash
GET https://lrclib.net/api/search
  ?track_name=title
  &artist_name=artist

Returns: [
  {
    id: number,
    trackName: string,
    artistName: string,
    albumName: string,
    duration: number,
    plainLyrics: string,
    syncedLyrics: string    // Format LRC avec timestamps
  }
]
```

### Format LRC

```
[00:00.00]Line 1
[00:05.50]Line 2
[00:10.99]Line 3
```

## Développement Local

### Setup

```bash
# Clone et install
git clone <repo>
cd jukebox
npm install

# Config
cp .env.example .env
nano .env

# Test services
node test-services.js

# Développement
npm run dev  # Auto-reload avec nodemon
```

### Debugging

```bash
# Logs détaillés
DEBUG=* npm start

# Node inspector
node --inspect jukebox-server.js
# Accédez à chrome://inspect

# PM2 logging
pm2 logs jukebox --err
```

## Améliorations Possibles

### Court Terme

- [ ] **Admin Dashboard Avancé**
  - Graphiques temps réel
  - Historique chansons
  - Statistiques par utilisateur

- [ ] **Enhanced Search**
  - Filtres (genre, année, durée)
  - Sauvegarde recherches favorites

- [ ] **User Accounts**
  - Historique personnel
  - Playlist sauvegardées
  - Profils

### Moyen Terme

- [ ] **Persistent Storage** (optionnel)
  - Redis cache
  - PostgreSQL pour historique
  - Sauvegarde playlist

- [ ] **Music Recommendations**
  - Basé sur historique
  - Trending songs
  - AI-powered suggestions

- [ ] **Social Features**
  - Collaboration playlists
  - Voting system
  - Chat temps réel

### Long Terme

- [ ] **Intégrations**
  - Spotify API
  - Apple Music
  - Deezer
  - SoundCloud

- [ ] **Mobile Apps**
  - React Native
  - Offline mode

- [ ] **Advanced Analytics**
  - Heatmaps
  - User behavior
  - Recommendations engine

## Performance Optimizations

### Frontend

- Lazy loading images
- Virtual scrolling pour playlist longue
- Service workers pour cache
- Code splitting

### Backend

- Connection pooling
- Query caching (Redis future)
- Pagination pour recherches
- Rate limiting

### Streaming

- Progressive buffering
- Adaptive bitrate
- CDN pour lyrics

## Testing

### Unit Tests (Futur)

```javascript
// test/auth.test.js
describe('Admin Authentication', () => {
  test('should reject invalid password', () => { ... });
  test('should return token on success', () => { ... });
});

// test/search.test.js
describe('Search Functionality', () => {
  test('should find songs in Navidrome', () => { ... });
  test('should find tracks on Soulseek', () => { ... });
});
```

### Integration Tests

```bash
# Tester endpoints API
npm test

# E2E avec Selenium/Cypress
npm run test:e2e
```

## Security Considerations

1. **Input Validation**
   - Sanitiser requêtes search
   - Valider IDs
   - Rate limiting

2. **Output Escaping**
   - HTML encoding dans DOM
   - CSP headers
   - XSS prevention

3. **Authentification**
   - HTTPS/TLS
   - Tokens short-lived (futur)
   - Rate limiting login

4. **Access Control**
   - Admin password strong
   - Liste blanche d'utilisateurs : tout userId inconnu reçoit 403
   - Routes /api/admin/* protégées par token Bearer

## Deployment Checklist

- [ ] Changer ADMIN_PASSWORD
- [ ] Configurer SSL/HTTPS
- [ ] Vérifier Navidrome connexion
- [ ] Tester sockseek (node test-services.js)
- [ ] Créer les utilisateurs autorisés dans /admin
- [ ] Activité logging
- [ ] Monitoring setup
- [ ] Backup strategy (si persistant)
- [ ] Rate limiting enabled
- [ ] Security headers configured

## Code Style

### JavaScript

```javascript
// Use const/let, avoid var
const config = { ... };

// Async/await over callbacks
async function fetchData() {
  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Use template literals
const message = `Found ${results.length} results`;

// Arrow functions for callbacks
array.map(item => item.id);
```

### CSS

```css
/* Use CSS custom properties for theming */
:root {
  --primary: #667eea;
  --secondary: #764ba2;
  --background: #1a1a2e;
}

/* BEM naming convention */
.playlist-item { }
.playlist-item__title { }
.playlist-item--active { }
```

## Resources

- [Express.js Docs](https://expressjs.com)
- [Subsonic API](http://www.subsonic.org/pages/api.jsp)
- [sockseek](https://github.com/fiso64/sockseek)
- [LRClib API](https://lrclib.net/)
- [Navidrome Docs](https://www.navidrome.org/)

## Contributing

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -am 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Créer Pull Request

## License

MIT - Libre d'usage et modification

---

**Pour questions:** Consultez README.md et les issues du repo
