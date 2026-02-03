import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

interface ImageLightboxProps {
  isOpen: boolean
  onClose: () => void
  imageUrl: string | null
  filename: string
}

export function ImageLightbox({ isOpen, onClose, imageUrl, filename }: ImageLightboxProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/95 border-none" hideCloseButton>
        <DialogTitle className="sr-only">{filename}</DialogTitle>
        <DialogDescription className="sr-only">Full-size image preview</DialogDescription>
        <div className="relative flex items-center justify-center min-h-[50vh]">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </Button>
          {imageUrl && <img src={imageUrl} alt={filename} className="max-w-full max-h-[85vh] object-contain" />}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <span className="text-sm text-white">{filename}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
