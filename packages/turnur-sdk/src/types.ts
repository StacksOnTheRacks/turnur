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

export type ApiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};
