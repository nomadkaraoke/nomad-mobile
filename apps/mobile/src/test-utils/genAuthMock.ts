// Shared jest mock for gen's sign-in facades: tests import `gen` and drive each call.
import * as apiGen from '@nomad/api-gen';

export const gen = apiGen as jest.Mocked<typeof apiGen>;

export const session = (email = 'me@example.com'): apiGen.GenSession => ({
  token: `tok-${email}`,
  email,
  credits: 1,
  creditsGranted: 1,
});

export const apiError = (status: number, detail: unknown) => new apiGen.ApiError(status, detail);
