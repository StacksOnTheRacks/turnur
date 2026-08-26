/** ADR-002 SDK key prefix. */
export const SDK_KEY_PREFIX = 'turnur_sk_';

/** ADR-002: turnur_sk_ + exactly 32 lowercase hex characters. */
export const SDK_KEY_FORMAT_REGEX = /^turnur_sk_[0-9a-f]{32}$/;

/** Stable game id for the dev/test fixture row seeded in GameRegistry. */
export const DEV_FIXTURE_GAME_ID = 'dev-fixture';

/** Precomputed SHA-256 hex of the dev fixture plaintext key (see test-fixtures/). */
export const DEV_FIXTURE_KEY_HASH =
  '8f9bd32f48ff076b96de35fcb52bf0b79af1937b289c86aeec4fd4d12cafd2c6';
