import { version } from '../package.json';

export const VERSION: string = version;

export {
  FeedError,
  type BarStreamListener,
  type BarStreamRequest,
  type DepthLevel,
  type DepthListener,
  type DepthUpdate,
  type FeedCapabilities,
  type FeedErrorCode,
  type FilterOption,
  type HistoryPage,
  type HistoryRequest,
  type InstrumentMatch,
  type InstrumentOptions,
  type InstrumentQuery,
  type MarketFeed,
} from './contract';
export {
  barOpenTime,
  compareTimeframes,
  formatTimeframe,
  nextBarOpenTime,
  parseTimeframe,
  timeframeDuration,
  tryParseTimeframe,
  type Timeframe,
  type TimeframeUnit,
} from './timeframe';
export { DepthBook, diffDepth, type DepthSides } from './depth-book';
export {
  MOCK_TIMEFRAMES,
  MockFeed,
  defaultMockInstruments,
  type ManualQuote,
  type MockFeedOptions,
  type MockInstrument,
} from './mock/mock-feed';
export {
  HttpPollingFeed,
  defaultHttpFeedDecoders,
  type FetchLike,
  type HttpEndpoint,
  type HttpFeedDecoders,
  type HttpHistoryPage,
  type HttpPollingFeedOptions,
} from './http/http-polling-feed';
