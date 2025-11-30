import pino from "pino"
import { isProduction, LOG_LEVEL } from "../config"

export const logger = pino({
  level: LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
})
