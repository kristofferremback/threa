import { Client, QueryConfigValues, QueryResultRow } from "pg"
import { DATABASE_URL } from "../config"
import { logger } from "./logger"

export interface NotificationMessage {
  channel: string
  payload: string | null
  processId: number
}

export type NotificationHandler = (msg: NotificationMessage) => void
export type ErrorHandler = (err: Error) => void

/**
 * PostgreSQL LISTEN/NOTIFY client wrapper
 * Manages a dedicated database connection for receiving notifications
 */
export class NotifyClient {
  private client: Client | null = null
  private isConnected = false
  private errorHandler: ErrorHandler | null = null

  constructor(private databaseUrl: string = DATABASE_URL) {}

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      logger.warn("NotifyClient already connected")
      return
    }

    try {
      this.client = new Client({
        connectionString: this.databaseUrl,
      })

      this.client.on("error", (err) => {
        logger.error({ err }, "Notification client error")
        if (this.errorHandler) {
          this.errorHandler(err)
        }
      })

      await this.client.connect()
      await this.client.query("SELECT 1")
      this.isConnected = true
      logger.info("Notification client connected")
    } catch (error) {
      logger.error({ err: error }, "Failed to connect notification client")
      throw error
    }
  }

  /**
   * Listen to a notification channel
   */
  async listen(channel: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      throw new Error("NotifyClient not connected. Call connect() first.")
    }

    await this.client.query(`LISTEN ${channel}`)
    logger.info({ channel }, "Listening to notification channel")
  }

  /**
   * Stop listening to a notification channel
   */
  async unlisten(channel: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return
    }

    await this.client.query(`UNLISTEN ${channel}`)
    logger.info({ channel }, "Stopped listening to notification channel")
  }

  /**
   * Register a handler for notifications
   */
  onNotification(handler: NotificationHandler): void {
    if (!this.client) {
      throw new Error("NotifyClient not connected. Call connect() first.")
    }

    // @ts-expect-error - on(event: "notification", listener: (message: Notification) => void): this;
    this.client.on("notification", handler)
  }

  /**
   * Register a handler for errors
   */
  onError(handler: ErrorHandler): void {
    this.errorHandler = handler
    if (this.client) {
      this.client.on("error", handler)
    }
  }
}
