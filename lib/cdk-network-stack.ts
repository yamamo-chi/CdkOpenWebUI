import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { execSync } from 'child_process';

export class CdkNetworkStack extends cdk.Stack {
  public readonly eip: ec2.CfnEIP;
  public readonly vpc: ec2.Vpc;
  public readonly ec2Sg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC作成
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: this.node.tryGetContext("vpcName"),
      ipAddresses: ec2.IpAddresses.cidr('192.168.0.0/24'),
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: 'OpenwebuiPublic',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 25,
        },
      ],
    });

    // セキュリティグループ作成
    this.ec2Sg = new ec2.SecurityGroup(this, "Ec2Sg", {
      securityGroupName: this.node.tryGetContext("appSgName"),
      vpc: this.vpc,
    })
    this.ec2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.HTTP);

    // ↓↓↓ 初期設定後に公開する場合は一度コメントアウト ↓↓↓
    // マイIPのHTTPS許可追加
    const myIp = execSync('curl -s https://checkip.amazonaws.com').toString().trim();
    const myIpCidr = `${myIp}/32`;
    this.ec2Sg.addIngressRule(
      ec2.Peer.ipv4(myIpCidr),
      ec2.Port.HTTPS,
    );
    // ↑↑↑ 初期設定後に公開する場合はコメントアウト ↑↑↑

    // EC2用ElasticIPアドレス作成
    this.eip = new ec2.CfnEIP(this, 'EC2EIP', {
      tags: [{ key: 'Name', value: 'openwebui-ip' }],
    });
  }
}