import { validateCloudflareApiUrl } from './cloudflare-env.mjs';

try {
  validateCloudflareApiUrl(process.env['NEXT_PUBLIC_API_URL']);
} catch (error) {
  // Never echo the configured value: a malformed URL may contain credentials.
  console.error(error.message);
  process.exitCode = 1;
}
