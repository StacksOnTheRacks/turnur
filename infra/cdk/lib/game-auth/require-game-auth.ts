import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { SDK_KEY_FORMAT_REGEX } from './constants';
import {
  buildGameAuthInvalidResponse,
  buildGameAuthRequiredResponse,
} from './game-auth-response';
import { hashSdkKey } from './hash-sdk-key';
import type { GameAuthResult } from './types';

const BEARER_PREFIX = 'Bearer ';

type ParsedAuthorization =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'token'; token: string };

function authorizationHeader(
  headers: APIGatewayProxyEventV2['headers'],
): string | undefined {
  if (!headers) {
    return undefined;
  }
  return headers.authorization ?? headers.Authorization;
}

function parseBearerToken(headerValue: string | undefined): ParsedAuthorization {
  if (headerValue === undefined) {
    return { kind: 'missing' };
  }
  if (!headerValue.startsWith(BEARER_PREFIX)) {
    return { kind: 'invalid' };
  }
  const token = headerValue.slice(BEARER_PREFIX.length);
  if (token.length === 0) {
    return { kind: 'invalid' };
  }
  return { kind: 'token', token };
}

export type RequireGameAuthOptions = {
  tableName?: string;
  docClient?: DynamoDBDocumentClient;
};

export async function requireGameAuth(
  event: Pick<APIGatewayProxyEventV2, 'headers'>,
  options: RequireGameAuthOptions = {},
): Promise<GameAuthResult> {
  const parsed = parseBearerToken(authorizationHeader(event.headers));

  if (parsed.kind === 'missing') {
    return { ok: false, response: buildGameAuthRequiredResponse() };
  }
  if (parsed.kind === 'invalid') {
    return { ok: false, response: buildGameAuthInvalidResponse() };
  }
  if (!SDK_KEY_FORMAT_REGEX.test(parsed.token)) {
    return { ok: false, response: buildGameAuthInvalidResponse() };
  }

  const tableName = options.tableName ?? process.env.GAME_REGISTRY_TABLE_NAME;
  if (!tableName) {
    return { ok: false, response: buildGameAuthInvalidResponse() };
  }

  const docClient =
    options.docClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const keyHash = hashSdkKey(parsed.token);
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { keyHash },
    }),
  );

  const gameId = result.Item?.gameId;
  if (typeof gameId !== 'string' || gameId.length === 0) {
    return { ok: false, response: buildGameAuthInvalidResponse() };
  }

  return { ok: true, context: { gameId } };
}
