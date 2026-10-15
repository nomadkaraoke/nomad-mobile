# Nomad Mobile Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SDK 54 skeleton with a pnpm-workspace Expo SDK 57 app. Every package must work end to end: routing, i18n, generated API clients, UI wrappers, and auth plumbing against a mock. CI, Maestro and agent tooling must be wired.

**Architecture:**
- `apps/mobile` is the Expo Router app.
- Pure logic lives in `packages/core`.
- Strings and the locale pipeline live in `packages/i18n`.
- OpenAPI-generated clients live in `packages/api-gen` and `packages/api-decide`.
- Design tokens and the wrappers around FlashList/Skia live in `packages/ui`.
- The app injects token and locale getters into the clients. Clients never touch storage.

**Tech Stack:**
- App: Expo SDK 57 (expo@57.0.29+, RN 0.86, React 19.2), Expo Router 57, TypeScript strict
- Data and state: TanStack Query 5, Zustand 5, expo-secure-store
- Styling and UI: Uniwind 1.12 (Tailwind 4), @shopify/flash-list 2.3, @shopify/react-native-skia 2.14
- i18n and API: use-intl 4.14, expo-localization, @hey-api/openapi-ts 0.99, zod 4
- Testing: jest-expo 57 + @testing-library/react-native 14, Maestro 2.11
- Tooling: pnpm 12, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-phase0-design.md`

## Global Constraints

- Expo SDK **57** (`expo@^57.0.29`; never below 57.0.17 because of the Hermes v1 memory fix). Use a dev-client build, not Expo Go.
- Bundle id and package stay `com.nomadkaraoke.mobile`. Scheme stays `nomadkaraoke`. App name stays "Nomad Karaoke".
- **No backend changes** to karaoke-gen or karaoke-decide in Phase 0.
- **Never create Apple, Google, EAS/Expo, RevenueCat, Sentry or PostHog accounts, and never run anything that costs money.** Stop and ask Andrew. `eas` commands that need login are out of scope.
- Only `packages/ui` may import `@shopify/flash-list` or `@shopify/react-native-skia`. ESLint enforces this.
- No hardcoded user-facing strings in `apps/mobile` or `packages/ui`. All copy goes through `useTranslations()`, and a new key in `en.json` needs translations in all 33 locales.
- Every interactive element gets a `testID`.
- The API clients take `baseUrl`, `getToken`, `getLocale` and `onUnauthorized` by injection, and never import storage.
- Gen prod base URL: `https://api.nomadkaraoke.com`. Decide prod base URL: `https://decide.nomadkaraoke.com` (paths already start `/api/...`). The decide OpenAPI source is `https://karaoke-decide-718638054799.us-central1.run.app/openapi.json`.
- Coverage on `packages/*` must be at least 70%.
- Commit after every task. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012SVUgVaPghbrA9jJ9Fg4nX
  ```
- The repo has a gitleaks pre-commit hook. If it flags something, fix the content and never bypass the hook.
- Use the `ctx7` CLI (`npx ctx7@latest docs <id> "<question>"`) before guessing any library API. Useful IDs: `/websites/heyapi_dev`, `/uni-stack/uniwind`. Resolve any others with `npx ctx7@latest library <name> "<question>"`.

## Review Focus

1. **Device locale variants.** `pt-BR`, `zh-Hant-TW`, `nb-NO`, `he-IL` and unsupported `xx-YY` must resolve to `pt`, `zh`, `nb`, `he` and `en`. Covered by Task 3 test `resolveLocale`.
2. **A key missing from a non-English locale at runtime** must render the English string, not the raw key path. Covered by Task 3 test `falls back to en`.
3. **Search input edge cases.** An empty or whitespace query shows popular songs and never calls `/catalog/songs?q=`. Rapid typing shows results only for the last query (debounce plus a queryKey that includes the trimmed query). Covered by Task 6 `useSongSearch` tests.
4. **A 401 from either API** clears the session exactly once and doesn't loop. Decide's public endpoints never trigger sign-out. Covered by Task 4 `onUnauthorized` test and Task 6 auth-store test.
5. **Sign-in inputs.** An email with surrounding whitespace or uppercase is normalized. A pasted code with spaces or dashes (`"123 456"`, `"123-456"`) is accepted. 5- or 7-digit codes are rejected client-side. Covered by Task 2 `normalizeEmail` / `normalizeCode` tests.

---

## File Structure

```
package.json, pnpm-workspace.yaml, .npmrc, tsconfig.base.json, eslint.config.js,
jest.config.js, .gitignore                      root workspace config
apps/mobile/
  app.json, eas.json, metro.config.js, babel.config.js, tsconfig.json, jest.config.js, global.css
  app/_layout.tsx                                providers (i18n, query, auth bootstrap)
  app/(tabs)/_layout.tsx, find.tsx, videos.tsx, account.tsx
  app/sign-in/email.tsx, app/sign-in/code.tsx
  app/song/[id].tsx
  src/auth/authApi.ts                            AuthApi interface + mock impl
  src/auth/store.ts                              zustand + SecureStore session store
  src/api/setup.ts                               configureClient wiring for both APIs
  src/find/useSongSearch.ts                      debounced search hook
  src/observability.ts                           no-op-unless-configured Sentry/PostHog
  src/**/__tests__/*.test.ts(x)
packages/core/src/{session,jobStatus,backoff,format,index}.ts + __tests__
packages/i18n/
  messages/<33>.json, src/{locales,resolveLocale,IntlProvider,index}.ts(x)
  scripts/{translate.py,translation_cache.py,gemini_client.py,glossary.json,
           validate-translations.py,requirements.txt}   (vendored from karaoke-gen/frontend/scripts)
packages/api-gen/    openapi-ts.config.ts, src/client/** (generated), src/{configure,index}.ts
packages/api-decide/ openapi-ts.config.ts, src/client/** (generated), src/{configure,index}.ts
packages/ui/src/{tokens,Screen,Text,Button,TextField,List,WaveformCanvas,index}.tsx + __tests__
openapi/{gen.json,decide.json}, scripts/fetch-openapi.mjs, scripts/list-untyped.mjs
docs/gen-untyped-endpoints.md
maestro/flows/{smoke-find.yaml,smoke-signin-gate.yaml}
.github/workflows/ci.yml, .eas/workflows/{ci.yml,release.yml}
.mcp.json, CLAUDE.md, README.md
```

Deleted: `app/`, `src/`, `assets/` (moved to `apps/mobile/assets/`), `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`, `nativewind-env.d.ts`, `jest.*.js`, `package-lock.json`, `docs/IMPLEMENTATION-PLAN.md` (superseded; move it to `docs/archive/2026-02-01-original-implementation-plan.md`).

---

### Task 1: Workspace + fresh SDK 57 app shell

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `eslint.config.js`, `jest.config.js`, `apps/mobile/**` (from template)
- Delete: the old skeleton files listed above (after copying `assets/`)

**Interfaces:**
- Produces: root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`. Workspace packages are named `@nomad/mobile`, `@nomad/core`, `@nomad/i18n`, `@nomad/api-gen`, `@nomad/api-decide`, `@nomad/ui`.

- [ ] **Step 1: Move old skeleton out**

```bash
mkdir -p docs/archive
git mv docs/IMPLEMENTATION-PLAN.md docs/archive/2026-02-01-original-implementation-plan.md
mkdir -p /tmp/nm-assets && cp -R assets/* /tmp/nm-assets/   # keep icons
git rm -rq app src assets babel.config.js metro.config.js tailwind.config.js global.css nativewind-env.d.ts jest.config.js jest.setup.js package-lock.json package.json tsconfig.json
```

- [ ] **Step 2: Scaffold the app from the SDK 57 default template**

```bash
npx create-expo-app@latest apps/mobile --template default@sdk-57 --no-install
cp /tmp/nm-assets/* apps/mobile/assets/images/ 2>/dev/null || cp /tmp/nm-assets/* apps/mobile/assets/
```

Delete the template's demo content: `app/(tabs)/explore.tsx`, `components/`, `hooks/`, `constants/`, `scripts/reset-project.js`. Keep `app/_layout.tsx` and `app/(tabs)/_layout.tsx`; Task 6 rewrites both.

Then edit `apps/mobile/package.json`:
- Set `"name": "@nomad/mobile"`.
- Remove the `reset-project` script.

Then edit `apps/mobile/app.json`:
- Set `name` "Nomad Karaoke", `slug` "nomad-karaoke", `scheme` "nomadkaraoke".
- Set `ios.bundleIdentifier` and `android.package` to "com.nomadkaraoke.mobile".
- Set `userInterfaceStyle` "dark" and `experiments.typedRoutes: true`.
- Add plugins: `expo-router`, `expo-secure-store`, `expo-localization`.

- [ ] **Step 3: Root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`.npmrc`:
```
node-linker=hoisted
```
(We use the hoisted linker for Metro/React Native compatibility, and spec §5 names this as the fallback. Keep it unless isolated mode is proven to work.)

`package.json`:
```json
{
  "name": "nomad-mobile",
  "private": true,
  "packageManager": "pnpm@12.6.0",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "pnpm -r --parallel exec tsc --noEmit",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "gen:api": "node scripts/fetch-openapi.mjs && pnpm -r --filter './packages/api-*' run generate",
    "gen:api:offline": "pnpm -r --filter './packages/api-*' run generate",
    "i18n:check": "python3 packages/i18n/scripts/validate-translations.py --messages-dir packages/i18n/messages --keys-only",
    "i18n:translate": "python3 packages/i18n/scripts/translate.py --messages-dir packages/i18n/messages --target all"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

`apps/mobile/tsconfig.json` extends `expo/tsconfig.base` and adds `"strict": true` and `"noUncheckedIndexedAccess": true`. Keep the template's `include`.

`jest.config.js` (root):
```js
module.exports = {
  projects: [
    '<rootDir>/packages/core',
    '<rootDir>/packages/i18n',
    '<rootDir>/packages/api-gen',
    '<rootDir>/packages/api-decide',
    '<rootDir>/packages/ui',
    '<rootDir>/apps/mobile',
  ],
  coverageThreshold: { global: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  collectCoverageFrom: ['packages/*/src/**/*.{ts,tsx}', '!**/src/client/**', '!**/index.ts'],
};
```

`eslint.config.js`:
```js
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
  { ignores: ['**/src/client/**', '**/dist/**', 'apps/mobile/.expo/**', 'apps/mobile/ios/**', 'apps/mobile/android/**'] },
  { files: ['apps/**/*.{ts,tsx}', 'packages/core/**', 'packages/i18n/**', 'packages/api-*/**'],
    rules: { 'no-restricted-imports': ['error', shopifyBan] } },
  // No hardcoded user-facing strings: any non-whitespace JSX text literal is an error (use t('...')).
  { files: ['apps/mobile/app/**/*.tsx', 'apps/mobile/src/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    ignores: ['**/__tests__/**'],
    rules: { 'no-restricted-syntax': ['error', { selector: 'JSXText[value=/\\S/]', message: 'Use useTranslations(); no hardcoded strings.' }] } },
]);
```

- [ ] **Step 4: Install and verify**

```bash
pnpm install
cd apps/mobile && npx expo install --fix && npx expo-doctor && cd ../..
pnpm lint
```
Expected: install succeeds. `expo-doctor` reports no SDK-mismatch errors (warnings about an untested monorepo are OK; note them). Lint passes.

- [ ] **Step 5: Verify both ESLint guards work**

Create a temporary file `apps/mobile/src/__lint_probe.tsx` containing:
```tsx
import '@shopify/flash-list';
export const X = () => <>Hello</>;
```
Run `pnpm lint` and expect **two** errors: "Use <List> from @nomad/ui" and "no hardcoded strings". Delete the probe file.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: replace SDK 54 skeleton with SDK 57 pnpm workspace"
```

---

### Task 2: `packages/core` (session model, input normalizers, job status, backoff, formatting)

**Files:**
- Create: `packages/core/package.json`, `packages/core/jest.config.js`, `packages/core/tsconfig.json`, `packages/core/src/{session,jobStatus,backoff,format,index}.ts`
- Test: `packages/core/src/__tests__/{session,jobStatus,backoff,format}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Session = { token: string; email: string; createdAt: number };
  export type AuthState =
    | { status: 'signedOut' }
    | { status: 'codeSent'; email: string }
    | { status: 'signedIn'; session: Session };
  export function normalizeEmail(raw: string): string | null;   // trimmed+lowercased, null if invalid
  export function normalizeCode(raw: string): string | null;    // 6 digits or null
  export type JobPhase = 'working' | 'needsUser' | 'done' | 'failed';
  export function jobPhase(status: string): JobPhase;
  export function nextPollDelayMs(attempt: number): number;     // 2s,4s,8s… capped at 30s
  export function formatCredits(n: number, locale: string): string;
  export function formatPrice(cents: number, currency: string, locale: string): string;
  ```

- [ ] **Step 1: Package scaffolding**

`packages/core/package.json`:
```json
{ "name": "@nomad/core", "version": "0.0.0", "private": true, "main": "src/index.ts", "types": "src/index.ts" }
```
`packages/core/jest.config.js`: `module.exports = { preset: 'jest-expo/node', displayName: 'core' };`
`packages/core/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src"] }`

- [ ] **Step 2: Write failing tests**

`packages/core/src/__tests__/session.test.ts`:
```ts
import { normalizeEmail, normalizeCode } from '../session';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  Andrew@Example.COM ')).toBe('andrew@example.com'));
  it('rejects junk', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });
});

describe('normalizeCode', () => {
  it('accepts 6 digits', () => expect(normalizeCode('123456')).toBe('123456'));
  it('strips spaces and dashes from pasted codes', () => {
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
  });
  it('rejects wrong length or letters', () => {
    expect(normalizeCode('12345')).toBeNull();
    expect(normalizeCode('1234567')).toBeNull();
    expect(normalizeCode('12a456')).toBeNull();
  });
});
```

`packages/core/src/__tests__/jobStatus.test.ts`. The gen statuses come from `karaoke-gen/backend/models/job.py:38-93`. Before writing this test, check that file for any status not listed below and add it.
```ts
import { jobPhase } from '../jobStatus';

it.each([
  ['pending', 'working'], ['downloading', 'working'], ['separating_stage1', 'working'],
  ['transcribing', 'working'], ['rendering_video', 'working'], ['encoding', 'working'],
  ['awaiting_review', 'needsUser'], ['in_review', 'needsUser'],
  ['awaiting_duration_confirm', 'needsUser'], ['awaiting_audio_selection', 'needsUser'],
  ['complete', 'done'], ['prep_complete', 'done'],
  ['failed', 'failed'], ['cancelled', 'failed'],
  ['some_future_status', 'working'],
])('%s → %s', (s, phase) => expect(jobPhase(s)).toBe(phase));
```

`packages/core/src/__tests__/backoff.test.ts`:
```ts
import { nextPollDelayMs } from '../backoff';
it('doubles from 2s and caps at 30s', () => {
  expect([0, 1, 2, 3, 4, 10].map(nextPollDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
});
it('treats negative attempts as 0', () => expect(nextPollDelayMs(-1)).toBe(2000));
```

`packages/core/src/__tests__/format.test.ts`:
```ts
import { formatCredits, formatPrice } from '../format';
it('formats prices by locale', () => {
  expect(formatPrice(2400, 'USD', 'en')).toBe('$24.00');
  expect(formatPrice(2400, 'USD', 'de')).toMatch(/24,00/);
});
it('formats credit counts', () => expect(formatCredits(1234, 'en')).toBe('1,234'));
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `pnpm jest --selectProjects core`
Expected: FAIL with "Cannot find module '../session'" (and similar).

- [ ] **Step 4: Implement**

`src/session.ts`:
```ts
export type Session = { token: string; email: string; createdAt: number };
export type AuthState =
  | { status: 'signedOut' }
  | { status: 'codeSent'; email: string }
  | { status: 'signedIn'; session: Session };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function normalizeCode(raw: string): string | null {
  const c = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(c) ? c : null;
}
```

`src/jobStatus.ts`:
```ts
export type JobPhase = 'working' | 'needsUser' | 'done' | 'failed';
const NEEDS_USER = new Set(['awaiting_review', 'in_review', 'awaiting_duration_confirm', 'awaiting_audio_selection', 'awaiting_instrumental_selection']);
const DONE = new Set(['complete', 'prep_complete']);
const FAILED = new Set(['failed', 'cancelled']);
export function jobPhase(status: string): JobPhase {
  if (NEEDS_USER.has(status)) return 'needsUser';
  if (DONE.has(status)) return 'done';
  if (FAILED.has(status)) return 'failed';
  return 'working';
}
```
(Align the sets with `job.py` after the check in Step 2.)

`src/backoff.ts`:
```ts
export function nextPollDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 30000);
}
```

`src/format.ts`:
```ts
export const formatCredits = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
export const formatPrice = (cents: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
```

`src/index.ts` re-exports everything.

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm jest --selectProjects core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core && git commit -m "feat(core): session normalizers, job phases, poll backoff, formatters"
```

---

### Task 3: `packages/i18n` (33-locale messages, resolver, provider, vendored pipeline)

**Files:**
- Create: `packages/i18n/{package.json,jest.config.js,tsconfig.json}`, `messages/<33>.json`, `src/{locales,resolveLocale,IntlProvider,index}.ts(x)`, `scripts/*` (vendored)
- Test: `packages/i18n/src/__tests__/{resolveLocale,IntlProvider}.test.ts(x)`

**Interfaces:**
- Produces:
  ```ts
  export const LOCALES: readonly Locale[];       // 33 codes, same list as karaoke-gen frontend/i18n/routing.ts
  export type Locale = 'en' | 'es' | ... ;
  export const RTL_LOCALES: ReadonlySet<Locale>; // ar, he
  export function resolveLocale(deviceTags: readonly string[]): Locale;
  export function IntlProvider(props: { locale: Locale; children: React.ReactNode }): JSX.Element;
  export { useTranslations, useFormatter } from 'use-intl';
  ```
- Message namespaces used by later tasks (all of them must exist in `en.json`): `common`, `tabs`, `find`, `song`, `signIn`, `videos`, `account`.

- [ ] **Step 1: Vendor the pipeline scripts**

```bash
mkdir -p packages/i18n/scripts packages/i18n/messages
for f in translate.py translation_cache.py gemini_client.py glossary.json validate-translations.py requirements.txt; do
  cp ../karaoke-gen/frontend/scripts/$f packages/i18n/scripts/
done
```
Read `packages/i18n/scripts/translate.py` and confirm that its imports resolve relative to its own directory. Add a header comment: `# Vendored from karaoke-gen/frontend/scripts on 2026-10-14; keep in sync.`

- [ ] **Step 2: Write `en.json`**

`packages/i18n/messages/en.json`:
```json
{
  "common": { "retry": "Try again", "loading": "Loading…", "error": "Something went wrong.", "cancel": "Cancel", "continue": "Continue" },
  "tabs": { "find": "Find", "videos": "My Videos", "account": "Account" },
  "find": {
    "searchPlaceholder": "Search songs or artists",
    "popularHeading": "Popular for karaoke",
    "noResults": "No songs found for “{query}”.",
    "makeAnySong": "Can't find it? Make any song",
    "karaokeVersions": "{count, plural, =0 {No karaoke versions yet} one {# karaoke version} other {# karaoke versions}}"
  },
  "song": { "makeVideo": "Make karaoke video", "signInToMake": "Sign in to make this song" },
  "signIn": {
    "emailTitle": "Sign in",
    "emailLabel": "Email",
    "emailInvalid": "Enter a valid email address.",
    "sendCode": "Send code",
    "codeTitle": "Check your email",
    "codeHelp": "We sent a 6-digit code to {email}.",
    "codeLabel": "Code",
    "codeInvalid": "Enter the 6-digit code.",
    "verify": "Sign in",
    "devMockNotice": "Development mode: use code 123456"
  },
  "videos": { "emptyTitle": "No videos yet", "emptyBody": "Songs you make will appear here.", "signInPrompt": "Sign in to see your videos" },
  "account": { "title": "Account", "signIn": "Sign in", "signOut": "Sign out", "signedInAs": "Signed in as {email}", "language": "Language" }
}
```

- [ ] **Step 3: Translate to all 32 other locales**

```bash
pip install -r packages/i18n/scripts/requirements.txt -q
env -u GEMINI_API_KEY python3 packages/i18n/scripts/translate.py --messages-dir packages/i18n/messages --target all
pnpm i18n:check
```
Expected: 32 new `<locale>.json` files, and `i18n:check` exits 0.

If translation fails because of credentials (the script reads Secret Manager through `gcloud` user auth; see memory `reference_gcloud_cli_secret_access_remediation`), **stop and ask Andrew to run `! gcloud auth login`**. Do not hand-write translations.

- [ ] **Step 4: Write failing tests**

`src/__tests__/resolveLocale.test.ts`:
```ts
import { resolveLocale, LOCALES, RTL_LOCALES } from '../index';

it('has 33 locales incl. en', () => { expect(LOCALES).toHaveLength(33); expect(LOCALES).toContain('en'); });
it.each([
  [['pt-BR'], 'pt'], [['zh-Hant-TW'], 'zh'], [['nb-NO'], 'nb'], [['he-IL'], 'he'],
  [['xx-YY'], 'en'], [[], 'en'], [['xx-YY', 'fr-CA'], 'fr'], [['ES'], 'es'],
])('%j → %s', (tags, expected) => expect(resolveLocale(tags)).toBe(expected));
it('marks ar and he RTL', () => { expect(RTL_LOCALES.has('ar')).toBe(true); expect(RTL_LOCALES.has('en')).toBe(false); });
```

`src/__tests__/IntlProvider.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { IntlProvider, useTranslations } from '../index';
import * as fs from 'fs';
import * as path from 'path';

function Probe({ k }: { k: string }) { const t = useTranslations(); return <Text>{t(k as never)}</Text>; }

it('renders the locale string', () => {
  render(<IntlProvider locale="es"><Probe k="tabs.find" /></IntlProvider>);
  const es = JSON.parse(fs.readFileSync(path.join(__dirname, '../../messages/es.json'), 'utf8'));
  expect(screen.getByText(es.tabs.find)).toBeTruthy();
});

it('falls back to en for a key missing in the locale', () => {
  jest.isolateModules(() => {
    jest.doMock('../../messages/fr.json', () => ({ tabs: {} }), { virtual: false });
    const { IntlProvider: P } = require('../IntlProvider');
    render(<P locale="fr"><Probe k="tabs.find" /></P>);
    expect(screen.getByText('Find')).toBeTruthy();
  });
});

it('formats ICU plurals', () => {
  render(<IntlProvider locale="en"><PluralProbe /></IntlProvider>);
  expect(screen.getByText('3 karaoke versions')).toBeTruthy();
});
function PluralProbe() { const t = useTranslations('find'); return <Text>{t('karaokeVersions', { count: 3 })}</Text>; }
```
`jest.config.js`: `module.exports = { preset: 'jest-expo/ios', displayName: 'i18n' };`

- [ ] **Step 5: Run tests and verify they fail**

Run: `pnpm jest --selectProjects i18n`
Expected: FAIL (modules missing).

- [ ] **Step 6: Implement**

`src/locales.ts`:
```ts
export const LOCALES = ['en','es','de','pt','fr','ja','ko','zh','it','nl','pl','tr','ru','th','id','vi','tl','hi','ar','sv','nb','da','fi','cs','ro','hu','el','he','ms','uk','hr','sk','ca'] as const;
export type Locale = (typeof LOCALES)[number];
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar', 'he']);
```
Before committing, cross-check this list against `karaoke-gen/frontend/i18n/routing.ts` and use gen's order.

`src/resolveLocale.ts`:
```ts
import { LOCALES, type Locale } from './locales';
const ALIASES: Record<string, Locale> = { no: 'nb', nn: 'nb', iw: 'he', in: 'id', fil: 'tl' };
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
    const cand = ALIASES[base] ?? base;
    if ((LOCALES as readonly string[]).includes(cand)) return cand as Locale;
  }
  return 'en';
}
```

`src/IntlProvider.tsx`:
```tsx
import { IntlProvider as UseIntlProvider, type AbstractIntlMessages } from 'use-intl';
import type { ReactNode } from 'react';
import type { Locale } from './locales';
import en from '../messages/en.json';

// Static requires so Metro bundles every locale (33 small JSON files).
const LOADERS: Record<Locale, () => AbstractIntlMessages> = {
  en: () => en,
  es: () => require('../messages/es.json'), de: () => require('../messages/de.json'),
  pt: () => require('../messages/pt.json'), fr: () => require('../messages/fr.json'),
  ja: () => require('../messages/ja.json'), ko: () => require('../messages/ko.json'),
  zh: () => require('../messages/zh.json'), it: () => require('../messages/it.json'),
  nl: () => require('../messages/nl.json'), pl: () => require('../messages/pl.json'),
  tr: () => require('../messages/tr.json'), ru: () => require('../messages/ru.json'),
  th: () => require('../messages/th.json'), id: () => require('../messages/id.json'),
  vi: () => require('../messages/vi.json'), tl: () => require('../messages/tl.json'),
  hi: () => require('../messages/hi.json'), ar: () => require('../messages/ar.json'),
  sv: () => require('../messages/sv.json'), nb: () => require('../messages/nb.json'),
  da: () => require('../messages/da.json'), fi: () => require('../messages/fi.json'),
  cs: () => require('../messages/cs.json'), ro: () => require('../messages/ro.json'),
  hu: () => require('../messages/hu.json'), el: () => require('../messages/el.json'),
  he: () => require('../messages/he.json'), ms: () => require('../messages/ms.json'),
  uk: () => require('../messages/uk.json'), hr: () => require('../messages/hr.json'),
  sk: () => require('../messages/sk.json'), ca: () => require('../messages/ca.json'),
};

function deepMerge(base: AbstractIntlMessages, over: AbstractIntlMessages): AbstractIntlMessages {
  const out: AbstractIntlMessages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    out[k] = typeof v === 'object' && v && typeof b === 'object' && b ? deepMerge(b as AbstractIntlMessages, v as AbstractIntlMessages) : v;
  }
  return out;
}

export function IntlProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const messages = locale === 'en' ? en : deepMerge(en, LOADERS[locale]());
  return (
    <UseIntlProvider locale={locale} messages={messages} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      onError={() => {}}>
      {children}
    </UseIntlProvider>
  );
}
```
`src/index.ts` exports `LOCALES`, `Locale`, `RTL_LOCALES`, `resolveLocale`, `IntlProvider`, and re-exports `useTranslations` and `useFormatter` from `use-intl`.

`package.json`: name `@nomad/i18n`, `main: src/index.ts`, dependency `use-intl@4.14.9`.

- [ ] **Step 7: Run tests and verify they pass**

Run: `pnpm jest --selectProjects i18n && pnpm i18n:check`
Expected: PASS, exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/i18n && git commit -m "feat(i18n): 33-locale messages, resolver, use-intl provider with en fallback, vendored pipeline"
```

---

### Task 4: Generated API clients (`packages/api-gen`, `packages/api-decide`)

**Files:**
- Create: `openapi/{gen.json,decide.json}`, `scripts/fetch-openapi.mjs`, `scripts/list-untyped.mjs`, `docs/gen-untyped-endpoints.md`
- Create per package: `package.json`, `openapi-ts.config.ts`, `jest.config.js`, `tsconfig.json`, `src/configure.ts`, `src/index.ts`, `src/client/**` (generated)
- Test: `packages/api-gen/src/__tests__/configure.test.ts`, `packages/api-decide/src/__tests__/configure.test.ts`

**Interfaces:**
- Produces, in each package:
  ```ts
  export type ClientDeps = {
    baseUrl: string;
    getToken: () => string | null;
    getLocale: () => string;
    onUnauthorized: () => void;
  };
  export function configureClient(deps: ClientDeps): void;
  export * from './client';                 // generated sdk + types + @tanstack/react-query options
  ```
- `@nomad/api-decide` additionally exports named facades:
  ```ts
  export function searchSongs(q: string, page?: number): Promise<CatalogSearchResponse>;
  export function popularSongs(limit?: number): Promise<SongResponse[]>;
  export function getSong(id: number): Promise<SongResponse>;
  ```
- `@nomad/api-gen` exports `getMe(): Promise<UserProfileResponse>` and `listCreditPackages(): Promise<CreditPackagesResponse>`.
- Generated function names come from FastAPI operationIds, for example `searchCatalogApiCatalogSongsGet`, `getPopularSongsApiCatalogSongsPopularGet`, `getSongApiCatalogSongsSongIdGet`, `getCurrentUserApiUsersMeGet` and `listCreditPackagesApiUsersCreditsPackagesGet`. Confirm the exact names with `grep -n "export const" src/client/sdk.gen.ts` before writing the facades.

- [ ] **Step 1: Fetch script + snapshots**

`scripts/fetch-openapi.mjs`:
```js
import { writeFile } from 'node:fs/promises';
const SOURCES = {
  gen: 'https://api.nomadkaraoke.com/openapi.json',
  decide: 'https://karaoke-decide-718638054799.us-central1.run.app/openapi.json',
};
for (const [name, url] of Object.entries(SOURCES)) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  await writeFile(`openapi/${name}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: ${Object.keys(json.paths).length} paths`);
}
```
Run `mkdir -p openapi && node scripts/fetch-openapi.mjs`. Expect about 268 gen paths and some decide paths. Decide is on Cloud Run with cold starts, so retry once if the first fetch times out.

- [ ] **Step 2: Generator config (repeat in both packages; only `input` and the package name differ)**

`packages/api-decide/openapi-ts.config.ts`:
```ts
import { defineConfig } from '@hey-api/openapi-ts';
export default defineConfig({
  input: '../../openapi/decide.json',
  output: { path: 'src/client', format: 'prettier' },
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', '@hey-api/sdk', '@tanstack/react-query'],
});
```
`packages/api-decide/package.json`:
```json
{ "name": "@nomad/api-decide", "version": "0.0.0", "private": true, "main": "src/index.ts",
  "scripts": { "generate": "openapi-ts" },
  "devDependencies": { "@hey-api/openapi-ts": "0.99.0" },
  "peerDependencies": { "@tanstack/react-query": "^5" } }
```
Pin `@hey-api/openapi-ts` exactly, because its output changes between minor versions and the drift check depends on stable output. Run `pnpm install && pnpm gen:api:offline`, then confirm that `src/client/{sdk.gen.ts,types.gen.ts,client.gen.ts,@tanstack/react-query.gen.ts}` exist.

If the plugin names or the client output layout differ in 0.99, check with `npx ctx7@latest docs /websites/heyapi_dev "plugins list client-fetch tanstack 0.99"` and adjust.

- [ ] **Step 3: Write the failing test for configureClient**

`packages/api-decide/src/__tests__/configure.test.ts`:
```ts
import { configureClient, searchSongs } from '../index';

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock as never; });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

it('hits baseUrl with query, locale header, and bearer token when present', async () => {
  fetchMock.mockResolvedValue(ok({ songs: [], total: 0, page: 1, per_page: 20, has_more: false }));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'de', onUnauthorized: jest.fn() });
  await searchSongs('hello');
  const req: Request = fetchMock.mock.calls[0][0];
  expect(req.url).toBe('https://decide.test/api/catalog/songs?q=hello&page=1&per_page=20');
  expect(req.headers.get('accept-language')).toBe('de');
  expect(req.headers.get('authorization')).toBe('Bearer tok');
});

it('omits authorization when no token', async () => {
  fetchMock.mockResolvedValue(ok({ songs: [], total: 0, page: 1, per_page: 20, has_more: false }));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', onUnauthorized: jest.fn() });
  await searchSongs('x');
  expect((fetchMock.mock.calls[0][0] as Request).headers.get('authorization')).toBeNull();
});

it('calls onUnauthorized once on 401 and throws', async () => {
  const onUnauthorized = jest.fn();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 401, headers: { 'content-type': 'application/json' } }));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => 'tok', getLocale: () => 'en', onUnauthorized });
  await expect(searchSongs('x')).rejects.toMatchObject({ status: 401 });
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

it('surfaces FastAPI detail in errors', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'bad query' }), { status: 422, headers: { 'content-type': 'application/json' } }));
  configureClient({ baseUrl: 'https://decide.test', getToken: () => null, getLocale: () => 'en', onUnauthorized: jest.fn() });
  await expect(searchSongs('x')).rejects.toMatchObject({ status: 422, detail: 'bad query' });
});
```
Write the same four tests for api-gen, using `getMe()` against `https://gen.test/api/users/me`.

- [ ] **Step 4: Run tests and verify they fail**

Run: `pnpm jest --selectProjects api-decide api-gen`
Expected: FAIL (`configureClient` not exported).

- [ ] **Step 5: Implement `configure.ts` (same file in both packages)**

```ts
import { client } from './client/client.gen';

export type ClientDeps = { baseUrl: string; getToken: () => string | null; getLocale: () => string; onUnauthorized: () => void };
export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) { super(typeof detail === 'string' ? detail : `HTTP ${status}`); }
}

let interceptorIds: number[] = [];

export function configureClient(deps: ClientDeps): void {
  client.setConfig({ baseUrl: deps.baseUrl, throwOnError: true });
  interceptorIds.forEach((id) => client.interceptors.request.eject(id));
  interceptorIds = [
    client.interceptors.request.use((req) => {
      req.headers.set('Accept-Language', deps.getLocale());
      const t = deps.getToken();
      if (t) req.headers.set('Authorization', `Bearer ${t}`);
      return req;
    }),
  ];
  client.interceptors.error.clear?.();
  client.interceptors.error.use((err, res) => {
    if (res?.status === 401) deps.onUnauthorized();
    const detail = (err as { detail?: unknown })?.detail ?? err;
    return new ApiError(res?.status ?? 0, detail);
  });
}
```
Check the hey-api fetch client's interceptor API (`request.use` / `eject`, `error.use` signature) via ctx7 and adapt the code to it. The tests define the behavior, not this exact code.

`packages/api-decide/src/index.ts`:
```ts
export * from './client';
export { configureClient, ApiError, type ClientDeps } from './configure';
import { searchCatalogApiCatalogSongsGet, getPopularSongsApiCatalogSongsPopularGet, getSongApiCatalogSongsSongIdGet } from './client';

export const searchSongs = async (q: string, page = 1) =>
  (await searchCatalogApiCatalogSongsGet({ query: { q, page, per_page: 20 } })).data!;
export const popularSongs = async (limit = 30) =>
  (await getPopularSongsApiCatalogSongsPopularGet({ query: { limit } })).data!;
export const getSong = async (id: number) =>
  (await getSongApiCatalogSongsSongIdGet({ path: { song_id: id } })).data!;
```
`packages/api-gen/src/index.ts` follows the same pattern with `getMe` and `listCreditPackages`. Gen's `/api/users/me` declares an `authorization` header parameter. If the generated signature requires it, pass `headers: { authorization: '' }`; the interceptor overrides it. Add a comment explaining why.

- [ ] **Step 6: Run tests and verify they pass**

Run: `pnpm jest --selectProjects api-decide api-gen`
Expected: PASS.

- [ ] **Step 7: Untyped-endpoint report**

`scripts/list-untyped.mjs` reads `openapi/gen.json`. It prints a markdown table of operations whose 200 response has no `$ref` schema and no typed `items` (method, path, operationId), excluding `/api/admin/*` and `/api/internal/*`. Run it to write `docs/gen-untyped-endpoints.md`, with this header:

> Gen endpoints that return untyped dicts. Before the app calls one, add a zod schema in `packages/api-gen/src/overrides/` and file a gen follow-up to add `response_model`.

- [ ] **Step 8: Commit**

```bash
git add openapi scripts packages/api-gen packages/api-decide docs/gen-untyped-endpoints.md
git commit -m "feat(api): hey-api generated gen + decide clients with injected auth/locale and 401 hook"
```

---

### Task 5: `packages/ui` (tokens, primitives, `<List>`, `<WaveformCanvas>`)

**Files:**
- Create: `packages/ui/{package.json,jest.config.js,tsconfig.json,jest.setup.js}`, `src/{tokens,Screen,Text,Button,TextField,List,WaveformCanvas,index}.tsx`, `apps/mobile/global.css`, and edit `apps/mobile/metro.config.js`
- Test: `packages/ui/src/__tests__/{List,WaveformCanvas,Button}.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const colors: { bg; card; border; text; textMuted; primary; primaryFg; danger; success; gold; waveform };
  export function Screen(p: { children; testID: string; scroll?: boolean }): JSX.Element;
  export function Text(p: TextProps & { variant?: 'title' | 'body' | 'muted' }): JSX.Element;
  export function Button(p: { label: string; onPress: () => void; testID: string; variant?: 'primary' | 'secondary'; disabled?: boolean; loading?: boolean }): JSX.Element;
  export function TextField(p: { label: string; value: string; onChangeText: (s: string) => void; testID: string; error?: string; keyboardType?; autoComplete?; autoFocus? }): JSX.Element;
  export type ListProps<T> = { data: readonly T[]; renderItem: (item: T, index: number) => ReactElement; keyExtractor: (item: T) => string; testID: string; estimatedItemSize?: number; onEndReached?: () => void; ListEmptyComponent?: ReactElement; ListHeaderComponent?: ReactElement; refreshing?: boolean; onRefresh?: () => void };
  export function List<T>(p: ListProps<T>): JSX.Element;
  export function WaveformCanvas(p: { peaks: readonly number[]; progress: number; height: number; testID: string; color?: string; playedColor?: string }): JSX.Element;
  ```

- [ ] **Step 1: Uniwind + tokens**

`apps/mobile/global.css`:
```css
@import 'tailwindcss';
@import 'uniwind';
@source "../../packages/ui/src";

@theme {
  --color-bg: #0f0f0f;
  --color-card: #1a1a1a;
  --color-border: #2a2a2a;
  --color-text: #e5e5e5;
  --color-muted: #888888;
  --color-primary: #ff7acc;
  --color-primary-fg: #ffffff;
  --color-gold: #ffdf6b;
  --color-purple: #8b5cf6;
  --color-danger: #ef4444;
  --color-success: #22c55e;
  --color-waveform: #0d1117;
}
```
(The values mirror `karaoke-gen/frontend/app/globals.css` lines 14–50.)

`apps/mobile/metro.config.js`:
```js
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const config = getDefaultConfig(__dirname);
module.exports = withUniwindConfig(config, { cssEntryFile: './global.css' });
```
`src/tokens.ts` exports the same hex values as a `colors` object, for non-className uses such as Skia paints and the navigation theme.

Install the dependencies: `pnpm --filter @nomad/mobile exec npx expo install uniwind tailwindcss @shopify/flash-list @shopify/react-native-skia react-native-reanimated react-native-gesture-handler`. Then add `@shopify/flash-list` and `@shopify/react-native-skia` as `peerDependencies` of `@nomad/ui`.

Check Uniwind's Expo SDK 57 compatibility with `npx ctx7@latest docs /uni-stack/uniwind "expo sdk support version"`. If it is incompatible, switch to NativeWind 4.2.7 (spec §5 fallback) and note this in the commit message.

- [ ] **Step 2: Write failing tests**

`packages/ui/jest.setup.js`:
```js
jest.mock('@shopify/react-native-skia', () => require('@shopify/react-native-skia/lib/commonjs/mock').Mock ?? {
  Canvas: ({ children, testID }) => require('react').createElement('View', { testID }, children),
  Path: () => null, Skia: { Path: { Make: () => ({ moveTo() {}, lineTo() {}, close() {} }) } },
});
```
Check whether Skia 2.14 ships an official jest mock (`@shopify/react-native-skia/jestSetup` or similar) via ctx7. Prefer the official mock.

`src/__tests__/List.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { List } from '../List';

it('renders items with keys and the empty component', () => {
  const { rerender } = render(<List testID="l" data={['a', 'b']} keyExtractor={(x) => x} renderItem={(x) => <Text>{x}</Text>} />);
  expect(screen.getByText('a')).toBeTruthy();
  rerender(<List testID="l" data={[]} keyExtractor={(x) => x} renderItem={(x) => <Text>{x}</Text>} ListEmptyComponent={<Text>empty</Text>} />);
  expect(screen.getByText('empty')).toBeTruthy();
});
```

`src/__tests__/WaveformCanvas.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react-native';
import { WaveformCanvas, buildBars } from '../WaveformCanvas';

it('renders with testID', () => {
  render(<WaveformCanvas testID="wf" peaks={[0, 0.5, 1]} progress={0.5} height={40} />);
  expect(screen.getByTestId('wf')).toBeTruthy();
});
it('buildBars maps peaks to centered bar rects and clamps', () => {
  expect(buildBars([0, 0.5, 2, -1], 100, 40)).toEqual([
    { x: 0, y: 20, w: 25, h: 0 }, { x: 25, y: 10, w: 25, h: 20 },
    { x: 50, y: 0, w: 25, h: 40 }, { x: 75, y: 20, w: 25, h: 0 },
  ]);
});
it('buildBars handles empty peaks', () => expect(buildBars([], 100, 40)).toEqual([]));
```

`src/__tests__/Button.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from '../Button';
it('fires onPress, not when disabled or loading', () => {
  const onPress = jest.fn();
  const { rerender } = render(<Button testID="b" label="Go" onPress={onPress} />);
  fireEvent.press(screen.getByTestId('b')); expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Button testID="b" label="Go" onPress={onPress} disabled />);
  fireEvent.press(screen.getByTestId('b')); expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Button testID="b" label="Go" onPress={onPress} loading />);
  fireEvent.press(screen.getByTestId('b')); expect(onPress).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `pnpm jest --selectProjects ui`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`src/List.tsx`:
```tsx
import { FlashList } from '@shopify/flash-list';
import type { ReactElement } from 'react';

export type ListProps<T> = {
  data: readonly T[]; renderItem: (item: T, index: number) => ReactElement; keyExtractor: (item: T) => string;
  testID: string; estimatedItemSize?: number; onEndReached?: () => void;
  ListEmptyComponent?: ReactElement; ListHeaderComponent?: ReactElement; refreshing?: boolean; onRefresh?: () => void;
};

/** Our only list primitive. FlashList today; swap the body for LegendList/FlatList without touching callers. */
export function List<T>({ data, renderItem, keyExtractor, testID, ...rest }: ListProps<T>) {
  return (
    <FlashList
      testID={testID}
      data={data as T[]}
      renderItem={({ item, index }) => renderItem(item, index)}
      keyExtractor={keyExtractor}
      onEndReachedThreshold={0.5}
      {...rest}
    />
  );
}
```
If FlashList does not render its items under jest (no layout), set `estimatedListSize` / `overrideProps` per the FlashList v2 testing docs (ctx7), or use the official FlashList jest mock.

`src/WaveformCanvas.tsx`:
```tsx
import { Canvas, Rect, Group } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { colors } from './tokens';

export type Bar = { x: number; y: number; w: number; h: number };
export function buildBars(peaks: readonly number[], width: number, height: number): Bar[] {
  if (peaks.length === 0) return [];
  const w = width / peaks.length;
  return peaks.map((p, i) => {
    const h = Math.max(0, Math.min(1, p)) * height;
    return { x: i * w, y: (height - h) / 2, w, h };
  });
}

/** Our only Skia entry point for waveforms; peaks are 0..1 amplitudes (gen /waveform-data). */
export function WaveformCanvas({ peaks, progress, height, testID, color = colors.muted, playedColor = colors.primary }:
  { peaks: readonly number[]; progress: number; height: number; testID: string; color?: string; playedColor?: string }) {
  const [width, setWidth] = useState(0);
  const bars = buildBars(peaks, width, height);
  const cut = Math.max(0, Math.min(1, progress)) * width;
  return (
    <View testID={testID} style={{ height }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <Canvas style={{ flex: 1 }}>
        <Group>
          {bars.map((b, i) => (
            <Rect key={i} x={b.x} y={b.y} width={Math.max(1, b.w - 1)} height={b.h} color={b.x < cut ? playedColor : color} />
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
```
With `buildBars(peaks, 100, 40)`, the `[0,0.5,2,-1]` test expects `y: 20` for zero-height bars, which `(40-0)/2` gives. Keep the test and the implementation consistent.

Write `Screen` (SafeAreaView + optional ScrollView, `className="flex-1 bg-bg"`), `Text` (variants map to classNames), `Button` (Pressable with `disabled={disabled || loading}`, ActivityIndicator when loading, `accessibilityRole="button"`) and `TextField` (label, TextInput, error text, `accessibilityLabel={label}`). Each one passes `testID` through. Use Uniwind `className` on RN core components.

`src/index.ts` exports everything.

- [ ] **Step 5: Run tests and verify they pass**

Run: `pnpm jest --selectProjects ui && pnpm lint`
Expected: PASS. Lint is clean, because `packages/ui` is the one place allowed to import `@shopify/*`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui apps/mobile/global.css apps/mobile/metro.config.js apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(ui): Uniwind tokens, primitives, List (FlashList) and WaveformCanvas (Skia) wrappers"
```

---

### Task 6: App wiring (providers, auth store + mock, screens, search hook)

**Files:**
- Create: `apps/mobile/src/auth/{authApi.ts,store.ts}`, `src/api/setup.ts`, `src/find/useSongSearch.ts`, `src/locale.ts`, and the routes listed in File Structure
- Modify: `apps/mobile/app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `apps/mobile/jest.config.js`
- Test: `apps/mobile/src/__tests__/{authStore,authApi,useSongSearch,findScreen,signInFlow}.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  ```ts
  // src/auth/authApi.ts
  export interface AuthApi { sendCode(email: string, locale: string): Promise<void>; verifyCode(email: string, code: string): Promise<{ token: string }> }
  export const mockAuthApi: AuthApi;     // code 123456 succeeds; anything else throws ApiError(400, 'invalid_code')
  export function getAuthApi(): AuthApi; // mock when EXPO_PUBLIC_AUTH_MOCK !== '0' (Phase 1 swaps in gen)
  // src/auth/store.ts
  export const useAuth: UseBoundStore<{ state: AuthState; hydrated: boolean;
    hydrate(): Promise<void>; requestCode(email: string): Promise<void>; verify(code: string): Promise<void>;
    signOut(): Promise<void>; getToken(): string | null }>;
  // src/find/useSongSearch.ts
  export function useSongSearch(rawQuery: string): { mode: 'popular' | 'search'; songs: SongResponse[]; isLoading: boolean; isError: boolean; refetch(): void };
  ```

- [ ] **Step 1: Install app dependencies**

```bash
cd apps/mobile
npx expo install expo-secure-store expo-localization expo-dev-client @tanstack/react-query zustand
pnpm add @nomad/core@workspace:* @nomad/i18n@workspace:* @nomad/api-gen@workspace:* @nomad/api-decide@workspace:* @nomad/ui@workspace:*
cd ../..
```
`apps/mobile/jest.config.js`:
```js
module.exports = { preset: 'jest-expo/ios', displayName: 'mobile', setupFiles: ['../../packages/ui/jest.setup.js'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo|expo-router|@shopify|uniwind|use-intl|@nomad)/)'] };
```

- [ ] **Step 2: Write failing tests**

`src/__tests__/authStore.test.ts`:
```ts
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '../auth/store';

jest.mock('expo-secure-store', () => { const m = new Map(); return {
  getItemAsync: jest.fn(async (k) => m.get(k) ?? null), setItemAsync: jest.fn(async (k, v) => void m.set(k, v)),
  deleteItemAsync: jest.fn(async (k) => void m.delete(k)) }; });

beforeEach(async () => { await useAuth.getState().signOut(); });

it('happy path: email → code → signedIn, persisted', async () => {
  await useAuth.getState().requestCode('  Me@Example.com ');
  expect(useAuth.getState().state).toEqual({ status: 'codeSent', email: 'me@example.com' });
  await useAuth.getState().verify('123 456');
  const s = useAuth.getState().state;
  expect(s.status).toBe('signedIn');
  expect(useAuth.getState().getToken()).toBeTruthy();
  expect(SecureStore.setItemAsync).toHaveBeenCalled();
});

it('rejects invalid email without calling the API', async () => {
  await expect(useAuth.getState().requestCode('nope')).rejects.toThrow('invalid_email');
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('wrong code keeps codeSent state', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await expect(useAuth.getState().verify('000000')).rejects.toMatchObject({ status: 400 });
  expect(useAuth.getState().state.status).toBe('codeSent');
});

it('hydrate restores a persisted session; signOut clears it', async () => {
  await useAuth.getState().requestCode('me@example.com');
  await useAuth.getState().verify('123456');
  useAuth.setState({ state: { status: 'signedOut' }, hydrated: false });
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedIn');
  await useAuth.getState().signOut();
  await useAuth.getState().hydrate();
  expect(useAuth.getState().state.status).toBe('signedOut');
});

it('signOut is idempotent (401 storms do not loop)', async () => {
  await useAuth.getState().signOut(); await useAuth.getState().signOut();
  expect(useAuth.getState().state.status).toBe('signedOut');
});
```

`src/__tests__/useSongSearch.test.tsx`:
```tsx
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as decide from '@nomad/api-decide';
import { useSongSearch } from '../find/useSongSearch';

jest.mock('@nomad/api-decide', () => ({ searchSongs: jest.fn(), popularSongs: jest.fn() }));
const wrapper = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { jest.useFakeTimers(); (decide.popularSongs as jest.Mock).mockResolvedValue([{ id: 1, artist: 'A', title: 'Pop', brands: [], brand_count: 3, is_popular: true }]);
  (decide.searchSongs as jest.Mock).mockImplementation(async (q) => ({ songs: [{ id: 2, artist: 'B', title: q, brands: [], brand_count: 0, is_popular: false }], total: 1, page: 1, per_page: 20, has_more: false })); });
afterEach(() => jest.useRealTimers());

it('blank or whitespace query shows popular and never searches', async () => {
  const { result } = renderHook(() => useSongSearch('   '), { wrapper });
  await waitFor(() => expect(result.current.songs[0]?.title).toBe('Pop'));
  expect(result.current.mode).toBe('popular');
  expect(decide.searchSongs).not.toHaveBeenCalled();
});

it('debounces: rapid typing searches only the last trimmed query', async () => {
  const { result, rerender } = renderHook(({ q }) => useSongSearch(q), { wrapper, initialProps: { q: 'h' } });
  rerender({ q: 'he' }); rerender({ q: 'hel ' });
  act(() => { jest.advanceTimersByTime(350); });
  await waitFor(() => expect(result.current.songs[0]?.title).toBe('hel'));
  expect(decide.searchSongs).toHaveBeenCalledTimes(1);
  expect(decide.searchSongs).toHaveBeenCalledWith('hel');
});

it('reports errors with refetch available', async () => {
  (decide.searchSongs as jest.Mock).mockRejectedValue(new Error('net'));
  const { result } = renderHook(() => useSongSearch('x'), { wrapper });
  act(() => { jest.advanceTimersByTime(350); });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(typeof result.current.refetch).toBe('function');
});
```

`src/__tests__/findScreen.test.tsx` renders `app/(tabs)/find.tsx` inside the providers (export a `renderWithProviders` helper from `src/test-utils.tsx`) with `@nomad/api-decide` mocked. It asserts:
- the `find-search-input` testID exists
- popular rows render with the badge text "3 karaoke versions"
- typing a query, then advancing timers, shows the result row `song-row-2`
- the error state shows a `find-retry` button that calls refetch

`src/__tests__/signInFlow.test.tsx` uses expo-router's `renderRouter` from `expo-router/testing-library`. It checks:
- from `/song/2`, pressing `song-make` while signed out navigates to `/sign-in/email`
- entering an email and pressing `signin-send` reaches `/sign-in/code`
- entering `123456` and pressing `signin-verify` returns to `/song/2`, which now shows `song-make` enabled with the label "Make karaoke video"

- [ ] **Step 3: Run tests and verify they fail**

Run: `pnpm jest --selectProjects mobile`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement auth**

`src/auth/authApi.ts`:
```ts
import { ApiError } from '@nomad/api-gen';
export interface AuthApi { sendCode(email: string, locale: string): Promise<void>; verifyCode(email: string, code: string): Promise<{ token: string }> }

/** Stand-in for gen POST /api/users/auth/send-code + verify-code (spec §4.1, built in Phase 1). */
export const mockAuthApi: AuthApi = {
  async sendCode() { await new Promise((r) => setTimeout(r, 300)); },
  async verifyCode(email, code) {
    await new Promise((r) => setTimeout(r, 300));
    if (code !== '123456') throw new ApiError(400, 'invalid_code');
    return { token: `mock-${email}` };
  },
};
export function getAuthApi(): AuthApi {
  if (process.env.EXPO_PUBLIC_AUTH_MOCK === '0') throw new Error('Real gen auth lands in Phase 1 (spec §4.1)');
  return mockAuthApi;
}
```
In jest, the 300 ms delays are fine with real timers. In tests that use fake timers, advance them.

`src/auth/store.ts`:
```ts
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { normalizeCode, normalizeEmail, type AuthState, type Session } from '@nomad/core';
import { getAuthApi } from './authApi';
import { currentLocale } from '../locale';

const KEY = 'nomad.session.v1';
type Store = { state: AuthState; hydrated: boolean; hydrate(): Promise<void>; requestCode(email: string): Promise<void>;
  verify(code: string): Promise<void>; signOut(): Promise<void>; getToken(): string | null };

export const useAuth = create<Store>((set, get) => ({
  state: { status: 'signedOut' }, hydrated: false,
  async hydrate() {
    const raw = await SecureStore.getItemAsync(KEY);
    let state: AuthState = { status: 'signedOut' };
    if (raw) { try { state = { status: 'signedIn', session: JSON.parse(raw) as Session }; } catch { await SecureStore.deleteItemAsync(KEY); } }
    set({ state, hydrated: true });
  },
  async requestCode(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!email) throw new Error('invalid_email');
    await getAuthApi().sendCode(email, currentLocale());
    set({ state: { status: 'codeSent', email } });
  },
  async verify(rawCode) {
    const s = get().state;
    if (s.status !== 'codeSent') throw new Error('no_pending_code');
    const code = normalizeCode(rawCode);
    if (!code) throw new Error('invalid_code_format');
    const { token } = await getAuthApi().verifyCode(s.email, code);
    const session: Session = { token, email: s.email, createdAt: Date.now() };
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
    set({ state: { status: 'signedIn', session } });
  },
  async signOut() {
    if (get().state.status === 'signedOut' && get().hydrated) return;
    await SecureStore.deleteItemAsync(KEY);
    set({ state: { status: 'signedOut' }, hydrated: true });
  },
  getToken() { const s = get().state; return s.status === 'signedIn' ? s.session.token : null; },
}));
```

`src/locale.ts`:
```ts
import { getLocales } from 'expo-localization';
import { resolveLocale, type Locale } from '@nomad/i18n';
let override: Locale | null = null;
export const setLocaleOverride = (l: Locale | null) => { override = l; };
export const currentLocale = (): Locale => override ?? resolveLocale(getLocales().map((l) => l.languageTag));
```

`src/api/setup.ts`:
```ts
import { configureClient as configureGen } from '@nomad/api-gen';
import { configureClient as configureDecide } from '@nomad/api-decide';
import { useAuth } from '../auth/store';
import { currentLocale } from '../locale';

export const GEN_BASE_URL = process.env.EXPO_PUBLIC_GEN_API_URL ?? 'https://api.nomadkaraoke.com';
export const DECIDE_BASE_URL = process.env.EXPO_PUBLIC_DECIDE_API_URL ?? 'https://decide.nomadkaraoke.com';

export function setupApiClients() {
  const getToken = () => useAuth.getState().getToken();
  // Gen owns identity: a gen 401 means the session is dead.
  configureGen({ baseUrl: GEN_BASE_URL, getToken, getLocale: currentLocale, onUnauthorized: () => void useAuth.getState().signOut() });
  // Decide is public for MVP (catalog); no gen token is sent and a 401 never signs the user out (spec §4.2 adds a decide token later).
  configureDecide({ baseUrl: DECIDE_BASE_URL, getToken: () => null, getLocale: currentLocale, onUnauthorized: () => {} });
}
```

- [ ] **Step 5: Implement the search hook**

`src/find/useSongSearch.ts`:
```ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { popularSongs, searchSongs, type SongResponse } from '@nomad/api-decide';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useSongSearch(rawQuery: string) {
  const q = useDebounced(rawQuery.trim());
  const mode: 'popular' | 'search' = q.length === 0 ? 'popular' : 'search';
  const popular = useQuery({ queryKey: ['decide', 'popular'], queryFn: () => popularSongs(30), enabled: mode === 'popular', staleTime: 3_600_000 });
  const search = useQuery({ queryKey: ['decide', 'search', q], queryFn: () => searchSongs(q), enabled: mode === 'search', staleTime: 300_000 });
  const active = mode === 'popular' ? popular : search;
  const songs: SongResponse[] = mode === 'popular' ? (popular.data ?? []) : (search.data?.songs ?? []);
  return { mode, songs, isLoading: active.isLoading, isError: active.isError, refetch: () => void active.refetch() };
}
```

- [ ] **Step 6: Implement routes**

`app/_layout.tsx`:
```tsx
import '../global.css';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider, RTL_LOCALES } from '@nomad/i18n';
import { useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import { useAuth } from '../src/auth/store';
import { setupApiClients } from '../src/api/setup';
import { currentLocale } from '../src/locale';
import { initObservability } from '../src/observability';

initObservability();
setupApiClients();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export default function RootLayout() {
  const hydrated = useAuth((s) => s.hydrated);
  const [locale] = useState(currentLocale);
  useEffect(() => { void useAuth.getState().hydrate(); }, []);
  useEffect(() => {
    const rtl = RTL_LOCALES.has(locale);
    if (I18nManager.isRTL !== rtl) { I18nManager.allowRTL(rtl); I18nManager.forceRTL(rtl); } // takes effect on next launch
  }, [locale]);
  if (!hydrated) return null;
  return (
    <IntlProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </IntlProvider>
  );
}
```
Phase 0 applies RTL on the next launch rather than through `expo-updates` reload; record this in the Phase 1 notes in CLAUDE.md.

`app/(tabs)/_layout.tsx` defines Tabs `find`, `videos` and `account`. Titles come from `t('tabs.*')`, and testIDs are `tab-find`, `tab-videos` and `tab-account` (via `tabBarButtonTestID`). Use `@expo/vector-icons` Ionicons (search, film, person). Add `app/index.tsx` containing `<Redirect href="/find" />`.

`app/(tabs)/find.tsx`:
- `Screen testID="find-screen"`
- `TextField testID="find-search-input"` with the label `t('find.searchPlaceholder')`
- a heading: `t('find.popularHeading')` when `mode === 'popular'`
- `List testID="find-list"` whose rows are Pressables (`testID={\`song-row-${id}\`}`) showing the title, artist and `t('find.karaokeVersions', {count: brand_count})`, and pushing `/song/[id]`
- empty state `t('find.noResults', {query})`
- error state: `t('common.error')` plus `Button testID="find-retry"`
- footer row `Button testID="find-make-any"` with the label `t('find.makeAnySong')`, pushing `/song/new`

`app/song/[id].tsx`:
- loads `getSong(Number(id))` through `useQuery`. When `id === 'new'`, it shows TextFields for artist and title instead.
- shows the title and artist.
- `Button testID="song-make"`:
  - signed out: the label `t('song.signInToMake')` and `router.push({ pathname: '/sign-in/email', params: { returnTo: \`/song/${id}\` } })`
  - signed in: the label `t('song.makeVideo')`. In Phase 0, pressing it opens an `Alert` placeholder (the text comes from `t('common.continue')`); the make flow is Phase 1.

`app/sign-in/email.tsx`:
- `TextField testID="signin-email"` with `keyboardType="email-address"`, `autoComplete="email"` and `autoFocus`
- `Button testID="signin-send"` calls `requestCode` and then `router.replace({ pathname: '/sign-in/code', params: { returnTo } })`
- an `invalid_email` error shows `t('signIn.emailInvalid')`
- when the mock is active, shows `t('signIn.devMockNotice')`

`app/sign-in/code.tsx`:
- `TextField testID="signin-code"` with `keyboardType="number-pad"` and `autoComplete="one-time-code"`
- `Button testID="signin-verify"` calls `verify`, then `router.dismissTo(returnTo ?? '/find')`
- errors show `t('signIn.codeInvalid')`

`app/(tabs)/videos.tsx`:
- signed out: `t('videos.signInPrompt')` plus `Button testID="videos-signin"`
- signed in: the empty state `t('videos.emptyTitle')` / `t('videos.emptyBody')` with testID `videos-empty`

`app/(tabs)/account.tsx`:
- signed in: `t('account.signedInAs', {email})` plus `Button testID="account-signout"`
- signed out: `Button testID="account-signin"`
- `t('account.language')` row showing the current locale name (read-only in Phase 0)

- [ ] **Step 7: Run tests and verify they pass**

Run: `pnpm jest --selectProjects mobile && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile pnpm-lock.yaml && git commit -m "feat(mobile): providers, mock email-code auth, Find/Song/Videos/Account placeholder screens"
```

---

### Task 7: Observability (Sentry + PostHog, no-op unless configured)

**Files:**
- Create: `apps/mobile/src/observability.ts`
- Test: `apps/mobile/src/__tests__/observability.test.ts`

**Interfaces:**
- Produces: `initObservability(): { sentry: boolean; posthog: boolean }`, `track(event: string, props?: Record<string, unknown>): void`

- [ ] **Step 1: Install**

`cd apps/mobile && npx expo install @sentry/react-native posthog-react-native && cd ../..`. Do **not** run the Sentry wizard; it wants a login. Don't add the Sentry Expo config plugin with an org/project yet; add a CLAUDE.md note saying that comes with the account.

- [ ] **Step 2: Write failing test**

```ts
jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));
jest.mock('posthog-react-native', () => ({ PostHog: jest.fn().mockImplementation(() => ({ capture: jest.fn() })) }));

beforeEach(() => { jest.resetModules(); delete process.env.EXPO_PUBLIC_SENTRY_DSN; delete process.env.EXPO_PUBLIC_POSTHOG_KEY; });

it('is a no-op without env', () => {
  const { initObservability, track } = require('../observability');
  expect(initObservability()).toEqual({ sentry: false, posthog: false });
  expect(() => track('x')).not.toThrow();
  expect(require('@sentry/react-native').init).not.toHaveBeenCalled();
});

it('initializes when configured', () => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://k@o.ingest.sentry.io/1';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  const { initObservability } = require('../observability');
  expect(initObservability()).toEqual({ sentry: true, posthog: true });
});
```

- [ ] **Step 3: Run it and verify it fails, then implement**

```ts
import * as Sentry from '@sentry/react-native';
import { PostHog } from 'posthog-react-native';

let posthog: PostHog | null = null;
export function initObservability() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const phKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (dsn) Sentry.init({ dsn, tracesSampleRate: 0.2, sendDefaultPii: false });
  if (phKey) posthog = new PostHog(phKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com' });
  return { sentry: Boolean(dsn), posthog: Boolean(phKey) };
}
export function track(event: string, props?: Record<string, unknown>) { posthog?.capture(event, props as never); }
```
Run: `pnpm jest --selectProjects mobile -t observability`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile && git commit -m "feat(mobile): env-gated Sentry + PostHog init (no-op without keys)"
```

---

### Task 8: Native dev builds, agent tooling, Maestro smoke flows

**Files:**
- Create: `.mcp.json`, `maestro/flows/{smoke-find.yaml,smoke-signin-gate.yaml}`, `maestro/config.yaml`
- Modify: `CLAUDE.md` (rewrite), `README.md` (rewrite), `.gitignore` (add `apps/mobile/ios/`, `apps/mobile/android/`, `.expo/`, `coverage/`)

**Interfaces:**
- Consumes: the testIDs from Task 6 (`find-search-input`, `song-row-<id>`, `song-make`, `signin-email`, `signin-send`, `signin-code`, `signin-verify`, `tab-*`).

- [ ] **Step 1: Agent tooling**

```bash
claude plugin install expo@claude-plugins-official --scope project
cd apps/mobile && npx expo install expo-mcp -- --save-dev && cd ../..
```
If `claude plugin install` isn't available from inside the session, write the equivalent project settings by hand. Look up the format with `npx ctx7@latest docs` for Expo's "agents/claude" page, or with the claude-code-guide agent.

`.mcp.json`:
```json
{
  "mcpServers": {
    "maestro": { "command": "maestro", "args": ["mcp"] }
  }
}
```
The local Expo MCP runs by starting the dev server with `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start` (Expo docs: docs.expo.dev/mcp). Document the exact connection step from those docs in CLAUDE.md. **Skip the remote Expo MCP, because it needs an Expo account login. Note it as pending Andrew's approval.**

- [ ] **Step 2: Build and run on iOS simulator**

```bash
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios --device "iPhone 16 Pro"
```
Expected: the app launches on the Find tab, popular songs load from prod decide, and searching "hello" shows Lionel Richie. Take a screenshot with `xcrun simctl io booted screenshot /tmp/.../find.png`, or with the expo-mcp `automation_take_screenshot` tool, and look at it.

If the iOS 18.1 simulator runtime is too old for the SDK 57 minimum deployment target, run `xcodebuild -downloadPlatform iOS` only after asking Andrew, because it is a multi-GB download.

- [ ] **Step 3: Build and run on Android emulator**

```bash
emulator -list-avds   # pick one; if none exist, create one with avdmanager using an installed system image
npx expo run:android
```
Expected: the same behavior. If there is no AVD or system image, ask Andrew before downloading a system image (multi-GB).

- [ ] **Step 4: Maestro flows**

`maestro/config.yaml`:
```yaml
flows:
  - flows/*
```

`maestro/flows/smoke-find.yaml`:
```yaml
appId: com.nomadkaraoke.mobile
---
- launchApp: { clearState: true }
- assertVisible: { id: "find-search-input" }
- tapOn: { id: "find-search-input" }
- inputText: "hello"
- extendedWaitUntil: { visible: { id: "song-row-43362" }, timeout: 15000 }
- tapOn: { id: "song-row-43362" }
- assertVisible: { id: "song-make" }
```
(43362 is decide's id for Lionel Richie "Hello", verified 2026-10-14. If the catalog id changes, use `- tapOn: { text: "Hello" }` instead.)

`maestro/flows/smoke-signin-gate.yaml`:
```yaml
appId: com.nomadkaraoke.mobile
---
- launchApp: { clearState: true }
- tapOn: { id: "find-search-input" }
- inputText: "hello"
- extendedWaitUntil: { visible: { id: "song-row-43362" }, timeout: 15000 }
- tapOn: { id: "song-row-43362" }
- tapOn: { id: "song-make" }
- assertVisible: { id: "signin-email" }
- tapOn: { id: "signin-email" }
- inputText: "maestro@example.com"
- tapOn: { id: "signin-send" }
- assertVisible: { id: "signin-code" }
- tapOn: { id: "signin-code" }
- inputText: "123456"
- tapOn: { id: "signin-verify" }
- assertVisible: { id: "song-make" }
- tapOn: { id: "tab-account" }
- assertVisible: { id: "account-signout" }
```

Run: `maestro test maestro/` with the iOS simulator booted and the dev build running, then again on Android.
Expected: both flows pass on both platforms.

- [ ] **Step 5: Rewrite CLAUDE.md and README.md**

`CLAUDE.md` must contain:
- the stack table (from the spec)
- the workspace map
- commands (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm gen:api`, `pnpm i18n:check`/`translate`, `npx expo run:ios`, `maestro test maestro/`, `EXPO_UNSTABLE_MCP_SERVER=1 npx expo start`)
- the **Rules** from spec §3.1 and §3.6, verbatim
- the "never create Apple/Google/EAS/RevenueCat/Sentry/PostHog accounts or spend money without asking Andrew" rule
- links to the spec, this plan and the stack research doc (`../docs/archive/2026-10-14-mobile-app-stack-research.md`)
- a "Phase 1 notes" section: swap `mockAuthApi` for gen's `send-code`/`verify-code`; RTL reload via `expo-updates`; Sentry Expo plugin with org/project; remote Expo MCP; Maestro in CI

`README.md` covers the status, a quick start and the workspace layout.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: agent tooling (expo plugin, expo-mcp, maestro mcp), Maestro smoke flows, docs"
```

---

### Task 9: CI (GitHub Actions) + dormant EAS config

**Files:**
- Create: `.github/workflows/ci.yml`, `apps/mobile/eas.json`, `.eas/workflows/{ci.yml,release.yml}`

- [ ] **Step 1: `ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - name: i18n completeness (hard fail)
        run: pnpm i18n:check
      - name: OpenAPI drift (generated code matches committed snapshot)
        run: pnpm gen:api:offline && git diff --exit-code -- packages/api-gen/src/client packages/api-decide/src/client
      - name: expo-doctor
        working-directory: apps/mobile
        run: npx expo-doctor
```
Check whether `validate-translations.py` needs any pip packages beyond the stdlib. If it does, add `pip install -r packages/i18n/scripts/requirements.txt`.

- [ ] **Step 2: Dormant EAS config**

`apps/mobile/eas.json`:
```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "channel": "development" },
    "preview": { "distribution": "internal", "channel": "preview" },
    "production": { "channel": "production", "autoIncrement": true }
  },
  "submit": { "production": {} }
}
```

`.eas/workflows/ci.yml` and `release.yml` follow the EAS Workflows docs (ctx7 `/expo/expo` "EAS workflows maestro job"):
- `ci.yml`: on PR, lint, test and a preview update
- `release.yml`: on main, `build` (ios + android, production) → `maestro` (needs a paid plan, so comment the job out with a note) → `submit`

Add a header comment to both files: `# DORMANT: requires an Expo account + project id (ask Andrew before creating).`

Do **not** set `runtimeVersion` / `updates.url` in app.json yet; they need a project id. Note this in CLAUDE.md Phase 1 notes.

- [ ] **Step 3: Verify locally**

Run the CI steps by hand: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm i18n:check && pnpm gen:api:offline && git diff --exit-code`
Expected: all pass, and coverage is at least 70%.

- [ ] **Step 4: Commit and push; confirm CI green**

```bash
git add -A && git commit -m "ci: GitHub Actions checks + dormant EAS build/workflow config"
git push -u origin HEAD
gh run watch --exit-status $(gh run list --branch "$(git branch --show-current)" --limit 1 --json databaseId -q '.[0].databaseId')
```
Expected: the CI workflow and the existing security workflow are both green.

---

## Self-review notes (completed while writing)

- **Spec coverage:**
  - §3 layout: Tasks 1–6 and 8–9
  - §3.1 rules: Task 1 ESLint, Task 5, Task 8 CLAUDE.md
  - §3.2: Task 4
  - §3.3: Tasks 2 and 6
  - §3.4: Task 3
  - §3.5: Task 7
  - §3.6: Task 8
  - §3.7: Task 9
  - §2 and §4 are Phase 1 by design (spec §1). The only Phase 0 artifact for them is the mock `AuthApi`, which matches §4.1's shape.
- **Gap fixed:** spec §3.1's no-hardcoded-strings rule is enforced in Task 1 by a `no-restricted-syntax` JSXText selector (no extra plugin needed), and Task 1 Step 5 verifies it.
- **Placeholder scan:** clean. Where a library API detail could differ in the pinned version (hey-api interceptors, the FlashList and Skia jest mocks, the Uniwind/SDK 57 fit), the task names the ctx7 lookup, and the tests define the behavior.
- **Type consistency:** `ClientDeps`, `configureClient`, `ApiError`, `AuthApi`, `useAuth`, `useSongSearch`, `List`, `WaveformCanvas` and `buildBars` are used the same way in every task.
