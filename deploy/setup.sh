#!/bin/bash
# Первая установка сервера (Ubuntu 24.04). Запуск: sudo bash setup.sh
# Ставит Node.js 22, PostgreSQL 17, nginx; создаёт пользователя shino, базу shino,
# забирает сайт из GitHub в /srv/shinomontazh и включает автовыкладку и ночные копии базы.
# Секреты (пароли CRM и т. п.) сюда не входят — они в /etc/shinomontazh.env (создаётся пустым шаблоном).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
REPO=https://github.com/aibakay/shinomontazh-pro.git
BRANCH=${BRANCH:-main}

timedatectl set-timezone Europe/Moscow || true
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git nginx ufw unattended-upgrades

# swap 1 ГБ — на 2 ГБ памяти не помешает
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node.js 22
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - || true
  apt-get install -y -q nodejs
fi

# PostgreSQL 17 (как в Neon), из официального репозитория
if [ ! -x /usr/lib/postgresql/17/bin/postgres ]; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -q
  apt-get install -y -q postgresql-17
fi

id shino >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/shino --shell /usr/sbin/nologin shino

# база и пользователь базы (только с этого сервера, наружу порт 5432 закрыт)
if [ ! -f /etc/shinomontazh.env ]; then
  DBPW=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "create role shino login password '$DBPW';" || sudo -u postgres psql -c "alter role shino password '$DBPW';"
  sudo -u postgres psql -tc "select 1 from pg_database where datname='shino'" | grep -q 1 || sudo -u postgres createdb -O shino shino
  umask 027
  cat > /etc/shinomontazh.env <<ENV
DATABASE_URL=postgres://shino:$DBPW@127.0.0.1:5432/shino
DATABASE_SSL=off
# CRM_OWNER_PASSWORD=
# CRM_MASTER_PASSWORD=
# CRM_SECRET=
# CRM_OWNER_PIN=
# TELEGRAM_RELAY_URL=https://shinomontazh-pro.vercel.app/api/tg
# TELEGRAM_RELAY_SECRET=
ENV
  chown root:shino /etc/shinomontazh.env
  chmod 640 /etc/shinomontazh.env
fi

# код сайта
if [ ! -d /srv/shinomontazh/.git ]; then
  install -d -o shino -g shino /srv/shinomontazh
  sudo -u shino git clone -q -b "$BRANCH" "$REPO" /srv/shinomontazh
fi
cd /srv/shinomontazh
sudo -u shino git config pull.ff only
sudo -u shino HOME=/home/shino npm install --omit=dev --no-audit --no-fund -q

# службы
cp deploy/shinomontazh.service deploy/shinomontazh-update.service deploy/shinomontazh-update.timer \
   deploy/shinomontazh-backup.service deploy/shinomontazh-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now shinomontazh shinomontazh-update.timer shinomontazh-backup.timer

# nginx
cp deploy/nginx.conf /etc/nginx/sites-available/shinomontazh
cp deploy/shino_proxy.conf /etc/nginx/shino_proxy.conf
ln -sf /etc/nginx/sites-available/shinomontazh /etc/nginx/sites-enabled/shinomontazh
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# брандмауэр: только SSH, HTTP, HTTPS
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "Готово. Проверка: curl -s localhost:3000/api/queue"
