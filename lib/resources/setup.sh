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

# --- Datadog設定 start ---

# Datadog Agentのインストール
DD_API_KEY=$(aws ssm get-parameter --name "$1" --with-decryption --query "Parameter.Value" --output text) \
DD_SITE="ap1.datadoghq.com" \
DD_INSTALL_ONLY=true \
bash -c "$(curl -L https://install.datadoghq.com/scripts/install_script_agent7.sh)"

# コンテナの中身もDatadogで監視
usermod -aG docker dd-agent
# ログ収集の有効化
echo "logs_enabled: true" | sudo tee -a /etc/datadog-agent/datadog.yaml
# 全てのコンテナログ収集を無効化
echo "container_collect_all: false" | sudo tee -a /etc/datadog-agent/datadog.yaml
# AmazonLinux2023でEC2メタデータを取得できるようにする
echo "ec2_prefer_imdsv2: true" | sudo tee -a /etc/datadog-agent/datadog.yaml

# Datadog Agent起動
systemctl enable datadog-agent
systemctl start datadog-agent

# --- Datadog設定 end ---

# Docker Compose 起動
cd $SCRIPT_DIR
docker compose up -d

# NginxへIPアドレス証明書のインストールと自動更新設定
mkdir -p /home/ec2-user/openwebui/nginx/ssl
$ACME_DIR/acme.sh --install-cert -d $PUBLIC_IP \
--key-file /home/ec2-user/openwebui/nginx/ssl/key.pem \
--fullchain-file /home/ec2-user/openwebui/nginx/ssl/fullchain.pem \
--reloadcmd "chown ec2-user:ec2-user $SCRIPT_DIR/nginx/ssl/*.pem && docker exec nginx-proxy nginx -s reload" \