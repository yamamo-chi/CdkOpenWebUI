import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as path from 'path'

// アプリスタック用引数
export interface ApiStackProps extends cdk.StackProps {
  readonly eip: ec2.CfnEIP;
  readonly vpc: ec2.Vpc;
  readonly ec2Sg: ec2.SecurityGroup;
}

export class CdkWebAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ==============================
    // 定数 
    // ==============================

    // EC2の性能
    const INSTANCE_TYPE = ec2.InstanceType.of(
      ec2.InstanceClass.C5A, 
      ec2.InstanceSize.LARGE
    );
    const MACHINE_IMAGE = ec2.MachineImage.latestAmazonLinux2023({
      //cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });


    // ==============================
    // 処理開始
    // ==============================
    
    // EC2インスタンス用のIAMロール作成
    const ec2Role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // EC2にDatadogApiKey取得権限付与
    const ddApiKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'DdApiKeyParam', {
      parameterName: this.node.tryGetContext("ddApiKeyParamName"),
    });
    ddApiKeyParam.grantRead(ec2Role);

    // 配備リソースをS3経由でEC2に取得させる
    const webappAsset = new s3_assets.Asset(this, 'WebappAsset', {
      path: path.join(__dirname, 'resources/webapp'),
    });
    const commonAsset = new s3_assets.Asset(this, 'CommonAsset', {
      path: path.join(__dirname, 'resources/common'),
    });

    // S3アセットへの読み取り権限をEC2に付与
    webappAsset.grantRead(ec2Role);
    commonAsset.grantRead(ec2Role);

    const userData = ec2.UserData.forLinux({
      shebang: "#!/bin/bash"
    });

    // S3にアップロードした配備リソースを取得
    const webappZip = userData.addS3DownloadCommand({
      bucket: webappAsset.bucket,
      bucketKey: webappAsset.s3ObjectKey,
    });
    const commonZip = userData.addS3DownloadCommand({
      bucket: commonAsset.bucket,
      bucketKey: commonAsset.s3ObjectKey,
    });
    userData.addCommands(
      `unzip ${webappZip} -d /home/ec2-user/openwebui/`,
      `rm ${webappZip}`,
    );
    userData.addCommands(
      `unzip ${commonZip} -d /tmp/`,
      `rm ${commonZip}`,
    );

    // Dockerインストール & サーバー起動
    userData.addExecuteFileCommand({
      filePath: '/tmp/docker-installer.sh',
    });
    userData.addCommands(
      'cd /home/ec2-user/openwebui',
      'docker compose up -d',
    );

    // Datadogエージェントインストール
    userData.addExecuteFileCommand({
      filePath: '/tmp/ddagent-installer.sh',
      arguments: this.node.tryGetContext("ddApiKeyParamName"),
    });
    userData.addCommands(
      '# Nginx Integration用設定ファイル',
      'cat <<EOF > /etc/datadog-agent/conf.d/nginx.d/conf.yaml',
      'init_config:',

      'instances:',
      '  - nginx_status_url: http://localhost:81/nginx_status',
      'EOF',

      '# Datadog Agent再起動',
      'systemctl restart datadog-agent',
    );

    // IPアドレス証明書発行
    userData.addExecuteFileCommand({
      filePath: '/home/ec2-user/openwebui/issue-cert.sh',
    });

    // EC2インスタンス作成
    const instance = new ec2.Instance(this, 'Instance', {
      instanceName: "Openwebui-WebappInstance",
      vpc: props.vpc,
      instanceType: INSTANCE_TYPE,
      machineImage: MACHINE_IMAGE,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: props.ec2Sg,
      role: ec2Role,
      userData: userData,
      ssmSessionPermissions: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20)
        }
      ],
    });

    // EIPとEC2の紐付け
    new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
      instanceId: instance.instanceId,
      allocationId: props.eip.attrAllocationId,
    });

    // --- EC2自動起動/停止設定 ---

    // 1. スケジューラーがEC2を操作するための実行ロール
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    schedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:StartInstances', 'ec2:StopInstances'],
      resources: [`arn:aws:ec2:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:instance/${instance.instanceId}`], // インスタンスARNに制限
    }));

    // スケジュールグループ
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', {
      name: 'auto-start-stop-group-webapp',
    });

    // 2. 起動スケジュール (平日 09:00 JST)
    new scheduler.CfnSchedule(this, 'StartSchedule', {
      groupName: scheduleGroup.name,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0 9 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'Asia/Tokyo',
      target: {
        arn: `arn:aws:scheduler:::aws-sdk:ec2:startInstances`,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: [instance.instanceId] }),
      },
    });

    // 3. 停止スケジュール (平日 19:00 JST)
    new scheduler.CfnSchedule(this, 'StopSchedule', {
      groupName: scheduleGroup.name,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0 19 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'Asia/Tokyo',
      target: {
        arn: `arn:aws:scheduler:::aws-sdk:ec2:stopInstances`,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: [instance.instanceId] }),
      },
    });

    
    // --- コンソール表示 ---

    new cdk.CfnOutput(this, 'InstanceIdOutput', {
      value: `InstanceId: ${instance.instanceId}`,
    });

    new cdk.CfnOutput(this, 'UrlOutput', {
      value: `ServerURL: https://${instance.instancePublicIp}`,
    });
  }
}