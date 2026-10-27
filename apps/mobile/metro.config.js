// Sentry's Expo config = expo's default plus the serializer that stamps Debug IDs on bundles and source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withUniwindConfig } = require('uniwind/metro');

const config = getSentryExpoConfig(__dirname);

// Uniwind must be the outermost wrapper.
module.exports = withUniwindConfig(config, { cssEntryFile: './global.css' });
