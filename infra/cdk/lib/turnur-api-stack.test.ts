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

class MatchRegistryWriteProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchWriteProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchRegistryWrite: true,
    });
  }
}

class MatchRegistryReadProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchReadProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchRegistryRead: true,
    });
  }
}

class MatchStateReadProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchStateReadProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchStateRead: true,
    });
  }
}

class MatchStateWriteProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchStateWriteProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchStateWrite: true,
    });
  }
}

class MatchMoveLogReadProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchMoveLogReadProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchMoveLogRead: true,
    });
  }
}

class MatchMoveLogWriteProbeStack extends TurnurApiStack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    this.createProtectedNodejsFunction('MatchMoveLogWriteProbeFn', {
      entry: path.join(__dirname, '../lambda/health-handler.ts'),
      handler: 'handler',
      matchMoveLogWrite: true,
    });
  }
}

function lambdaPolicyStatements(
  template: Template,
  logicalIdFragment: string,
): Array<{ Action?: string | string[]; Resource?: string | string[] }> {
  const functions = template.findResources('AWS::Lambda::Function');
  const fnEntry = Object.entries(functions).find(([id]) => id.includes(logicalIdFragment));
  if (!fnEntry) {
    return [];
  }

  const roleRef = fnEntry[1].Properties?.Role as
    | { 'Fn::GetAtt'?: [string, string] }
    | { Ref?: string }
    | undefined;
  const roleLogicalId =
    roleRef && 'Fn::GetAtt' in roleRef
      ? roleRef['Fn::GetAtt']?.[0]
      : roleRef && 'Ref' in roleRef
        ? roleRef.Ref
        : undefined;

  if (!roleLogicalId) {
    return [];
  }

  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies).flatMap((policy) => {
    const roles = policy.Properties?.Roles ?? [];
    const attached = roles.some(
      (role: { Ref?: string }) => role.Ref === roleLogicalId,
    );
    if (!attached) {
      return [];
    }
    return policy.Properties?.PolicyDocument?.Statement ?? [];
  });
}

function hasActionOnTableResource(
  statements: Array<{ Action?: string | string[]; Resource?: string | string[] }>,
  action: string,
  tableLogicalIdFragment: string,
): boolean {
  return statements.some((statement) => {
    const actions = Array.isArray(statement.Action)
      ? statement.Action
      : [statement.Action];
    if (!actions.includes(action)) {
      return false;
    }
    const resources = Array.isArray(statement.Resource)
      ? statement.Resource
      : [statement.Resource];
    return resources.some(
      (resource) =>
        typeof resource === 'object' &&
        resource !== null &&
        'Fn::GetAtt' in resource &&
        Array.isArray((resource as { 'Fn::GetAtt': string[] })['Fn::GetAtt']) &&
        (resource as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0].includes(tableLogicalIdFragment),
    );
  });
}

function lambdaEnvVars(template: Template, logicalIdFragment: string): Record<string, unknown> {
  const functions = template.findResources('AWS::Lambda::Function');
  const match = Object.entries(functions).find(([id]) => id.includes(logicalIdFragment));
  return match?.[1]?.Properties?.Environment?.Variables ?? {};
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

    template.resourceCountIs('AWS::ApiGatewayV2::Route', 12);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/health',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/game/me',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /v1/matches',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/matches/{matchId}',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /v1/matches/{matchId}/seats',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/matches/{matchId}/seats',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/matches/{matchId}/turn',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /v1/matches/{matchId}/turn',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /v1/matches/{matchId}/moves',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'PUT /v1/matches/{matchId}/seats/{seatId}/view',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/matches/{matchId}/seats/{seatId}/view',
      AuthorizationType: 'NONE',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /v1/matches/{matchId}/moves',
      AuthorizationType: 'NONE',
    });

    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 9);
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

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          GAME_REGISTRY_TABLE_NAME: Match.anyValue(),
          MATCH_REGISTRY_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    const permissions = template.findResources('AWS::Lambda::Permission');
    expect(Object.keys(permissions).length).toBeGreaterThanOrEqual(1);
  });

  it('synthesizes GameRegistry, MatchRegistry, MatchState, MatchMoveLog tables and dev fixture seed', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackGameRegistryTest');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 4);
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
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'matchId', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'matchId', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'matchId', KeyType: 'HASH' },
        { AttributeName: 'seq', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'matchId', AttributeType: 'S' },
        { AttributeName: 'seq', AttributeType: 'N' },
      ],
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
    template.hasOutput('MatchStateTableName', {});
    template.hasOutput('MatchStateTableArn', {});
    template.hasOutput('MatchMoveLogTableName', {});
    template.hasOutput('MatchMoveLogTableArn', {});
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

  it('protected Lambda factory with matchRegistryWrite grants PutItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchRegistryWriteProbeStack(
      app,
      'TurnurApiStackMatchRegistryWriteTest',
    );
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          GAME_REGISTRY_TABLE_NAME: Match.anyValue(),
          MATCH_REGISTRY_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:PutItem',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('protected Lambda factory with matchRegistryRead grants GetItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchRegistryReadProbeStack(
      app,
      'TurnurApiStackMatchRegistryReadTest',
    );
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          GAME_REGISTRY_TABLE_NAME: Match.anyValue(),
          MATCH_REGISTRY_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    const policies = template.findResources('AWS::IAM::Policy');
    const getItemOnMatchRegistry = Object.values(policies).some((policy) => {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      return statements.some(
        (statement: { Action?: string | string[]; Resource?: string | string[] }) => {
          const actions = Array.isArray(statement.Action)
            ? statement.Action
            : [statement.Action];
          if (!actions.includes('dynamodb:GetItem')) {
            return false;
          }
          const resources = Array.isArray(statement.Resource)
            ? statement.Resource
            : [statement.Resource];
          return resources.some(
            (resource) =>
              typeof resource === 'object' &&
              resource !== null &&
              'Fn::GetAtt' in resource &&
              Array.isArray((resource as { 'Fn::GetAtt': string[] })['Fn::GetAtt']) &&
              (resource as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0].includes('MatchRegistry'),
          );
        },
      );
    });
    expect(getItemOnMatchRegistry).toBe(true);
  });

  it('shipped handlers do not receive MatchState or MatchMoveLog env or IAM', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackShippedHandlerIsolationTest');
    const template = Template.fromStack(stack);

    for (const fnId of ['HealthFn', 'GameMeFn', 'MatchesAttachFn', 'MatchesProbeFn']) {
      const env = lambdaEnvVars(template, fnId);
      expect(env).not.toHaveProperty('MATCH_STATE_TABLE_NAME');
      expect(env).not.toHaveProperty('MATCH_MOVE_LOG_TABLE_NAME');

      const statements = lambdaPolicyStatements(template, fnId);
      expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(false);
      expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(false);
      expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
      expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
      expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
      expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(false);
    }
  });

  it('protected Lambda factory with matchStateRead grants GetItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchStateReadProbeStack(app, 'TurnurApiStackMatchStateReadTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchStateReadProbeFn');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          MATCH_STATE_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
  });

  it('protected Lambda factory with matchStateWrite grants PutItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchStateWriteProbeStack(app, 'TurnurApiStackMatchStateWriteTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchStateWriteProbeFn');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          MATCH_STATE_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
  });

  it('protected Lambda factory with matchMoveLogRead grants Query and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchMoveLogReadProbeStack(app, 'TurnurApiStackMatchMoveLogReadTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchMoveLogReadProbeFn');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          MATCH_MOVE_LOG_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
  });

  it('protected Lambda factory with matchMoveLogWrite grants PutItem and sets env var', () => {
    const app = new cdk.App();
    const stack = new MatchMoveLogWriteProbeStack(app, 'TurnurApiStackMatchMoveLogWriteTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchMoveLogWriteProbeFn');

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          MATCH_MOVE_LOG_TABLE_NAME: Match.anyValue(),
        }),
      },
    });

    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
  });

  it('MatchesSeatsFn receives MatchState and MatchRegistry env and IAM without MatchMoveLog or Query', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMatchesSeatsTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchesSeatsFn');

    const env = lambdaEnvVars(template, 'MatchesSeatsFn');
    expect(env).toMatchObject({
      GAME_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_STATE_TABLE_NAME: expect.anything(),
    });
    expect(env).not.toHaveProperty('MATCH_MOVE_LOG_TABLE_NAME');

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchRegistry')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(false);
  });

  it('MatchesTurnFn receives MatchState and MatchRegistry env and IAM without MatchMoveLog', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMatchesTurnTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchesTurnFn');

    const env = lambdaEnvVars(template, 'MatchesTurnFn');
    expect(env).toMatchObject({
      GAME_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_STATE_TABLE_NAME: expect.anything(),
    });
    expect(env).not.toHaveProperty('MATCH_MOVE_LOG_TABLE_NAME');

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchRegistry')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(false);
  });

  it('MatchesMovesFn receives MatchMoveLog and MatchState read env and IAM without MatchState write', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMatchesMovesTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchesMovesFn');

    const env = lambdaEnvVars(template, 'MatchesMovesFn');
    expect(env).toMatchObject({
      GAME_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_STATE_TABLE_NAME: expect.anything(),
      MATCH_MOVE_LOG_TABLE_NAME: expect.anything(),
    });

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchRegistry')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
  });

  it('MatchesViewFn receives MatchState and MatchRegistry env and IAM without MatchMoveLog or Query', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMatchesViewTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchesViewFn');

    const env = lambdaEnvVars(template, 'MatchesViewFn');
    expect(env).toMatchObject({
      GAME_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_STATE_TABLE_NAME: expect.anything(),
    });
    expect(env).not.toHaveProperty('MATCH_MOVE_LOG_TABLE_NAME');

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchRegistry')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(false);
  });

  it('MatchesMoveLogFn receives MatchRegistry and MatchMoveLog read env and IAM without MatchState or write', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMatchesMoveLogTest');
    const template = Template.fromStack(stack);
    const statements = lambdaPolicyStatements(template, 'MatchesMoveLogFn');

    const env = lambdaEnvVars(template, 'MatchesMoveLogFn');
    expect(env).toMatchObject({
      GAME_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_REGISTRY_TABLE_NAME: expect.anything(),
      MATCH_MOVE_LOG_TABLE_NAME: expect.anything(),
    });
    expect(env).not.toHaveProperty('MATCH_STATE_TABLE_NAME');

    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchRegistry')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchMoveLog')).toBe(true);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:Query', 'MatchState')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:PutItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:GetItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:UpdateItem', 'MatchMoveLog')).toBe(false);
    expect(hasActionOnTableResource(statements, 'dynamodb:DeleteItem', 'MatchMoveLog')).toBe(false);
  });

  it('does not register PUT PATCH or DELETE on /v1/matches/{matchId}/moves', () => {
    const app = new cdk.App();
    const stack = new TurnurApiStack(app, 'TurnurApiStackMoveLogRouteMethodsTest');
    const template = Template.fromStack(stack);
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const moveRoutes = Object.values(routes)
      .map((route) => route.Properties?.RouteKey as string)
      .filter((routeKey) => routeKey?.includes('/moves'));

    expect(moveRoutes).toContain('GET /v1/matches/{matchId}/moves');
    expect(moveRoutes).toContain('POST /v1/matches/{matchId}/moves');
    expect(moveRoutes.filter((routeKey) => routeKey.startsWith('PUT'))).toHaveLength(0);
    expect(moveRoutes.filter((routeKey) => routeKey.startsWith('PATCH'))).toHaveLength(0);
    expect(moveRoutes.filter((routeKey) => routeKey.startsWith('DELETE'))).toHaveLength(0);
    expect(moveRoutes.some((routeKey) => routeKey.includes('/moves/{'))).toBe(false);
  });
});
