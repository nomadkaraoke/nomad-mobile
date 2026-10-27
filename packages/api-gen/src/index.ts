// eslint-disable-next-line import/export -- the facade CreditPackage below deliberately shadows the generated one
export * from './client';
export { ApiError, configureClient, isApiError, type ClientDeps } from './configure';

// Zod schemas for responses the OpenAPI snapshot doesn't type (or types too loosely).
export { AudioResultSchema, type AudioResult } from './overrides/audioSearch';
export {
  CompleteReviewSchema,
  CorrectionDataSchema,
  InstrumentalUrlsSchema,
  PreviewRequestSchema,
  PreviewStatusSchema,
  VocalsPeaksSchema,
  WaveformDataSchema,
} from './overrides/review';
export { CreditPackagesSchema, WebLinkSchema } from './overrides/credits';
export { JobDetailSchema, JobSummarySchema, type JobDetail, type JobSummary } from './overrides/jobs';

// Readable facades over FastAPI's generated operation names. Every one throws ApiError.
export * from './facades/auth';
// Explicit: the facade's camelCase CreditPackage replaces the generated one of the same name.
export {
  createAppCheckout,
  getCreditCatalog,
  listCreditPackages,
  type CreditCatalog,
  // eslint-disable-next-line import/export
  type CreditPackage,
  type WebLink,
} from './facades/credits';
export * from './facades/make';
export * from './facades/jobs';
export * from './facades/requests';
export * from './facades/review';
export * from './facades/push';
export * from './facades/account';
