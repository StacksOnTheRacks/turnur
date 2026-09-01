export type TurnurClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export type GameMeResponse = {
  gameId: string;
};

export type MatchCreateResponse = {
  matchId: string;
};

export type MatchGetResponse = {
  matchId: string;
  status: string;
  createdAt: string;
};

export type MatchSeatCreateResponse = {
  seatId: string;
  currentSeat: string | null;
};

export type MatchSeatListResponse = {
  seats: Array<{ seatId: string; createdAt: string }>;
  currentSeat: string | null;
};

export type MatchTurnResponse = {
  currentSeat: string | null;
};

export type MatchMoveCreateResponse = {
  seq: number;
  seatId: string;
  createdAt: string;
  currentSeat: string | null;
};

export type MatchViewPutResponse = {
  seatId: string;
};

export type MatchViewGetResponse = {
  seatId: string;
  view: unknown;
};

export type MatchMovesListResponse = {
  items: Array<{ seq: number; seatId: string; payload: unknown; createdAt: string }>;
};

export type ApiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};
