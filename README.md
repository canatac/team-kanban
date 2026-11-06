# Team Kanban

Gestion de projets collaborative minimaliste : des tableaux Kanban partagés en temps réel, accessibles avec un compte GitHub.

## Fonctionnalités

- Connexion avec votre compte GitHub (OAuth)
- Projets avec invitation de membres par login GitHub
- Tableaux Kanban : colonnes personnalisables, tâches en glisser-déposer
- Assignation de tâches et commentaires
- Synchro en temps réel : chaque modification apparaît immédiatement chez tous les collaborateurs connectés (WebSocket)

## Stack technique

| Couche | Choix |
|---|---|
| Backend | Rust — Axum, SQLx, WebSockets |
| Base de données | PostgreSQL 16 |
| Frontend | TypeScript — React (Vite), Material UI, @dnd-kit |
| Authentification | OAuth GitHub + JWT en cookie HttpOnly |
| Reverse proxy | Caddy (HTTPS automatique via Let's Encrypt) |
| CI/CD | GitHub Actions (tests à chaque push, déploiement auto sur la VM) |

## Architecture

```
Navigateur ──► Caddy (443, TLS, sert le frontend statique)
                ├── /api/*  ──► Backend Rust (Axum) ──► PostgreSQL
                └── /ws     ──► WebSocket (événements temps réel)
```

Chaque mutation (tâche déplacée, commentaire ajouté…) est diffusée à tous les clients abonnés au projet concerné.

## Développement local

Pré-requis : Rust stable, Node 20+, Docker.

```bash
# 1. Base de données (mot de passe de dev)
echo "POSTGRES_PASSWORD=kanban" > .env
docker compose up -d postgres

# 2. Backend (premier terminal)
cd backend
DATABASE_URL=postgres://kanban:kanban@localhost:5432/kanban \
APP_URL=http://localhost:5173 \
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=xxx JWT_SECRET=dev \
cargo run

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev
```

Ouvrez http://localhost:5173. Pour tester la connexion en local, créez une OAuth App GitHub avec le callback `http://localhost:5173/api/auth/github/callback`.

## Mise en production (checklist initiale)

### 1. OAuth GitHub

1. github.com/settings/developers → **New OAuth App**
2. Homepage URL : `https://VOTRE-DOMAINE`
3. Authorization callback URL : `https://VOTRE-DOMAINE/api/auth/github/callback`
4. Conservez le **Client ID** et générez un **Client Secret**.

### 2. VM Scaleway

- Image : **Ubuntu 24.04**, ~2 vCPU / 4 Go (une instance de type DEV1-M suffit)
- DNS : enregistrement **A** `VOTRE-DOMAINE` → IP publique de la VM
- Pare-feu : ports 22, 80 et 443 ouverts

### 3. Amorçage de la VM (une seule fois)

Sur votre machine :

```bash
ssh-keygen -t ed25519 -f ./deploy_key -N "" -C deploy
```

Puis, en root sur la VM :

```bash
curl -fsSL https://raw.githubusercontent.com/canatac/team-kanban/master/deploy/bootstrap.sh -o bootstrap.sh
sudo bash bootstrap.sh "$(cat ./deploy_key.pub)"
```

Le script installe Docker, crée l'utilisateur `deploy` et prépare `/opt/team-kanban`.

### 4. Secrets GitHub

Dépôt → Settings → Secrets and variables → Actions → **New repository secret** :

| Secret | Valeur |
|---|---|
| SSH_HOST | IP publique (ou domaine) de la VM |
| SSH_USER | `deploy` |
| SSH_PRIVATE_KEY | contenu du fichier `./deploy_key` |
| DOMAIN | votre domaine, sans `https://` |
| GITHUB_CLIENT_ID | Client ID de l'OAuth App |
| GITHUB_CLIENT_SECRET | Client Secret de l'OAuth App |
| JWT_SECRET | ex. `openssl rand -hex 32` |
| POSTGRES_PASSWORD | ex. `openssl rand -hex 16` |

### 5. Déployer

Tout push sur `master` déclenche la CI (clippy, tests backend, build frontend) puis le déploiement automatique sur la VM. Le premier build Rust sur la VM prend quelques minutes ; les suivants sont plus rapides (cache Docker).

## Exploitation

- Logs : `cd /opt/team-kanban && docker compose logs -f backend`
- Sauvegarde de la base : `cd /opt/team-kanban && docker compose exec postgres pg_dump -U kanban kanban > backup.sql`
- Redémarrer : `cd /opt/team-kanban && docker compose restart`
- Mettre à jour : pousser sur `master` — c'est tout.

## Limites connues (v1)

- Le glisser-déposer déplace les tâches **entre colonnes** ; le réordonnancement fin au sein d'une colonne n'est pas encore implémenté.
- Écritures concurrentes sur une même tâche : « dernier gagnant », avec resynchronisation immédiate des clients via WebSocket.
