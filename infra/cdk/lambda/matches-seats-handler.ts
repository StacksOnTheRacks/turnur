/**
 * POST /v1/matches/{matchId}/seats — create a seat (server-issued seatId).
 * GET /v1/matches/{matchId}/seats — list public roster + currentSeat.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type CreateSeatResponseBody = {
  seatId: string;
  currentSeat: null;
};

export type SeatRosterEntry = {
  seatId: string;
  createdAt: string;
};

export type ListSeatsResponseBody = {
  seats: SeatRosterEntry[];
  currentSeat: string | null;
};

type MatchErrorCode = 'match_not_found' | 'match_forbidden';

type MatchErrorBody = {
  code: MatchErrorCode;
  message: string;
  hint: string;
};

type CursorItem = {
  currentSeat?: string | null;
  seatOrder?: string[];
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function matchErrorResponse(
  statusCode: number,
  body: MatchErrorBody,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, body);
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

async function assertMatchOwnership(
  docClient: DynamoDBDocumentClient,
  matchRegistryTable: string,
  matchId: string,
  gameId: string,
): Promise<APIGatewayProxyResultV2 | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: matchRegistryTable,
      Key: { matchId },
    }),
  );

  if (!result.Item) {
    return buildMatchNotFoundResponse();
  }

  if (result.Item.gameId !== gameId) {
    return buildMatchForbiddenResponse();
  }

  return null;
}

async function handlePostSeats(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
): Promise<APIGatewayProxyResultV2> {
  const seatId = randomUUID();
  const createdAt = new Date().toISOString();

  const cursorResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: 'CURSOR' },
    }),
  );

  const existing = (cursorResult.Item ?? {}) as CursorItem;
  const currentSeat = existing.currentSeat ?? null;
  const seatOrder = [...(existing.seatOrder ?? []), seatId];

  await docClient.send(
    new PutCommand({
      TableName: matchStateTable,
      Item: {
        matchId,
        sk: `SEAT#${seatId}`,
        seatId,
        createdAt,
      },
    }),
  );

  await docClient.send(
    new PutCommand({
      TableName: matchStateTable,
      Item: {
        matchId,
        sk: 'CURSOR',
        currentSeat,
        seatOrder,
      },
    }),
  );

  const body: CreateSeatResponseBody = { seatId, currentSeat: null };
  return jsonResponse(201, body);
}

async function handleGetSeats(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
): Promise<APIGatewayProxyResultV2> {
  const cursorResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: 'CURSOR' },
    }),
  );

  if (!cursorResult.Item) {
    const body: ListSeatsResponseBody = { seats: [], currentSeat: null };
    return jsonResponse(200, body);
  }

  const cursor = cursorResult.Item as CursorItem;
  const currentSeat = cursor.currentSeat ?? null;
  const seatOrder = cursor.seatOrder ?? [];
  const seats: SeatRosterEntry[] = [];

  for (const id of seatOrder) {
    const seatResult = await docClient.send(
      new GetCommand({
        TableName: matchStateTable,
        Key: { matchId, sk: `SEAT#${id}` },
      }),
    );

    if (seatResult.Item?.seatId && seatResult.Item?.createdAt) {
      seats.push({
        seatId: String(seatResult.Item.seatId),
        createdAt: String(seatResult.Item.createdAt),
      });
    }
  }

  const body: ListSeatsResponseBody = { seats, currentSeat };
  return jsonResponse(200, body);
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

  const matchRegistryTable = process.env.MATCH_REGISTRY_TABLE_NAME;
  const matchStateTable = process.env.MATCH_STATE_TABLE_NAME;
  if (!matchRegistryTable) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }
  if (!matchStateTable) {
    throw new Error('MATCH_STATE_TABLE_NAME is not configured');
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const ownershipError = await assertMatchOwnership(
    docClient,
    matchRegistryTable,
    matchId,
    auth.context.gameId,
  );
  if (ownershipError) {
    return ownershipError;
  }

  const method = event.requestContext.http.method;

  if (method === 'POST') {
    return handlePostSeats(docClient, matchStateTable, matchId);
  }

  if (method === 'GET') {
    return handleGetSeats(docClient, matchStateTable, matchId);
  }

  return jsonResponse(405, { message: 'Method Not Allowed' });
};
