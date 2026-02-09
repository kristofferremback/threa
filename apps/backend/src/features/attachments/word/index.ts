export { WordProcessingService } from "./service"
export { StubWordProcessingService } from "./service.stub"
export type { WordProcessingServiceDeps } from "./service"
export type { WordProcessingServiceLike } from "./types"
export {
  WORD_SUMMARY_MODEL_ID,
  WORD_SUMMARY_TEMPERATURE,
  WORD_SIZE_THRESHOLDS,
  WORD_MIME_TYPES,
  WORD_EXTENSIONS,
  WORD_MAGIC_BYTES,
  isWordAttachment,
} from "./config"
export { detectWordFormat, validateWordFormat } from "./detector"
