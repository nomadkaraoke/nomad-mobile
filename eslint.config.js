const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

const shopifyBan = {
  paths: [
    { name: '@shopify/flash-list', message: 'Use <List> from @nomad/ui' },
    { name: '@shopify/react-native-skia', message: 'Use wrappers from @nomad/ui' },
  ],
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/src/client/**',
      '**/dist/**',
      '**/coverage/**',
      '.superpowers/**',
      'apps/mobile/.expo/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
    ],
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/core/**', 'packages/i18n/**', 'packages/api-*/**'],
    rules: { 'no-restricted-imports': ['error', shopifyBan] },
  },
  // No hardcoded user-facing strings: any non-whitespace JSX text literal is an error (use t('...')).
  {
    files: ['apps/mobile/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXText[value=/\\S/]', message: 'Use useTranslations(); no hardcoded strings.' },
      ],
    },
  },
]);
