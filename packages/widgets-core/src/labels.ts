import type { ExitRole, OrderState } from '@tickdeck/broker';
import type { OrderKind, Side, TimeInForce } from '@tickdeck/core';

export const SIDE_LABELS: Readonly<Record<Side, string>> = { buy: 'Buy', sell: 'Sell' };

export const POSITION_SIDE_LABELS: Readonly<Record<Side, string>> = { buy: 'Long', sell: 'Short' };

export const ORDER_KIND_LABELS: Readonly<Record<OrderKind, string>> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  'stop-limit': 'Stop limit',
};

export const TIME_IN_FORCE_LABELS: Readonly<Record<TimeInForce, string>> = {
  day: 'Day',
  gtc: 'GTC',
  gtd: 'GTD',
  ioc: 'IOC',
  fok: 'FOK',
};

export const TIME_IN_FORCE_DESCRIPTIONS: Readonly<Record<TimeInForce, string>> = {
  day: 'Day: until the end of the trading day',
  gtc: 'Good till cancelled',
  gtd: 'Good till date',
  ioc: 'Immediate or cancel',
  fok: 'Fill or kill',
};

export const ORDER_STATE_LABELS: Readonly<Record<OrderState, string>> = {
  pending: 'Pending',
  held: 'Held',
  open: 'Working',
  filled: 'Filled',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

export const EXIT_ROLE_LABELS: Readonly<Record<ExitRole, string>> = {
  'take-profit': 'Take-profit',
  'stop-loss': 'Stop-loss',
};
