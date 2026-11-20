import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { spacing } from '@wtrdrop/design-tokens';
import { addressInputSchema, type AddressInput } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { api, ApiError } from '../../lib/api';
import { profileKey, useProfile, type Address } from '../../lib/customer';
import { errorText } from '../../lib/errors';

type Label = 'home' | 'office' | 'other';

/** Add or change a delivery address. A landmark is required: it is how drivers find houses here. */
export default function AddressScreen() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { id, first } = useLocalSearchParams<{ id?: string; first?: string }>();
  const profile = useProfile();
  const editing = profile.data?.addresses.find((a) => a.id === id);
  const areas = useQuery({
    queryKey: ['service-areas'],
    queryFn: async () =>
      (await api<{ areas: { name: string; nameMl: string | null }[] }>('/service-areas')).areas,
  });

  const [labelKind, setLabelKind] = useState<Label>('home');
  const [otherLabel, setOtherLabel] = useState('');
  const [line, setLine] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pincode, setPincode] = useState('');
  const [note, setNote] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const known: Record<string, Label> = {
      [t('address.home')]: 'home',
      [t('address.office')]: 'office',
    };
    const kind = known[editing.label] ?? 'other';
    setLabelKind(kind);
    if (kind === 'other') setOtherLabel(editing.label);
    setLine(editing.line);
    setLandmark(editing.landmark);
    setPincode(editing.pincode);
    setNote(editing.deliveryNote ?? '');
    if (editing.latitude !== null && editing.longitude !== null)
      setCoords({ latitude: editing.latitude, longitude: editing.longitude });
  }, [editing, t]);

  const label = labelKind === 'other' ? otherLabel.trim() : t(`address.${labelKind}`);
  const input: AddressInput = {
    label,
    line: line.trim(),
    landmark: landmark.trim(),
    pincode: pincode.trim(),
    deliveryNote: note.trim() || null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
  };
  const check = addressInputSchema.safeParse(input);
  const fieldError = (field: keyof AddressInput) =>
    tried && !check.success && check.error.issues.some((i) => i.path[0] === field)
      ? t(`address.errors.${field}`)
      : null;

  const locate = async () => {
    setLocating(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError(t('address.locationDenied'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      setError(t('address.locationFailed'));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    setTried(true);
    if (!check.success) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api<{ address: Address }>(`/customer/addresses/${editing.id}`, {
          method: 'PATCH',
          body: input,
        });
      } else {
        await api<{ address: Address }>('/customer/addresses', { method: 'POST', body: input });
      }
      await qc.invalidateQueries({ queryKey: profileKey });
      if (first) router.replace('/(customer)/home');
      else router.back();
    } catch (e) {
      // Shown on the PIN code field itself, where the person is looking.
      if (e instanceof ApiError && e.code === 'OUTSIDE_SERVICE_AREA') setPinError(errorText(t, e));
      else setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const areaNames = (areas.data ?? [])
    .map((a) => (i18n.language === 'ml' && a.nameMl ? a.nameMl : a.name))
    .join(', ');

  return (
    <Screen
      footer={
        <Button
          label={busy ? t('common.saving') : t('address.save')}
          disabled={busy}
          onPress={() => void save()}
        />
      }
    >
      <Header
        title={
          editing ? t('address.editTitle') : first ? t('address.firstTitle') : t('address.addTitle')
        }
        back={!first}
      />
      {first ? <Text muted>{t('address.firstBody')}</Text> : null}
      <ChoiceList
        layout="row"
        label={t('address.labelLabel')}
        value={labelKind}
        onChange={setLabelKind}
        choices={[
          { value: 'home', label: t('address.home') },
          { value: 'office', label: t('address.office') },
          { value: 'other', label: t('address.other') },
        ]}
      />
      {labelKind === 'other' ? (
        <TextField
          label={t('address.otherLabel')}
          value={otherLabel}
          onChangeText={setOtherLabel}
          maxLength={40}
          error={fieldError('label')}
        />
      ) : null}
      <TextField
        label={t('address.lineLabel')}
        hint={t('address.lineHint')}
        value={line}
        onChangeText={setLine}
        maxLength={200}
        multiline
        error={fieldError('line')}
      />
      <TextField
        label={t('address.landmarkLabel')}
        hint={t('address.landmarkHint')}
        value={landmark}
        onChangeText={setLandmark}
        maxLength={120}
        error={fieldError('landmark')}
      />
      <TextField
        label={t('address.pincodeLabel')}
        value={pincode}
        onChangeText={(v) => {
          setPinError(null);
          setPincode(v.replace(/\D/g, '').slice(0, 6));
        }}
        keyboardType="number-pad"
        autoComplete="postal-code"
        error={fieldError('pincode') ?? pinError}
        hint={areaNames ? t('address.weDeliver', { areas: areaNames }) : undefined}
      />
      <TextField
        label={t('address.noteLabel')}
        hint={t('address.noteHint')}
        value={note}
        onChangeText={setNote}
        maxLength={200}
      />
      <View style={styles.locRow}>
        <Button
          variant="secondary"
          icon="pin"
          compact
          label={
            locating
              ? t('address.locating')
              : coords
                ? t('address.locationSaved')
                : t('address.useLocation')
          }
          selected={!!coords}
          disabled={locating}
          onPress={() => void locate()}
        />
        <Text variant="caption" muted>
          {t('address.locationWhy')}
        </Text>
      </View>
      {error ? <Message tone="warning" text={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ locRow: { gap: spacing.xs } });
