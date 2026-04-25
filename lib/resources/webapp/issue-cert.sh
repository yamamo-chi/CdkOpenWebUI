#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 権限修正
chown -R ec2-user:ec2-user $SCRIPT_DIR

dnf install -y cronie

# acme.sh用にcronを起動
systemctl start crond
systemctl enable crond

# acme.shインストール
curl https://get.acme.sh | HOME=/root sh
ACME_DIR=/root/.acme.sh

# パブリックIP取得
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)

# IPアドレス証明書発行
$ACME_DIR/acme.sh --issue \
  --standalone \
  --httpport 80 \
  --listen-v4 \
  -d $PUBLIC_IP \
  --server letsencrypt \
  --cert-profile shortlived \
  --days 3

# NginxへIPアドレス証明書のインストールと自動更新設定
mkdir -p /home/ec2-user/openwebui/nginx/webapp-proxy/ssl
$ACME_DIR/acme.sh --install-cert -d $PUBLIC_IP \
  --key-file /home/ec2-user/openwebui/nginx/webapp-proxy/ssl/key.pem \
  --fullchain-file /home/ec2-user/openwebui/nginx/webapp-proxy/ssl/fullchain.pem \
  --reloadcmd "chown ec2-user:ec2-user $SCRIPT_DIR/nginx/webapp-proxy/ssl/*.pem && docker exec webapp-proxy nginx -s reload"