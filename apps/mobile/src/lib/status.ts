import type { OrderStatus } from '@wtrdrop/shared';
import type { ChipTone } from '../components/StatusChip';
import type { IconName } from '../components/Icon';

/** How each order status looks to a customer: word + icon + colour. */
export const STATUS_LOOK: Record<OrderStatus, { tone: ChipTone; icon: IconName }> = {
  PLACED: { tone: 'info', icon: 'clock' },
  ACCEPTED: { tone: 'info', icon: 'check' },
  ASSIGNED: { tone: 'info', icon: 'check' },
  OUT_FOR_DELIVERY: { tone: 'info', icon: 'truck' },
  DELIVERED: { tone: 'success', icon: 'check' },
  RESCHEDULE_PENDING: { tone: 'warning', icon: 'alert' },
  CANCELLED: { tone: 'neutral', icon: 'alert' },
  REJECTED: { tone: 'neutral', icon: 'alert' },
};
