#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkNetworkStack } from '../lib/cdk-network-stack';
import { CdkWebAppStack } from '../lib/cdk-webapp-stack';
import { CdkLlmServerStack } from '../lib/cdk-llmserver-stack';

const app = new cdk.App();
const networkStack = new CdkNetworkStack(app, 'OpenwebuiNetworkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

new CdkWebAppStack(app, 'OpenwebuiWebAppStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  eip: networkStack.eip,
  vpc: networkStack.vpc,
  ec2Sg: networkStack.webappEc2Sg
});

new CdkLlmServerStack(app, 'OpenwebuiLlmServerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  },
  vpc: networkStack.vpc,
  ec2Sg: networkStack.llamaserverEc2Sg
});