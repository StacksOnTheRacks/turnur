import { describe, expect, it } from 'vitest';

import { DEV_FIXTURE_KEY_HASH } from './constants';
import { hashSdkKey } from './hash-sdk-key';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../../test-fixtures/dev-game-key';

describe('hashSdkKey', () => {
  it('returns SHA-256 lowercase hex of the full key string', () => {
    expect(hashSdkKey(DEV_FIXTURE_PLAINTEXT_SDK_KEY)).toBe(DEV_FIXTURE_KEY_HASH);
  });
});
