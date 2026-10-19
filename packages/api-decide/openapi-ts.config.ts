import { defineConfig } from '@hey-api/openapi-ts';

const plugins = [{ name: '@hey-api/client-fetch', throwOnError: true }, '@hey-api/typescript', '@hey-api/sdk', '@tanstack/react-query'] as const;

// Two specs, one package: the main decide API and the separate search service (own client instance each).
export default defineConfig([
  { input: '../../openapi/decide.json', output: { path: 'src/client' }, plugins: [...plugins] },
  { input: '../../openapi/decide-search.json', output: { path: 'src/search-client' }, plugins: [...plugins] },
]);
