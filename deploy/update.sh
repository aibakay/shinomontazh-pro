#!/bin/bash
# Автовыкладка: если в GitHub (ветка main, точнее — текущая ветка на сервере) появилось новое — забрать и перезапустить сайт.
# Запускается таймером shinomontazh-update.timer раз в минуту.
set -euo pipefail
cd /srv/shinomontazh
# ветка — та, что выбрана на сервере (обычно main)
BR=$(sudo -u shino git rev-parse --abbrev-ref HEAD)
sudo -u shino git fetch -q origin "$BR"
NEW=$(sudo -u shino git rev-parse "origin/$BR")
OLD=$(sudo -u shino git rev-parse HEAD)
[ "$NEW" = "$OLD" ] && exit 0
PKG_CHANGED=$(sudo -u shino git diff --name-only "$OLD" "$NEW" -- package.json | wc -l)
sudo -u shino git reset -q --hard "$NEW"
if [ "$PKG_CHANGED" != "0" ] || [ ! -d node_modules ]; then sudo -u shino npm install --omit=dev --no-audit --no-fund -q; fi
# обновить сами настройки сервера, если они менялись
if ! cmp -s deploy/shinomontazh.service /etc/systemd/system/shinomontazh.service; then
  cp deploy/shinomontazh.service /etc/systemd/system/ && systemctl daemon-reload
fi
systemctl restart shinomontazh
sleep 2
if systemctl is-active -q shinomontazh; then
  logger -t shinomontazh-update "выложено ${NEW:0:7}"
else
  logger -t shinomontazh-update "ОШИБКА после ${NEW:0:7}, откат на ${OLD:0:7}"
  sudo -u shino git reset -q --hard "$OLD"
  systemctl restart shinomontazh
fi
