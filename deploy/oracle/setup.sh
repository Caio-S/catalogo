#!/usr/bin/env bash
# Primeiro setup do app na VM Oracle (Ubuntu). Rodar via SSH, uma vez.
set -euo pipefail

APP_DIR="/home/ubuntu/catalogo"
REPO_URL="https://github.com/Caio-S/catalogo.git"

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip git nginx

if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  cp .env.example .env
  echo "RUN_SCHEDULER=1" >> .env
  echo ">> Edite $APP_DIR/.env com os valores reais (DATABASE_URL, SECRET_KEY, MARIADB_*) antes de iniciar o serviço."
fi

sudo cp deploy/oracle/catalogo.service /etc/systemd/system/catalogo.service
sudo systemctl daemon-reload
sudo systemctl enable catalogo

sudo cp deploy/oracle/nginx-catalogo.conf /etc/nginx/sites-available/catalogo
sudo ln -sf /etc/nginx/sites-available/catalogo /etc/nginx/sites-enabled/catalogo
sudo rm -f /etc/nginx/sites-enabled/default
echo ">> Edite server_name em /etc/nginx/sites-available/catalogo (domínio ou IP público) antes de recarregar o nginx."

echo
echo "Próximos passos manuais:"
echo "1) nano $APP_DIR/.env            (preencher os valores reais)"
echo "2) sudo nano /etc/nginx/sites-available/catalogo   (ajustar server_name)"
echo "3) sudo nginx -t && sudo systemctl reload nginx"
echo "4) sudo systemctl start catalogo && sudo systemctl status catalogo"
