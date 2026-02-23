## プロジェクト初期設定
1. Gitクローン後、 `npm install` でパッケージインストール
2. DatadogAPIキーをSSMパラメータストアにSecureStringで格納
3. [cdk.json](cdk.json)の `ddApiKeyParamName` に格納したパラメータ名を設定

## 通常のデプロイ手順
1. デプロイコマンド実行: `cdk deploy OpenwebuiAppStack`
2. デプロイ後にコンソールに表示された `ServerURL` をブラウザで開く

## OpenWebUIの初期設定完了後に公開する場合

1. [cdk-network-stack.ts](lib\cdk-network-stack.ts)内の `ec2Sg` へのHTTPS許可をコメントアウト
2. デプロイコマンド実行: `cdk deploy OpenwebuiAppStack`
3. デプロイ後にコンソールに表示された `InstanceId` を指定して[ssm_to_server.bat](scripts\ssm_to_server.bat)を実行
4. ブラウザで証明書エラーの警告が出るが無視して続行し、初期設定を行う
5. 初期設定が全て完了したら、上記 1. でコメントアウトしたHTTPS許可をコメントアウト解除
6. 再度デプロイコマンド実行: `cdk deploy OpenwebuiAppStack`
7. デプロイ後にコンソールに表示された `ServerURL` をブラウザで開き、正常に初期設定が完了していることを確認する