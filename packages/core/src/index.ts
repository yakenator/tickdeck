import { version } from '../package.json';

export const VERSION: string = version;

export { Emitter, type Listener, type Unsubscribe } from './emitter';
export {
  ObservableValue,
  type ObservableValueOptions,
  type ReadonlyObservableValue,
  type SubscribeOptions,
  type ValueListener,
} from './observable';
export { DisposableGroup, isDisposable, toDisposable, type Disposable } from './disposable';
export { microtask, systemScheduler, type Scheduler, type TimerHandle } from './scheduler';
export {
  oppositeSide,
  sideSign,
  type Bar,
  type Instrument,
  type InstrumentKind,
  type OrderKind,
  type QuantityRules,
  type Quote,
  type QuoteListener,
  type QuoteSource,
  type QuoteStreamRequest,
  type Side,
  type TimeInForce,
} from './types';
export {
  addExact,
  checkQuantity,
  decimalPlaces,
  divideExact,
  formatDecimal,
  isOnTick,
  multiplyExact,
  roundQuantity,
  roundToStep,
  roundToTick,
  subtractExact,
  ticksBetween,
  type QuantityProblem,
  type RoundingMode,
} from './decimal';
export { isSessionOpen, parseSession, type SessionWindow, type TradingSession, type Weekday } from './session';
