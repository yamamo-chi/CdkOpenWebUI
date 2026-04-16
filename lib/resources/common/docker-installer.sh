#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 権限修正
chown -R ec2-user:ec2-user $SCRIPT_DIR

dnf update -y
dnf install -y docker

# docker実行権限付与
usermod -aG docker ec2-user

# docker起動
systemctl start docker
systemctl enable docker

# Docker Composeインストール
mkdir -p /usr/libexec/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose
