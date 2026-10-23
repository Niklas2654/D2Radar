/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the Windows installer is hosted (defaults to the copy in public/download). */
  readonly VITE_DOWNLOAD_URL?: string;
}
