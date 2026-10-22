import { useTranslations } from '@nomad/i18n';
import { Button, Text, TextField } from '@nomad/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { useNightStore } from '../nightStore';
import { TonightSheet } from '../TonightSheet';

/**
 * The empty state's "At another karaoke night? Start logging tonight" (spec §6.2, ruling E9-R2): asks for an
 * optional venue name, then starts an Other night. E3 places it in the full empty state.
 */
export function StartOtherNight() {
  const t = useTranslations('tonight.other');
  const [open, setOpen] = useState(false);
  const [venue, setVenue] = useState('');
  const start = () => {
    setOpen(false);
    useNightStore.getState().startOther(venue);
  };
  return (
    <View className="gap-2">
      <Text variant="muted">{t('startPrompt')}</Text>
      <Button testID="tonight-start-other" variant="secondary" label={t('start')} onPress={() => setOpen(true)} />
      <TonightSheet visible={open} onClose={() => setOpen(false)} title={t('startTitle')} testID="tonight-start-other-sheet" closeLabel={t('close')}>
        <View className="gap-3 pb-2">
          <TextField
            testID="tonight-venue-input"
            label={t('venueLabel')}
            placeholder={t('venuePlaceholder')}
            value={venue}
            onChangeText={setVenue}
            autoCapitalize="words"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={start}
          />
          <Button testID="tonight-start-other-confirm" label={t('startConfirm')} onPress={start} />
        </View>
      </TonightSheet>
    </View>
  );
}
