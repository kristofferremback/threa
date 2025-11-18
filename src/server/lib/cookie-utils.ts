export const parseCookies = (cookieHeader: string): Record<string, string> => {
  return cookieHeader.split(";").reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split("=")
    if (key && value) {
      acc[key] = decodeURIComponent(value)
    }
    return acc
  }, {} as Record<string, string>)
}
