import { useQuery } from '@tanstack/react-query';
import type { CustomerType, Language } from '@wtrdrop/shared';
import { api } from './api';

export interface Address {
  id: string;
  label: string;
  line: string;
  landmark: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  deliveryNote: string | null;
  isDefault: boolean;
  areaName: string;
  areaNameMl: string | null;
}

export interface CustomerProfile {
  id: string;
  name: string | null;
  phone: string;
  preferredLanguage: Language;
  type: CustomerType;
  privacyAcceptedAt: string | null;
  addresses: Address[];
}

export const profileKey = ['customer', 'profile'] as const;

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: profileKey,
    enabled,
    queryFn: async () => (await api<{ customer: CustomerProfile }>('/customer/profile')).customer,
  });
}

/** Area name in the reader's language. */
export const areaLabel = (a: Pick<Address, 'areaName' | 'areaNameMl'>, lang: string) =>
  lang === 'ml' && a.areaNameMl ? a.areaNameMl : a.areaName;
