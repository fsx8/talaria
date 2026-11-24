/* Shared test setup: matchMedia (theming), a clean storage per test. */
import { beforeEach } from "vitest";

beforeEach(() => {
  localStorage.clear();
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
  }
});
