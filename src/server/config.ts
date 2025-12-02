import dotenv from "dotenv"

dotenv.config()

const config = {
  // Core
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001),
  isProduction: process.env.NODE_ENV === "production",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  // Database & Redis
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://threa:threa@localhost:5433/threa",
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6380",

  // Auth (WorkOS)
  WORKOS_API_KEY: process.env.WORKOS_API_KEY!,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID!,
  WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI!,
  WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD!,
  USE_STUB_AUTH: process.env.USE_STUB_AUTH === "true",

  // AI Providers
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,

  // Ollama (local AI)
  OLLAMA_HOST: process.env.OLLAMA_HOST || "http://localhost:11434",
  OLLAMA_CLASSIFICATION_MODEL: process.env.OLLAMA_CLASSIFICATION_MODEL || "granite4:1b",
  OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
  EMBEDDING_PROVIDER: (process.env.EMBEDDING_PROVIDER || "ollama") as "ollama" | "openai",

  // Langfuse (optional - for AI observability)
  LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
  LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
  LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL || "http://localhost:3100",

  // Health checks (for load balancer drain)
  HEALTH_CHECK_INTERVAL_MS: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "10000", 10),
  HEALTH_CHECK_FAILURES_TO_UNHEALTHY: parseInt(process.env.HEALTH_CHECK_FAILURES_TO_UNHEALTHY || "2", 10),
}

// Core
export const NODE_ENV = config.NODE_ENV
export const PORT = config.PORT
export const isProduction = config.isProduction
export const LOG_LEVEL = config.LOG_LEVEL

// Database & Redis
export const DATABASE_URL = config.DATABASE_URL
export const REDIS_URL = config.REDIS_URL

// Auth
export const WORKOS_API_KEY = config.WORKOS_API_KEY
export const WORKOS_CLIENT_ID = config.WORKOS_CLIENT_ID
export const WORKOS_REDIRECT_URI = config.WORKOS_REDIRECT_URI
export const WORKOS_COOKIE_PASSWORD = config.WORKOS_COOKIE_PASSWORD
export const USE_STUB_AUTH = config.USE_STUB_AUTH

// AI Providers
export const ANTHROPIC_API_KEY = config.ANTHROPIC_API_KEY
export const OPENAI_API_KEY = config.OPENAI_API_KEY
export const TAVILY_API_KEY = config.TAVILY_API_KEY

// Ollama
export const OLLAMA_HOST = config.OLLAMA_HOST
export const OLLAMA_CLASSIFICATION_MODEL = config.OLLAMA_CLASSIFICATION_MODEL
export const OLLAMA_EMBEDDING_MODEL = config.OLLAMA_EMBEDDING_MODEL
export const EMBEDDING_PROVIDER = config.EMBEDDING_PROVIDER

// Langfuse
export const LANGFUSE_SECRET_KEY = config.LANGFUSE_SECRET_KEY
export const LANGFUSE_PUBLIC_KEY = config.LANGFUSE_PUBLIC_KEY
export const LANGFUSE_BASE_URL = config.LANGFUSE_BASE_URL

// Health checks
export const HEALTH_CHECK_INTERVAL_MS = config.HEALTH_CHECK_INTERVAL_MS
export const HEALTH_CHECK_FAILURES_TO_UNHEALTHY = config.HEALTH_CHECK_FAILURES_TO_UNHEALTHY
