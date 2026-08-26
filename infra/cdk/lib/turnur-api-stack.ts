import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

import { DEV_FIXTURE_GAME_ID, DEV_FIXTURE_KEY_HASH } from './game-auth/constants';

const sharedLambdaBundle = {
  externalModules: ['@aws-sdk/*'],
};

export class TurnurApiStack extends cdk.Stack {
  public readonly httpApi: apigwv2.HttpApi;
  public readonly healthFunction: lambdaNodejs.NodejsFunction;
  public readonly gameRegistryTable: dynamodb.Table;

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

    this.gameRegistryTable = new dynamodb.Table(this, 'GameRegistry', {
      partitionKey: { name: 'keyHash', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new AwsCustomResource(this, 'DevFixtureSeed', {
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        parameters: {
          TableName: this.gameRegistryTable.tableName,
          Item: {
            keyHash: { S: DEV_FIXTURE_KEY_HASH },
            gameId: { S: DEV_FIXTURE_GAME_ID },
          },
        },
        physicalResourceId: PhysicalResourceId.of('dev-fixture-seed'),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [this.gameRegistryTable.tableArn],
      }),
    });

    new cdk.CfnOutput(this, 'GameRegistryTableName', {
      value: this.gameRegistryTable.tableName,
      exportName: 'GameRegistryTableName',
    });

    new cdk.CfnOutput(this, 'GameRegistryTableArn', {
      value: this.gameRegistryTable.tableArn,
      exportName: 'GameRegistryTableArn',
    });
  }
}
