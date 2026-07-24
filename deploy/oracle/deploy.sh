#!/usr/bin/env bash
# Atualiza o app na VM apos um push no repo. Rodar via SSH.
set -euo pipefail

cd /home/ubuntu/catalogo
git pull
./.venv/bin/pip install -r requirements.txt
sudo systemctl restart catalogo
sudo systemctl status catalogo --no-pager
