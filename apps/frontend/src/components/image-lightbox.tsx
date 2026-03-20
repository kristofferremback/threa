import { useCallback } from "react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { X, Download, Copy } from "lucide-react"
import { downloadImage, copyImage } from "@/lib/image-utils"

interface ImageLightboxProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string | null
  filename: string
  workspaceId: string
  attachmentId: string | null
}

export function ImageLightbox({ isOpen, onClose, imageUrl, filename, workspaceId, attachmentId }: ImageLightboxProps) {
  const handleDownload = useCallback(() => {
    if (workspaceId && attachmentId) downloadImage(workspaceId, attachmentId, filename)
  }, [workspaceId, attachmentId, filename])

  const handleCopy = useCallback(() => {
    if (imageUrl) copyImage(imageUrl)
  }, [imageUrl])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={[
          "p-0 max-sm:p-0 overflow-hidden bg-black/95 border-none",
          // Centered modal on all screen sizes (override mobile full-screen)
          "max-w-[90vw] max-h-[90vh]",
          "max-sm:inset-auto max-sm:left-1/2 max-sm:top-1/2 max-sm:-translate-x-1/2 max-sm:-translate-y-1/2",
          "max-sm:max-w-[95vw] max-sm:max-h-[90vh] max-sm:rounded-lg",
        ].join(" ")}
        hideCloseButton
      >
        <DialogTitle className="sr-only">{filename}</DialogTitle>
        <DialogDescription className="sr-only">Full-size image preview</DialogDescription>
        <div className="relative flex items-center justify-center">
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
              onClick={handleDownload}
            >
              <Download className="h-5 w-5" />
              <span className="sr-only">Download image</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
              onClick={handleCopy}
            >
              <Copy className="h-5 w-5" />
              <span className="sr-only">Copy image</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
          {imageUrl && <img src={imageUrl} alt={filename} className="max-w-full max-h-[85vh] object-contain" />}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <span className="text-sm text-white">{filename}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
