// The upload's multipart body through Expo's own fetch encoder (expo/fetch is the app's global fetch since SDK 57).
// React Native's `{ uri, name, type }` file part made it throw "Unsupported FormDataPart implementation" before any
// request was sent, so no take ever reached decide (found on the simulator in D8).
import { voiceRecordingForm } from '@nomad/api-decide';
// On purpose: Expo's private winter modules (convertFormData, FormData), the exact code the app's global fetch runs,
// are not public API and may move or change. Re-check these imports and this test on every Expo SDK bump.
import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { installFormDataPatch } from 'expo/src/winter/FormData';

const decode = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/**
 * Expo's encoder over a form: the patched append keeps each value as given in `_parts`, and the patched entries()
 * yields those pairs (its generator doesn't iterate under jest's transform, so the pairs are handed over directly).
 */
const encode = (form: FormData) =>
  convertFormDataAsync({ entries: () => (form as unknown as { _parts: unknown[] })._parts } as unknown as FormData, 'B');

describe('voice recording upload body (expo/fetch)', () => {
  // The app's FormData: React Native's, with Expo's append/entries patch (jest's global FormData is Node's).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RNFormData = require('react-native/Libraries/Network/FormData').default as typeof FormData;
  const nodeFormData = globalThis.FormData;
  beforeAll(() => {
    installFormDataPatch(RNFormData);
    globalThis.FormData = RNFormData;
  });
  afterAll(() => {
    globalThis.FormData = nodeFormData;
  });

  it('encodes the take as a file part with decide\'s exact content type', async () => {
    const take = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    const form = voiceRecordingForm({
      sessionId: 's1',
      attemptN: 2,
      durationS: 14.5,
      device: 'Simulator iOS',
      file: { bytes: async () => take },
      contentType: 'audio/wav',
    });
    const { body, boundary } = await encode(form);
    expect(boundary).toBe('B');
    const text = decode(body);
    expect(text).toContain('content-disposition: form-data; name="file"; filename="2.wav"\r\ncontent-type: audio/wav\r\n\r\nRIFF\x01\x02\x03\r\n');
    expect(text).toContain('name="session_id"\r\n\r\ns1\r\n');
    expect(text).toContain('name="attempt_n"\r\n\r\n2\r\n');
    expect(text).toContain('name="duration_s"\r\n\r\n14.5\r\n');
    expect(text.endsWith('--B--\r\n')).toBe(true);
  });

  it('a React Native { uri } part is what expo/fetch refuses', async () => {
    const form = new FormData();
    form.append('file', { uri: 'file:///x.wav', name: 'x.wav', type: 'audio/wav' } as unknown as Blob);
    await expect(encode(form)).rejects.toThrow('Unsupported FormDataPart implementation');
  });
});
