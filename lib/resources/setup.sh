#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 権限修正
chown -R ec2-user:ec2-user $SCRIPT_DIR

dnf update -y
dnf install -y docker git cronie

# docker実行権限付与
usermod -aG docker ec2-user

# docker起動
systemctl start docker
systemctl enable docker

# acme.sh用にcronを起動
systemctl start crond
systemctl enable crond

# Docker Composeインストール
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# acme.shインストール
HOME=/root
curl https://get.acme.sh | sh
source ~/.acme.sh/acme.sh.env

# パブリックIP取得
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)

# IPアドレス証明書発行
acme.sh --issue \
  --standalone \
  --httpport 80 \
  --listen-v4 \
  -d $PUBLIC_IP \
  --server letsencrypt \
  --cert-profile shortlived \
  --days 3

# Docker Compose 起動
cd $SCRIPT_DIR
docker compose up -d

# NginxへIPアドレス証明書のインストールと自動更新設定
mkdir -p /home/ec2-user/openwebui/nginx/ssl
acme.sh --install-cert -d $PUBLIC_IP \
--key-file /home/ec2-user/openwebui/nginx/ssl/key.pem \
--fullchain-file /home/ec2-user/openwebui/nginx/ssl/fullchain.pem \
--reloadcmd "chown ec2-user:ec2-user $SCRIPT_DIR/nginx/ssl/*.pem && docker exec nginx-proxy nginx -s reload" \
