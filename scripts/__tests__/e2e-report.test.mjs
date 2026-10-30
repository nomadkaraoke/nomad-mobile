// scripts/ci/e2e-report.mjs: JUnit parsing and the Android guard's infra summary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guardSummary, parseJunit } from '../ci/e2e-report.mjs';

const junit = (device, cases) => `<?xml version="1.0"?><testsuites><testsuite name="Test Suite" device="${device}">${cases}</testsuite></testsuites>`;

test('parseJunit reads passes and failures with their message', () => {
  const xml = junit('emulator-5554', '<testcase id="a" name="make-1" time="12.5"/>' +
    '<testcase id="b" name="review-3" time="3"><failure message="Assertion is false: id: make-list is visible"/></testcase>');
  assert.deepEqual(parseJunit(xml, 'android', 1), [
    { platform: 'android', shard: 1, flow: 'make-1', ok: true, seconds: 12.5, message: '' },
    { platform: 'android', shard: 1, flow: 'review-3', ok: false, seconds: 3, message: 'Assertion is false: id: make-list is visible' },
  ]);
});

test('parseJunit drops a report from the other platform (a stale file on a self-hosted lane)', () => {
  const android = junit('emulator-5556', '<testcase id="a" name="make-1" time="1"/>');
  const ios = junit('2B1C3D4E-0000-1111-2222-333344445555', '<testcase id="a" name="make-1" time="1"/>');
  assert.equal(parseJunit(android, 'ios', 0).length, 0);
  assert.equal(parseJunit(ios, 'android', 0).length, 0);
  assert.equal(parseJunit(ios, 'ios', 0).length, 1);
});

test('guardSummary counts the guard events by kind', () => {
  const log = [
    'android-guard 12:00:33: emulator-5554 is offline; reconnecting',
    'android-guard 12:00:41: emulator-5554 back after 8 s',
    'android-guard 12:00:45: emulator-5554 lost adb reverse for 8010 8020; re-adding',
    'android-guard 12:10:45: emulator-5554 lost adb reverse for 8010; re-adding',
    'android-guard 12:20:00: emulator-5554: emulator process gone; rebooting it',
    'unrelated line',
  ].join('\n');
  assert.equal(guardSummary(log), 'lost adb reverse ×2, adb offline ×1, emulator died and was rebooted ×1');
  assert.equal(guardSummary('android-guard 1: emulator-5554 back after 3 s\n'), '');
});
