import * as kjbox from '@nomad/api-kjbox';
import * as Clipboard from 'expo-clipboard';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { TipsScreen, tipUrl } from '../../../tonight/manage/TipsScreen';
import type { NomadNight } from '../../../tonight/nightStore';
import { renderTonight } from '../../../test-utils/tonightFixtures';
import { requestResult, restoreTiming, setupNight } from './setup';

jest.mock('@nomad/api-kjbox', () => ({
  ...jest.requireActual('@nomad/api-kjbox'),
  getMe: jest.fn(),
  getNow: jest.fn(),
  getRotation: jest.fn(),
  getNight: jest.fn(),
  getTips: jest.fn(),
  claimTip: jest.fn(),
}));

const api = kjbox as jest.Mocked<typeof kjbox>;
const { KjboxError } = jest.requireActual<typeof kjbox>('@nomad/api-kjbox');
const cash: kjbox.TipMethod = { key: 'cashapp', label: 'CashApp', url: 'https://cash.app/$nomad', amount_style: 'path' };
const venmo: kjbox.TipMethod = { key: 'venmo', label: 'Venmo', url: 'https://venmo.com/nomad', amount_style: 'venmo' };
const zelle: kjbox.TipMethod = { key: 'zelle', label: 'Zelle', value: 'tips@example.com', amount_style: 'copy' };
const card: kjbox.TipMethod = { key: 'stripe', label: 'Card', url: 'https://buy.stripe.com/x', amount_style: 'none' };
const tips = (over: Partial<kjbox.TipsResult> = {}): kjbox.TipsResult => ({
  api_version: '1.0',
  enabled: true,
  threshold: 0,
  kj_name: 'Andrew',
  methods: [cash, venmo, zelle, card],
  ...over,
});

let night: NomadNight;
beforeEach(() => {
  night = setupNight(api);
  api.getTips.mockResolvedValue(tips());
});
afterAll(restoreTiming);

const show = () => renderTonight(<TipsScreen night={night} userKey={null} />);

it('builds amount-first links: path, Venmo pay intent, as-is for card', () => {
  expect(tipUrl(cash, 5, 'n')).toBe('https://cash.app/$nomad/5');
  expect(tipUrl(venmo, 7.5, 'Karaoke tip')).toBe('https://venmo.com/nomad?txn=pay&amount=7.50&note=Karaoke%20tip');
  expect(tipUrl(venmo, 5, 'Propina')).toBe('https://venmo.com/nomad?txn=pay&amount=5&note=Propina');
  expect(tipUrl(card, 5, 'n')).toBe('https://buy.stripe.com/x');
  expect(tipUrl(zelle, 5, 'n')).toBeNull();
});

it('amount first, then a method opens the payment app with it; Zelle copies (A.64, ruling E6-R6)', async () => {
  show();
  fireEvent.press(await screen.findByTestId('tonight-tips-amount-20'));
  fireEvent.press(screen.getByTestId('tonight-tips-method-cashapp'));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://cash.app/$nomad/20');
  fireEvent.changeText(screen.getByTestId('tonight-tips-custom'), '12');
  fireEvent.press(screen.getByTestId('tonight-tips-method-venmo'));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://venmo.com/nomad?txn=pay&amount=12&note=Karaoke%20tip');
  fireEvent.press(screen.getByTestId('tonight-tips-method-zelle'));
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('tips@example.com'));
  expect(await screen.findByText('Copied tips@example.com')).toBeTruthy();
});

it('defaults to the threshold amount and says what it earns', async () => {
  api.getTips.mockResolvedValue(tips({ threshold: 5 }));
  show();
  expect(await screen.findByTestId('tonight-tips-perk')).toHaveTextContent('Tip $5 or more and the host moves your next song up a little.');
  fireEvent.press(screen.getByTestId('tonight-tips-method-cashapp'));
  expect(Linking.openURL).toHaveBeenLastCalledWith('https://cash.app/$nomad/5');
});

it('claims with a client_request_id, reused on retry after a timeout; shows the host is to confirm', async () => {
  api.claimTip
    .mockRejectedValueOnce(new KjboxError('internal', 0, undefined, {}, true))
    .mockResolvedValueOnce(requestResult({ source_type: 'tip', status: 'pending', tip_amount: 10, tip_method: 'Venmo' }));
  show();
  fireEvent.press(await screen.findByTestId('tonight-tips-amount-10'));
  fireEvent.press(screen.getByTestId('tonight-tips-claim-method-1'));
  fireEvent.press(screen.getByTestId('tonight-tips-claim-send'));
  expect(await screen.findByTestId('tonight-tips-claim-error')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tonight-tips-claim-send'));
  await waitFor(() => expect(api.claimTip).toHaveBeenCalledTimes(2));
  const [a, b] = api.claimTip.mock.calls.map((c) => c[1]);
  expect(a).toMatchObject({ amount: 10, method: 'Venmo', night_id: night.nightId });
  expect(a!.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(b!.client_request_id).toBe(a!.client_request_id);
  expect(await screen.findByTestId('tonight-tips-claims')).toHaveTextContent(/\$10 via Venmo.*Sent to the host/);
});

it('a new tip after a settled one gets a new id', async () => {
  api.claimTip.mockResolvedValue(requestResult({ source_type: 'tip', status: 'pending', tip_amount: 5 }));
  show();
  fireEvent.press(await screen.findByTestId('tonight-tips-amount-5'));
  fireEvent.press(screen.getByTestId('tonight-tips-claim-send'));
  await waitFor(() => expect(api.claimTip).toHaveBeenCalledTimes(1));
  await screen.findByTestId('tonight-tips-claims');
  fireEvent.press(screen.getByTestId('tonight-tips-claim-send'));
  await waitFor(() => expect(api.claimTip).toHaveBeenCalledTimes(2));
  const [a, b] = api.claimTip.mock.calls.map((c) => c[1].client_request_id);
  expect(b).not.toBe(a);
});

it('tips switched off says so', async () => {
  api.getTips.mockResolvedValue(tips({ enabled: false }));
  show();
  expect(await screen.findByTestId('tonight-tips-off')).toBeTruthy();
  expect(screen.queryByTestId('tonight-tips-claim')).toBeNull();
});
