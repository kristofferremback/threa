const REGION_LABELS: Record<string, string> = {
  "eu-north-1": "Europe (Stockholm)",
  "us-east-1": "US East (Virginia)",
  local: "Local",
}

export function formatRegion(regionId: string): string {
  return REGION_LABELS[regionId] ?? regionId
}
