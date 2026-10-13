import { describe, expect, it } from 'vitest';
import { validateCloudflareApiUrl } from '../scripts/cloudflare-env.mjs';

describe('Cloudflare release API URL', () => {
  it.each([undefined, '', '  ', 'not a URL', 'http://api.example.com', 'https://localhost:8080', 'https://127.0.0.1:8080', 'https://[::1]:8080', 'https://a.localhost', 'https://user:password@api.example.com', 'https://api.example.com?token=secret', 'https://api.example.com#fragment'])('rejects an unusable or credential-bearing release input', (value) => {
    expect(() => validateCloudflareApiUrl(value)).toThrow();
  });
  it.each(['https://api.example.com', 'https://api.example.com/v1/'])('accepts a hosted API base', (value) => {
    expect(() => validateCloudflareApiUrl(value)).not.toThrow();
  });
});
