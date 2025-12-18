import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { RelativeTime } from "./relative-time"

describe("RelativeTime", () => {
  // Fixed to Sunday, June 15, 2025 at 12:00:00 UTC
  const fixedNow = new Date("2025-06-15T12:00:00Z")

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should show just time for same day", () => {
    // 30 minutes ago, same day
    const sameDay = new Date("2025-06-15T11:30:00Z")
    render(<RelativeTime date={sameDay} />)
    // Time format depends on locale, just check it contains digits
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  it("should show 'yesterday' with time for yesterday", () => {
    // Yesterday at 15:20
    const yesterday = new Date("2025-06-14T15:20:00Z")
    render(<RelativeTime date={yesterday} />)
    expect(screen.getByText(/yesterday/i)).toBeInTheDocument()
  })

  it("should show day name with time for dates within the last week", () => {
    // Thursday (3 days ago from Sunday)
    const thursday = new Date("2025-06-12T10:30:00Z")
    render(<RelativeTime date={thursday} />)
    expect(screen.getByText(/Thursday/i)).toBeInTheDocument()
  })

  it("should show month and day with time for dates in same year over a week ago", () => {
    // June 1st (14 days ago)
    const twoWeeksAgo = new Date("2025-06-01T14:00:00Z")
    render(<RelativeTime date={twoWeeksAgo} />)
    expect(screen.getByText(/June 1/i)).toBeInTheDocument()
  })

  it("should show full date with time for dates in previous years", () => {
    const lastYear = new Date("2024-03-15T09:45:00Z")
    render(<RelativeTime date={lastYear} />)
    expect(screen.getByText(/March 15, 2024/i)).toBeInTheDocument()
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
    const date = new Date("2025-06-15T10:00:00Z")
    render(<RelativeTime date={date} />)
    // Same day, should just show time
    expect(screen.getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  it("should accept ISO string dates", () => {
    const isoString = "2025-06-14T08:30:00Z"
    render(<RelativeTime date={isoString} />)
    // Yesterday
    expect(screen.getByText(/yesterday/i)).toBeInTheDocument()
  })
})
