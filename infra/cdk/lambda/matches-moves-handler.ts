/**
 * POST /v1/matches/{matchId}/moves — append an on-turn move to the move log.
 */
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type MoveCreateResponseBody = {
  seq: number;
  seatId: string;
  createdAt: string;
  currentSeat: string;
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

type IllegalTurnBody = {
  code: 'illegal_turn';
  message: string;
  hint: string;
};

type CursorItem = {
  currentSeat?: string | null;
};

type ParsedMoveBody =
  | { ok: false; response: APIGatewayProxyResultV2 }
  | { ok: true; seatId: string; payload: unknown };

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
    hint: 'Provide seatId and payload in the request body.',
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

function buildIllegalTurnResponse(): APIGatewayProxyResultV2 {
  const body: IllegalTurnBody = {
    code: 'illegal_turn',
    message: 'Illegal turn',
    hint: 'Submit a move only for the current seat. Designate a seat with PUT /v1/matches/{matchId}/turn first if none is current.',
  };
  return jsonResponse(409, body);
}

function parseMoveBody(body: string | undefined): ParsedMoveBody {
  if (body === undefined || body === '') {
    return { ok: false, response: buildInvalidRequestResponse() };
  }
  try {
    const parsed = JSON.parse(body) as { seatId?: unknown; payload?: unknown };
    if (typeof parsed.seatId !== 'string') {
      return { ok: false, response: buildInvalidRequestResponse() };
    }
    const trimmed = parsed.seatId.trim();
    if (trimmed === '') {
      return { ok: false, response: buildInvalidRequestResponse() };
    }
    if (!('payload' in parsed) || parsed.payload === null || parsed.payload === undefined) {
      return { ok: false, response: buildInvalidRequestResponse() };
    }
    return { ok: true, seatId: trimmed, payload: parsed.payload };
  } catch {
    return { ok: false, response: buildInvalidRequestResponse() };
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

async function handlePostMove(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchMoveLogTable: string,
  matchId: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  const parsed = parseMoveBody(body);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { seatId, payload } = parsed;

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

  const cursor = (cursorResult.Item ?? {}) as CursorItem;
  const currentSeat = cursor.currentSeat ?? null;

  if (currentSeat === null || seatId !== currentSeat) {
    return buildIllegalTurnResponse();
  }

  const lastSeqResult = await docClient.send(
    new QueryCommand({
      TableName: matchMoveLogTable,
      KeyConditionExpression: 'matchId = :matchId',
      ExpressionAttributeValues: { ':matchId': matchId },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );

  const lastSeq =
    lastSeqResult.Items && lastSeqResult.Items.length > 0
      ? Number(lastSeqResult.Items[0].seq)
      : 0;
  const nextSeq = lastSeq + 1;
  const createdAt = new Date().toISOString();

  try {
    await docClient.send(
      new PutCommand({
        TableName: matchMoveLogTable,
        Item: {
          matchId,
          seq: nextSeq,
          seatId,
          payload,
          createdAt,
        },
        ConditionExpression: 'attribute_not_exists(seq)',
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return buildIllegalTurnResponse();
    }
    throw error;
  }

  const responseBody: MoveCreateResponseBody = {
    seq: nextSeq,
    seatId,
    createdAt,
    currentSeat,
  };
  return jsonResponse(201, responseBody);
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
  const matchMoveLogTable = process.env.MATCH_MOVE_LOG_TABLE_NAME;
  if (!matchRegistryTable) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }
  if (!matchStateTable) {
    throw new Error('MATCH_STATE_TABLE_NAME is not configured');
  }
  if (!matchMoveLogTable) {
    throw new Error('MATCH_MOVE_LOG_TABLE_NAME is not configured');
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
    return handlePostMove(
      docClient,
      matchStateTable,
      matchMoveLogTable,
      matchId,
      event.body,
    );
  }

  return jsonResponse(405, { message: 'Method Not Allowed' });
};
