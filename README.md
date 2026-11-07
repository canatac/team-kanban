# Team Kanban

Gestion de projets collaborative minimaliste : des tableaux Kanban partagés en temps réel, accessibles avec un compte GitHub.

## Fonctionnalités

- Connexion avec votre compte GitHub (OAuth)
- Projets avec invitation de membres par login GitHub
- Tableaux Kanban : colonnes personnalisables, tâches en glisser-déposer
- Assignation de tâches et commentaires
- Synchro en temps réel : chaque modification apparaît immédiatement chez tous les collaborateurs connectés (WebSocket)
- Projets « socle » : tickets communs déduits par IA de plusieurs projets

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

## Déploiement initial

Premier déploiement de production sur kanban.misfits.ai (2026-11-06).

- Redéploiement initial (correctif secrets SSH) : 2026-11-06.

## Génération de tickets par IA (Mistral)

Bouton **« Générer avec l'IA »** dans la barre d'un tableau :

- Décrivez le projet dans le prompt (objectifs, équipe, contexte…).
- Joignez jusqu'à 5 fichiers (≤ 10 Mo chacun) : images, PDF ou fichiers texte —
  ils sont analysés par le modèle (`mistral-small-latest`).
- L'IA propose des tickets **avec leur fiche Scrum complète** (voir ci-dessous),
  crée d'éventuelles nouvelles colonnes, et répartit les tickets dans les
  colonnes existantes. Tout apparaît en temps réel (WebSocket) pour tous les
  membres connectés.

Requiert le secret `MISTRAL_API_KEY` (console.mistral.ai → API Keys) dans les
secrets du dépôt ; il est transmis au backend via le `.env` de la VM.

### Fiches Scrum et découpage des tickets

Chaque ticket porte une fiche Scrum stricte, pensée pour qu'un développeur ou
un assistant de développement IA ait une vision fine du travail :

- `task_type` : `epic` (grand ensemble à découper), `story` (fonctionnalité
  utilisateur), `task` (tâche technique) ou `bug` ;
- `user_story` : « En tant que <rôle>, je veux <capacité>, afin de <bénéfice> » ;
- `context` : problème et contexte métier ;
- `expected_results` : résultats attendus, observables et mesurables ;
- `acceptance_criteria` : critères d'acceptation vérifiables ;
- `definition_of_done` : Definition of Done ;
- `technical_notes` : pistes d'implémentation, contraintes, hypothèses ;
- `story_points` : estimation en points de la suite de Fibonacci ;
- `priority` : priorité métier 1-10 (1 = la plus haute), fixée par l'IA selon
  le besoin métier défini au départ (valeur, urgence, risque, dépendances).

Dans le détail d'un ticket :

- **« Fiche Scrum (IA) »** génère (ou régénère) la fiche complète du ticket
  à partir de son titre et de sa description — soignez-les pour un meilleur
  résultat. Si l'IA juge le ticket trop large, une bannière propose de le
  découper, avec la raison.
- **« Découper (IA) »** découpe le ticket en 2 à 8 sous-tickets rattachés
  (un epic devient des user stories, sinon des tâches techniques), chacun
  avec sa propre fiche Scrum. Les sous-tickets sont listés dans le ticket
  parent, et le parent est accessible depuis chaque enfant.
- Les cartes du tableau affichent le type, les story points et le nombre de
  sous-tickets.

### Vue Roadmap

Bascule « Kanban / Roadmap » dans la barre d'un tableau :

- Un **swimlane par epic**, trié par priorité métier (`priority`, P1 en premier).
- Dans chaque lane : les **user stories** du epic en cartes (avec points et
  priorité), et **leurs tâches techniques imbriquées** dans chaque carte
  (triées par priorité, ouvrables en un clic).
- Une lane « Tickets hors epic » regroupe les stories/tâches/bugs sans epic.
- La priorisation vient du besoin métier défini au départ : le champ
  `priority` est fixé par l'IA lors de la génération en masse, de la fiche
  Scrum ou du découpage (rangs distincts entre frères et sœurs). Pour
  re-prioriser un ticket, régénérez sa fiche Scrum.

### Réorganisation en epics (IA)

Le bouton « Organiser en epics » dans la barre d'un tableau (désactivé sous
2 tickets) demande à Mistral de déduire la structure d'epics du projet :

1. Le backend envoie au modèle les tickets de **premier niveau** (sans epic,
   ou déjà rattachés à un epic — les sous-tickets suivent leur parent) ainsi
   que les epics existants.
2. Mistral les regroupe en epics cohérents : il **réutilise les epics
   existants** quand un groupe leur correspond (re-priorisés au passage),
   et crée les nouveaux epics manquants (fiche Scrum, priorité métier).
3. Tous les tickets de premier niveau sont rattachés à leur epic — un ticket
   sans groupe repart « hors epic ». Titres et contenus ne sont jamais
   modifiés.
4. L'interface bascule automatiquement sur la vue Roadmap pour voir
   l'agencement ; tout est temps réel pour les collaborateurs connectés.

Limites : 150 tickets de premier niveau maximum, 15 epics par réorganisation.
La consommation de l'appel est répartie sur les epics créés (ou rattachée au
projet si aucun n'est créé).
API : `POST /api/projects/:id/epics` → `{ epics, created, moved }`.

### Suivi de consommation

- À côté du nom du projet, un badge affiche en continu les tokens envoyés/reçus
  et le coût estimé en euros **depuis le début du projet** — c'est la somme
  exacte de toutes les lignes de la table `ai_usage`.
- Dans le détail de chaque ticket, un badge affiche les tokens et le coût
  **de ce ticket**. La consommation d'un appel est répartie sur les tickets
  qu'il crée (génération en masse, découpage) ou rattachée au ticket généré
  (fiche Scrum). Supprimer un ticket ne fausse pas le total projet : sa
  consommation reste comptée (rattachée au projet).

Tarifs par défaut (euros / million de tokens, ajustables via l'environnement) :
0,15 en entrée, 0,60 en sortie.

### Projets socle (tickets communs)

Depuis la page d'accueil, le bouton « Créer un socle (IA) » permet de
sélectionner 2 à 8 projets :

1. Le backend charge les tickets de chaque projet (fiche Scrum comprise,
   jusqu'à 100 tickets par projet, triés par priorité métier).
2. Mistral compare les tickets et identifie ceux dont l'intention métier est
   **commune à au moins deux projets** ; pour chaque groupe, il rédige un
   ticket commun ajusté et générique, avec fiche Scrum complète et
   priorisation métier.
3. Les tickets communs (jusqu'à 25) sont créés dans un nouveau projet de type
   `foundation` (badge « Socle » sur l'accueil), dans la première colonne,
   ordonnés par priorité. Leur description mentionne les projets sources.
4. La consommation de l'appel de comparaison est répartie sur les tickets
   du socle — le total du projet socle reste la somme exacte des lignes
   `ai_usage`.

Un socle s'utilise comme un projet normal (colonnes, drag & drop, fiches
Scrum, découpage). Il est exclu des sources possibles d'un autre socle.
API : `POST /api/foundation { name, project_ids }` → projet + tickets créés.
