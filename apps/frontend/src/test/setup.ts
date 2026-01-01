import "@testing-library/jest-dom/vitest"

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = () => {}

// ResizeObserver for cmdk and other components
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ProseMirror needs getClientRects for scroll calculations
if (typeof Range !== "undefined") {
  // @ts-expect-error - polyfill for jsdom
  Range.prototype.getClientRects = function () {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }
  }
  Range.prototype.getBoundingClientRect = function () {
    return {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  }
}

// Elements need getClientRects too
if (!Element.prototype.getClientRects) {
  // @ts-expect-error - polyfill for jsdom
  Element.prototype.getClientRects = function () {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }
  }
}

// elementFromPoint is needed by ProseMirror for click handling
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}
