/**
 * GET /v1/matches/{matchId}/turn — read current turn designation.
 * PUT /v1/matches/{matchId}/turn — designate current seat.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type TurnResponseBody = {
  currentSeat: string | null;
};

type MatchErrorCode = 'match_not_found' | 'match_forbidden';

type MatchErrorBody = {
  code: MatchErrorCode;
  message: string;
  hint: string;
};

type InvalidRequestBody = {
  code: 'invalid_request';
  message: string;
  hint: string;
};

type SeatNotFoundBody = {
  code: 'seat_not_found';
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

function buildInvalidRequestResponse(): APIGatewayProxyResultV2 {
  const body: InvalidRequestBody = {
    code: 'invalid_request',
    message: 'Invalid request',
    hint: 'Provide a seatId in the request body.',
  };
  return jsonResponse(400, body);
}

function buildSeatNotFoundResponse(): APIGatewayProxyResultV2 {
  const body: SeatNotFoundBody = {
    code: 'seat_not_found',
    message: 'Seat not found',
    hint: 'Create the seat via POST /v1/matches/{matchId}/seats before designating it or submitting a move.',
  };
  return jsonResponse(404, body);
}

function parseSeatId(body: string | undefined): string | null {
  if (body === undefined || body === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as { seatId?: unknown };
    if (typeof parsed.seatId !== 'string') {
      return null;
    }
    const trimmed = parsed.seatId.trim();
    if (trimmed === '') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
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

async function handleGetTurn(
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

  if (!cursorResult.Item || cursorResult.Item.currentSeat == null) {
    const body: TurnResponseBody = { currentSeat: null };
    return jsonResponse(200, body);
  }

  const body: TurnResponseBody = {
    currentSeat: String(cursorResult.Item.currentSeat),
  };
  return jsonResponse(200, body);
}

async function handlePutTurn(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  const seatId = parseSeatId(body);
  if (seatId === null) {
    return buildInvalidRequestResponse();
  }

  const seatResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: `SEAT#${seatId}` },
    }),
  );

  if (!seatResult.Item) {
    return buildSeatNotFoundResponse();
  }

  const cursorResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: 'CURSOR' },
    }),
  );

  const existing = (cursorResult.Item ?? {}) as CursorItem;

  await docClient.send(
    new PutCommand({
      TableName: matchStateTable,
      Item: {
        matchId,
        sk: 'CURSOR',
        currentSeat: seatId,
        seatOrder: existing.seatOrder ?? [],
      },
    }),
  );

  const responseBody: TurnResponseBody = { currentSeat: seatId };
  return jsonResponse(200, responseBody);
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

  if (method === 'GET') {
    return handleGetTurn(docClient, matchStateTable, matchId);
  }

  if (method === 'PUT') {
    return handlePutTurn(docClient, matchStateTable, matchId, event.body);
  }

  return jsonResponse(405, { message: 'Method Not Allowed' });
};
