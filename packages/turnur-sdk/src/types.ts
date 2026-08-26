export type TurnurClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export type GameMeResponse = {
  gameId: string;
};

export type ApiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};
