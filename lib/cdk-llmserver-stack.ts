import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as path from 'path'

// アプリスタック用引数
export interface ApiStackProps extends cdk.StackProps {
  readonly vpc: ec2.Vpc;
  readonly ec2Sg: ec2.SecurityGroup;
}

export class CdkLlmServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ==============================
    // 定数 
    // ==============================

    // 並列稼働するEC2の数
    const INSTANCE_NUM = 2;

    // EC2の性能
    const INSTANCE_TYPE = ec2.InstanceType.of(
      ec2.InstanceClass.C6A, 
      ec2.InstanceSize.XLARGE
    );
    const MACHINE_IMAGE = ec2.MachineImage.latestAmazonLinux2023({
      //cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });


    // ==============================
    // 処理開始
    // ==============================

    // ホストゾーン作成
    const hostedzone = new route53.PrivateHostedZone(this, 'HostedZone', {
      zoneName: 'openwebui.local',
      vpc: props.vpc,
    });
    
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
    const llmserverAsset = new s3_assets.Asset(this, 'LlmserverAsset', {
      path: path.join(__dirname, 'resources/llmserver'),
    });
    const commonAsset = new s3_assets.Asset(this, 'CommonAsset', {
      path: path.join(__dirname, 'resources/common'),
    });

    // S3アセットへの読み取り権限をEC2に付与
    llmserverAsset.grantRead(ec2Role);
    commonAsset.grantRead(ec2Role);

    const userData = ec2.UserData.forLinux({
      shebang: "#!/bin/bash"
    });
    userData.addCommands('dnf update -y');
    userData.addCommands('timedatectl set-timezone Asia/Tokyo');

    // S3にアップロードした配備リソースを取得
    const llmserverZip = userData.addS3DownloadCommand({
      bucket: llmserverAsset.bucket,
      bucketKey: llmserverAsset.s3ObjectKey,
    });
    const commonZip = userData.addS3DownloadCommand({
      bucket: commonAsset.bucket,
      bucketKey: commonAsset.s3ObjectKey,
    });
    userData.addCommands(
      `unzip ${llmserverZip} -d /home/ec2-user/llama-server/`,
      `rm ${llmserverZip}`,
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
      'cd /home/ec2-user/llama-server',
      'docker compose up -d',
    );
    // Datadogエージェントインストール
    userData.addExecuteFileCommand({
      filePath: '/tmp/ddagent-installer.sh',
      arguments: this.node.tryGetContext("ddApiKeyParamName"),
    });

    // EC2インスタンス作成
    const instances: ec2.Instance[] = [];
    for (let i = 0; i < INSTANCE_NUM; i++) {
      const instance = new ec2.Instance(this, `Instance${i}`, {
        instanceName: `Openwebui-LlmServerInstance${i}`,
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
      instances.push(instance);

    }

    // api.openwebui.localに各EC2のIPを紐づけ
    new route53.ARecord(this, `ARecord`, {
      zone: hostedzone,
      recordName: 'api', 
      target: route53.RecordTarget.fromIpAddresses(
        ...instances.map(instance => instance.instancePrivateIp)
      ),
      ttl: cdk.Duration.seconds(60),
    });

    // --- EC2自動起動/停止設定 ---

    const startHour = this.node.tryGetContext("serverStartHour");
    const stopHour = this.node.tryGetContext("serverStopHour");
    const scheduleDays = this.node.tryGetContext("serverScheduleDays");

    // 1. スケジューラーがEC2を操作するための実行ロール
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    schedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ec2:StartInstances', 'ec2:StopInstances'],
      resources: instances.map(instance => `arn:aws:ec2:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:instance/${instance.instanceId}`), // インスタンスARNに制限
    }));

    // スケジュールグループ
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', {
      name: 'auto-start-stop-group-llmserver',
    });

    // 2. 起動スケジュール (平日 09:00 JST)
    new scheduler.CfnSchedule(this, 'StartSchedule', {
      groupName: scheduleGroup.name,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: `cron(0 ${startHour} ? * ${scheduleDays} *)`,
      scheduleExpressionTimezone: 'Asia/Tokyo',
      target: {
        arn: `arn:aws:scheduler:::aws-sdk:ec2:startInstances`,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: instances.map(instance => instance.instanceId) }),
      },
    });

    // 3. 停止スケジュール (平日 19:00 JST)
    new scheduler.CfnSchedule(this, 'StopSchedule', {
      groupName: scheduleGroup.name,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: `cron(0 ${stopHour} ? * ${scheduleDays} *)`,
      scheduleExpressionTimezone: 'Asia/Tokyo',
      target: {
        arn: `arn:aws:scheduler:::aws-sdk:ec2:stopInstances`,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ InstanceIds: instances.map(instance => instance.instanceId) }),
      },
    });
  }
}