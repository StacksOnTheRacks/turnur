/**
 * POST /v1/matches — attach (create) a match; returns server-generated matchId.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type MatchesAttachResponseBody = { matchId: string };

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireGameAuth(event);
  if (!auth.ok) {
    return auth.response;
  }

  const matchId = randomUUID();
  const createdAt = new Date().toISOString();
  const tableName = process.env.MATCH_REGISTRY_TABLE_NAME;
  if (!tableName) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        matchId,
        gameId: auth.context.gameId,
        status: 'created',
        createdAt,
      },
    }),
  );

  const body: MatchesAttachResponseBody = { matchId };

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
};
