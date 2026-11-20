import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { FAILURE_REASONS, type FailureReason } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { orderNo } from '../../lib/orders';
import { enqueue } from '../../lib/outbox';
import { backToRoute, useStaffDay } from '../../lib/staff';

/** Couldn't deliver: one tap on a reason. A note is needed only for "Something else". */
export default function NotDelivered() {
  const { t } = useTranslation();
  const { order = '' } = useLocalSearchParams<{ order?: string }>();
  const q = useStaffDay();
  const s = q.data?.stops.find((x) => x.orderId === order);
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [note, setNote] = useState('');
  const ready = !!s && reason !== null && (reason !== 'OTHER' || note.trim().length > 0);

  const save = () => {
    if (!s || !reason) return;
    const id = Crypto.randomUUID();
    void enqueue({
      id,
      kind: 'not-delivered',
      orderId: s.orderId,
      path: `/staff/orders/${s.orderId}/not-delivered`,
      body: {
        clientActionId: id,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        at: new Date().toISOString(),
      },
    });
    backToRoute();
  };

  return (
    <Screen footer={<Button label={t('staff.saveReason')} disabled={!ready} onPress={save} />}>
      <Header
        title={t('staff.failTitle')}
        subtitle={s ? (s.customerName ?? orderNo(s.orderNo)) : undefined}
        back
      />
      <Text muted>{t('staff.failBody')}</Text>
      <ChoiceList
        label={t('staff.failTitle')}
        value={reason}
        onChange={setReason}
        choices={FAILURE_REASONS.map((r) => ({ value: r, label: t(`staff.reason.${r}`) }))}
      />
      {reason ? (
        <TextField
          label={reason === 'OTHER' ? t('staff.noteRequired') : t('staff.noteOptional')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
      ) : null}
    </Screen>
  );
}
