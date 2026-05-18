import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { MediaGalleryProvider, useMediaGallery } from "./media-gallery-context"

function Harness() {
  const { openMedia, closeMedia } = useMediaGallery()
  const location = useLocation()
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
      <button onClick={() => openMedia("a")}>open-a</button>
      <button onClick={() => openMedia("b")}>open-b</button>
      <button onClick={() => closeMedia()}>close</button>
    </div>
  )
}

function renderHarness(initialEntries: string[], initialIndex?: number) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <MediaGalleryProvider>
        <Routes>
          <Route path="/w/:workspaceId" element={<Harness />} />
        </Routes>
      </MediaGalleryProvider>
    </MemoryRouter>
  )
}

describe("MediaGalleryProvider", () => {
  it("pushes on open and pops on close so OS back closes the gallery", async () => {
    const user = userEvent.setup()
    renderHarness(["/w/ws_1"])

    expect(screen.getByTestId("search").textContent).toBe("")

    await user.click(screen.getByText("open-a"))
    expect(screen.getByTestId("search").textContent).toBe("?media=a")

    // If open had replaced instead of pushed there would be nothing to pop
    // and the param would survive the close; reaching "" proves the pop.
    await user.click(screen.getByText("close"))
    expect(screen.getByTestId("search").textContent).toBe("")
  })

  it("replaces when navigating between items so back skips intermediate images", async () => {
    const user = userEvent.setup()
    renderHarness(["/w/ws_1"])

    await user.click(screen.getByText("open-a"))
    await user.click(screen.getByText("open-b"))
    expect(screen.getByTestId("search").textContent).toBe("?media=b")

    // Only the open pushed an entry; item navigation replaced it, so a single
    // back step lands before the gallery, not on the previously viewed image.
    await user.click(screen.getByText("close"))
    expect(screen.getByTestId("search").textContent).toBe("")
  })

  it("strips the param in place for deep-linked opens without popping history", async () => {
    const user = userEvent.setup()
    // Prior entry is a distinct path: a buggy navigate(-1) would land there.
    renderHarness(["/w/other", "/w/ws_1?media=a"], 1)

    expect(screen.getByTestId("path").textContent).toBe("/w/ws_1")
    expect(screen.getByTestId("search").textContent).toBe("?media=a")

    await user.click(screen.getByText("close"))
    // Stayed on the current entry with the param removed instead of popping
    // back to /w/other (which would also risk escaping the app).
    expect(screen.getByTestId("path").textContent).toBe("/w/ws_1")
    expect(screen.getByTestId("search").textContent).toBe("")
  })
})
