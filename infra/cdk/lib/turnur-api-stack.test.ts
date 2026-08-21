import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';

import { TurnurApiStack } from './turnur-api-stack';

describe('TurnurApiStack', () => {
  it('synthesizes HTTP API and Node 22 Lambda without routes or integrations', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
    });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 0);
    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 0);
  });
});
