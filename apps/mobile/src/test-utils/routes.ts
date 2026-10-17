// In-memory route table for expo-router's renderRouter, built from the real screen modules.
import * as tabsLayout from '../app/(tabs)/_layout';
import * as account from '../app/(tabs)/account';
import * as find from '../app/(tabs)/find';
import * as videos from '../app/(tabs)/videos';
import * as rootLayout from '../app/_layout';
import * as index from '../app/index';
import * as signInCode from '../app/sign-in/code';
import * as signInEmail from '../app/sign-in/email';
import * as signInSheet from '../app/sign-in/index';
import * as song from '../app/song/[id]';

export function appRoutes() {
  return {
    _layout: rootLayout,
    index,
    '(tabs)/_layout': tabsLayout,
    '(tabs)/find': find,
    '(tabs)/videos': videos,
    '(tabs)/account': account,
    'song/[id]': song,
    'sign-in/index': signInSheet,
    'sign-in/email': signInEmail,
    'sign-in/code': signInCode,
  };
}
