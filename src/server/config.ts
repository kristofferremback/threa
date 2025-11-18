const config = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 3000,
  WORKOS_API_KEY: process.env.WORKOS_API_KEY!,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID!,
  WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI!,
  WORKOS_COOKIE_PASSWORD: process.env.WORKOS_COOKIE_PASSWORD!,
  isProduction: process.env.NODE_ENV === "production",
}

export const NODE_ENV = config.NODE_ENV
export const PORT = config.PORT
export const WORKOS_API_KEY = config.WORKOS_API_KEY
export const WORKOS_CLIENT_ID = config.WORKOS_CLIENT_ID
export const WORKOS_REDIRECT_URI = config.WORKOS_REDIRECT_URI
export const WORKOS_COOKIE_PASSWORD = config.WORKOS_COOKIE_PASSWORD

export const isProduction = config.isProduction

console.log("Configuration:", JSON.stringify(config, null, 2))
