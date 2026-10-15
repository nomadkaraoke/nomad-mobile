import { getCurrentUserApiUsersMeGet, listCreditPackagesApiUsersCreditsPackagesGet } from './client';

export * from './client';
export { ApiError, configureClient, type ClientDeps } from './configure';

// Readable facades over FastAPI's generated operation names.
export const getMe = async () => (await getCurrentUserApiUsersMeGet()).data;

export const listCreditPackages = async () => (await listCreditPackagesApiUsersCreditsPackagesGet()).data;
