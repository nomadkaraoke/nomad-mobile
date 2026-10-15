import { IntlProvider, RTL_LOCALES } from '@nomad/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';

import { setupApiClients } from '../api/setup';
import { useAuth } from '../auth/store';
import { currentLocale } from '../locale';

setupApiClients();

/** i18n + server-state providers; renders nothing until the stored session has been read. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const hydrated = useAuth((s) => s.hydrated);
  const [locale] = useState(currentLocale);

  useEffect(() => {
    if (!useAuth.getState().hydrated) void useAuth.getState().hydrate();
  }, []);

  useEffect(() => {
    // Takes effect on next launch; Phase 1 reloads via expo-updates instead.
    const rtl = RTL_LOCALES.has(locale);
    if (I18nManager.isRTL !== rtl) {
      I18nManager.allowRTL(rtl);
      I18nManager.forceRTL(rtl);
    }
  }, [locale]);

  if (!hydrated) return null;
  return (
    <IntlProvider locale={locale}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </IntlProvider>
  );
}
