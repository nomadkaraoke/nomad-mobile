import { ApiError } from '@nomad/api-gen';

export interface AuthApi {
  sendCode(email: string, locale: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<{ token: string }>;
}

export const MOCK_CODE = '123456';

/** Stand-in for gen POST /api/users/auth/send-code + verify-code (spec §4.1, built in Phase 1). */
export const mockAuthApi: AuthApi = {
  async sendCode() {
    await new Promise((r) => setTimeout(r, 300));
  },
  async verifyCode(email, code) {
    await new Promise((r) => setTimeout(r, 300));
    if (code !== MOCK_CODE) throw new ApiError(400, 'invalid_code');
    return { token: `mock-${email}` };
  },
};

export const isAuthMocked = () => process.env.EXPO_PUBLIC_AUTH_MOCK !== '0';

export function getAuthApi(): AuthApi {
  if (!isAuthMocked()) throw new Error('Real gen email-code auth lands in Phase 1 (spec §4.1)');
  return mockAuthApi;
}
