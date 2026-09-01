/**
 * GET /v1/matches/{matchId}/moves — read append-only move log for an owned match.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type MoveLogItem = {
  seq: number;
  seatId: string;
  payload: unknown;
  createdAt: string;
};

export type MatchesMoveLogResponseBody = {
  items: MoveLogItem[];
};

type MatchMoveLogErrorCode = 'match_not_found' | 'match_forbidden';

type MatchMoveLogErrorBody = {
  code: MatchMoveLogErrorCode;
  message: string;
  hint: string;
};

function matchErrorResponse(
  statusCode: number,
  body: MatchMoveLogErrorBody,
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

function mapMoveLogItem(item: Record<string, unknown>): MoveLogItem {
  return {
    seq: Number(item.seq),
    seatId: String(item.seatId),
    payload: item.payload,
    createdAt: String(item.createdAt),
  };
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

  const registryTableName = process.env.MATCH_REGISTRY_TABLE_NAME;
  if (!registryTableName) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }

  const moveLogTableName = process.env.MATCH_MOVE_LOG_TABLE_NAME;
  if (!moveLogTableName) {
    throw new Error('MATCH_MOVE_LOG_TABLE_NAME is not configured');
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const registryResult = await docClient.send(
    new GetCommand({
      TableName: registryTableName,
      Key: { matchId },
    }),
  );

  if (!registryResult.Item) {
    return buildMatchNotFoundResponse();
  }

  const { gameId } = registryResult.Item;
  if (gameId !== auth.context.gameId) {
    return buildMatchForbiddenResponse();
  }

  const queryResult = await docClient.send(
    new QueryCommand({
      TableName: moveLogTableName,
      KeyConditionExpression: 'matchId = :matchId',
      ExpressionAttributeValues: { ':matchId': matchId },
      ScanIndexForward: true,
    }),
  );

  const items = (queryResult.Items ?? []).map((item) =>
    mapMoveLogItem(item as Record<string, unknown>),
  );

  const body: MatchesMoveLogResponseBody = { items };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
};
