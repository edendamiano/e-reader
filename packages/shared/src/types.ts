export interface LocatorText {
  before?: string;
  highlight?: string;
  after?: string;
}

export interface LocatorLocations {
  cfi?: string;
  cssSelector?: string;
  position?: number;
  progression?: number;
  totalProgression?: number;
}

export interface ReadingLocator {
  bookId: string;
  href: string;
  title?: string;
  locations: LocatorLocations;
  text?: LocatorText;
}

export type SpeechUnitType = "heading" | "paragraph" | "quote" | "list";

export interface SpeechUnit {
  id: string;
  bookId: string;
  href: string;
  locator: ReadingLocator;
  text: string;
  type: SpeechUnitType;
  order: number;
}

export interface PublicationLinkDto {
  href: string;
  type?: string;
  title?: string;
  children?: PublicationLinkDto[];
}

export interface PublicationDto {
  bookId: string;
  sourcePath: string;
  title: string;
  author: string;
  languages: string[];
  readingOrder: PublicationLinkDto[];
  toc: PublicationLinkDto[];
}

export interface OpenPublicationResult {
  publication: PublicationDto;
  href: string;
  rawHtml: string;
  restoredLocator?: ReadingLocator;
}

export interface TtsHealth {
  ready: boolean;
  detail?: string;
}

export interface TtsSynthesisResult {
  requestId: string;
  audioDataUrl: string;
  durationMs: number;
  cacheHit: boolean;
}

export interface EReaderBridge {
  openDefaultFixture(): Promise<OpenPublicationResult>;
  chooseBook(): Promise<OpenPublicationResult | null>;
  loadSavedLocator(bookId: string): Promise<ReadingLocator | undefined>;
  saveLocator(locator: ReadingLocator): Promise<void>;
  ttsHealth(): Promise<TtsHealth>;
  synthesize(text: string, speed: number, context: Record<string, unknown>): Promise<TtsSynthesisResult>;
}
