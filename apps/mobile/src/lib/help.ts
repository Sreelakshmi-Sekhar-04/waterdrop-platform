import { useQuery } from '@tanstack/react-query';
import type { ComplaintCategory } from '@wtrdrop/shared';
import { api } from './api';

export interface MyComplaint {
  id: string;
  orderId: string | null;
  orderNo: number | null;
  category: ComplaintCategory;
  note: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export const complaintsKey = ['customer', 'complaints'] as const;

export function useMyComplaints() {
  return useQuery({
    queryKey: complaintsKey,
    queryFn: async () =>
      (await api<{ complaints: MyComplaint[] }>('/customer/complaints')).complaints,
  });
}

export interface AppMessage {
  id: number;
  kind: string;
  orderId: string | null;
  read: boolean;
  createdAt: string;
  title: string;
  body: string;
}

export const messagesKey = ['customer', 'messages'] as const;

/** Messages from the business (deliveries, dues, complaints). Checked again every two minutes. */
export function useMessages() {
  return useQuery({
    queryKey: messagesKey,
    queryFn: () => api<{ messages: AppMessage[]; unread: number }>('/customer/messages'),
    refetchInterval: 120_000,
  });
}

/** "+919876543210" → links that open the phone app and WhatsApp. */
export const telLink = (phone: string) => `tel:${phone}`;
export const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
