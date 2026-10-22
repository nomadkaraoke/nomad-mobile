import { JoinScreen } from '../../tonight/JoinScreen';

/** Join a Nomad night: `/tonight/join?t=<code>` (QR, link, typed code; spec §4.2). */
export default function TonightJoinRoute() {
  return <JoinScreen />;
}
