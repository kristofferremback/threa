import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { RelativeTime } from "./relative-time"

describe("RelativeTime", () => {
  const fixedNow = new Date("2025-06-15T12:00:00Z")

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should render 'just now' for times less than a minute ago", () => {
    const thirtySecondsAgo = new Date(fixedNow.getTime() - 30 * 1000)
    render(<RelativeTime date={thirtySecondsAgo} />)
    expect(screen.getByText("just now")).toBeInTheDocument()
  })

  it("should render minutes ago for times 1-59 minutes ago", () => {
    const fiveMinutesAgo = new Date(fixedNow.getTime() - 5 * 60 * 1000)
    render(<RelativeTime date={fiveMinutesAgo} />)
    expect(screen.getByText("5m ago")).toBeInTheDocument()
  })

  it("should render hours ago for times 1-23 hours ago", () => {
    const threeHoursAgo = new Date(fixedNow.getTime() - 3 * 60 * 60 * 1000)
    render(<RelativeTime date={threeHoursAgo} />)
    expect(screen.getByText("3h ago")).toBeInTheDocument()
  })

  it("should render 'yesterday' for times 24-47 hours ago", () => {
    const yesterday = new Date(fixedNow.getTime() - 30 * 60 * 60 * 1000)
    render(<RelativeTime date={yesterday} />)
    expect(screen.getByText("yesterday")).toBeInTheDocument()
  })

  it("should render days ago for times 2-6 days ago", () => {
    const threeDaysAgo = new Date(fixedNow.getTime() - 3 * 24 * 60 * 60 * 1000)
    render(<RelativeTime date={threeDaysAgo} />)
    expect(screen.getByText("3d ago")).toBeInTheDocument()
  })

  it("should render month and day for dates in the same year but over a week ago", () => {
    const twoWeeksAgo = new Date("2025-06-01T12:00:00Z")
    render(<RelativeTime date={twoWeeksAgo} />)
    expect(screen.getByText("Jun 1")).toBeInTheDocument()
  })

  it("should render month, day, and year for dates in previous years", () => {
    const lastYear = new Date("2024-03-15T12:00:00Z")
    render(<RelativeTime date={lastYear} />)
    expect(screen.getByText("Mar 15, 2024")).toBeInTheDocument()
  })

  it("should render '--' for invalid dates", () => {
    render(<RelativeTime date="invalid-date" />)
    expect(screen.getByText("--")).toBeInTheDocument()
  })

  it("should render '--' for null", () => {
    render(<RelativeTime date={null} />)
    expect(screen.getByText("--")).toBeInTheDocument()
  })

  it("should render '--' for undefined", () => {
    render(<RelativeTime date={undefined} />)
    expect(screen.getByText("--")).toBeInTheDocument()
  })

  it("should accept Date objects", () => {
    const date = new Date(fixedNow.getTime() - 10 * 60 * 1000)
    render(<RelativeTime date={date} />)
    expect(screen.getByText("10m ago")).toBeInTheDocument()
  })

  it("should accept ISO string dates", () => {
    const isoString = new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000).toISOString()
    render(<RelativeTime date={isoString} />)
    expect(screen.getByText("2h ago")).toBeInTheDocument()
  })
})
