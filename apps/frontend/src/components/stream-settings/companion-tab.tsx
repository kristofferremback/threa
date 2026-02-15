import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { CompanionModes, type Stream } from "@threa/types"

interface CompanionTabProps {
  stream: Stream
}

export function CompanionTab({ stream }: CompanionTabProps) {
  return (
    <div className="space-y-6 p-1">
      <div className="space-y-3">
        <Label className="text-sm font-medium">Companion mode</Label>
        <RadioGroup value={stream.companionMode} disabled>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value={CompanionModes.ON} id="companion-on" />
            <Label htmlFor="companion-on" className="font-normal text-muted-foreground">
              On
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value={CompanionModes.OFF} id="companion-off" />
            <Label htmlFor="companion-off" className="font-normal text-muted-foreground">
              Off
            </Label>
          </div>
        </RadioGroup>
      </div>

      <p className="text-sm text-muted-foreground">Companion settings will be configurable in a future update.</p>
    </div>
  )
}
