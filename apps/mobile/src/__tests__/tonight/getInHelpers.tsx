// Shared route table + camera mock state for the "getting in" tests (E3). Not a test file (no `.test.` in the name).
import * as joinRoute from '../../app/tonight/join';
import * as scanRoute from '../../app/tonight/scan';
import { makeRoutes } from '../../test-utils/makeFixtures';

/** The app's routes plus the join and scan screens. */
export const getInRoutes = () => ({ ...makeRoutes(), 'tonight/join': joinRoute, 'tonight/scan': scanRoute });

/** What the mocked expo-camera reports and captures (see each test file's jest.mock). */
export type CameraMockState = {
  permission: { granted: boolean; status: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean } | null;
  request: jest.Mock;
  onScan?: (r: { type: string; data: string }) => void;
  /** The scanner settings the screen passed. */
  settings?: unknown;
};
