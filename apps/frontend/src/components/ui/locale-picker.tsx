import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const COMMON_LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-CA",
  "de-DE",
  "de-AT",
  "de-CH",
  "fr-FR",
  "fr-CA",
  "es-ES",
  "es-MX",
  "it-IT",
  "pt-BR",
  "pt-PT",
  "nl-NL",
  "sv-SE",
  "nb-NO",
  "da-DK",
  "fi-FI",
  "pl-PL",
  "cs-CZ",
  "ro-RO",
  "hu-HU",
  "uk-UA",
  "ru-RU",
  "ja-JP",
  "ko-KR",
  "zh-CN",
  "zh-TW",
  "th-TH",
  "vi-VN",
  "id-ID",
  "ms-MY",
  "hi-IN",
  "ar-SA",
  "he-IL",
  "tr-TR",
  "el-GR",
] as const

function getLocaleLabel(locale: string): string {
  try {
    // Display the locale name in its own language (e.g., "Svenska (Sverige)" for sv-SE)
    const displayNames = new Intl.DisplayNames([locale], { type: "language" })
    const nativeName = displayNames.of(locale)
    if (nativeName) {
      // Capitalize first letter
      return nativeName.charAt(0).toUpperCase() + nativeName.slice(1)
    }
  } catch {
    // Fallback
  }
  return locale
}

interface LocalePickerProps {
  value: string
  onChange: (locale: string) => void
}

export function LocalePicker({ value, onChange }: LocalePickerProps) {
  const [open, setOpen] = useState(false)
  const browserLocale = useMemo(() => navigator.language, [])

  const localeOptions = useMemo(() => {
    return COMMON_LOCALES.map((locale) => ({
      value: locale,
      label: getLocaleLabel(locale),
    }))
  }, [])

  const selectedLabel = useMemo(() => {
    const found = localeOptions.find((opt) => opt.value === value)
    return found ? `${found.label} (${found.value})` : value
  }, [value, localeOptions])

  function handleSelect(locale: string) {
    onChange(locale)
    setOpen(false)
  }

  const browserLocaleInList = COMMON_LOCALES.includes(browserLocale as (typeof COMMON_LOCALES)[number])

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start" onWheel={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search locale..." />
          <CommandList>
            <CommandEmpty>No locale found.</CommandEmpty>
            <CommandGroup>
              {!browserLocaleInList && browserLocale !== value && (
                <CommandItem
                  value={`browser-${browserLocale}`}
                  onSelect={() => handleSelect(browserLocale)}
                  className="font-medium"
                >
                  <Check className={cn("mr-2 h-4 w-4", value === browserLocale ? "opacity-100" : "opacity-0")} />
                  <span>
                    {getLocaleLabel(browserLocale)} ({browserLocale})
                  </span>
                  <span className="ml-2 text-muted-foreground">(browser)</span>
                </CommandItem>
              )}
              {localeOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.value}`}
                  onSelect={() => handleSelect(opt.value)}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === opt.value ? "opacity-100" : "opacity-0")} />
                  <span>{opt.label}</span>
                  <span className="ml-2 text-muted-foreground">({opt.value})</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
