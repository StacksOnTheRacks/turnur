import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { DEV_FIXTURE_GAME_ID, DEV_FIXTURE_KEY_HASH } from './game-auth/constants';
import { TurnurApiStack } from './turnur-api-stack';

describe('TurnurApiStack', () => {
  it('synthesizes HTTP API, Node 22 Lambda, and GET /v1/health route', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/health',
      AuthorizationType: 'NONE',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);

    const permissions = template.findResources('AWS::Lambda::Permission');
    expect(Object.keys(permissions).length).toBeGreaterThanOrEqual(1);
  });

  it('synthesizes GameRegistry DynamoDB table and dev fixture seed', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackGameRegistryTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'keyHash', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'keyHash', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    });

    template.resourceCountIs('Custom::AWS', 1);
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).toContain(DEV_FIXTURE_KEY_HASH);
    expect(templateJson).toContain(DEV_FIXTURE_GAME_ID);
    expect(templateJson).toContain('putItem');

    template.hasOutput('GameRegistryTableName', {});
    template.hasOutput('GameRegistryTableArn', {});
  });
});
