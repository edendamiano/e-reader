import type { EReaderBridge } from "../../../../packages/shared/src/types";

declare global {
  interface Window {
    ereader: EReaderBridge;
    __EPUB_SCRIPT_EXECUTED__?: boolean;
    __EPUB_HANDLER_EXECUTED__?: boolean;
  }
}

export {};
