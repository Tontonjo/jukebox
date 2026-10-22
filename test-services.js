#!/usr/bin/env node

/**
 * Test Script - Vérifier la connectivité avec tous les services
 * Utilisation: node test-services.js
 */

require('dotenv').config();
const axios = require('axios');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(type, msg) {
    const prefix = {
        '✓': `${colors.green}✓${colors.reset}`,
        '✗': `${colors.red}✗${colors.reset}`,
        '⚠': `${colors.yellow}⚠${colors.reset}`,
        'ℹ': `${colors.blue}ℹ${colors.reset}`
    };
    console.log(`${prefix[type]} ${msg}`);
}

async function testNavidrome() {
    log('ℹ', '=== Testing Navidrome ===');
    
    if (process.env.NAVIDROME_ENABLED !== 'true') {
        log('⚠', 'Navidrome est désactivé dans .env');
        return;
    }

    try {
        const url = process.env.NAVIDROME_URL;
        const user = process.env.NAVIDROME_USER;
        const pass = process.env.NAVIDROME_PASS;

        if (!url || !user || !pass) {
            log('✗', 'Paramètres Navidrome manquants dans .env');
            log('ℹ', 'NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASS requis');
            return;
        }

        // Calcul du hash
        const crypto = require('crypto');
        const salt = crypto.randomBytes(8).toString('hex');
        const hash = crypto.createHash('md5')
            .update(pass + salt)
            .digest('hex');

        log('ℹ', `Connexion à ${url}...`);

        const response = await axios.get(`${url}/rest/ping`, {
            params: {
                u: user,
                t: hash,
                s: salt,
                v: '1.12.0',
                c: 'jukebox',
                f: 'json'
            },
            timeout: 5000
        });

        if (response.data['subsonic-response']?.status === 'ok') {
            log('✓', 'Connexion Navidrome réussie');
            
            // Tester une recherche
            const searchResponse = await axios.get(`${url}/rest/search3`, {
                params: {
                    u: user,
                    t: hash,
                    s: salt,
                    v: '1.12.0',
                    c: 'jukebox',
                    query: 'test',
                    f: 'json'
                },
                timeout: 5000
            });
            
            log('✓', 'Recherche Navidrome fonctionnelle');
        } else {
            log('✗', 'Réponse invalide de Navidrome');
        }
    } catch (error) {
        log('✗', `Erreur Navidrome: ${error.message}`);
        log('ℹ', 'Vérifier:');
        log('ℹ', '  - NAVIDROME_URL (ex: http://192.168.1.100:4533)');
        log('ℹ', '  - NAVIDROME_USER et NAVIDROME_PASS');
        log('ℹ', '  - Navidrome est en cours d\'exécution');
        log('ℹ', '  - Connectivité réseau');
    }

    console.log('');
}

async function testSoulseek() {
    log('ℹ', '=== Testing Soulseek (sockseek) ===');

    if (process.env.SOULSEEK_ENABLED === 'false') {
        log('⚠', 'Soulseek est désactivé dans .env');
        console.log('');
        return;
    }

    const { execFile } = require('child_process');
    const sockseekPath = process.env.SOCKSEEK_PATH || 'sockseek';
    const remote = process.env.SOCKSEEK_REMOTE !== undefined
        ? process.env.SOCKSEEK_REMOTE.trim()
        : 'http://127.0.0.1:5030';

    const version = await new Promise(resolve => {
        execFile(sockseekPath, ['--version'], { timeout: 15000 },
            (error, stdout) => resolve(error ? null : String(stdout).trim()));
    });

    if (!version) {
        log('✗', `sockseek introuvable (${sockseekPath})`);
        log('ℹ', 'Téléchargez-le : https://github.com/fiso64/sockseek');
        log('ℹ', 'Puis renseignez son chemin dans .env : SOCKSEEK_PATH=...');
        console.log('');
        return;
    }

    log('✓', `sockseek présent (${version})`);
    log('ℹ', remote ? `Démon attendu sur ${remote}` : 'Mode autonome (pas de démon)');

    log('ℹ', 'Recherche de test "daft punk get lucky"...');

    const args = ['daft punk get lucky', '--print', 'json-all'];
    if (remote) args.push('--remote', remote);

    const output = await new Promise(resolve => {
        execFile(sockseekPath, args, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout, stderr) => resolve({ stdout: String(stdout), stderr: String(stderr), error }));
    });

    const text = output.stdout.trim();

    if (text.startsWith('[') || text.startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : (parsed.results || [parsed]);
            log('✓', `Recherche fonctionnelle (${list.length} résultats)`);
            if (list.length) {
                log('ℹ', `Premier résultat : ${JSON.stringify(list[0]).slice(0, 200)}`);
            }
        } catch (e) {
            log('⚠', 'Sortie JSON illisible — envoyez ce qui suit pour ajuster le mapping :');
            console.log(text.slice(0, 500));
        }
    } else {
        log('✗', 'Aucune sortie JSON exploitable');
        if (output.stderr.trim()) log('ℹ', output.stderr.trim().split('\n').pop());
        log('ℹ', remote
            ? 'Le démon tourne-t-il ?  sockseek daemon --server-port 5030'
            : 'Vérifiez username/password dans sockseek.conf');
    }

    console.log('');
}

async function testLRClib() {
    log('ℹ', '=== Testing LRClib (Lyrics) ===');

    try {
        log('ℹ', 'Connexion à LRClib...');

        const response = await axios.get('https://lrclib.net/api/search', {
            params: {
                track_name: 'Imagine',
                artist_name: 'John Lennon'
            },
            timeout: 5000
        });

        if (Array.isArray(response.data) && response.data.length > 0) {
            log('✓', 'LRClib fonctionnel (paroles trouvées)');
        } else {
            log('⚠', 'LRClib ne retourne aucune parole (normal pour certaines chansons)');
        }
    } catch (error) {
        log('✗', `Erreur LRClib: ${error.message}`);
        log('ℹ', 'Service de paroles optionnel');
    }

    console.log('');
}

async function testConfig() {
    log('ℹ', '=== Configuration ===');

    const config = {
        'PORT': process.env.PORT || '3000',
        'NODE_ENV': process.env.NODE_ENV || 'development',
        'ADMIN_PASSWORD': process.env.ADMIN_PASSWORD ? '***' : 'NOT SET',
        'MAX_SONGS_PER_USER': process.env.MAX_SONGS_PER_USER || '3',
        'COOLDOWN_MINUTES': process.env.COOLDOWN_MINUTES || '5',
        'NAVIDROME_ENABLED': process.env.NAVIDROME_ENABLED || 'false',
        'SOULSEEK_ENABLED': process.env.SOULSEEK_ENABLED !== 'false' ? 'true' : 'false',
        'SOCKSEEK_PATH': process.env.SOCKSEEK_PATH || 'sockseek'
    };

    Object.entries(config).forEach(([key, value]) => {
        if (key === 'ADMIN_PASSWORD' && value === 'NOT SET') {
            log('✗', `${key}: ${value}`);
        } else {
            log('ℹ', `${key}: ${value}`);
        }
    });

    if (!process.env.ADMIN_PASSWORD) {
        log('✗', 'ADMIN_PASSWORD non défini - utiliser par défaut "admin123"');
    }

    console.log('');
}

async function testAPI() {
    log('ℹ', '=== API Local ===');

    try {
        log('ℹ', 'Vérification API locale...');

        const response = await axios.get('http://localhost:3000/api/config', {
            timeout: 3000
        });

        log('✓', 'API locale fonctionnelle');
        log('ℹ', `Sources: Navidrome=${response.data.sources.navidrome}, Soulseek=${response.data.sources.soulseek}`);
    } catch (error) {
        log('⚠', 'API locale non accessible (normal si serveur non lancé)');
        log('ℹ', 'Lancez: npm start');
    }

    console.log('');
}

async function main() {
    console.log(`${colors.blue}
╔═══════════════════════════════════════╗
║    🎵 Jukebox - Service Tests        ║
╚═══════════════════════════════════════╝
${colors.reset}`);
    console.log('');

    await testConfig();
    await testNavidrome();
    await testSoulseek();
    await testLRClib();
    await testAPI();

    console.log(`${colors.blue}Tests terminés!${colors.reset}`);
    console.log('');
    console.log('Prochaines étapes:');
    console.log('  1. npm start          # Lancer l\'application');
    console.log('  2. Ouvrir http://localhost:3000');
    console.log('');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
