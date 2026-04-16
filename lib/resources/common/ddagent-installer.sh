#!/bin/bash
set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 権限修正
chown -R ec2-user:ec2-user $SCRIPT_DIR

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
# プロセス情報収集
cat << EOF | sudo tee -a /etc/datadog-agent/datadog.yaml
process_config:
  process_collection:
    enabled: true
    
  strip_proc_arguments: true
EOF
# Nginx Integration用設定ファイル
cat <<EOF > /etc/datadog-agent/conf.d/nginx.d/conf.yaml
init_config:

instances:
  - nginx_status_url: http://localhost:81/nginx_status
EOF

# Datadog Agent起動
systemctl enable datadog-agent
systemctl start datadog-agent
