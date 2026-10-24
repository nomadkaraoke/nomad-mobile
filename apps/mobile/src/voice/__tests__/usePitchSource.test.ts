import { renderHook } from '@testing-library/react-native';

const mic = { kind: 'mic' };
const fake = { kind: 'fake' };
jest.mock('../useMicPitchSource', () => ({ useMicPitchSource: () => mic }));
jest.mock('../useFakePitchSource', () => ({ useFakePitchSource: () => fake }));

function load(fakeMic: string | null) {
  let hook!: typeof import('../usePitchSource').usePitchSource;
  jest.isolateModules(() => {
    jest.doMock('../../config', () => ({ FAKE_MIC: fakeMic }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hook = require('../usePitchSource').usePitchSource;
  });
  return hook;
}

it('uses the real microphone when FAKE_MIC is null (every release build)', () => {
  const { result } = renderHook(load(null));
  expect(result.current).toBe(mic);
});

it('uses the bundled recording when FAKE_MIC names one (local-stack E2E)', () => {
  const { result } = renderHook(load('baritone-scale'));
  expect(result.current).toBe(fake);
});
