import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: '../../openapi/decide.json',
  output: { path: 'src/client' },
  plugins: [{ name: '@hey-api/client-fetch', throwOnError: true }, '@hey-api/typescript', '@hey-api/sdk', '@tanstack/react-query'],
});
