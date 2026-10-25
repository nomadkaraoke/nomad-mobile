// In-memory route table for expo-router's renderRouter, built from the real screen modules.
import * as tabsLayout from '../app/(tabs)/_layout';
import * as discover from '../app/(tabs)/discover';
import * as makeTab from '../app/(tabs)/make';
import * as me from '../app/(tabs)/me';
import * as tonight from '../app/(tabs)/tonight';
import * as rootLayout from '../app/_layout';
import * as connectLayout from '../app/discover/connect/_layout';
import * as connectApple from '../app/discover/connect/apple';
import * as connectHub from '../app/discover/connect/index';
import * as connectImportFile from '../app/discover/connect/import-file';
import * as connectLastfm from '../app/discover/connect/lastfm';
import * as connectListenBrainz from '../app/discover/connect/listenbrainz';
import * as connectPlaylist from '../app/discover/connect/playlist';
import * as connectScreenshot from '../app/discover/connect/screenshot';
import * as connectSpotifyExport from '../app/discover/connect/spotify-export';
import * as quiz from '../app/discover/quiz';
import * as voice from '../app/discover/voice';
import * as voiceSession from '../app/discover/voice-session';
import * as index from '../app/index';
import * as artistsAll from '../app/me/artists';
import * as setlistsIndex from '../app/me/setlists/index';
import * as setlistDetail from '../app/me/setlists/[id]';
import * as songHistory from '../app/me/history/[key]';
import * as sungBefore from '../app/me/sung-before';
import * as musicProfile from '../app/me/music-profile';
import * as voiceDebug from '../app/me/voice-debug';
import * as readyScreen from '../app/job/[id]';
import * as durationSheet from '../app/job/duration/[id]';
import * as makeFlow from '../app/make/new';
import * as signInCode from '../app/sign-in/code';
import * as signInEmail from '../app/sign-in/email';
import * as signInSheet from '../app/sign-in/index';
import * as song from '../app/song/[id]';

/** Stand-in for the review screen: the root layout declares the route, and its real module needs native audio. */
const reviewStub = { default: () => null };

export function appRoutes() {
  return {
    _layout: rootLayout,
    index,
    '(tabs)/_layout': tabsLayout,
    '(tabs)/discover': discover,
    '(tabs)/tonight': tonight,
    '(tabs)/make': makeTab,
    '(tabs)/me': me,
    'discover/quiz': quiz,
    'discover/connect/_layout': connectLayout,
    'discover/connect/index': connectHub,
    'discover/connect/apple': connectApple,
    'discover/connect/playlist': connectPlaylist,
    'discover/connect/screenshot': connectScreenshot,
    'discover/connect/spotify-export': connectSpotifyExport,
    'discover/connect/import-file': connectImportFile,
    'discover/connect/listenbrainz': connectListenBrainz,
    'discover/connect/lastfm': connectLastfm,
    'discover/voice': voice,
    'discover/voice-session': voiceSession,
    'me/music-profile': musicProfile,
    'me/artists': artistsAll,
    'me/history/[key]': songHistory,
    'me/sung-before': sungBefore,
    'me/setlists/index': setlistsIndex,
    'me/setlists/[id]': setlistDetail,
    'me/voice-debug': voiceDebug,
    'song/[id]': song,
    'make/new': makeFlow,
    'job/[id]': readyScreen,
    'job/duration/[id]': durationSheet,
    'review/[id]': reviewStub,
    'sign-in/index': signInSheet,
    'sign-in/email': signInEmail,
    'sign-in/code': signInCode,
  };
}
