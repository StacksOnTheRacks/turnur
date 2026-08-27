import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { describe, expect, it } from 'vitest';

import { DEV_FIXTURE_GAME_ID, DEV_FIXTURE_KEY_HASH } from './game-auth/constants';
import { TurnurApiStack } from './turnur-api-stack';

class ProtectedFnProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('AuthProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
    });
  }
}

describe('TurnurApiStack', () => {
  it('synthesizes HTTP API, Node 22 Lambda, and GET /v1/health route', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/health',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/game/me',
      AuthorizationType: 'NONE',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 2);
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          GAME_REGISTRY_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    const permissions = template.findResources('AWS::Lambda::Permission');
    expect(Object.keys(permissions).length).toBeGreaterThanOrEqual(1);
  });

  it('synthesizes GameRegistry and MatchRegistry DynamoDB tables and dev fixture seed', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackGameRegistryTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 2);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'keyHash', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'keyHash', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'matchId', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'matchId', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    });

    template.resourceCountIs('Custom::AWS', 1);
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain(DEV_FIXTURE_KEY_HASH);
    expect(templateJson).toContain(DEV_FIXTURE_GAME_ID);
    expect(templateJson).toContain('putItem');

    template.hasOutput('GameRegistryTableName', {});
    template.hasOutput('GameRegistryTableArn', {});
    template.hasOutput('MatchRegistryTableName', {});
    template.hasOutput('MatchRegistryTableArn', {});
  });

  it('protected Lambda factory grants GameRegistry GetItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new ProtectedFnProbeStack(app, 'TurnurApiStackProtectedFnTest');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          GAME_REGISTRY_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:GetItem',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });
});
