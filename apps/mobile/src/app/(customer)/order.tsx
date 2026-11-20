import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { ApiError, api } from '../../lib/api';
import { areaLabel, useProfile } from '../../lib/customer';
import { errorText } from '../../lib/errors';
import {
  ordersKey,
  quoteFor,
  useOrderOptions,
  windowLabel,
  type OrderDetail,
} from '../../lib/orders';

/** One screen from quantity to "Place order", pre-filled with the last quantity and earliest time. */
export default function OrderScreen() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ qty?: string }>();
  const profile = useProfile();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [choosingAddress, setChoosingAddress] = useState(false);
  const options = useOrderOptions(addressId);
  const o = options.data;
  const [qty, setQty] = useState<number | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id for this order screen: tapping twice, or retrying after a dropped connection, saves one order.
  const [requestId] = useState(() => Crypto.randomUUID());

  useEffect(() => {
    if (!o) return;
    if (qty === null) {
      const wanted = Number(params.qty);
      setQty(Number.isInteger(wanted) && wanted > 0 ? Math.min(wanted, o.maxCans) : o.defaultQty);
    }
    const first = o.windows[0];
    const still = o.windows.some((w) => `${w.date}|${w.windowId}` === slot);
    if (!still) setSlot(first ? `${first.date}|${first.windowId}` : null);
  }, [o, qty, slot, params.qty]);

  if (options.isPending || profile.isPending) {
    return (
      <Screen>
        <Header title={t('customer.orderTitle')} back />
        <Skeleton lines={5} />
      </Screen>
    );
  }
  if (options.isError || !o) {
    return (
      <Screen>
        <Header title={t('customer.orderTitle')} back />
        <ErrorState message={errorText(t, options.error)} onRetry={() => void options.refetch()} />
      </Screen>
    );
  }

  const lang = i18n.language;
  const n = qty ?? o.defaultQty;
  const q = quoteFor(o, n);
  const addresses = profile.data?.addresses ?? [];
  const address = addresses.find((a) => a.id === o.addressId);
  const chosen = o.windows.find((w) => `${w.date}|${w.windowId}` === slot);
  const productName = lang === 'ml' ? o.product.nameMl : o.product.nameEn;
  const delivery =
    q.deliveryChargePaise > 0
      ? t('order.deliveryCharge', { amount: formatINR(q.deliveryChargePaise) })
      : t('customer.deliveryFree');

  const place = async () => {
    if (!chosen || !address) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: OrderDetail }>('/customer/orders', {
        method: 'POST',
        body: {
          clientRequestId: requestId,
          addressId: address.id,
          windowId: chosen.windowId,
          date: chosen.date,
          qty: n,
          expectedTotalPaise: q.totalPaise,
        },
      });
      await qc.invalidateQueries({ queryKey: ordersKey });
      await qc.invalidateQueries({ queryKey: ['customer', 'order-options'] });
      router.replace({ pathname: '/(customer)/placed', params: { id: r.order.id } });
    } catch (e) {
      setError(errorText(t, e));
      // A full time or a new price: show the latest choices and total, then let them tap again.
      if (
        e instanceof ApiError &&
        ['WINDOW_FULL', 'PRICE_CHANGED', 'TOO_LATE_FOR_WINDOW', 'DAY_CLOSED'].includes(e.code)
      ) {
        await options.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <View style={styles.summary}>
            <Text muted style={styles.flex}>
              {t('customer.summary', { count: n, price: formatINR(o.unitPricePaise), delivery })}
            </Text>
            <Text variant="title">{formatINR(q.totalPaise)}</Text>
          </View>
          {error ? <Message tone="warning" text={error} /> : null}
          <Button
            label={
              busy
                ? t('order.placing')
                : t('customer.placeOrder', { total: formatINR(q.totalPaise) })
            }
            onPress={() => void place()}
            disabled={busy || !chosen || !address}
          />
        </>
      }
    >
      <Header title={t('customer.orderTitle')} back />

      <Card>
        <View>
          <Text variant="title">{productName}</Text>
          <Text muted>
            {t('customer.perCan', { price: formatINR(o.unitPricePaise) })}
            {o.specialPrice ? ` · ${t('order.yourPrice')}` : ''}
          </Text>
        </View>
        <View style={styles.center}>
          <Stepper value={n} onChange={setQty} min={1} max={o.maxCans} label={t('customer.cans')} />
          <Text muted>{t('customer.cans')}</Text>
        </View>
        {n === o.maxCans ? (
          <Message tone="info" text={t('customer.maxReached', { max: o.maxCans })} />
        ) : null}
      </Card>

      {address ? (
        <Card style={styles.addressRow}>
          <Icon name="pin" color={colors.primary} />
          <View style={styles.flex}>
            <Text variant="label" muted>
              {t('customer.deliverTo')}
            </Text>
            <Text variant="title">{address.label}</Text>
            <Text muted>
              {address.line} · {areaLabel(address, lang)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('order.changeAddress')}
            style={styles.change}
            onPress={() =>
              addresses.length > 1
                ? setChoosingAddress((v) => !v)
                : router.push('/(customer)/address')
            }
          >
            <Text variant="label" color={colors.primary}>
              {addresses.length > 1 ? t('customer.change') : t('order.addAddress')}
            </Text>
          </Pressable>
        </Card>
      ) : (
        <Button
          variant="secondary"
          label={t('order.addAddress')}
          onPress={() => router.push('/(customer)/address')}
        />
      )}
      {choosingAddress ? (
        <ChoiceList
          label={t('customer.deliverTo')}
          value={o.addressId}
          onChange={(id) => {
            setAddressId(id);
            setChoosingAddress(false);
          }}
          choices={addresses.map((a) => ({ value: a.id, label: a.label, note: a.line }))}
        />
      ) : null}

      <Text variant="title">{t('customer.when')}</Text>
      {o.windows.length === 0 ? (
        <>
          <Message tone="warning" text={t('order.noWindows')} />
          {o.supportPhone ? (
            <Button
              variant="secondary"
              icon="phone"
              label={t('customer.callUs')}
              onPress={() => void Linking.openURL(`tel:${o.supportPhone}`)}
            />
          ) : null}
        </>
      ) : (
        <ChoiceList
          label={t('customer.when')}
          value={slot}
          onChange={setSlot}
          choices={o.windows.slice(0, 6).map((w, i) => {
            const value = `${w.date}|${w.windowId}`;
            return {
              value,
              label: windowLabel(t, w, lang),
              note:
                w.remainingCans < n
                  ? t('order.almostFull', { count: w.remainingCans })
                  : value === slot
                    ? t('customer.selected')
                    : i === 0
                      ? t('customer.earliest')
                      : undefined,
            };
          })}
        />
      )}

      <Message tone="info" icon="cash" text={t('customer.payNote')} />
      {q.depositPaise > 0 ? (
        <Message
          tone="info"
          text={t('customer.depositNote', {
            amount: formatINR(q.depositPaise),
            count: q.depositCans,
          })}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.xs },
  addressRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  change: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
});
