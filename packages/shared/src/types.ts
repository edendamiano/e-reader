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

export type BookFormat = "epub" | "azw3";
export type LibrarySort = "recent" | "title";

export interface LibraryBook {
  id: string;
  sha256: string;
  format: BookFormat;
  title: string;
  author: string;
  sourceFilename: string;
  addedAt: string;
  lastOpenedAt?: string;
  languageHint?: string;
  progress: number;
  coverDataUrl: string;
}

export interface ImportResult {
  sourcePath: string;
  status: "imported" | "duplicate" | "failed";
  book?: LibraryBook;
  message?: string;
}

export interface ReaderSettings {
  fontFamily: "serif" | "sans";
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  theme: "day" | "night";
  showProgress: boolean;
  speechRate: number;
}

export interface StartupState {
  books: LibraryBook[];
  settings: ReaderSettings;
  resume?: OpenPublicationResult;
}

export interface PublicationResourceResult {
  href: string;
  rawHtml: string;
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
  startup(): Promise<StartupState>;
  listBooks(query: string, sort: LibrarySort): Promise<LibraryBook[]>;
  chooseAndImport(): Promise<ImportResult[]>;
  importDroppedFiles(files: File[]): Promise<ImportResult[]>;
  importTestPaths(paths: string[]): Promise<ImportResult[]>;
  openLibraryBook(bookId: string): Promise<OpenPublicationResult>;
  deleteLibraryBook(bookId: string): Promise<void>;
  loadPublicationResource(bookId: string, href: string): Promise<PublicationResourceResult>;
  getSettings(): Promise<ReaderSettings>;
  saveSettings(settings: ReaderSettings): Promise<ReaderSettings>;
  setReadingMode(reading: boolean): Promise<void>;
  openDefaultFixture(): Promise<OpenPublicationResult>;
  loadSavedLocator(bookId: string): Promise<ReadingLocator | undefined>;
  saveLocator(locator: ReadingLocator): Promise<void>;
  ttsHealth(): Promise<TtsHealth>;
  synthesize(text: string, speed: number, context: Record<string, unknown>): Promise<TtsSynthesisResult>;
}
