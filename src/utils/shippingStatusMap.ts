import { OrderStatus } from '../models/Order';

const statusIdMap: Record<number, OrderStatus> = {
  1: 'processing',
  2: 'processing',
  3: 'processing',
  4: 'processing',
  5: 'processing',
  6: 'shipped',
  7: 'shipped',
  8: 'shipped',
  9: 'shipped',
  10: 'shipped',
  17: 'delivered',
  18: 'cancelled',
  19: 'returned',
  20: 'returned',
};

const normalizeText = (value?: string): string => (value || '').trim().toLowerCase();

export const mapProviderStatusToOrderStatus = (
  statusId?: number | string,
  statusText?: string
): OrderStatus | null => {
  if (statusId !== undefined && statusId !== null && statusId !== '') {
    const numericStatusId = Number(statusId);
    if (!Number.isNaN(numericStatusId) && statusIdMap[numericStatusId]) {
      return statusIdMap[numericStatusId];
    }
  }

  const normalized = normalizeText(statusText);
  if (!normalized) return null;

  if (normalized.includes('deliver')) return 'delivered';
  if (normalized.includes('return') || normalized.includes('rto')) return 'returned';
  if (normalized.includes('cancel')) return 'cancelled';
  if (
    normalized.includes('shipped') ||
    normalized.includes('in transit') ||
    normalized.includes('out for delivery')
  ) {
    return 'shipped';
  }
  if (
    normalized.includes('awb') ||
    normalized.includes('pickup') ||
    normalized.includes('manifest') ||
    normalized.includes('process')
  ) {
    return 'processing';
  }

  return null;
};
