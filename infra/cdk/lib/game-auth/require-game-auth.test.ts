import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from './constants';
import { requireGameAuth } from './require-game-auth';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../../test-fixtures/dev-game-key';

const TABLE_NAME = 'GameRegistryTest';

function eventWithAuth(value: string | undefined): Pick<APIGatewayProxyEventV2, 'headers'> {
  if (value === undefined) {
    return { headers: {} };
  }
  return { headers: { authorization: value } };
}

function parseAuthBody(result: {
  ok: false;
  response: APIGatewayProxyResultV2;
}): {
  code: string;
  message: string;
  hint: string;
} {
  const response = result.response;
  if (typeof response === 'string' || !response.body) {
    throw new Error('expected structured auth error response');
  }
  return JSON.parse(response.body);
}

function authStatusCode(response: APIGatewayProxyResultV2): number {
  if (typeof response === 'string') {
    throw new Error('expected structured auth error response');
  }
  return response.statusCode ?? 0;
}

function authBody(response: APIGatewayProxyResultV2): string {
  if (typeof response === 'string') {
    throw new Error('expected structured auth error response');
  }
  return response.body ?? '';
}

describe('requireGameAuth', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
  });

  const docClient = { send } as unknown as DynamoDBDocumentClient;

  it('returns gameId for a valid registered SDK key', async () => {
    send.mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } });

    const result = await requireGameAuth(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      { tableName: TABLE_NAME, docClient },
    );

    expect(result).toEqual({ ok: true, context: { gameId: DEV_FIXTURE_GAME_ID } });
    expect(send).toHaveBeenCalledWith(expect.any(GetCommand));
  });

  it('returns game_auth_required when Authorization is absent', async () => {
    const result = await requireGameAuth(eventWithAuth(undefined), {
      tableName: TABLE_NAME,
      docClient,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(authStatusCode(result.response)).toBe(401);
    expect(parseAuthBody(result)).toMatchObject({ code: 'game_auth_required' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns game_auth_invalid for empty Bearer token', async () => {
    const result = await requireGameAuth(eventWithAuth('Bearer '), {
      tableName: TABLE_NAME,
      docClient,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(parseAuthBody(result)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns game_auth_invalid for non-Bearer scheme', async () => {
    const result = await requireGameAuth(
      eventWithAuth(`Basic ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      { tableName: TABLE_NAME, docClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(parseAuthBody(result)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns game_auth_invalid for malformed SDK key without DynamoDB lookup', async () => {
    const result = await requireGameAuth(eventWithAuth('Bearer turnur_sk_not-valid'), {
      tableName: TABLE_NAME,
      docClient,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(parseAuthBody(result)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns game_auth_invalid when registry lookup misses', async () => {
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await requireGameAuth(
      eventWithAuth('Bearer turnur_sk_11111111111111111111111111111111'),
      { tableName: TABLE_NAME, docClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(parseAuthBody(result)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not echo the presented token in error responses', async () => {
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await requireGameAuth(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      { tableName: TABLE_NAME, docClient },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected auth failure');
    }
    expect(authBody(result.response)).not.toContain('turnur_sk_');
    expect(authBody(result.response)).not.toContain('keyHash');
  });
});
