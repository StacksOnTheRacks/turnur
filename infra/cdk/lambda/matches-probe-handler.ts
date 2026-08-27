/**
 * GET /v1/matches/{matchId} — read probe; returns match metadata when owned by authenticated game.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type MatchesProbeResponseBody = {
  matchId: string;
  status: string;
  createdAt: string;
};

type MatchProbeErrorCode = 'match_not_found' | 'match_forbidden';

type MatchProbeErrorBody = {
  code: MatchProbeErrorCode;
  message: string;
  hint: string;
};

function matchErrorResponse(
  statusCode: number,
  body: MatchProbeErrorBody,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function buildMatchNotFoundResponse(): APIGatewayProxyResultV2 {
  return matchErrorResponse(404, {
    code: 'match_not_found',
    message: 'Match not found',
    hint: 'Verify the matchId exists and was created via POST /v1/matches for your game.',
  });
}

function buildMatchForbiddenResponse(): APIGatewayProxyResultV2 {
  return matchErrorResponse(403, {
    code: 'match_forbidden',
    message: 'Match belongs to another game',
    hint: 'Use the SDK key for the game that created this match.',
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireGameAuth(event);
  if (!auth.ok) {
    return auth.response;
  }

  const matchId = event.pathParameters?.matchId;
  if (!matchId) {
    return buildMatchNotFoundResponse();
  }

  const tableName = process.env.MATCH_REGISTRY_TABLE_NAME;
  if (!tableName) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { matchId },
    }),
  );

  if (!result.Item) {
    return buildMatchNotFoundResponse();
  }

  const { gameId, status, createdAt } = result.Item;
  if (gameId !== auth.context.gameId) {
    return buildMatchForbiddenResponse();
  }

  const body: MatchesProbeResponseBody = {
    matchId,
    status: String(status),
    createdAt: String(createdAt),
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
};
