import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const sharedLambdaBundle = {
  externalModules: ['@aws-sdk/*'],
};

export class TurnurApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly healthFunction: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'turnur-http',
      description: 'Turnur control-plane HTTP API',
    });

    this.healthFunction = new lambdaNodejs.NodejsFunction(this, 'HealthFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: sharedLambdaBundle,
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
    });

    const healthIntegration = new integrations.HttpLambdaIntegration(
      'HealthInt',
      this.healthFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/health',
      methods: [apigwv2.HttpMethod.GET],
      integration: healthIntegration,
    });
  }
}
