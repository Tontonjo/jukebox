// ============================================================
//  Jukebox — serveur
//  Version : 1.1.0 (2026-09-09)
//    1.1.0 — Retrait d'une chanson : l'invité récupère son crédit
//            (place dans le quota + délai d'ajout remis à zéro), que le
//            retrait vienne de l'organisateur ou de l'invité lui-même.
//            Nouvelle route POST /api/playlist/remove.
//    1.0.0 — Version initiale
// ============================================================

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { execFile, spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { qrSvg } = require('./qrcode');
require('dotenv').config();

console.log('=== ENV DEBUG ===');
console.log('NAVIDROME_ENABLED =', process.env.NAVIDROME_ENABLED);
console.log('NAVIDROME_URL     =', process.env.NAVIDROME_URL);
console.log('NAVIDROME_USER    =', process.env.NAVIDROME_USER);
console.log('NAVIDROME_PASS    =', process.env.NAVIDROME_PASS ? '***présent***' : 'ABSENT');
console.log('SOULSEEK_ENABLED  =', process.env.SOULSEEK_ENABLED !== 'false');
console.log('=================');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// ============= CONFIGURATION =============
const CONFIG = {
  // Admin
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  // Navidrome/Subsonic
  navidrome: {
    enabled: process.env.NAVIDROME_ENABLED === 'true',
    url: process.env.NAVIDROME_URL || 'http://localhost:4533',
    username: process.env.NAVIDROME_USER || '',
    password: process.env.NAVIDROME_PASS || ''
  },

  // Soulseek : utilisé en repli quand Navidrome ne trouve rien.
  // Passe par sockseek (https://github.com/fiso64/sockseek), en CLI ou en
  // mode démon. Le démon est fortement recommandé : il garde la connexion
  // Soulseek ouverte au lieu de se reconnecter à chaque recherche.
  soulseek: {
    enabled: process.env.SOULSEEK_ENABLED !== 'false',
    sockseekPath: process.env.SOCKSEEK_PATH || 'sockseek',
    // Vide = lancer sockseek en autonome (plus lent, reconnexion à chaque fois).
    // On distingue "non défini" (défaut) de "défini à vide" (autonome voulu).
    remote: process.env.SOCKSEEK_REMOTE !== undefined
      ? process.env.SOCKSEEK_REMOTE.trim()
      : 'http://127.0.0.1:5030',
    // Lancer le démon sockseek avec le jukebox, s'il n'écoute pas déjà.
    autostart: process.env.SOCKSEEK_AUTOSTART !== 'false',
    downloadDir: process.env.SOULSEEK_DOWNLOAD_DIR || path.join(__dirname, 'downloads'),
    maxResults: parseInt(process.env.SOULSEEK_MAX_RESULTS || '10'),
    // Temps que sockseek passe à collecter les réponses des pairs, et
    // délai annoncé au client pour la barre de progression de recherche.
    // Sa valeur par défaut (6 s côté sockseek) est courte : les pairs lents
    // n'ont pas le temps de répondre et la recherche paraît vide. Réglable
    // à chaud depuis le panneau admin (Réglages > Délai de recherche
    // Soulseek), ou au démarrage via SOULSEEK_SEARCH_TIME (ms).
    searchTimeMs: parseInt(process.env.SOULSEEK_SEARCH_TIME || '20000'),
    downloadTimeoutMs: parseInt(process.env.SOULSEEK_DOWNLOAD_TIMEOUT || '180') * 1000,
    maxConcurrentDownloads: parseInt(process.env.SOULSEEK_MAX_DOWNLOADS || '2'),
    // Supprimer le fichier dès que la lecture du morceau est terminée
    deleteAfterPlay: process.env.SOULSEEK_DELETE_AFTER_PLAY !== 'false',
    // Soulseek bannit 30 min au-delà de ~34 recherches / 220 s : on reste en deçà
    searchRateLimit: parseInt(process.env.SOULSEEK_RATE_LIMIT || '30'),
    searchRateWindowMs: 220 * 1000,
    // Renseigné au démarrage
    version: null
  },

  // Jukebox settings
  // Fondu entre deux chansons, en secondes. 0 = enchaînement sec.
  // Le morceau sortant baisse sur cette durée, le suivant monte sur la même.
  fadeSeconds: Math.min(15, Math.max(0, parseFloat(process.env.FADE_SECONDS || '3') || 0)),
  maxSongsPerUser: parseInt(process.env.MAX_SONGS_PER_USER || '3'),
  cooldownMinutes: parseInt(process.env.COOLDOWN_MINUTES || '5'),
  // Fenêtre glissante du quota : une chanson libère sa place après ce délai.
  // 0 = quota définitif (seul l'admin peut réinitialiser).
  quotaWindowMinutes: parseFloat(process.env.QUOTA_WINDOW_MINUTES || '60'),
  sessionDuration: parseInt(process.env.SESSION_DURATION || '120') // minutes
};

// ============= ÉTAT EN MÉMOIRE =============
const state = {
  playlist: [],
  currentTrackIndex: 0,
  isPlaying: false,
  users: new Map(), // userId -> { id, name, addedSongs: [], lastAddTime, createdAt }
  adminTokens: new Set(),
  playbackTime: 0,
  // Incremente a chaque saut demande par l'admin : l'ecran de lecture
  // n'applique une position que lorsque ce compteur change.
  seekSeq: 0,
  trackStartedAt: 0,
  sessionId: crypto.randomBytes(8).toString('hex')
};

// ============= UTILISATEURS =============
function generateUserId() {
  return crypto.randomBytes(6).toString('hex');
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function findUserById(userId) {
  if (!userId) return null;
  return state.users.get(String(userId)) || null;
}

// Cle de comparaison : insensible a la casse, aux accents et aux espaces multiples
function nameKey(name) {
  return normalizeName(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ---- Codes d'accès ----
// L'invité se connecte avec son seul code : celui-ci doit donc identifier
// une personne et une seule. Alphabet sans I, O, 0 ni 1 : un code se dicte
// et se recopie sans confusion.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(longueur = 6) {
  const octets = crypto.randomBytes(longueur);
  let code = '';
  for (let i = 0; i < longueur; i++) code += CODE_ALPHABET[octets[i] % CODE_ALPHABET.length];
  return code;
}

// Comparaison insensible à la casse et aux espaces de bord
function passwordKey(password) {
  return String(password == null ? '' : password).trim().toUpperCase();
}

function findUserByPassword(password) {
  const cible = passwordKey(password);
  if (!cible) return null;
  for (const user of state.users.values()) {
    if (passwordKey(user.password) === cible) return user;
  }
  return null;
}

function uniquePassword() {
  let code;
  do { code = generatePassword(); } while (findUserByPassword(code));
  return code;
}

// Valide un code choisi par l'organisateur, ou en génère un
function prepareUserPassword(demande, utilisateurCourant) {
  if (demande === undefined || demande === null || String(demande).trim() === '') {
    return { password: uniquePassword() };
  }

  const code = String(demande).trim();
  if (code.length < 4) return { error: 'Code trop court (4 caractères minimum)' };
  if (code.length > 40) return { error: 'Code trop long (40 caractères max)' };

  const proprietaire = findUserByPassword(code);
  if (proprietaire && proprietaire !== utilisateurCourant) {
    return { error: `Ce code est déjà celui de ${proprietaire.name}` };
  }

  return { password: code };
}

function findUserByName(name) {
  const target = nameKey(name);
  if (!target) return null;
  for (const user of state.users.values()) {
    if (nameKey(user.name) === target) return user;
  }
  return null;
}

function createUser(name, password) {
  const clean = normalizeName(name);
  if (!clean) return { error: 'Nom vide' };
  if (clean.length > 40) return { error: 'Nom trop long (40 caractères max)' };
  if (findUserByName(clean)) return { error: 'Ce nom existe déjà' };

  const code = prepareUserPassword(password);
  if (code.error) return { error: code.error };

  const user = {
    id: generateUserId(),
    name: clean,
    password: code.password,   // c'est lui qui identifie l'invité
    addedSongs: [],      // [{ id, at }] limité à la fenêtre glissante
    totalAdded: 0,       // compteur cumulé, informatif
    notices: [],         // messages à afficher à l'invité (ex : téléchargement échoué)
    lastAddTime: 0,
    createdAt: Date.now()
  };
  state.users.set(user.id, user);
  return { user };
}

function adminUserView(user) {
  const canAdd = canUserAddSong(user);   // purge aussi les chansons expirées
  return {
    id: user.id,
    name: user.name,
    password: user.password,   // l'organisateur doit pouvoir le redonner
    addedSongs: user.addedSongs.length,
    totalAdded: user.totalAdded,
    maxSongs: CONFIG.maxSongsPerUser,
    lastAddTime: user.lastAddTime,
    createdAt: user.createdAt,
    canAdd,
    waitSeconds: canAdd.waitSeconds || 0
  };
}

// Duree lisible : 45 s / 2 min 05 s
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${s.toString().padStart(2, '0')} s`;
}

// ---- Messages destinés à un invité ----
// Un invité ne regarde pas forcément sa page au moment où sa chanson échoue :
// on garde le message une demi-heure, sa page le récupère à sa prochaine
// synchronisation (toutes les 15 s).
const NOTICE_TTL_MS = 30 * 60 * 1000;

function addUserNotice(user, id, message) {
  const notices = (user.notices || []).filter(n => n.id !== id);
  notices.push({ id, message, at: Date.now() });
  user.notices = notices.slice(-5);
}

function activeNotices(user) {
  const cutoff = Date.now() - NOTICE_TTL_MS;
  user.notices = (user.notices || []).filter(n => n.at > cutoff);
  return user.notices;
}

// Rend à l'invité la place occupée par une chanson qui n'a jamais pu être
// jouée : quota, compteur cumulé et cooldown (ce dernier suivait cet ajout,
// il n'a plus lieu d'être).
function refundUserCredit(track, message) {
  const user = findUserById(track.addedById);
  if (!user) return null;

  const index = user.addedSongs.findIndex(entry => entry.id === track.id);
  if (index !== -1) user.addedSongs.splice(index, 1);
  user.totalAdded = Math.max(0, (user.totalAdded || 0) - 1);

  user.lastAddTime = user.addedSongs.length
    ? Math.max(...user.addedSongs.map(entry => entry.at))
    : 0;

  if (message) addUserNotice(user, track.id, message);
  return user;
}

// Chansons encore comptées dans le quota. Au-delà de la fenêtre glissante,
// une chanson libère sa place. Purge au passage pour ne rien accumuler.
function activeSongs(user) {
  if (CONFIG.quotaWindowMinutes <= 0) return user.addedSongs;

  const cutoff = Date.now() - CONFIG.quotaWindowMinutes * 60 * 1000;
  const active = user.addedSongs.filter(entry => entry.at > cutoff);
  user.addedSongs = active;
  return active;
}

function canUserAddSong(user) {
  if (!user) return { allowed: false, reason: 'Utilisateur non autorisé', limit: 'unknown' };
  const now = Date.now();
  const active = activeSongs(user);

  // Quota : nombre de chansons dans la fenêtre glissante
  if (active.length >= CONFIG.maxSongsPerUser) {
    if (CONFIG.quotaWindowMinutes > 0 && active.length > 0) {
      const oldest = Math.min(...active.map(entry => entry.at));
      const freeAt = oldest + CONFIG.quotaWindowMinutes * 60 * 1000;
      const waitSeconds = Math.max(1, Math.ceil((freeAt - now) / 1000));
      return {
        allowed: false,
        limit: 'quota',
        waitSeconds,
        reason: `Quota atteint : une place se libère dans ${formatDuration(waitSeconds)}`
      };
    }

    // Fenêtre désactivée (ou quota à 0) : seul l'organisateur peut débloquer
    return {
      allowed: false,
      limit: 'quota',
      reason: 'Nombre maximum de chansons atteint'
    };
  }

  // Cooldown : délai minimum entre deux ajouts
  const cooldownMs = CONFIG.cooldownMinutes * 60 * 1000;
  const elapsed = now - user.lastAddTime;
  if (user.lastAddTime > 0 && elapsed < cooldownMs) {
    const waitSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
    return {
      allowed: false,
      limit: 'cooldown',
      waitSeconds,
      reason: `Attendre encore ${formatDuration(waitSeconds)} avant d'ajouter une nouvelle chanson`
    };
  }

  return { allowed: true };
}

// ============= AUTH =============
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.headers['x-admin-token'] || req.query.token || '';
}

function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (token && state.adminTokens.has(token)) return next();
  return res.status(401).json({ error: 'Session admin invalide' });
}

// ============= NAVIDROME / SUBSONIC API =============
async function searchNavidrome(query) {
  if (!CONFIG.navidrome.enabled) return [];

  try {
    const salt = crypto.randomBytes(8).toString('hex');

    const hash = crypto.createHash('md5')
      .update(CONFIG.navidrome.password + salt)
      .digest('hex');

    const response = await axios.get(
      `${CONFIG.navidrome.url}/rest/search3`,
      {
        params: {
          u: CONFIG.navidrome.username,
          t: hash,
          s: salt,
          v: '1.12.0',
          c: 'jukebox',
          query: query,
          f: 'json'
        }
      }
    );

    const searchResult =
      response.data['subsonic-response']?.['searchResult3'];

    if (searchResult?.song) {
      return searchResult.song.map(song => ({
        source: 'navidrome',
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,

        coverArt: song.coverArt
          ? `${CONFIG.navidrome.url}/rest/getCoverArt?id=${song.coverArt}&u=${CONFIG.navidrome.username}&t=${hash}&s=${salt}&v=1.12.0&c=jukebox`
          : null,

        streamUrl:
          `${CONFIG.navidrome.url}/rest/stream?id=${song.id}` +
          `&u=${CONFIG.navidrome.username}` +
          `&t=${hash}&s=${salt}&v=1.12.0&c=jukebox`,

        metadata: song
      }));
    }

  } catch (error) {
    console.error('Navidrome search error:', error.message);
  }

  return [];
}

// ============= SOULSEEK (repli quand Navidrome ne trouve rien) =============
// Recherche et téléchargement via sockseek. Les fichiers sont éphémères :
// téléchargés à l'ajout, supprimés dès la fin de leur lecture.

const SOULSEEK_DIR = path.resolve(CONFIG.soulseek.downloadDir);
// Marge de sécurité (ms) accordée au processus sockseek au-delà du délai
// de recherche configuré, avant de le tuer. Interne : n'affecte pas la
// barre de progression annoncée au client.
const SOULSEEK_PROCESS_OVERHEAD_MS = 20000;
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma'];

// id -> { link, title, artist, ... } : résultats récents, pour retrouver le
// lien slsk:// à partir de l'identifiant court manipulé par les clients
const soulseekResults = new Map();
// id -> { status, file, error, startedAt }
const downloads = new Map();

let searchTimestamps = [];
let downloadQueue = [];
let activeDownloads = 0;
let loggedSampleResult = false;
let loggedRawOutput = false;

function soulseekAvailable() {
  return CONFIG.soulseek.enabled && !!CONFIG.soulseek.version;
}

function remoteArgs() {
  return CONFIG.soulseek.remote ? ['--remote', CONFIG.soulseek.remote] : [];
}

function lastLine(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

function runSockseek(args, timeout, signal) {
  return new Promise((resolve, reject) => {
    execFile(
      CONFIG.soulseek.sockseekPath,
      args,
      // `signal` permet d'arreter sockseek si le client annule sa recherche
      { timeout, maxBuffer: 16 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        // sockseek écrit parfois sur stderr tout en réussissant : on ne
        // considère l'échec que si rien d'exploitable n'est sorti.
        if (error && !String(stdout).trim()) {
          return reject(new Error(lastLine(stderr) || error.message || 'échec de sockseek'));
        }
        resolve(String(stdout));
      }
    );
  });
}

function detectSockseek() {
  return new Promise(resolve => {
    execFile(CONFIG.soulseek.sockseekPath, ['--version'], { timeout: 15000 },
      (error, stdout) => resolve(error ? null : (lastLine(stdout) || 'présent')));
  });
}

// ---- Démon sockseek ----
// Le démon garde la connexion Soulseek ouverte : sans lui, chaque recherche
// se reconnecte au réseau, ce qui prend des secondes. On le démarre donc avec
// le jukebox, sauf s'il tourne déjà (systemd, lancement manuel, autre machine).

let sockseekDaemon = null;

function parseRemote(remote) {
  try {
    const url = new URL(remote);
    return { host: url.hostname, port: parseInt(url.port, 10) || 5030 };
  } catch (error) {
    return null;
  }
}

// Le démon répond-il déjà ? Une simple connexion TCP suffit à le savoir.
function portOuvert(host, port, timeout = 1000) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const fin = ouvert => { socket.destroy(); resolve(ouvert); };
    socket.setTimeout(timeout);
    socket.once('connect', () => fin(true));
    socket.once('timeout', () => fin(false));
    socket.once('error', () => fin(false));
  });
}

function journaliserSockseek(flux, prefixe) {
  let reste = '';
  flux.on('data', morceau => {
    const lignes = (reste + morceau).split('\n');
    reste = lignes.pop();
    for (const ligne of lignes) {
      if (ligne.trim()) console.log(`${prefixe} ${ligne.trim()}`);
    }
  });
}

async function startSockseekDaemon() {
  if (!CONFIG.soulseek.autostart) return 'désactivé';
  if (!CONFIG.soulseek.remote) return 'autonome';   // pas de démon voulu

  const cible = parseRemote(CONFIG.soulseek.remote);
  if (!cible) return 'adresse invalide';

  const local = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(cible.host);
  if (!local) return 'distant';                     // le démon tourne ailleurs

  if (await portOuvert(cible.host, cible.port)) return 'déjà lancé';

  const hote = cible.host === 'localhost' ? '127.0.0.1' : cible.host;
  const enfant = spawn(
    CONFIG.soulseek.sockseekPath,
    ['daemon', '--server-ip', hote, '--server-port', String(cible.port)],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  sockseekDaemon = enfant;
  journaliserSockseek(enfant.stdout, 'sockseek :');
  journaliserSockseek(enfant.stderr, 'sockseek :');

  enfant.on('error', error => {
    console.error('sockseek : démarrage impossible —', error.message);
    if (sockseekDaemon === enfant) sockseekDaemon = null;
  });

  enfant.on('exit', code => {
    if (sockseekDaemon === enfant) {
      sockseekDaemon = null;
      console.error(`sockseek : le démon s'est arrêté (code ${code}).`
        + ' Les recherches Soulseek repassent en mode autonome, plus lent.');
    }
  });

  // On attend qu'il réponde avant de dire qu'il est prêt (20 s au plus)
  for (let essai = 0; essai < 40; essai++) {
    if (!sockseekDaemon) return null;               // mort-né
    if (await portOuvert(cible.host, cible.port)) return 'lancé';
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return null;
}

function stopSockseekDaemon() {
  const enfant = sockseekDaemon;
  if (!enfant) return;

  sockseekDaemon = null;   // l'arrêt est volontaire : pas de message d'alerte
  try { enfant.kill('SIGTERM'); } catch (error) { /* déjà parti */ }
}

// ---- Recherche ----

// Soulseek bannit temporairement au-delà d'un certain rythme de recherches
function searchAllowed() {
  const now = Date.now();
  searchTimestamps = searchTimestamps.filter(t => now - t < CONFIG.soulseek.searchRateWindowMs);
  return searchTimestamps.length < CONFIG.soulseek.searchRateLimit;
}

// sockseek peut sortir un tableau JSON, un objet, ou du JSON ligne par ligne
function parseSockseekJson(stdout) {
  const text = String(stdout).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.results)) return parsed.results;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch (error) { /* on tente le mode ligne par ligne */ }

  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) entries.push(...parsed);
      else entries.push(parsed);
    } catch (error) { /* ligne non JSON : ignorée */ }
  }
  return entries;
}

function firstDefined() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

// Devine artiste et titre à partir du chemin partagé. Les partages Soulseek
// suivent souvent "Artiste/Album/03 - Titre.mp3" ou "Artiste - Titre.mp3".
const GENERIC_FOLDERS = new Set([
  'music', 'musique', 'shared', 'share', 'partage', 'downloads', 'complete',
  'mp3', 'flac', 'albums', 'media', 'audio', 'soulseek', 'documents'
]);

function guessMetadata(filePath) {
  const segments = String(filePath || '').split(/[\\/]+/).filter(Boolean);
  const base = segments.pop() || '';
  const name = base.replace(/\.[a-z0-9]{2,5}$/i, '');

  // Retire un éventuel numéro de piste en tête. On exige un séparateur
  // explicite, ou un zéro initial ("01 Titre") : sans cette prudence,
  // "99 Luftballons" perdrait son titre.
  const cleaned = name
    .replace(/^\s*\d{1,3}\s*[.\-_)]+\s*/, '')
    .replace(/^\s*0\d\s+/, '')
    .trim();
  const parts = cleaned.split(/\s+-\s+/);

  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }

  const title = cleaned || name;

  // Pas d'artiste dans le nom du fichier : on remonte dans l'arborescence
  for (let i = segments.length - 1; i >= 0 && i >= segments.length - 3; i--) {
    const folder = segments[i].trim();
    if (!folder || GENERIC_FOLDERS.has(folder.toLowerCase())) continue;

    // "Artiste - Album (2013)" -> "Artiste"
    const dash = folder.split(/\s+-\s+/);
    if (dash.length >= 2) return { artist: dash[0].trim(), title };

    // Dossier d'album : l'artiste est en général juste au-dessus
    const parent = segments[i - 1];
    if (parent && !GENERIC_FOLDERS.has(parent.trim().toLowerCase())) {
      return { artist: parent.trim(), title };
    }

    // Un seul dossier utile : c'est probablement l'artiste
    return { artist: folder, title };
  }

  return { artist: null, title };
}

// Lit une propriété quel que soit le style de nommage
function pick(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (let i = 1; i < arguments.length; i++) {
    const value = obj[arguments[i]];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

// sockseek renvoie { User: { Username, UploadSpeed, HasFreeUploadSlot },
//                    File: { Filename, Length, Size, Bitrate } }
// On accepte aussi une forme à plat, au cas où le format évoluerait.
function normalizeSoulseekResult(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const file = entry.File || entry.file || entry;
  const user = entry.User || entry.user || entry;

  const username = firstDefined(
    pick(user, 'Username', 'username', 'user', 'name'),
    pick(entry, 'username', 'user', 'uploader')
  );

  const filePath = firstDefined(
    pick(file, 'Filename', 'filename', 'FileName', 'Path', 'path', 'file', 'name'),
    pick(entry, 'path', 'filename', 'file', 'fullPath')
  );

  let link = firstDefined(
    pick(entry, 'link', 'slsk', 'slskLink', 'url'),
    pick(file, 'Link', 'link')
  );
  if (!link && username && filePath) {
    link = `slsk://${username}/${String(filePath).replace(/\\/g, '/')}`;
  }
  if (!link) return null;

  const guessed = guessMetadata(filePath || link);
  const title = firstDefined(pick(file, 'Title', 'title'), pick(entry, 'title', 'track'), guessed.title, 'Sans titre');
  const artist = firstDefined(pick(file, 'Artist', 'artist'), pick(entry, 'artist'), guessed.artist, username, 'Inconnu');

  const duration = Number(firstDefined(
    pick(file, 'Length', 'length', 'Duration', 'duration', 'seconds'), 0)) || 0;
  const bitrate = Number(firstDefined(
    pick(file, 'Bitrate', 'bitrate', 'BitRate'), 0)) || 0;
  const size = Number(firstDefined(
    pick(file, 'Size', 'size', 'FileSize'), 0)) || 0;
  const uploadSpeed = Number(firstDefined(
    pick(user, 'UploadSpeed', 'uploadSpeed', 'speed'), 0)) || 0;

  const freeSlotRaw = firstDefined(
    pick(user, 'HasFreeUploadSlot', 'hasFreeUploadSlot', 'freeUploadSlot', 'FreeUploadSlot'));
  const freeSlot = freeSlotRaw === undefined ? true : Boolean(freeSlotRaw);

  return {
    source: 'soulseek',
    id: crypto.createHash('sha1').update(String(link)).digest('hex').slice(0, 12),
    title: String(title),
    artist: String(artist),
    duration,
    coverArt: null,
    bitrate,
    size,
    format: (String(filePath || '').match(/\.([a-z0-9]{2,5})$/i) || [, ''])[1].toLowerCase(),
    username: username ? String(username) : null,
    uploadSpeed,
    freeSlot,
    slskLink: String(link)
  };
}

// sockseek interprète "Artiste - Titre" comme une recherche de morceau, mais
// une requête sans tiret comme une recherche d'ALBUM : il renvoie alors des
// dossiers, inutilisables pour un jukebox. La syntaxe structurée "title=..."
// force la recherche de morceau.
function soulseekQuery(query) {
  const clean = String(query).trim();

  if (/\s+-\s+/.test(clean)) return clean;   // "Artiste - Titre" : tel quel

  // Les propriétés sont séparées par des virgules : on neutralise , et =
  return 'title=' + clean.replace(/[,=]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchSoulseek(query, signal) {
  if (!soulseekAvailable()) return [];

  if (!searchAllowed()) {
    console.warn('Soulseek : limite de recherches atteinte, requête refusée');
    return [];
  }
  searchTimestamps.push(Date.now());

  const sent = soulseekQuery(query);

  try {
    const stdout = await runSockseek(
      [sent, '--print', 'json-all',
       '--search-timeout', String(CONFIG.soulseek.searchTimeMs)].concat(remoteArgs()),
      // Marge de sécurité interne pour le processus (démarrage, parsing…),
      // au-delà du délai de recherche lui-même. Purement technique : elle
      // n'est jamais montrée à l'invité (cf. searchMaxDurationMs).
      CONFIG.soulseek.searchTimeMs + SOULSEEK_PROCESS_OVERHEAD_MS,
      signal
    );

    const entries = parseSockseekJson(stdout);

    // Le format exact de sockseek peut évoluer : on garde une trace du
    // premier résultat pour pouvoir corriger la correspondance des champs.
    if (!loggedSampleResult && entries.length) {
      loggedSampleResult = true;
      console.log('Soulseek : exemple de résultat brut →',
        JSON.stringify(entries[0]).slice(0, 500));
    }

    if (!entries.length) {
      console.log(`Soulseek : aucun résultat pour « ${sent} »`);

      // Sortie non vide mais illisible : la montrer est le seul moyen de
      // corriger la correspondance des champs.
      const raw = String(stdout).trim();
      if (raw && !loggedRawOutput) {
        loggedRawOutput = true;
        console.log('Soulseek : sortie non reconnue →', raw.slice(0, 800));
      }
    }

    const results = [];
    const seen = new Set();

    for (const entry of entries) {
      const normalized = normalizeSoulseekResult(entry);
      if (!normalized || seen.has(normalized.id)) continue;
      if (normalized.format && !AUDIO_EXTENSIONS.includes('.' + normalized.format)) continue;

      seen.add(normalized.id);
      results.push(normalized);
    }

    // sockseek trie déjà selon ses préférences (format, débit...). On se
    // contente de remonter les pairs ayant un créneau d'envoi libre : sans
    // cela, le téléchargement reste en file d'attente chez l'autre.
    results.sort((a, b) => (a.freeSlot === b.freeSlot) ? 0 : (a.freeSlot ? -1 : 1));

    const selected = results.slice(0, CONFIG.soulseek.maxResults);
    for (const track of selected) soulseekResults.set(track.id, track);

    return selected;
  } catch (error) {
    if (signal && signal.aborted) {
      console.log('Soulseek : recherche annulée par le client');
      return [];
    }
    console.error('Soulseek search error:', explainSockseekError(error.message));
    return [];
  }
}

// Transforme les erreurs sockseek courantes en conseil actionnable
function explainSockseekError(message) {
  const text = String(message || '');

  if (/not configured for Soulseek login|Configure username\/password/i.test(text)) {
    return text +
      "\n  → Le démon sockseek n'a pas d'identifiants Soulseek." +
      '\n     Ajoutez dans ~/.config/sockseek/sockseek.conf :' +
      '\n       username = votre-pseudo' +
      '\n       password = votre-mot-de-passe' +
      '\n     puis redémarrez le démon (sockseek daemon).';
  }

  if (/refused|ECONNREFUSED|could not connect/i.test(text)) {
    return text +
      `\n  → Démon injoignable sur ${CONFIG.soulseek.remote}.` +
      '\n     Lancez-le (sockseek daemon --server-port 5030),' +
      '\n     ou videz SOCKSEEK_REMOTE dans .env pour le mode autonome.';
  }

  if (/banned|too many searches|rate/i.test(text)) {
    return text +
      '\n  → Soulseek limite le rythme des recherches (bannissement ~30 min).' +
      '\n     Baissez SOULSEEK_RATE_LIMIT dans le .env.';
  }

  return text;
}

// ---- Métadonnées et pochette embarquées ----
// Une fois le fichier là, ses tags valent mieux que ce qu'on avait deviné
// du nom de fichier : titre, artiste, et surtout la pochette.
const COVER_EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif'
};

async function readEmbeddedMetadata(file) {
  // music-metadata est en ESM : import dynamique depuis ce module CommonJS
  const mm = await import('music-metadata');
  const parsed = await mm.parseFile(file, { duration: false, skipPostHeaders: true });
  return parsed;
}

// Extrait la pochette à côté du fichier audio, renvoie son chemin ou null
async function extractCover(parsed, dir) {
  const pictures = (parsed.common && parsed.common.picture) || [];
  if (!pictures.length) return null;

  const picture = pictures[0];
  const extension = COVER_EXTENSIONS[String(picture.format || '').toLowerCase()] || '.jpg';
  const target = path.join(dir, 'cover' + extension);

  fs.writeFileSync(target, Buffer.from(picture.data));
  return target;
}

// ---- Doublons ----
// Deux invités peuvent demander le même morceau sans le savoir, et la même
// chanson se retrouve rarement sous un identifiant identique (Navidrome d'un
// côté, plusieurs pairs Soulseek de l'autre). On compare donc aussi artiste et
// titre, en ignorant casse, accents, ponctuation et mentions entre
// parenthèses : « Bohemian Rhapsody (Remastered 2011) » et « Bohemian
// Rhapsody » sont le même morceau pour une soirée.
function titleKey(title) {
  return String(title == null ? '' : title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')   // (remastered), [live]...
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trackKey(track) {
  return `${titleKey(track && track.artist)}|${titleKey(track && track.title)}`;
}

// Renvoie la piste déjà présente dans la playlist, ou null
function findPlaylistDuplicate(song) {
  if (!song) return null;
  const cle = trackKey(song);

  return state.playlist.find(track =>
    (track.source === song.source && track.id === song.id)
    || (cle !== '|' && trackKey(track) === cle)
  ) || null;
}

// ---- Téléchargement ----

function downloadStatus(id) {
  const entry = downloads.get(id);
  return entry ? entry.status : 'absent';
}

function findAudioFile(dir) {
  let best = null;

  const walk = (current) => {
    let items = [];
    try { items = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }

    for (const item of items) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) { walk(full); continue; }

      const ext = path.extname(item.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;

      let size = 0;
      try { size = fs.statSync(full).size; } catch (e) { continue; }
      if (!best || size > best.size) best = { file: full, size };
    }
  };

  walk(dir);
  return best ? best.file : null;
}

function queueDownload(track) {
  if (!soulseekAvailable() || !track.slskLink) return;
  if (downloads.has(track.id)) return;

  downloads.set(track.id, { status: 'pending', file: null, error: null, startedAt: Date.now() });
  downloadQueue.push(track);
  pumpDownloads();
}

function pumpDownloads() {
  while (activeDownloads < CONFIG.soulseek.maxConcurrentDownloads && downloadQueue.length) {
    const track = downloadQueue.shift();
    activeDownloads++;
    runDownload(track).finally(() => {
      activeDownloads--;
      pumpDownloads();
    });
  }
}

async function runDownload(track) {
  const entry = downloads.get(track.id);
  if (!entry || entry.status === 'deleted') return;

  entry.status = 'downloading';
  const dir = path.join(SOULSEEK_DIR, track.id);

  try {
    fs.mkdirSync(dir, { recursive: true });

    await runSockseek(
      [track.slskLink, '-p', dir].concat(remoteArgs()),
      CONFIG.soulseek.downloadTimeoutMs
    );

    // Un autre thread a pu supprimer la piste entre-temps
    if (downloads.get(track.id) !== entry || entry.status === 'deleted') return;

    const file = findAudioFile(dir);
    if (!file) throw new Error('aucun fichier audio téléchargé');

    entry.file = file;
    entry.status = 'ready';
    console.log(`Soulseek : "${track.title}" prêt (${path.basename(file)})`);

    await applyEmbeddedMetadata(track, entry, dir);
  } catch (error) {
    entry.status = 'failed';
    entry.error = error.message;
    console.error(`Soulseek : échec du téléchargement de "${track.title}" — ${explainSockseekError(error.message)}`);
    removeDownloadDir(track.id);
    handleFailedDownload(track, error.message);
  }
}

// Complète la piste avec ce que contient réellement le fichier
async function applyEmbeddedMetadata(track, entry, dir) {
  let parsed;
  try {
    parsed = await readEmbeddedMetadata(entry.file);
  } catch (error) {
    console.error(`Métadonnées illisibles pour "${track.title}" — ${error.message}`);
    return;
  }

  const tags = (parsed && parsed.common) || {};
  const format = (parsed && parsed.format) || {};

  // Les tags sont plus fiables que le nom de fichier, mais on ne remplace
  // que ce qui est réellement renseigné.
  const oldTitle = track.title;
  const oldArtist = track.artist;

  if (tags.title && tags.title.trim()) track.title = tags.title.trim();
  if (tags.artist && tags.artist.trim()) track.artist = tags.artist.trim();
  if (tags.album && tags.album.trim()) track.album = tags.album.trim();
  if (format.duration > 0) track.duration = Math.round(format.duration);

  try {
    const cover = await extractCover(parsed, dir);
    if (cover) {
      entry.cover = cover;
      track.coverArt = `/api/cover/soulseek/${track.id}`;
      console.log(`Pochette : extraite pour "${track.title}"`);
    }
  } catch (error) {
    console.error(`Pochette : extraction impossible — ${error.message}`);
  }

  // Les tags corrigent souvent ce que le nom de fichier avait mal deviné :
  // on retente les paroles si elles avaient échoué, ou si l'identité a changé.
  const identityChanged = track.title !== oldTitle || track.artist !== oldArtist;
  if (track.lyricsState === 'none' || (identityChanged && track.lyricsState !== 'synced')) {
    fetchLyricsFor(track);
  }
}

function removeDownloadDir(id) {
  const dir = path.join(SOULSEEK_DIR, id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Soulseek : suppression impossible (${id}) — ${error.message}`);
  }
}

// Supprime le fichier local d'une piste : appelé dès la fin de sa lecture
// forget : la piste quitte la playlist, plus rien à retenir d'elle.
// Sinon on garde un marqueur 'deleted', que l'admin affiche.
function discardDownload(id, forget) {
  const entry = downloads.get(id);
  if (!entry) return;

  removeDownloadDir(id);
  downloadQueue = downloadQueue.filter(t => t.id !== id);

  // La pochette vivait dans le dossier supprimé
  const track = state.playlist.find(t => t.source === 'soulseek' && t.id === id);
  if (track) track.coverArt = null;

  if (forget) {
    downloads.delete(id);
    return;
  }

  entry.status = 'deleted';
  entry.file = null;
  entry.cover = null;
}

// Retire une piste de la playlist en gardant le morceau courant sous les
// yeux du lecteur, et libère sa copie locale.
function removePlaylistIndex(index) {
  if (index < 0 || index >= state.playlist.length) return null;

  const [removed] = state.playlist.splice(index, 1);
  if (removed && removed.source === 'soulseek') discardDownload(removed.id, true);

  if (index < state.currentTrackIndex) state.currentTrackIndex -= 1;
  if (state.currentTrackIndex >= state.playlist.length) {
    state.currentTrackIndex = Math.max(0, state.playlist.length - 1);
  }

  return removed;
}

// Téléchargement échoué : la piste est injouable, elle n'a rien à faire dans
// la playlist. On la retire et on rend son crédit à l'invité.
// L'erreur brute vise l'organisateur (et peut contenir le lien slsk://,
// qui révèle le pseudo d'un pair) : l'invité reçoit une raison courte.
function guestFailureReason(message) {
  const text = String(message || '');
  if (/aucun fichier audio/i.test(text)) return 'fichier reçu inutilisable';
  if (/timed?\s?out|ETIMEDOUT|killed/i.test(text)) return 'la source ne répond plus';
  if (/refused|ECONNREFUSED|could not connect|not configured|login/i.test(text)) {
    return 'source momentanément indisponible';
  }
  return 'téléchargement impossible';
}

function handleFailedDownload(track, reason) {
  // Plusieurs invités peuvent avoir demandé le même morceau : ils partagent
  // le téléchargement, ils partagent donc l'échec. Une piste déjà jouée (ou
  // en cours de lecture) a eu son tour : on n'y touche pas.
  const doomed = state.playlist.filter(entry =>
    entry.source === 'soulseek' && entry.id === track.id && !entry.played);

  for (const entry of doomed) {
    const index = state.playlist.indexOf(entry);
    if (index === -1) continue;   // retirée entre-temps par l'admin

    removePlaylistIndex(index);

    const user = refundUserCredit(entry,
      `« ${entry.title} » n'a pas pu être téléchargée (${guestFailureReason(reason)}). `
      + 'Elle a été retirée de la playlist et votre crédit vous a été rendu.');

    console.log(`Playlist : "${entry.title}" retirée (téléchargement échoué)`
      + (user ? ` — crédit rendu à ${user.name}` : ''));
  }
}

function discardPlayedTrack(track) {
  if (!track || track.source !== 'soulseek') return;
  if (!CONFIG.soulseek.deleteAfterPlay) return;

  // Le meme morceau peut figurer deux fois dans la playlist (deux invites
  // l'ont demande) : supprimer le fichier de celui qui vient de finir
  // couperait la lecture de celui qui commence, puisqu'ils le partagent.
  const current = state.playlist[state.currentTrackIndex];
  if (current && current.source === 'soulseek' && current.id === track.id) return;

  discardDownload(track.id);
}

// Repart d'un dossier propre : les restes d'une exécution précédente
// n'ont aucune raison de survivre.
function resetDownloadDir() {
  try {
    fs.rmSync(SOULSEEK_DIR, { recursive: true, force: true });
    fs.mkdirSync(SOULSEEK_DIR, { recursive: true });
  } catch (error) {
    console.error('Soulseek : impossible de préparer le dossier de téléchargement —', error.message);
  }
}

// Vue publique d'une piste : ni chemin local, ni lien slsk:// (il révèle
// le pseudo d'un pair), mais l'état du téléchargement pour le lecteur.
// includeLyrics : les paroles ne sont envoyées que pour le morceau en cours.
// La playlist est interrogée toutes les 2 s par trois pages ; transporter le
// texte de chaque titre à chaque fois serait du gâchis.
function publicTrack(track, includeLyrics) {
  const view = Object.assign({}, track);
  delete view.slskLink;
  delete view.localFile;

  if (!includeLyrics) {
    delete view.lyrics;
    delete view.plainLyrics;
  }

  if (track.source === 'soulseek') {
    const entry = downloads.get(track.id);
    view.downloadStatus = entry ? entry.status : 'absent';
    view.downloadError = entry ? entry.error : null;
  }
  return view;
}

// ============= PAROLES (LRCLIB) =============
// LRCLIB indexe par artiste + titre + durée. Les titres venant de Soulseek
// sortent de noms de fichiers : bruités, souvent suffixés. On nettoie, puis
// on tente plusieurs requêtes de la plus précise à la plus large.

const LRCLIB_BASE = process.env.LRCLIB_BASE || 'https://lrclib.net/api';
const LYRICS_HEADERS = {
  // LRCLIB demande de s'identifier
  'User-Agent': 'Jukebox (https://github.com/fiso64/sockseek jukebox local)'
};

// Retire ce qui empêche la correspondance : mentions de qualité, éditions,
// balises de release, extensions résiduelles.
function cleanForLyrics(text) {
  return String(text || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:official|lyric|audio|video|hd|hq|remaster[^)]*|explicit|clean)[^)]*\)/gi, ' ')
    .replace(/\b(official\s+(music\s+)?video|lyrics?\s+video|audio\s+officiel)\b/gi, ' ')
    .replace(/\b(320\s*kbps|flac|mp3|wav|24bit|16bit|44\.1|48khz)\b/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Calvin Harris & Dua Lipa" -> ["Calvin Harris & Dua Lipa", "Calvin Harris"]
// "Artiste feat. X"          -> ["Artiste feat. X", "Artiste"]
function artistVariants(artist) {
  const base = cleanForLyrics(artist);
  if (!base) return [];

  const variants = [base];
  const first = base
    .split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|&|,|x)\s+/i)[0]
    .trim();

  if (first && first.toLowerCase() !== base.toLowerCase()) variants.push(first);
  return variants;
}

// "One Kiss (Radio Edit)" -> ["One Kiss (Radio Edit)", "One Kiss"]
function titleVariants(title) {
  const base = cleanForLyrics(title);
  if (!base) return [];

  const variants = [base];
  const stripped = base.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, '').trim();
  if (stripped && stripped.toLowerCase() !== base.toLowerCase()) variants.push(stripped);
  return variants;
}

async function lrclibRequest(endpoint, params) {
  const response = await axios.get(`${LRCLIB_BASE}/${endpoint}`, {
    params,
    headers: LYRICS_HEADERS,
    timeout: 8000,
    validateStatus: status => status === 200 || status === 404
  });
  return response.status === 200 ? response.data : null;
}

// Parmi plusieurs candidats, garder le plus plausible : paroles synchronisées
// d'abord, puis la durée la plus proche de celle du morceau joué.
function bestLyricsMatch(candidates, duration) {
  const usable = (candidates || []).filter(c => c && (c.syncedLyrics || c.plainLyrics || c.instrumental));
  if (!usable.length) return null;

  return usable.sort((a, b) => {
    const synced = (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0);
    if (synced !== 0) return synced;

    if (duration > 0) {
      const da = Math.abs((a.duration || 0) - duration);
      const db = Math.abs((b.duration || 0) - duration);
      if (da !== db) return da - db;
    }
    return 0;
  })[0];
}

async function getLyrics(title, artist, duration) {
  const titles = titleVariants(title);
  const artists = artistVariants(artist);

  if (!titles.length) return null;

  try {
    // 1. Correspondance exacte, la plus fiable quand la durée est connue
    if (duration > 0 && artists.length) {
      for (const t of titles) {
        for (const a of artists) {
          const exact = await lrclibRequest('get', {
            track_name: t, artist_name: a, duration: Math.round(duration)
          });
          if (exact) {
            const match = bestLyricsMatch([exact], duration);
            if (match) return formatLyrics(match, title, artist);
          }
        }
      }
    }

    // 2. Recherche par champs
    for (const t of titles) {
      for (const a of (artists.length ? artists : [undefined])) {
        const params = a ? { track_name: t, artist_name: a } : { track_name: t };
        const match = bestLyricsMatch(await lrclibRequest('search', params), duration);
        if (match) return formatLyrics(match, title, artist);
      }
    }

    // 3. Recherche libre, dernier recours
    const query = cleanForLyrics(`${artists[0] || ''} ${titles[0]}`).trim();
    if (query) {
      const match = bestLyricsMatch(await lrclibRequest('search', { q: query }), duration);
      if (match) return formatLyrics(match, title, artist);
    }
  } catch (error) {
    console.error('Lyrics fetch error:', error.message);
  }

  return null;
}

// On ne fabrique plus d'horodatage pour des paroles non synchronisées :
// inventer un défilement faux est pire que pas de défilement du tout.
function formatLyrics(match, title, artist) {
  if (match.instrumental) {
    console.log(`Paroles : "${title}" est marqué instrumental sur LRCLIB`);
    return { synced: null, plain: null, instrumental: true, source: lyricsCredit(match) };
  }

  if (match.syncedLyrics) {
    console.log(`Paroles : "${title}" — synchronisées (${lyricsCredit(match)})`);
    return { synced: match.syncedLyrics, plain: match.plainLyrics || null, instrumental: false, source: lyricsCredit(match) };
  }

  console.log(`Paroles : "${title}" — non synchronisées (${lyricsCredit(match)})`);
  return { synced: null, plain: match.plainLyrics, instrumental: false, source: lyricsCredit(match) };
}

// Renseigne les paroles d'une entrée de playlist sans bloquer l'appelant
async function fetchLyricsFor(entry) {
  try {
    const lyrics = await getLyrics(entry.title, entry.artist, entry.duration);

    if (!lyrics) {
      entry.lyricsState = 'none';
      console.log(`Paroles : rien trouvé pour "${entry.artist} — ${entry.title}"`);
      return;
    }

    entry.lyrics = lyrics.synced;
    entry.plainLyrics = lyrics.plain;
    entry.lyricsSource = lyrics.source;
    entry.lyricsState = lyrics.instrumental ? 'instrumental'
      : (lyrics.synced ? 'synced' : 'plain');
  } catch (error) {
    entry.lyricsState = 'none';
    console.error('Paroles : erreur —', error.message);
  }
}

function lyricsCredit(match) {
  return [match.artistName, match.trackName].filter(Boolean).join(' — ') || 'LRCLIB';
}

// ============= API PUBLIQUE =============

// Admin auth (doit rester avant le middleware requireAdmin)
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === CONFIG.adminPassword) {
    const token = crypto.randomBytes(32).toString('hex');
    state.adminTokens.add(token);
    res.json({
      success: true,
      token,
      sessionId: state.sessionId
    });
  } else {
    res.status(401).json({ success: false, error: 'Mot de passe incorrect' });
  }
});

// Toutes les autres routes admin sont protégées
app.use('/api/admin', requireAdmin);

// Get config
// ---- Adresse à afficher aux invités ----
// Derrière un proxy ou un nom de domaine, PUBLIC_URL a le dernier mot.
// Sinon on prend l'adresse du serveur sur le réseau local : c'est elle que
// les téléphones doivent viser, pas « localhost ».
function lanAddress() {
  const prive = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ? 1 : 0;
  const candidats = [];

  for (const liste of Object.values(os.networkInterfaces())) {
    for (const net of liste || []) {
      const ipv4 = net.family === 'IPv4' || net.family === 4;
      if (ipv4 && !net.internal) candidats.push(net.address);
    }
  }

  candidats.sort((a, b) => prive(b) - prive(a));
  return candidats[0] || 'localhost';
}

// L'adresse à donner aux invités est, en priorité, celle par laquelle le
// navigateur a lui-même joint le jukebox : nom de machine, domaine derrière
// un proxy, port particulier — tout est déjà dans la requête.
function guestUrl(req) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/+$/, '') + '/guest';
  }

  const brut = req && (req.headers['x-forwarded-host'] || req.headers.host) || '';
  const hote = String(brut).split(',')[0].trim();
  const nom = hote.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');

  const valide = /^[A-Za-z0-9.\-:\[\]]+$/.test(hote);
  const local = !nom || nom === 'localhost' || nom === '127.0.0.1' || nom === '::1';

  if (valide && !local) {
    const transmis = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocole = transmis || (req.secure ? 'https' : 'http');
    return `${protocole}://${hote}/guest`;
  }

  // Page ouverte en « localhost » sur la machine du lecteur : un téléphone
  // n'irait nulle part. On retombe sur l'adresse du réseau local.
  return `http://${lanAddress()}:${process.env.PORT || 3000}/guest`;
}

// Budget maximal d'une recherche, communique au client pour la barre de
// progression. Quand Soulseek est disponible, il est TOUJOURS interroge en
// dernier recours si Navidrome ne trouve rien : le budget annonce est alors
// exactement le delai de recherche Soulseek configure (CONFIG.soulseek.
// searchTimeMs, reglable depuis le panneau admin), sans rien ajouter pour
// Navidrome — ce dernier repond en pratique en une fraction de seconde, deja
// largement couverte par la marge du delai Soulseek. La marge de securite
// interne du processus (SOULSEEK_PROCESS_OVERHEAD_MS) ne rallonge jamais la
// barre de progression, cf. commentaire sur runSockseek.
// Si Soulseek n'est pas disponible, on retombe sur un budget fixe de 10 s
// pour la seule recherche Navidrome.
function searchMaxDurationMs() {
  if (soulseekAvailable()) return CONFIG.soulseek.searchTimeMs;
  return 10000;
}

app.get('/api/config', (req, res) => {
  res.json({
    maxSongsPerUser: CONFIG.maxSongsPerUser,
    cooldownMinutes: CONFIG.cooldownMinutes,
    quotaWindowMinutes: CONFIG.quotaWindowMinutes,
    searchMaxMs: searchMaxDurationMs(),
    fadeSeconds: CONFIG.fadeSeconds,
    guestUrl: guestUrl(req),
    sources: {
      navidrome: CONFIG.navidrome.enabled,
      soulseek: soulseekAvailable()
    }
  });
});

// QR code de la page invité, affiché sur l'écran de lecture.
// Genere a la volee, sans dependance ni acces internet.
app.get('/api/qr', (req, res) => {
  try {
    const taille = Math.min(600, Math.max(120, parseInt(req.query.size, 10) || 320));
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'no-store');   // l'adresse du serveur peut changer
    res.send(qrSvg(guestUrl(req), taille));
  } catch (error) {
    console.error('QR code : génération impossible —', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Connexion d'un utilisateur listé (par nom)
// L'invité se connecte avec son seul code : pas de nom à saisir.
app.post('/api/guest/login', (req, res) => {
  const user = findUserByPassword(req.body && req.body.password);
  if (!user) {
    return res.status(403).json({ error: "Code inconnu — demandez le vôtre à l'organisateur" });
  }
  res.json({
    userId: user.id,
    name: user.name,
    canAdd: canUserAddSong(user),
    addedSongs: user.addedSongs.length,
    maxSongs: CONFIG.maxSongsPerUser,
    cooldownMinutes: CONFIG.cooldownMinutes,
    quotaWindowMinutes: CONFIG.quotaWindowMinutes,
    notices: activeNotices(user)
  });
});

// Infos d'un utilisateur
app.get('/api/guest/info/:userId', (req, res) => {
  const user = findUserById(req.params.userId);
  if (!user) {
    return res.status(403).json({ error: 'Utilisateur non autorisé' });
  }

  res.json({
    userId: user.id,
    name: user.name,
    canAdd: canUserAddSong(user),
    addedSongs: user.addedSongs.length,
    maxSongs: CONFIG.maxSongsPerUser,
    cooldownMinutes: CONFIG.cooldownMinutes,
    quotaWindowMinutes: CONFIG.quotaWindowMinutes,
    notices: activeNotices(user)
  });
});

// ---- Recherche et ajout : logique commune aux invités et à l'admin ----

// La bibliothèque locale d'abord, Soulseek en secours quand elle ne donne rien.
async function runSearch(query, signal) {
  let results = await searchNavidrome(query);
  let searchedSoulseek = false;

  if (results.length === 0 && soulseekAvailable()) {
    searchedSoulseek = true;
    results = await searchSoulseek(query, signal);
  }

  return { results, searchedSoulseek };
}

// Vue client d'un résultat. Le lien slsk:// reste côté serveur : il révèle le
// pseudo d'un pair. inPlaylist grisè le bouton « Ajouter » plutôt que de
// laisser cliquer pour un refus.
function searchResultView(track) {
  const vue = publicTrack(track, false);
  const doublon = findPlaylistDuplicate(track);
  if (doublon) {
    vue.inPlaylist = true;
    vue.alreadyPlayed = Boolean(doublon.played);
  }
  return vue;
}

// Ajoute réellement le morceau à la file. `user` vaut null pour l'admin, qui
// n'est soumis à aucun quota. L'erreur levée porte son propre statut HTTP.
function addToPlaylist(song, user) {
  const playlistEntry = {
    ...song,
    lyrics: null,           // renseigné en arrière-plan, voir plus bas
    lyricsState: 'pending',
    addedBy: user ? user.name : 'Admin',
    addedById: user ? user.id : null,
    addedAt: Date.now(),
    played: false
  };

  // Le client n'envoie qu'une vue publique : on récupère le lien slsk://
  // depuis les résultats de recherche gardés côté serveur.
  if (song.source === 'soulseek') {
    const known = soulseekResults.get(song.id);
    if (!known) {
      const expire = new Error('Résultat Soulseek expiré, relancez la recherche');
      expire.status = 400;
      throw expire;
    }
    playlistEntry.slskLink = known.slskLink;
    playlistEntry.username = known.username;
  }

  state.playlist.push(playlistEntry);

  // Les paroles ne doivent pas retarder la réponse : LRCLIB peut enchaîner
  // plusieurs requêtes, on le fait en arrière-plan.
  fetchLyricsFor(playlistEntry);

  // Téléchargement anticipé : le morceau doit être prêt à son tour
  if (playlistEntry.source === 'soulseek') queueDownload(playlistEntry);

  return playlistEntry;
}

// Search songs (réservé aux utilisateurs listés)
app.get('/api/search', async (req, res) => {
  const { q, userId } = req.query;

  // Le client peut relancer ou annuler : on coupe alors sockseek au lieu de
  // laisser tourner une recherche dont plus personne n'attend le resultat.
  const abort = new AbortController();
  let finished = false;
  req.on('close', () => {
    if (!finished) abort.abort();
  });

  const user = findUserById(userId);
  if (!user) {
    return res.status(403).json({ error: 'Utilisateur non autorisé' });
  }

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query trop court' });
  }

  try {
    const { results, searchedSoulseek } = await runSearch(q, abort.signal);

    if (abort.signal.aborted) return;   // client parti : plus rien a renvoyer

    finished = true;
    res.json({
      results: results.map(searchResultView),
      searchedSoulseek,
      canAdd: canUserAddSong(user),
      userAddedCount: user.addedSongs.length
    });
  } catch (error) {
    if (abort.signal.aborted) return;   // recherche annulee par le client
    finished = true;
    res.status(500).json({ error: error.message });
  }
});

// Add song to playlist (réservé aux utilisateurs listés)
app.post('/api/playlist/add', async (req, res) => {
  const { song, userId } = req.body;

  if (!song) {
    return res.status(400).json({ error: 'Song requis' });
  }

  const user = findUserById(userId);
  if (!user) {
    return res.status(403).json({ error: 'Utilisateur non autorisé' });
  }

  // Doublon : on refuse avant de toucher au quota de l'invité
  const doublon = findPlaylistDuplicate(song);
  if (doublon) {
    const qui = doublon.addedBy ? ` par ${doublon.addedBy}` : '';
    return res.status(409).json({
      duplicate: true,
      error: doublon.played
        ? `« ${doublon.title} » est déjà passée ce soir`
        : `« ${doublon.title} » est déjà dans la playlist, ajoutée${qui}`
    });
  }

  const canAdd = canUserAddSong(user);
  if (!canAdd.allowed) {
    return res.status(429).json({ error: canAdd.reason });
  }

  try {
    addToPlaylist(song, user);

    user.addedSongs.push({ id: song.id, at: Date.now() });
    user.totalAdded = (user.totalAdded || 0) + 1;
    user.lastAddTime = Date.now();

    res.json({
      success: true,
      playlistLength: state.playlist.length,
      yourSongsCount: user.addedSongs.length
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Retrait par l'invite d'une de ses propres chansons : erreur de selection,
// mauvaise version, changement d'avis. Tant qu'elle n'est pas passee, elle ne
// lui coute rien : quota et delai d'ajout lui sont rendus (meme logique qu'un
// telechargement echoue). Il ne peut toucher qu'a ses chansons, et jamais a
// celle qui joue.
app.post('/api/playlist/remove', (req, res) => {
  const { songId, userId } = req.body || {};

  const user = findUserById(userId);
  if (!user) {
    return res.status(403).json({ error: 'Utilisateur non autorisé' });
  }

  const index = state.playlist.findIndex((track, i) =>
    String(track.id) === String(songId)
    && track.addedById === user.id
    && !track.played
    && i !== state.currentTrackIndex);

  if (index === -1) {
    return res.status(404).json({
      error: 'Chanson introuvable : déjà jouée, en cours de lecture ou déjà retirée'
    });
  }

  const removed = removePlaylistIndex(index);
  // Pas de notice : l'invite vient de faire le geste, il n'a pas besoin
  // qu'on le lui raconte.
  refundUserCredit(removed);

  console.log(`Playlist : "${removed.title}" retirée par ${user.name} — crédit rendu`);

  res.json({
    success: true,
    playlistLength: state.playlist.length,
    yourSongsCount: user.addedSongs.length,
    canAdd: canUserAddSong(user)
  });
});

// Get playlist
app.get('/api/playlist', (req, res) => {
  // Le morceau courant a été supprimé et on veut le rejouer : on le récupère.
  // Conditionné à la lecture en cours, sinon la fin de playlist relancerait
  // aussitôt le téléchargement qu'elle vient de supprimer.
  const current = state.playlist[state.currentTrackIndex];
  if (current && current.source === 'soulseek' && state.isPlaying
      && downloadStatus(current.id) === 'deleted') {
    downloads.delete(current.id);
    queueDownload(current);
  }

  res.json({
    playlist: state.playlist.map((track, index) =>
      publicTrack(track, index === state.currentTrackIndex)),
    currentIndex: state.currentTrackIndex,
    isPlaying: state.isPlaying,
    playbackTime: state.playbackTime,
    seekSeq: state.seekSeq,
    fadeSeconds: CONFIG.fadeSeconds
  });
});

// ============= API ADMIN =============

// Lire les réglages globaux
app.get('/api/admin/settings', (req, res) => {
  res.json({
    maxSongsPerUser: CONFIG.maxSongsPerUser,
    cooldownMinutes: CONFIG.cooldownMinutes,
    quotaWindowMinutes: CONFIG.quotaWindowMinutes,
    fadeSeconds: CONFIG.fadeSeconds,
    soulseekSearchSeconds: Math.round(CONFIG.soulseek.searchTimeMs / 1000)
  });
});

// Modifier les réglages globaux (appliqués immédiatement, y compris aux quotas en cours)
app.put('/api/admin/settings', (req, res) => {
  const body = req.body || {};

  if (body.maxSongsPerUser !== undefined) {
    const max = Number(body.maxSongsPerUser);
    if (!Number.isInteger(max) || max < 0 || max > 100) {
      return res.status(400).json({ error: 'Max chansons : nombre entier entre 0 et 100' });
    }
    CONFIG.maxSongsPerUser = max;
  }

  if (body.cooldownMinutes !== undefined) {
    const cd = Number(body.cooldownMinutes);
    if (!Number.isFinite(cd) || cd < 0 || cd > 1440) {
      return res.status(400).json({ error: 'Cooldown : entre 0 et 1440 minutes' });
    }
    CONFIG.cooldownMinutes = Math.round(cd * 100) / 100;
  }

  if (body.quotaWindowMinutes !== undefined) {
    const win = Number(body.quotaWindowMinutes);
    if (!Number.isFinite(win) || win < 0 || win > 10080) {
      return res.status(400).json({ error: 'Fenêtre du quota : entre 0 et 10080 minutes (7 jours)' });
    }
    CONFIG.quotaWindowMinutes = Math.round(win * 100) / 100;
  }

  if (body.fadeSeconds !== undefined) {
    const fade = Number(body.fadeSeconds);
    if (!Number.isFinite(fade) || fade < 0 || fade > 15) {
      return res.status(400).json({ error: 'Fondu : entre 0 et 15 secondes' });
    }
    CONFIG.fadeSeconds = Math.round(fade * 10) / 10;
  }

  if (body.soulseekSearchSeconds !== undefined) {
    const delai = Number(body.soulseekSearchSeconds);
    if (!Number.isFinite(delai) || delai < 5 || delai > 120) {
      return res.status(400).json({ error: 'Délai de recherche Soulseek : entre 5 et 120 secondes' });
    }
    CONFIG.soulseek.searchTimeMs = Math.round(delai) * 1000;
  }

  console.log(`⚙ Réglages mis à jour : max=${CONFIG.maxSongsPerUser}, cooldown=${CONFIG.cooldownMinutes}min,`
    + ` fenêtre=${CONFIG.quotaWindowMinutes}min, fondu=${CONFIG.fadeSeconds}s,`
    + ` recherche Soulseek=${CONFIG.soulseek.searchTimeMs / 1000}s`);

  res.json({
    success: true,
    maxSongsPerUser: CONFIG.maxSongsPerUser,
    cooldownMinutes: CONFIG.cooldownMinutes,
    quotaWindowMinutes: CONFIG.quotaWindowMinutes,
    fadeSeconds: CONFIG.fadeSeconds,
    soulseekSearchSeconds: Math.round(CONFIG.soulseek.searchTimeMs / 1000)
  });
});

// Liste complète des utilisateurs
app.get('/api/admin/users', (req, res) => {
  const users = Array.from(state.users.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(adminUserView);
  res.json({ users, maxSongs: CONFIG.maxSongsPerUser, cooldownMinutes: CONFIG.cooldownMinutes });
});

// Ajouter un utilisateur
app.post('/api/admin/users', (req, res) => {
  const { name, password } = req.body || {};
  const result = createUser(name, password);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, user: adminUserView(result.user) });
});

// Renommer un utilisateur
app.put('/api/admin/users/:id', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const clean = normalizeName(req.body && req.body.name);
  if (!clean) return res.status(400).json({ error: 'Nom vide' });
  if (clean.length > 40) return res.status(400).json({ error: 'Nom trop long (40 caractères max)' });

  const existing = findUserByName(clean);
  if (existing && existing.id !== user.id) {
    return res.status(400).json({ error: 'Ce nom existe déjà' });
  }

  user.name = clean;
  res.json({ success: true, user: adminUserView(user) });
});

// Supprimer un utilisateur (révoque immédiatement son accès)
app.delete('/api/admin/users/:id', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  state.users.delete(user.id);
  res.json({ success: true });
});

// Réinitialiser le quota d'un utilisateur
// Nouveau code d'accès : celui choisi par l'organisateur, ou un code tiré au sort
app.post('/api/admin/users/:id/password', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const code = prepareUserPassword(req.body && req.body.password, user);
  if (code.error) return res.status(400).json({ error: code.error });

  user.password = code.password;
  console.log(`🔑 Nouveau code pour ${user.name}`);
  res.json({ success: true, user: adminUserView(user) });
});

app.post('/api/admin/users/:id/reset', (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  user.addedSongs = [];
  user.totalAdded = 0;
  user.lastAddTime = 0;
  res.json({ success: true, user: adminUserView(user) });
});

// Applique une commande de lecture. Utilisee par l'admin (qui pilote) et par
// l'ecran de lecture (qui signale seulement la fin d'une piste).
function applyPlaybackAction(action, trackIndex, time) {
  const previousIndex = state.currentTrackIndex;
  const previousTrack = state.playlist[previousIndex];

  switch (action) {
    case 'play':
      state.isPlaying = true;
      break;
    case 'pause':
      state.isPlaying = false;
      break;
    case 'seek':
      state.playbackTime = time;
      state.seekSeq += 1;   // signale a l'ecran de lecture qu'il doit se caler
      break;
    case 'next':
      if (state.currentTrackIndex >= state.playlist.length - 1) {
        // Dernier morceau terminé : on arrête et on libère sa copie locale
        state.isPlaying = false;
        state.playbackTime = 0;
        if (previousTrack) {
          previousTrack.played = true;
          discardPlayedTrack(previousTrack);
        }
        break;
      }
      state.currentTrackIndex += 1;
      state.playbackTime = 0;
      state.isPlaying = true;
      if (state.playlist[state.currentTrackIndex]) {
        state.playlist[state.currentTrackIndex].played = true;
      }
      break;
    case 'prev':
      state.currentTrackIndex = Math.max(state.currentTrackIndex - 1, 0);
      state.playbackTime = 0;
      state.isPlaying = true;
      break;
    case 'goto':
      state.currentTrackIndex = trackIndex;
      state.playbackTime = 0;
      state.isPlaying = true;
      if (state.playlist[state.currentTrackIndex]) {
        state.playlist[state.currentTrackIndex].played = true;
      }
      break;
  }

  // On quitte un morceau Soulseek : sa copie locale n'a plus de raison d'être
  if (state.currentTrackIndex !== previousIndex) {
    discardPlayedTrack(previousTrack);

    // Le morceau suivant doit être prêt : on relance son téléchargement
    // s'il avait été supprimé lors d'un passage précédent.
    const upcoming = state.playlist[state.currentTrackIndex];
    if (upcoming && upcoming.source === 'soulseek' && downloadStatus(upcoming.id) === 'deleted') {
      downloads.delete(upcoming.id);
      queueDownload(upcoming);
    }

    state.trackStartedAt = Date.now();
  }

  return {
    isPlaying: state.isPlaying,
    currentIndex: state.currentTrackIndex,
    playbackTime: state.playbackTime,
    seekSeq: state.seekSeq
  };
}

// Commandes de lecture : reservees a l'admin
app.post('/api/admin/playback', (req, res) => {
  const { action, trackIndex, time } = req.body;
  res.json({ success: true, state: applyPlaybackAction(action, trackIndex, time) });
});

// L'ecran de lecture ne commande rien : il rend compte. Fin de morceau,
// echec de lecture et position courante, pour la piste qu'il joue vraiment.
app.post('/api/player/event', (req, res) => {
  const { type, index, time } = req.body || {};

  // Un evenement qui ne concerne pas la piste en cours est perime
  if (typeof index !== 'number' || index !== state.currentTrackIndex) {
    return res.json({ ignored: true, currentIndex: state.currentTrackIndex });
  }

  if (type === 'position') {
    if (typeof time === 'number' && time >= 0) state.playbackTime = time;
    return res.json({ success: true });
  }

  if (type === 'ended' || type === 'failed') {
    // Garde-fou : personne ne fait defiler la playlist en enchainant les
    // requetes, un morceau doit avoir eu au moins quelques secondes.
    if (state.trackStartedAt && Date.now() - state.trackStartedAt < 3000) {
      return res.json({ ignored: true, currentIndex: state.currentTrackIndex });
    }

    console.log(`Lecture : ${type === 'ended' ? 'fin' : 'échec'} de « `
      + `${(state.playlist[index] || {}).title || '?'} » → piste suivante`);
    return res.json({ success: true, state: applyPlaybackAction('next') });
  }

  res.status(400).json({ error: 'Évènement inconnu' });
});

// Recherche (admin) : mêmes sources que côté invité, sans code ni quota
app.get('/api/admin/search', async (req, res) => {
  const { q } = req.query;

  // Le client peut relancer ou annuler : on coupe alors sockseek au lieu de
  // laisser tourner une recherche dont plus personne n'attend le resultat.
  const abort = new AbortController();
  let finished = false;
  req.on('close', () => {
    if (!finished) abort.abort();
  });

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query trop court' });
  }

  try {
    const { results, searchedSoulseek } = await runSearch(q, abort.signal);

    if (abort.signal.aborted) return;   // client parti : plus rien a renvoyer

    finished = true;
    res.json({
      results: results.map(searchResultView),
      searchedSoulseek
    });
  } catch (error) {
    if (abort.signal.aborted) return;   // recherche annulee par le client
    finished = true;
    res.status(500).json({ error: error.message });
  }
});

// Ajout à la playlist (admin) : autant de chansons que voulu, aucun quota,
// aucun délai d'attente. Le doublon reste refusé — deux entrées partageraient
// le même téléchargement, que la suppression de l'une effacerait sous l'autre.
app.post('/api/admin/playlist/add', (req, res) => {
  const song = req.body && req.body.song;

  if (!song) {
    return res.status(400).json({ error: 'Song requis' });
  }

  const doublon = findPlaylistDuplicate(song);
  if (doublon) {
    const qui = doublon.addedBy ? ` par ${doublon.addedBy}` : '';
    return res.status(409).json({
      duplicate: true,
      error: doublon.played
        ? `« ${doublon.title} » est déjà passée ce soir`
        : `« ${doublon.title} » est déjà dans la playlist, ajoutée${qui}`
    });
  }

  try {
    const entry = addToPlaylist(song, null);
    res.json({
      success: true,
      playlistLength: state.playlist.length,
      title: entry.title
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Déplacer une piste dans la file (admin)
app.post('/api/admin/playlist/move', (req, res) => {
  const from = parseInt(req.body && req.body.from, 10);
  let to = parseInt(req.body && req.body.to, 10);

  if (!Number.isInteger(from) || from < 0 || from >= state.playlist.length) {
    return res.status(400).json({ error: 'Position de départ invalide' });
  }
  if (!Number.isInteger(to)) {
    return res.status(400).json({ error: 'Position d\'arrivée invalide' });
  }

  to = Math.max(0, Math.min(to, state.playlist.length - 1));
  if (from === to) {
    return res.json({ success: true, currentIndex: state.currentTrackIndex });
  }

  const [moved] = state.playlist.splice(from, 1);
  state.playlist.splice(to, 0, moved);

  // Le morceau en cours doit rester le morceau en cours, où qu'il atterrisse
  const current = state.currentTrackIndex;
  if (from === current) {
    state.currentTrackIndex = to;
  } else if (from < current && to >= current) {
    state.currentTrackIndex = current - 1;
  } else if (from > current && to <= current) {
    state.currentTrackIndex = current + 1;
  }

  res.json({ success: true, currentIndex: state.currentTrackIndex });
});

// Remove song from playlist (admin)
// Une chanson retiree avant d'avoir ete jouee n'a rien coute a la soiree :
// l'invite qui l'avait ajoutee recupere sa place dans le quota et son delai
// d'ajout. Une chanson deja passee (ou en cours) a eu son tour, elle reste
// comptee.
app.delete('/api/admin/playlist/:index', (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < state.playlist.length) {
    const enLecture = index === state.currentTrackIndex;
    const removed = removePlaylistIndex(index);

    if (removed && removed.addedById && !removed.played && !enLecture) {
      const user = refundUserCredit(removed,
        `« ${removed.title} » a été retirée de la playlist par l'organisateur. `
        + 'Votre crédit vous a été rendu, vous pouvez ajouter une autre chanson.');
      if (user) {
        console.log(`Playlist : "${removed.title}" retirée par l'organisateur`
          + ` — crédit rendu à ${user.name}`);
      }
    }

    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Song not found' });
  }
});

// Clear playlist (admin) - conserve la liste des utilisateurs, remet les quotas à zéro
app.post('/api/admin/playlist/clear', (req, res) => {
  for (const track of state.playlist) {
    if (track.source === 'soulseek') discardDownload(track.id, true);
  }
  state.playlist = [];
  state.currentTrackIndex = 0;
  state.isPlaying = false;
  state.playbackTime = 0;
  for (const user of state.users.values()) {
    user.addedSongs = [];
    user.totalAdded = 0;
    user.lastAddTime = 0;
  }
  res.json({ success: true });
});

// ============= STREAMING =============
app.get('/api/stream/:source/:id', async (req, res) => {
  const { source, id } = req.params;

  try {
    if (source === 'navidrome') {
      const song = state.playlist.find(s => s.source === 'navidrome' && s.id === id);
      if (!song) return res.status(404).json({ error: 'Piste introuvable' });

      // Le lecteur demande une plage d'octets (recherche dans le morceau,
      // reprise après une coupure) : on la relaie telle quelle.
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;

      const proxyRes = await axios.get(song.streamUrl, {
        responseType: 'stream',
        headers,
        // Surtout pas de timeout ici : le navigateur cesse de lire dès que son
        // tampon est plein, parfois plusieurs minutes. Un timeout de socket
        // coupait alors le flux en plein morceau, et la lecture s'arrêtait
        // brutalement au milieu de la chanson.
        timeout: 0,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400
      });

      res.status(proxyRes.status);
      for (const name of ['content-type', 'content-length', 'content-range',
                          'accept-ranges', 'etag', 'last-modified']) {
        const value = proxyRes.headers[name];
        if (value !== undefined) res.set(name, value);
      }
      if (proxyRes.headers['accept-ranges'] === undefined) res.set('Accept-Ranges', 'bytes');

      const upstream = proxyRes.data;

      // Onglet fermé ou changement de piste : on libère la connexion Navidrome
      res.on('close', () => upstream.destroy());

      upstream.on('error', error => {
        console.error('Navidrome : flux interrompu —', error.message);
        if (!res.headersSent) res.status(502).json({ error: 'Flux interrompu' });
        else res.destroy();
      });

      return upstream.pipe(res);
    }

    if (source === 'soulseek') {
      const entry = downloads.get(id);

      if (!entry) {
        return res.status(404).json({ error: 'Piste inconnue', status: 'absent' });
      }

      // Morceau rejoué après suppression : on le récupère à nouveau
      if (entry.status === 'deleted') {
        const track = state.playlist.find(t => t.source === 'soulseek' && t.id === id);
        if (track) {
          downloads.delete(id);
          queueDownload(track);
          return res.status(425).json({ error: 'Nouveau téléchargement', status: 'pending' });
        }
      }

      if (entry.status === 'pending' || entry.status === 'downloading') {
        // 425 Too Early : le lecteur réessaiera quand le fichier sera là
        return res.status(425).json({
          error: 'Téléchargement en cours',
          status: entry.status
        });
      }

      if (entry.status !== 'ready' || !entry.file) {
        return res.status(404).json({
          error: entry.error || 'Fichier indisponible',
          status: entry.status
        });
      }

      // sendFile gère l'en-tête Range : la barre de progression reste utilisable
      return res.sendFile(entry.file, error => {
        if (error && !res.headersSent) {
          res.status(404).json({ error: 'Fichier illisible' });
        }
      });
    }

    res.status(400).json({ error: 'Source inconnue' });
  } catch (error) {
    console.error('Stream error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// Pochette extraite d'un fichier Soulseek
app.get('/api/cover/soulseek/:id', (req, res) => {
  const entry = downloads.get(req.params.id);

  if (!entry || !entry.cover) {
    return res.status(404).json({ error: 'Pas de pochette' });
  }

  res.sendFile(entry.cover, error => {
    if (error && !res.headersSent) res.status(404).end();
  });
});

// Serve static files
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/guest', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'guest.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ============= START SERVER =============
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🎵 Jukebox server running on port ${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
  console.log(`Guest: http://localhost:${PORT}/guest`);
  // Le QR reprend l'adresse par laquelle l'écran de lecture est ouvert ;
  // celle-ci ne sert que si cet écran est ouvert en « localhost ».
  console.log(`Adresse invité sur le réseau local → ${guestUrl()}`);
  console.log(`Player: http://localhost:${PORT}`);
  console.log('\nConfiguration:');
  console.log(`- Max songs per user: ${CONFIG.maxSongsPerUser}`);
  console.log(`- Cooldown: ${CONFIG.cooldownMinutes} minutes`);
  console.log(`- Fenêtre du quota: ${CONFIG.quotaWindowMinutes > 0 ? CONFIG.quotaWindowMinutes + ' minutes (glissant)' : 'désactivée (quota définitif)'}`);
  console.log(`- Fondu entre les chansons: ${CONFIG.fadeSeconds > 0 ? CONFIG.fadeSeconds + ' s' : 'désactivé'}`);
  console.log(`- Navidrome: ${CONFIG.navidrome.enabled}`);

  if (CONFIG.soulseek.enabled) {
    resetDownloadDir();
    CONFIG.soulseek.version = await detectSockseek();

    if (CONFIG.soulseek.version) {
      console.log(`- Soulseek (repli): ${CONFIG.soulseek.version}`);
      console.log(`  Téléchargements: ${SOULSEEK_DIR}`);
      console.log(`  Suppression après lecture: ${CONFIG.soulseek.deleteAfterPlay ? 'oui' : 'non'}`);

      const demon = await startSockseekDaemon();
      const explications = {
        'lancé': `démarré par le jukebox sur ${CONFIG.soulseek.remote}`,
        'déjà lancé': `déjà en écoute sur ${CONFIG.soulseek.remote}`,
        'distant': `sur une autre machine (${CONFIG.soulseek.remote})`,
        'désactivé': `non démarré (SOCKSEEK_AUTOSTART=false) — attendu sur ${CONFIG.soulseek.remote}`,
        'autonome': null,
        'adresse invalide': `SOCKSEEK_REMOTE illisible : ${CONFIG.soulseek.remote}`
      };

      if (!CONFIG.soulseek.remote) {
        console.log('  Mode autonome (plus lent : reconnexion à chaque recherche)');
      } else if (demon && explications[demon]) {
        console.log(`  Démon: ${explications[demon]}`);
      } else {
        console.log(`  ⚠ Démon injoignable sur ${CONFIG.soulseek.remote}.`);
        console.log('  ⚠ Vérifiez les identifiants Soulseek dans ~/.config/sockseek/sockseek.conf.');
        console.log('  ⚠ Les recherches fonctionneront en mode autonome, plus lent.');
      }
    } else {
      console.log('- Soulseek (repli): DÉSACTIVÉ, sockseek introuvable');
      console.log(`  ⚠ Commande testée: ${CONFIG.soulseek.sockseekPath} --version`);
      console.log('  ⚠ Indiquez son chemin via SOCKSEEK_PATH dans le .env.');
      console.log('  ⚠ Sans sockseek, seule la bibliothèque Navidrome est disponible.');
    }
  } else {
    console.log('- Soulseek (repli): désactivé dans .env');
  }

  console.log('- Accès invité: liste d\'utilisateurs gérée depuis /admin');
});

// Ne rien laisser traîner en quittant
function cleanupOnExit() {
  if (CONFIG.soulseek.enabled) {
    console.log('\nNettoyage des téléchargements Soulseek...');
    try { fs.rmSync(SOULSEEK_DIR, { recursive: true, force: true }); } catch (e) { /* rien à faire */ }
  }
  // Le démon lancé par le jukebox s'arrête avec lui ; celui qu'on a trouvé
  // déjà en route ne nous appartient pas, on n'y touche pas.
  stopSockseekDaemon();
  process.exit(0);
}

process.on('SIGINT', cleanupOnExit);
process.on('SIGTERM', cleanupOnExit);
process.on('exit', stopSockseekDaemon);

module.exports = app;
