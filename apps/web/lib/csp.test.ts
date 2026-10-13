import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '../middleware';

describe('document CSP nonce', () => {
  it('passes the generated policy to the renderer and replaces untrusted headers', () => {
    const response = middleware(new NextRequest('https://web.example/signin', { headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'nonce-attacker'", 'content-security-policy-report-only': "script-src 'nonce-another-attacker'" } }));
    const policy = response.headers.get('content-security-policy');
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    expect(nonce).toBeTruthy();
    expect(nonce).not.toBe('attacker');
    expect(policy).toContain(`'nonce-${nonce}'`);
    expect(policy).not.toContain('attacker');
    expect(response.headers.get('x-middleware-request-content-security-policy-report-only')).toBeNull();
  });

  it('generates a different nonce for each document', () => {
    const first = middleware(new NextRequest('https://web.example/signin'));
    const second = middleware(new NextRequest('https://web.example/signin'));
    expect(first.headers.get('x-middleware-request-x-nonce')).not.toBe(second.headers.get('x-middleware-request-x-nonce'));
  });
});
