# 🔒 Activer un certificat SSL (HTTPS)

> **Version 1.0.0** — dernière mise à jour : 11 septembre 2026
> Scénario couvert : jukebox exposé sur un **nom de domaine public**, derrière
> **Nginx**, avec un certificat gratuit **Let's Encrypt** délivré par **Certbot**.

Compter dix minutes. À la fin, `https://jukebox.mondomaine.fr` répond avec un
cadenas valide, le HTTP redirige vers le HTTPS, et le certificat se renouvelle
tout seul.

## Pourquoi c'est utile ici

Au-delà du chiffrement, plusieurs fonctions du jukebox dépendent d'une origine
sécurisée :

- le bouton **« copier le lien invité »** utilise le presse-papier du
  navigateur, réservé au HTTPS (une méthode de secours existe, moins fiable) ;
- les navigateurs mobiles restreignent la **lecture audio automatique** et
  l'installation en raccourci d'écran d'accueil sur les pages non sécurisées ;
- les invités scannent un **QR code** : un avertissement « site non sécurisé »
  au milieu d'une soirée, personne n'a envie de l'expliquer.

---

## 1. Avant de commencer

Trois conditions, à vérifier dans l'ordre :

**Un nom de domaine qui pointe vers le serveur.** Créez un enregistrement `A`
(et `AAAA` si vous avez de l'IPv6) chez votre registrar :

```
jukebox.mondomaine.fr.   A   203.0.113.42
```

Vérifiez la propagation — la réponse doit être l'IP publique du serveur :

```bash
dig +short jukebox.mondomaine.fr
```

**Les ports 80 et 443 ouverts et joignables depuis Internet.** Let's Encrypt
valide le domaine en appelant le port 80 : il ne peut pas être filtré, même si
vous ne comptez servir qu'en HTTPS.

```bash
sudo ufw allow 'Nginx Full'      # ou: sudo ufw allow 80,443/tcp
sudo ufw status
```

Si le serveur est derrière une box, redirigez aussi 80 et 443 vers lui.

**Nginx installé et déjà en train de servir le jukebox en HTTP.** Testez
`http://jukebox.mondomaine.fr` dans un navigateur avant d'aller plus loin : si
le HTTP ne marche pas, le HTTPS ne marchera pas non plus. La mise en place du
reverse proxy est décrite dans le [README](README.md#2-reverse-proxy-nginx).

> `server_name` dans `/etc/nginx/sites-available/jukebox` doit contenir votre
> vrai domaine, pas `jukebox.example.com` — Certbot lit ce champ pour trouver
> le bloc à modifier.

## 2. Installer Certbot

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

Sur une distribution sans paquet à jour, la méthode snap est celle que
recommande l'éditeur :

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

## 3. Obtenir le certificat

### Méthode A — automatique (recommandée)

Certbot obtient le certificat **et** modifie la configuration Nginx pour vous :

```bash
sudo certbot --nginx -d jukebox.mondomaine.fr
```

Il demande une adresse e-mail (pour les alertes d'expiration), l'acceptation des
conditions, puis propose de rediriger le HTTP vers le HTTPS : **répondez oui**.

C'est terminé. Passez à l'[étape 5](#5-vérifier).

<details>
<summary>Plusieurs domaines ou sous-domaines ?</summary>

```bash
sudo certbot --nginx -d jukebox.mondomaine.fr -d www.jukebox.mondomaine.fr
```
</details>

### Méthode B — manuelle

Utile si vous préférez garder la main sur le fichier Nginx, ou pour partir de la
configuration HTTPS fournie dans ce dépôt.

**1. Obtenir le certificat seul**, sans que Certbot touche à Nginx :

```bash
sudo certbot certonly --nginx -d jukebox.mondomaine.fr
```

Les fichiers atterrissent dans `/etc/letsencrypt/live/jukebox.mondomaine.fr/` :
`fullchain.pem` (le certificat) et `privkey.pem` (la clé privée).

**2. Installer la configuration HTTPS** livrée avec le projet :

```bash
sudo cp nginx.ssl.conf /etc/nginx/sites-available/jukebox
sudo sed -i 's/jukebox\.example\.com/jukebox.mondomaine.fr/g' \
    /etc/nginx/sites-available/jukebox
```

**3. Récupérer les fichiers de réglages TLS de Certbot** (paramètres modernes et
DH group), référencés par la configuration :

```bash
sudo test -f /etc/letsencrypt/options-ssl-nginx.conf || \
  sudo curl -o /etc/letsencrypt/options-ssl-nginx.conf \
    https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf

sudo test -f /etc/letsencrypt/ssl-dhparams.pem || \
  sudo openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
```

**4. Tester et recharger :**

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Adapter le jukebox

Une fois en HTTPS, indiquez au serveur son adresse publique, pour que le QR code
et le lien invité pointent vers `https://` et non vers une IP locale :

```bash
nano .env
```

```env
PUBLIC_URL=https://jukebox.mondomaine.fr
```

Puis redémarrez :

```bash
sudo systemctl restart jukebox      # ou: pm2 restart jukebox
```

La configuration Nginx transmet déjà `X-Forwarded-Proto` et `X-Forwarded-Host` :
sans `PUBLIC_URL`, le serveur devine correctement dans la plupart des cas, mais
autant être explicite.

## 5. Vérifier

```bash
curl -I https://jukebox.mondomaine.fr
# HTTP/2 200

curl -I http://jukebox.mondomaine.fr
# HTTP/1.1 301 Moved Permanently  →  Location: https://...
```

Date d'expiration et domaines couverts :

```bash
sudo certbot certificates
```

Pour un audit complet (note A/A+, chaîne, protocoles), passez le domaine dans
[SSL Labs](https://www.ssllabs.com/ssltest/).

Enfin, ouvrez `/admin` en HTTPS et cliquez sur « copier le lien invité » : le
bouton doit confirmer « ✓ Lien copié ».

## 6. Renouvellement automatique

Les certificats Let's Encrypt durent **90 jours**. Le paquet Certbot installe un
timer systemd qui renouvelle deux fois par jour tout certificat à moins de
30 jours de l'expiration. Rien à faire — juste à vérifier :

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

Le `--dry-run` simule un renouvellement complet : s'il passe, les vrais
renouvellements passeront aussi.

<details>
<summary>Si le timer n'existe pas (installation exotique)</summary>

```bash
sudo crontab -e
```

```cron
0 3 * * * certbot renew --quiet --deploy-hook "systemctl reload nginx"
```
</details>

> **Recharger Nginx après renouvellement** : le paquet Debian/Ubuntu s'en charge
> via `/etc/letsencrypt/renewal-hooks/deploy/`. En cas de doute, déposez-y un
> script `reload-nginx.sh` contenant `#!/bin/sh` puis `systemctl reload nginx`,
> et rendez-le exécutable.

## 7. Durcissement (facultatif)

Une fois le HTTPS stable — **et seulement à ce moment-là** — activez HSTS pour
que les navigateurs refusent de repasser en HTTP. La ligne est déjà présente,
commentée, dans `nginx.ssl.conf` :

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

⚠️ HSTS est mémorisé un an par le navigateur : ne l'activez pas tant que vous
n'êtes pas certain de garder le HTTPS sur ce domaine.

Pensez aussi à restreindre `/admin` — le mot de passe applicatif est la seule
barrière par défaut :

```nginx
location /admin {
    allow 192.168.1.0/24;      # réseau de la maison
    deny all;
    # ... reste de la configuration proxy
}
```

ou, pour une double authentification :

```bash
sudo apt install apache2-utils -y
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

```nginx
location /admin {
    auth_basic "Jukebox Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;
    # ... reste de la configuration proxy
}
```

## 8. Docker Compose

Le `docker-compose.yml` fourni laisse le port 443 et le montage des certificats
en commentaire. Pour du HTTPS conteneurisé, le plus simple est de terminer le
TLS **sur l'hôte** (Nginx + Certbot comme ci-dessus, en proxy vers
`http://localhost:3000`) plutôt que dans le conteneur Nginx : Certbot y a accès
au port 80 et au système de renouvellement sans montage supplémentaire.

Si vous tenez à tout conteneuriser, décommentez dans le service `nginx` :

```yaml
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.ssl.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

et lancez `certbot renew` depuis l'hôte, avec un hook qui fait
`docker compose exec nginx nginx -s reload`.

---

## Dépannage

| Message | Cause probable | Correction |
|---------|----------------|------------|
| `Timeout during connect (likely firewall problem)` | Le port 80 n'est pas joignable depuis Internet | Ouvrir 80/tcp sur le pare-feu **et** la box ; vérifier que rien d'autre n'écoute dessus |
| `DNS problem: NXDOMAIN looking up A for ...` | Le domaine ne résout pas, ou la propagation n'est pas finie | `dig +short le-domaine` ; attendre, puis relancer |
| `unauthorized :: Invalid response from http://.../.well-known/...` | Nginx ne sert pas le domaine sur le port 80, ou une règle intercepte `/.well-known/` | Vérifier `server_name` et tester `http://le-domaine` dans un navigateur |
| `Could not automatically find a matching server block` | `server_name` ne contient pas le domaine passé à `-d` | Corriger `server_name`, `nginx -t`, recharger, relancer Certbot |
| `too many certificates already issued for ...` | Limite Let's Encrypt atteinte (5 par domaine par semaine) | Attendre, et tester avec `--dry-run` ou `--test-cert` d'ici là |
| Cadenas barré, « contenu mixte » | Une ressource est encore appelée en `http://` | Vérifier `PUBLIC_URL` et redémarrer le jukebox |
| 502 Bad Gateway en HTTPS | Nginx répond, pas le serveur Node | `systemctl status jukebox`, `ss -tuln \| grep 3000` |

Journaux utiles :

```bash
sudo tail -50 /var/log/letsencrypt/letsencrypt.log
sudo tail -50 /var/log/nginx/jukebox_error.log
sudo journalctl -u jukebox -n 50
```

## Et sans domaine public ?

Certbot en HTTP-01 exige un domaine joignable depuis Internet. Si le jukebox
reste sur le réseau local, trois options :

- **Challenge DNS-01** — un vrai certificat Let's Encrypt pour un domaine qui
  pointe vers une IP privée, validé par un enregistrement TXT :
  `sudo certbot certonly --manual --preferred-challenges dns -d jukebox.mondomaine.fr`
  (à renouveler à la main, sauf plugin pour votre hébergeur DNS).
- **[mkcert](https://github.com/FiloSottile/mkcert)** — autorité de
  certification locale, à installer sur chaque appareil invité : peu pratique
  pour une soirée.
- **Tunnel** (Cloudflare Tunnel, Tailscale Funnel) — TLS géré par le
  fournisseur, sans ouvrir de port.

---

**Ressources** : [Certbot](https://certbot.eff.org/) ·
[Let's Encrypt](https://letsencrypt.org/docs/) ·
[Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
