// Final review I2: the import screen only reads and deletes the picker's and share intake's cache copies.
import { isImportableFileUri } from '../../discover/connect/importFileUri';

jest.mock('expo-file-system', () => require('../../test-utils/memoryFs'));

// memoryFs: Paths.cache = 'file:///cache'
describe('isImportableFileUri', () => {
  it.each([
    'file:///cache/DocumentPicker/4F1C2B7A-9D0E-4A51-8E2B-1C3D5E7F9A0B.zip',
    'file:///cache/DocumentPicker/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab.csv',
    'file:///cache/shared/1729999999999-1/my_spotify_data.zip',
    'file:///cache/shared/1729999999999-2/Apple_Music_Play_Activity.csv',
  ])('accepts the picker / share copy %s', (uri) => {
    expect(isImportableFileUri(uri)).toBe(true);
  });

  it.each([
    [undefined],
    [''],
    ['file:///cache/my_spotify_data.zip'], // the cache, but not a picker or share folder
    ['file:///cache/offline/offline.db'],
    ['file:///document/imports/abc.json'], // the queue's own payloads
    ['file:///document/shared/export.zip'],
    ['content://com.android.providers.downloads.documents/document/1'],
    ['/cache/DocumentPicker/a.zip'], // not a file:// uri
    ['FILE:///cache/DocumentPicker/a.zip'],
    ['file:///cache/DocumentPicker/'],
    ['file:///cache/DocumentPicker'],
    ['file:///cache/DocumentPicker/../offline/offline.db'],
    ['file:///cache/shared/../../files/mmkv/default'],
    ['file:///cache/shared/./a.zip'],
    ['file:///cache/DocumentPicker/%2e%2e/offline/offline.db'],
    ['file:///cache/DocumentPicker/%2E%2E%2Foffline%2Foffline.db'],
    ['file:///cache/DocumentPicker/%252e%252e/offline.db'],
    ['file:///cache/DocumentPicker/..%5Coffline.db'],
    ['file:///cache/DocumentPicker/a.zip?x=1'],
    ['file:///cache/DocumentPicker/a.zip#x'],
    ['file:///cache/DocumentPicker//a.zip'],
    ['file:///cache/DocumentPickerX/a.zip'],
    ['file:///cache/sharedfoo/a.zip'],
    ['file:///other/cache/DocumentPicker/a.zip'],
  ])('refuses %s', (uri) => {
    expect(isImportableFileUri(uri)).toBe(false);
  });
});
