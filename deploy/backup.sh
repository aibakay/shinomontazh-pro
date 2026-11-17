#!/bin/bash
# Копия базы CRM каждую ночь, хранится 30 дней: /var/backups/shinomontazh
set -euo pipefail
D=/var/backups/shinomontazh
mkdir -p "$D"
sudo -u postgres pg_dump -Fc shino > "$D/crm-$(date +%F).dump"
find "$D" -name 'crm-*.dump' -mtime +30 -delete
