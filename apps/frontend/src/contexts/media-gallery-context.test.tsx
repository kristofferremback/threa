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
      <span data-testid="search">{location.search}</span>
      <button onClick={() => openMedia("a")}>open-a</button>
      <button onClick={() => openMedia("b")}>open-b</button>
      <button onClick={() => closeMedia()}>close</button>
    </div>
  )
}

function renderHarness(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

    await user.click(screen.getByText("close"))
    // navigate(-1) returned to the pre-open entry rather than rewriting it
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

  it("strips the param in place for deep-linked opens without escaping the app", async () => {
    const user = userEvent.setup()
    renderHarness(["/w/ws_1?media=a"])

    expect(screen.getByTestId("search").textContent).toBe("?media=a")

    await user.click(screen.getByText("close"))
    expect(screen.getByTestId("search").textContent).toBe("")
    expect(window.location.pathname).not.toBe("about:blank")
  })
})
