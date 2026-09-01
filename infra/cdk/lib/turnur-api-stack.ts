import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
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
  public readonly gameMeFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesAttachFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesProbeFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesSeatsFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesTurnFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesMovesFunction: lambdaNodejs.NodejsFunction;
  public readonly matchesViewFunction: lambdaNodejs.NodejsFunction;
  public readonly gameRegistryTable: dynamodb.Table;
  public readonly matchRegistryTable: dynamodb.Table;
  public readonly matchStateTable: dynamodb.Table;
  public readonly matchMoveLogTable: dynamodb.Table;

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

    this.matchRegistryTable = new dynamodb.Table(this, 'MatchRegistry', {
      partitionKey: { name: 'matchId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'MatchRegistryTableName', {
      value: this.matchRegistryTable.tableName,
      exportName: 'MatchRegistryTableName',
    });

    new cdk.CfnOutput(this, 'MatchRegistryTableArn', {
      value: this.matchRegistryTable.tableArn,
      exportName: 'MatchRegistryTableArn',
    });

    this.matchStateTable = new dynamodb.Table(this, 'MatchState', {
      partitionKey: { name: 'matchId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'MatchStateTableName', {
      value: this.matchStateTable.tableName,
      exportName: 'MatchStateTableName',
    });

    new cdk.CfnOutput(this, 'MatchStateTableArn', {
      value: this.matchStateTable.tableArn,
      exportName: 'MatchStateTableArn',
    });

    this.matchMoveLogTable = new dynamodb.Table(this, 'MatchMoveLog', {
      partitionKey: { name: 'matchId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'seq', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'MatchMoveLogTableName', {
      value: this.matchMoveLogTable.tableName,
      exportName: 'MatchMoveLogTableName',
    });

    new cdk.CfnOutput(this, 'MatchMoveLogTableArn', {
      value: this.matchMoveLogTable.tableArn,
      exportName: 'MatchMoveLogTableArn',
    });

    this.gameMeFunction = this.createProtectedNodejsFunction('GameMeFn', {
      entry: path.join(__dirname, '../lambda/game-me-handler.ts'),
      handler: 'handler',
      description: 'GET /v1/game/me — authenticated game identity probe',
    });

    const gameMeIntegration = new integrations.HttpLambdaIntegration(
      'GameMeInt',
      this.gameMeFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/game/me',
      methods: [apigwv2.HttpMethod.GET],
      integration: gameMeIntegration,
    });

    this.matchesAttachFunction = this.createProtectedNodejsFunction('MatchesAttachFn', {
      entry: path.join(__dirname, '../lambda/matches-attach-handler.ts'),
      handler: 'handler',
      description: 'POST /v1/matches — attach (create) a match',
      matchRegistryWrite: true,
    });

    const matchesAttachIntegration = new integrations.HttpLambdaIntegration(
      'MatchesAttachInt',
      this.matchesAttachFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches',
      methods: [apigwv2.HttpMethod.POST],
      integration: matchesAttachIntegration,
    });

    this.matchesProbeFunction = this.createProtectedNodejsFunction('MatchesProbeFn', {
      entry: path.join(__dirname, '../lambda/matches-probe-handler.ts'),
      handler: 'handler',
      description: 'GET /v1/matches/{matchId} — read probe for match metadata',
      matchRegistryRead: true,
    });

    const matchesProbeIntegration = new integrations.HttpLambdaIntegration(
      'MatchesProbeInt',
      this.matchesProbeFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches/{matchId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: matchesProbeIntegration,
    });

    this.matchesSeatsFunction = this.createProtectedNodejsFunction('MatchesSeatsFn', {
      entry: path.join(__dirname, '../lambda/matches-seats-handler.ts'),
      handler: 'handler',
      description: 'POST/GET /v1/matches/{matchId}/seats — create and list seats',
      matchRegistryRead: true,
      matchStateRead: true,
      matchStateWrite: true,
    });

    const matchesSeatsIntegration = new integrations.HttpLambdaIntegration(
      'MatchesSeatsInt',
      this.matchesSeatsFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches/{matchId}/seats',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET],
      integration: matchesSeatsIntegration,
    });

    this.matchesTurnFunction = this.createProtectedNodejsFunction('MatchesTurnFn', {
      entry: path.join(__dirname, '../lambda/matches-turn-handler.ts'),
      handler: 'handler',
      description: 'GET/PUT /v1/matches/{matchId}/turn — read and designate current seat',
      matchRegistryRead: true,
      matchStateRead: true,
      matchStateWrite: true,
    });

    const matchesTurnIntegration = new integrations.HttpLambdaIntegration(
      'MatchesTurnInt',
      this.matchesTurnFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches/{matchId}/turn',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT],
      integration: matchesTurnIntegration,
    });

    this.matchesMovesFunction = this.createProtectedNodejsFunction('MatchesMovesFn', {
      entry: path.join(__dirname, '../lambda/matches-moves-handler.ts'),
      handler: 'handler',
      description: 'POST /v1/matches/{matchId}/moves — append on-turn move',
      matchRegistryRead: true,
      matchStateRead: true,
      matchMoveLogRead: true,
      matchMoveLogWrite: true,
    });

    const matchesMovesIntegration = new integrations.HttpLambdaIntegration(
      'MatchesMovesInt',
      this.matchesMovesFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches/{matchId}/moves',
      methods: [apigwv2.HttpMethod.POST],
      integration: matchesMovesIntegration,
    });

    this.matchesViewFunction = this.createProtectedNodejsFunction('MatchesViewFn', {
      entry: path.join(__dirname, '../lambda/matches-view-handler.ts'),
      handler: 'handler',
      description: 'PUT/GET /v1/matches/{matchId}/seats/{seatId}/view — seat hidden views',
      matchRegistryRead: true,
      matchStateRead: true,
      matchStateWrite: true,
    });

    const matchesViewIntegration = new integrations.HttpLambdaIntegration(
      'MatchesViewInt',
      this.matchesViewFunction,
    );

    this.httpApi.addRoutes({
      path: '/v1/matches/{matchId}/seats/{seatId}/view',
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.GET],
      integration: matchesViewIntegration,
    });
  }

  /** Protected Lambda factory: registry read + GAME_REGISTRY_TABLE_NAME for in-handler auth. */
  createProtectedNodejsFunction(
    id: string,
    props: Pick<
      lambdaNodejs.NodejsFunctionProps,
      'entry' | 'handler' | 'environment' | 'description'
    > & {
      matchRegistryWrite?: boolean;
      matchRegistryRead?: boolean;
      matchStateRead?: boolean;
      matchStateWrite?: boolean;
      matchMoveLogRead?: boolean;
      matchMoveLogWrite?: boolean;
    },
  ): lambdaNodejs.NodejsFunction {
    const environment: Record<string, string> = {
      ...props.environment,
      GAME_REGISTRY_TABLE_NAME: this.gameRegistryTable.tableName,
    };
    if (props.matchRegistryWrite || props.matchRegistryRead) {
      environment.MATCH_REGISTRY_TABLE_NAME = this.matchRegistryTable.tableName;
    }
    if (props.matchStateRead || props.matchStateWrite) {
      environment.MATCH_STATE_TABLE_NAME = this.matchStateTable.tableName;
    }
    if (props.matchMoveLogRead || props.matchMoveLogWrite) {
      environment.MATCH_MOVE_LOG_TABLE_NAME = this.matchMoveLogTable.tableName;
    }

    const fn = new lambdaNodejs.NodejsFunction(this, id, {
      runtime: lambda.Runtime.NODEJS_22_X,
      bundling: sharedLambdaBundle,
      environment,
      entry: props.entry,
      handler: props.handler,
      description: props.description,
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [this.gameRegistryTable.tableArn],
      }),
    );

    if (props.matchRegistryWrite) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:PutItem'],
          resources: [this.matchRegistryTable.tableArn],
        }),
      );
    }

    if (props.matchRegistryRead) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [this.matchRegistryTable.tableArn],
        }),
      );
    }

    if (props.matchStateRead) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [this.matchStateTable.tableArn],
        }),
      );
    }

    if (props.matchStateWrite) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:PutItem'],
          resources: [this.matchStateTable.tableArn],
        }),
      );
    }

    if (props.matchMoveLogRead) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:Query'],
          resources: [this.matchMoveLogTable.tableArn],
        }),
      );
    }

    if (props.matchMoveLogWrite) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['dynamodb:PutItem'],
          resources: [this.matchMoveLogTable.tableArn],
        }),
      );
    }

    return fn;
  }
}
