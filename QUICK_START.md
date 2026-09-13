# 🚀 Jukebox — démarrage rapide

> **Jukebox 1.2.0** · doc rév. 2 — 12 septembre 2026
> Node.js ≥ 18 requis. Vue d'ensemble : [README.md](README.md) · production :
> [DEPLOYMENT.md](DEPLOYMENT.md)

## Les trois écrans

**1. Lecteur — `http://localhost:3000`**

Pochette au centre, paroles synchronisées à gauche, playlist à droite recentrée
sur la piste en cours, QR code pour les invités. **Aucun bouton** : tout se
commande depuis `/admin`. Si le navigateur bloque le son, un voile « Cliquez pour
activer le son » s'affiche — un clic, une seule fois.

> Ouvrez-le par son adresse réseau (`http://192.168.1.50:3000`), pas par
> `localhost` : le QR code reprend l'adresse de la page.

**2. Admin — `/admin`** (mot de passe, `admin123` par défaut)

Ajoutez les invités dans la colonne « Utilisateurs autorisés ». Chacun reçoit un
**code** : saisissez-le ou laissez le champ vide pour un tirage au sort. Il
s'affiche sous le nom et se copie d'un clic. Partagez ensuite le lien invité
(bouton « Copier le lien ») ou laissez scanner le QR code.

**3. Invité — `/guest`** ou QR code

Le code seul identifie la personne — aucun nom à taper. Sans code valide, ni
recherche ni ajout.

## Contrôles admin

| Bouton | Effet |
|--------|-------|
| ▶ / ⏸ | Lecture / pause (affiche l'action à venir) |
| ⏮ ⏭ | Piste précédente / suivante |
| ▶ sur une piste | Lire directement ce morceau |
| ▲ ▼ | Réordonner la file |
| 🗑 | Vider la playlist (remet aussi les quotas à zéro) |
| Quotas | Max chansons, cooldown, fenêtre glissante — appliqués immédiatement |
| Fondu | Durée du fondu en secondes (0 = enchaînement sec) |
| + Ajouter | Nouvel utilisateur (code choisi ou tiré au sort) |
| 🔑 | Nouveau code (l'ancien cesse de fonctionner) |
| ↺ ✎ × | Réinitialiser le quota · renommer · retirer (accès révoqué aussitôt) |

## Côté invité

- Résultats Navidrome ; si la bibliothèque ne contient rien, repli **Soulseek**
  (nécessite [sockseek](https://github.com/fiso64/sockseek) et un compte Soulseek
  configurés dans `sockseek.conf`). Le démon démarre avec `npm start` et s'arrête
  avec lui — `SOCKSEEK_AUTOSTART=false` pour le gérer soi-même.
- Une recherche Soulseek peut durer ~20 s : barre de progression, second clic
  pour annuler. Les fichiers téléchargés sont supprimés dès la fin de lecture.
- **Doublons refusés** : un titre déjà en playlist apparaît grisé
  (« ✓ Déjà dans la liste ») et son ajout ne consomme pas de quota. La
  comparaison ignore casse, accents et parenthèses — « Bohemian Rhapsody
  (Remastered 2011) » = « Bohemian Rhapsody ». Pour rejouer un titre, l'admin le
  retire d'abord.
- **Téléchargement échoué** : la chanson est retirée de la playlist et le crédit
  rendu à l'invité, qui en est prévenu.


## Réglages courants

```env
MAX_SONGS_PER_USER=3     # 1 (strict) à 10 (permissif)
QUOTA_WINDOW_MINUTES=60  # fenêtre glissante ; 60 = "3 chansons/heure", 0 = définitif
COOLDOWN_MINUTES=5       # délai entre ajouts, 0 à 60
SESSION_DURATION=120     # minutes avant réinitialisation de session
```

## Avant la production

1. Changer `ADMIN_PASSWORD` dans `.env`.
2. Utiliser un reverse proxy.
3. Ne créer que les invités nécessaires — la liste est vide au démarrage
   (personne ne peut rien ajouter) et repart de zéro à chaque redémarrage.
4. Activer le rate limiting (section « Rate limiting » de `nginx.conf`).

## Aide rapide

| Problème | Solution |
|----------|----------|
| Port 3000 occupé | `PORT=3001 npm start`, ou `lsof -i :3000` puis tuer le process |
| `Cannot find module` | `rm -rf node_modules package-lock.json && npm install` |
| Navidrome injoignable | Vérifier `NAVIDROME_URL` / identifiants ; `curl "http://navidrome:4533/rest/ping.json?u=admin&p=admin&c=jukebox&v=1.12.0"` ; `netstat -tuln \| grep 4533` |
| Mot de passe admin refusé | `admin123` par défaut, sinon `ADMIN_PASSWORD` dans `.env` |
| Paroles manquantes | LRClib n'a pas tous les titres — normal |
| « Vous n'êtes pas autorisé » | Ajouter la personne dans /admin → Utilisateurs autorisés |
| Liste d'utilisateurs vide après redémarrage | Normal, elle est en mémoire : la recréer |
