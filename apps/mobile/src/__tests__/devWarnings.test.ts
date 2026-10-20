import { LogBox } from 'react-native';

import { __resetDevWarningTrace, installDevWarningTrace } from '../providers/devWarnings';

const realError = console.error;
let sink: jest.Mock;

beforeEach(() => {
  __resetDevWarningTrace();
  sink = jest.fn();
  console.error = sink;
});
afterEach(() => {
  console.error = realError;
  jest.restoreAllMocks();
});

const WARNING = "Can't perform a React state update on a component that hasn't mounted yet.";

describe('installDevWarningTrace (Ruling T)', () => {
  it('in dev, logs a caller stack after the not-mounted warning, and passes everything through', () => {
    installDevWarningTrace({ dev: true, e2e: false });
    console.error(WARNING);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.calls[0]).toEqual([WARNING]);
    expect(sink.mock.calls[1]![0]).toMatch(/^\[Ruling T\] state update before mount; caller stack:\n(Error|.*at )/s);
    console.error('something else', 3);
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink.mock.calls[2]).toEqual(['something else', 3]);
  });

  it('wraps only once', () => {
    installDevWarningTrace({ dev: true, e2e: false });
    installDevWarningTrace({ dev: true, e2e: false });
    console.error(WARNING);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('does nothing outside dev', () => {
    const ignore = jest.spyOn(LogBox, 'ignoreLogs');
    installDevWarningTrace({ dev: false, e2e: true });
    expect(console.error).toBe(sink);
    expect(ignore).not.toHaveBeenCalled();
  });

  it('hides the LogBox toast only in E2E builds', () => {
    const ignore = jest.spyOn(LogBox, 'ignoreLogs');
    installDevWarningTrace({ dev: true, e2e: false });
    expect(ignore).not.toHaveBeenCalled();
    __resetDevWarningTrace();
    installDevWarningTrace({ dev: true, e2e: true });
    expect(ignore).toHaveBeenCalledWith(["hasn't mounted yet"]);
  });
});
