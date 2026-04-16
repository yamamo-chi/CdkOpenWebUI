import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { execSync } from 'child_process';

export class CdkNetworkStack extends cdk.Stack {
  public readonly eip: ec2.CfnEIP;
  public readonly vpc: ec2.Vpc;
  public readonly webappEc2Sg: ec2.SecurityGroup;
  public readonly llamaserverEc2Sg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC作成
    this.vpc = new ec2.Vpc(this, 'Vpc', {
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

    // Webapp用セキュリティグループ作成
    this.webappEc2Sg = new ec2.SecurityGroup(this, "WebappEc2Sg", {
      vpc: this.vpc,
    });
    this.webappEc2Sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.HTTP);

    // ↓↓↓ 初期設定後に公開する場合は一度コメントアウト ↓↓↓
    // マイIPのHTTPS許可追加
    const myIp = execSync('curl -s https://checkip.amazonaws.com').toString().trim();
    const myIpCidr = `${myIp}/32`;
    this.webappEc2Sg.addIngressRule(
      ec2.Peer.ipv4(myIpCidr),
      ec2.Port.HTTPS,
    );
    // ↑↑↑ 初期設定後に公開する場合はコメントアウト ↑↑↑

    // LLMサーバー用セキュリティグループ作成
    this.llamaserverEc2Sg = new ec2.SecurityGroup(this, "LlmserverEc2Sg", {
      vpc: this.vpc,
    });
    this.llamaserverEc2Sg.addIngressRule(this.webappEc2Sg, ec2.Port.tcp(8080));

    // パブリックIPアドレス作成
    this.eip = new ec2.CfnEIP(this, 'EC2EIP', {
      tags: [{ key: 'Name', value: 'openwebui-ip' }],
    });
  }
}