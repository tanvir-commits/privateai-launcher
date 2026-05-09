import type { PrivateaiApi } from '@shared/preloadApi'

declare global {
  interface Window {
    privateai: PrivateaiApi
  }
}

export {}
