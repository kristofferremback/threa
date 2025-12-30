import "@testing-library/jest-dom/vitest"

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = () => {}
