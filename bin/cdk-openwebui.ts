#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkNetworkStack } from '../lib/cdk-network-stack';
import { CdkAppStack } from '../lib/cdk-app-stack';

const app = new cdk.App();
const networkStack = new CdkNetworkStack(app, 'OpenwebuiNetworkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

const appStack = new CdkAppStack(app, 'OpenwebuiAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  eip: networkStack.eip,
  vpc: networkStack.vpc,
  ec2Sg: networkStack.ec2Sg
});

appStack.node.addDependency(networkStack);