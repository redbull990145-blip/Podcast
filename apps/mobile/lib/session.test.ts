import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), verify: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(), invalidate: vi.fn() }));
vi.mock('./api', () => ({ api: { signUp: mocks.signUp, signIn: mocks.signIn, verifyEmail: mocks.verify } }));
vi.mock('./auth-token', () => ({ clearToken: mocks.clearToken, setToken: mocks.setToken, getToken: () => null, readOfflineSession: () => null, rememberVerifiedSession: vi.fn() }));
vi.mock('./connectivity', () => ({ isOnline: () => true }));
vi.mock('./player/store', () => ({ resetQueue: vi.fn(), setSyncState: vi.fn() }));
vi.mock('./session-lifecycle', () => ({ watchSessionLifecycle: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }), useMutation: (options: unknown) => options, useQuery: vi.fn() }));
beforeEach(() => { vi.resetModules(); Object.values(mocks).forEach((mock) => mock.mockReset()); });
type Mutation = { mutationFn: (input: Record<string, string>) => Promise<{ token: string | null }>; onSuccess: () => unknown };
describe('native verification contract', () => {
  it('does not store a null signup token when verification is required', async () => {
    mocks.signUp.mockResolvedValue({ token: null, user: { id: 'A' } });
    const session = await import('./session'); const signup = session.useSignUp() as unknown as Mutation;
    expect(await signup.mutationFn({ email: 'synthetic@test.invalid', name: 'Synthetic', password: 'synthetic-password' })).toMatchObject({ token: null });
    expect(mocks.setToken).not.toHaveBeenCalled();
  });
  it('stores authenticated signup and verification tokens, but retains an expired-code failure', async () => {
    mocks.signUp.mockResolvedValue({ token: 'synthetic-signup', user: { id: 'A' } });
    mocks.verify.mockRejectedValueOnce(new Error('Expired code')).mockResolvedValueOnce({ token: 'synthetic-verified', user: { id: 'A' } });
    const session = await import('./session'); const signup = session.useSignUp() as unknown as Mutation;
    await signup.mutationFn({}); expect(mocks.setToken).toHaveBeenCalledWith('synthetic-signup');
    const verify = session.useVerifyEmail() as unknown as Mutation;
    await expect(verify.mutationFn({})).rejects.toThrow('Expired code');
    expect(mocks.setToken).toHaveBeenCalledTimes(1); await verify.mutationFn({});
    expect(mocks.setToken).toHaveBeenLastCalledWith('synthetic-verified');
  });
});
