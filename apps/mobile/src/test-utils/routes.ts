// In-memory route table for expo-router's renderRouter, built from the real screen modules.
import * as tabsLayout from '../app/(tabs)/_layout';
import * as discover from '../app/(tabs)/discover';
import * as makeTab from '../app/(tabs)/make';
import * as me from '../app/(tabs)/me';
import * as tonight from '../app/(tabs)/tonight';
import * as rootLayout from '../app/_layout';
import * as quiz from '../app/discover/quiz';
import * as index from '../app/index';
import * as readyScreen from '../app/job/[id]';
import * as durationSheet from '../app/job/duration/[id]';
import * as makeFlow from '../app/make/new';
import * as signInCode from '../app/sign-in/code';
import * as signInEmail from '../app/sign-in/email';
import * as signInSheet from '../app/sign-in/index';
import * as song from '../app/song/[id]';

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
    'song/[id]': song,
    'make/new': makeFlow,
    'job/[id]': readyScreen,
    'job/duration/[id]': durationSheet,
    'sign-in/index': signInSheet,
    'sign-in/email': signInEmail,
    'sign-in/code': signInCode,
  };
}
