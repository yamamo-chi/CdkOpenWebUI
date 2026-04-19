## プロジェクト初期設定
1. Gitクローン後、 `npm install` でパッケージインストール
2. DatadogAPIキーをSSMパラメータストアに `SecureString`（タイプ: 安全な文字列）で格納
3. [cdk.json](cdk.json)の `ddApiKeyParamName` に格納したパラメータ名を設定

## デプロイ手順
### 通常のデプロイ手順
1. デプロイコマンド実行
```
cdk deploy OpenwebuiLlmServerStack && cdk deploy OpenwebuiWebAppStack
```
2. デプロイ後にコンソールに表示された `ServerURL` をブラウザで開く

### OpenWebUIの初期設定完了後に公開する場合

1. [cdk-network-stack.ts](lib\cdk-network-stack.ts)内の `webappEc2Sg` へのHTTPS許可をコメントアウト
2. デプロイコマンド実行: `cdk deploy OpenwebuiLlmServerStack && cdk deploy OpenwebuiWebAppStack`
3. デプロイ後にコンソールに表示された `InstanceId` を指定して[ssm_to_server.bat](scripts\ssm_to_server.bat)を実行
4. ブラウザで証明書エラーの警告が出るが無視して続行し、初期設定を行う
5. 初期設定が全て完了したら、上記 1. でコメントアウトしたHTTPS許可をコメントアウト解除
6. 再度デプロイコマンド実行: `cdk deploy OpenwebuiWebAppStack`
7. デプロイ後にコンソールに表示された `ServerURL` をブラウザで開き、正常に初期設定が完了していることを確認する

## OpenWebUI初期設定について
以下を手動で設定変更（何故か環境変数が効かない）
- セルフサインアップをON
- Ollama APIをOFF

## 負荷テスト
同時に複数人が利用した場合の負荷をテストするために、Playwrightを利用します。

1. OpenWebUIをデプロイする
2. [load-test.spec.ts](tests\load-test.spec.ts) 内の遷移先URL、メールアドレス、パスワードを変更する
3. 必要であれば、同時リクエスト数 `iterations` を変更する
4. テストコマンドを実行する
```
npx playwright test --ui
```
5. 起動したPlaywrightのウィンドウ内で、左バーにある `load-test.spec.ts` の再生ボタンを選択してテストを実行する

## 負荷強度を上げる場合
1. [cdk-llmserver-stack.ts](lib\cdk-llmserver-stack.ts)内の `INSTANCE_NUM` を上げる
2. LLMサーバーのみ再デプロイする
```
cdk deploy OpenwebuiLlmServerStack
```
3. AWSにログインしてEC2を開き、インスタンス `Openwebui-WebappInstance` を選択
4. 接続 > SSM Session Manager > 接続 でサーバーに乗り込む
5. 以下コマンドを実行
```
sudo su -c 'docker restart llmserver-proxy'
```