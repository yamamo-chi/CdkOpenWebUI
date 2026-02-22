import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3_assets from 'aws-cdk-lib/aws-s3-assets';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as path from 'path'

// アプリスタック用引数
export interface ApiStackProps extends cdk.StackProps {
  readonly eip: ec2.CfnEIP;
  readonly vpc: ec2.Vpc;
  readonly ec2Sg: ec2.SecurityGroup;
}

export class CdkAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const INSTANCE_TYPE = ec2.InstanceType.of(
      ec2.InstanceClass.C6A, 
      ec2.InstanceSize.XLARGE);
    const MACHINE_IMAGE = ec2.MachineImage.latestAmazonLinux2023({
      //cpuType: ec2.AmazonLinuxCpuType.ARM_64
    });

    // 配備リソースをS3経由でEC2に取得させる
    const resourcesAsset = new s3_assets.Asset(this, 'ResourcesAsset', {
      path: path.join(__dirname, 'resources'),
    });

    // EC2インスタンス用のIAMロール作成
    const role = new iam.Role(this, 'Ec2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // S3アセットへの読み取り権限をEC2に付与
    resourcesAsset.grantRead(role);

    // EC2初期設定
    const userData = ec2.UserData.forLinux({
      shebang: "#!/bin/bash"
    });

    const resourcesZip = userData.addS3DownloadCommand({
      bucket: resourcesAsset.bucket,
      bucketKey: resourcesAsset.s3ObjectKey,
    });
    userData.addCommands(
      `unzip ${resourcesZip} -d /home/ec2-user/openwebui/`,
      `rm ${resourcesZip}`,
    );
    userData.addExecuteFileCommand({
      filePath: '/home/ec2-user/openwebui/setup.sh',
    });

    // EC2インスタンス作成
    const instance = new ec2.Instance(this, 'Instance', {
      instanceName: "OpenwebuiInstance",
      vpc: props.vpc,
      instanceType: INSTANCE_TYPE,
      machineImage: MACHINE_IMAGE,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: props.ec2Sg,
      role: role,
      userData: userData,
      ssmSessionPermissions: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20)
        }
      ],
      // keyName: "my-key"
    });

    // EIPとEC2の紐付け
    new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
      eip: props.eip.ref,
      instanceId: instance.instanceId,
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
      name: 'auto-start-stop-group',
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