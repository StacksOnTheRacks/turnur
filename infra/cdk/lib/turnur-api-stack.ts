import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const sharedLambdaBundle = {
  externalModules: ['@aws-sdk/*'],
};

export class TurnurApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly stubFunction: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'turnur-http',
      description: 'Turnur control-plane HTTP API',
    });

    this.stubFunction = new lambdaNodejs.NodejsFunction(this, 'StubFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: sharedLambdaBundle,
      entry: path.join(__dirname, '../lambda/stub-handler.ts'),
      handler: 'handler',
    });
  }
}
