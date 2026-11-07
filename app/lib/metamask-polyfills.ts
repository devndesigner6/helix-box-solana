import { Buffer } from 'buffer';

global.Buffer = Buffer;
const browser = global.window ?? ({} as typeof global.window);
if (!browser.location) {
  Object.defineProperty(browser, 'location', { value: { hostname: 'helixboxide.xyz', href: 'https://helixboxide.xyz' } });
}
if (!browser.addEventListener) browser.addEventListener = () => {};
if (!browser.removeEventListener) browser.removeEventListener = () => {};
if (!browser.dispatchEvent) browser.dispatchEvent = () => true;
global.window = browser;
if (typeof global.Event === 'undefined') {
  global.Event = class {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    defaultPrevented = false;
    constructor(type: string, options?: EventInit) {
      this.type = type;
      this.bubbles = options?.bubbles ?? false;
      this.cancelable = options?.cancelable ?? false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
    stopImmediatePropagation() {}
  } as typeof Event;
}
if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class extends Event {
    detail: unknown;
    constructor(type: string, options?: CustomEventInit) {
      super(type, options);
      this.detail = options?.detail ?? null;
    }
  } as unknown as typeof CustomEvent;
}
