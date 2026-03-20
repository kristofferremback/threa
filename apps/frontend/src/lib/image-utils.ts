import { toast } from "sonner"

async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.blob()
}

export async function downloadImage(url: string, filename: string): Promise<void> {
  try {
    const blob = await fetchImageBlob(url)
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
    toast.success("Image downloaded")
  } catch {
    toast.error("Failed to download image")
  }
}

export async function copyImage(url: string): Promise<void> {
  try {
    const blob = await fetchImageBlob(url)
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    toast.success("Image copied")
  } catch {
    toast.error("Failed to copy image")
  }
}
