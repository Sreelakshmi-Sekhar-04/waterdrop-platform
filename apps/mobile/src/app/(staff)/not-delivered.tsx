import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { findStop } from '../../demo/fixtures';

const REASONS = ['NotHome', 'Locked', 'Refused', 'WrongAddress', 'NoStock', 'Other'] as const;
type Reason = (typeof REASONS)[number];

/** Couldn't deliver: one tap on a reason. A note is needed only for "Something else". */
export default function NotDelivered() {
  const { t } = useTranslation();
  const { stop = '' } = useLocalSearchParams<{ stop?: string }>();
  const s = findStop(Number(stop));
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const ready = reason !== null && (reason !== 'Other' || note.trim().length > 0);

  return (
    <Screen
      footer={
        <Button
          label={t('staff.saveReason')}
          disabled={!ready}
          onPress={() => router.replace('/(staff)/route')}
        />
      }
    >
      <Header title={t('staff.failTitle')} subtitle={s?.name} back />
      <Text muted>{t('staff.failBody')}</Text>
      <ChoiceList
        label={t('staff.failTitle')}
        value={reason}
        onChange={setReason}
        choices={REASONS.map((r) => ({ value: r, label: t(`staff.reason${r}`) }))}
      />
      {reason ? (
        <TextField
          label={reason === 'Other' ? t('staff.noteRequired') : t('staff.noteOptional')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
      ) : null}
    </Screen>
  );
}
