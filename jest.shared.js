// Shared jest settings for workspace projects that render React Native.
// pnpm's hoisted node_modules ship some ESM-only deps (use-intl, @formatjs) that babel must transform.
module.exports = {
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|expo-router|@shopify|uniwind|use-intl|@formatjs|intl-messageformat|icu-minify|@nomad|@hey-api|@tanstack|standard-navigation|@sentry/react-native|posthog-react-native|@noble))',
  ],
};
