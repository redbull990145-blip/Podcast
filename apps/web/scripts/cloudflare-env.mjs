/** Validate release inputs before emitting a worker with an unusable API URL. */
export function validateCloudflareApiUrl(value) {
  if (!value?.trim()) throw new Error('NEXT_PUBLIC_API_URL must be set in the Cloudflare build variables.');
  let url;
  try { url = new URL(value); }
  catch { throw new Error('NEXT_PUBLIC_API_URL must be a valid HTTPS API base URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_API_URL must be an HTTPS API base URL without credentials, a query, or a fragment.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname.startsWith('127.')) {
    throw new Error('NEXT_PUBLIC_API_URL must point to the hosted API, not a loopback address.');
  }
}
