#!/usr/bin/env bash
# Amorçage d'une VM Ubuntu (22.04 / 24.04) pour Team Kanban.
# Installe Docker, crée l'utilisateur "deploy" et prépare /opt/team-kanban.
# Usage : sudo bash bootstrap.sh "<clé publique SSH>"
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Lancez ce script avec sudo." >&2
  exit 1
fi

PUBKEY="${1:?Usage: sudo bash bootstrap.sh \"<clé publique SSH>\"}"

apt-get update -y
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

id deploy &>/dev/null || useradd -m -s /bin/bash -G docker deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
echo "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
install -d -o deploy -g deploy /opt/team-kanban

if command -v ufw >/dev/null; then
  ufw allow OpenSSH || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw --force enable || true
fi

echo "VM prête. Ajoutez ensuite les secrets GitHub, puis poussez sur master pour déployer."
