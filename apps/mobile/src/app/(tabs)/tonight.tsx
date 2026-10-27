import { useTonightFocusTracking } from '../../notifications/handler';
import { usePendingPushAsk } from '../../notifications/usePendingPushAsk';
import { installPendingMakePurge } from '../../tonight/make/pendingMake';
import { TonightHome } from '../../tonight/TonightHome';

// App open and every night change: forget other nights' pending makes (their ids are no use to a new night).
// (Module scope: runs once, when the tab's module first loads.)
installPendingMakePurge();

/** Tonight: the night home, the Other-night log, or the ways in (TonightHome). */
export default function TonightScreen() {
  // Tonight pushes (up next, your turn) stay quiet while this tab is in front: the status tile says it.
  useTonightFocusTracking();
  // Just joined a Nomad night: the in-context push question, now that the join sheet has gone.
  usePendingPushAsk('night');
  return <TonightHome />;
}
