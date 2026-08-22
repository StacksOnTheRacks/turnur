import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { TurnurApiStack } from './turnur-api-stack';

describe('TurnurApiStack', () => {
  it('synthesizes HTTP API, Node 22 Lambda, and GET /v1/health route', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
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
});
