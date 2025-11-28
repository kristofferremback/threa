import dotenv from "dotenv"

dotenv.config()

const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001),
  WORKOS_API_KEY: process.env.WORKOS_API_KEY!,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID!,
  WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI!,
  WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD!,
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://threa:threa@localhost:5433/threa",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6380",
  isProduction: process.env.NODE_ENV === "production",
  // Langfuse (optional - for AI observability)
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL || "http://localhost:3100",
}

export const NODE_ENV = config.NODE_ENV
export const PORT = config.PORT
export const WORKOS_API_KEY = config.WORKOS_API_KEY
export const WORKOS_CLIENT_ID = config.WORKOS_CLIENT_ID
export const WORKOS_REDIRECT_URI = config.WORKOS_REDIRECT_URI
export const WORKOS_COOKIE_PASSWORD = config.WORKOS_COOKIE_PASSWORD
export const DATABASE_URL = config.DATABASE_URL
export const REDIS_URL = config.REDIS_URL
export const LANGFUSE_SECRET_KEY = config.LANGFUSE_SECRET_KEY
export const LANGFUSE_PUBLIC_KEY = config.LANGFUSE_PUBLIC_KEY
export const LANGFUSE_BASE_URL = config.LANGFUSE_BASE_URL

export const isProduction = config.isProduction
