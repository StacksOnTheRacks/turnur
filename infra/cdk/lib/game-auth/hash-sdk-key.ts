import { createHash } from 'crypto';

/** SHA-256 lowercase-hex digest of the full SDK key string (UTF-8). */
export function hashSdkKey(sdkKey: string): string {
  return createHash('sha256').update(sdkKey, 'utf8').digest('hex');
}
