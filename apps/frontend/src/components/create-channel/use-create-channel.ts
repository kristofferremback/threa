import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

const PARAM = "create-channel"

export function useCreateChannel() {
  const [searchParams, setSearchParams] = useSearchParams()

  const isOpen = searchParams.has(PARAM)

  const openCreateChannel = useCallback(() => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set(PARAM, "")
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  const closeCreateChannel = useCallback(() => {
    const newParams = new URLSearchParams(searchParams)
    newParams.delete(PARAM)
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  return { isOpen, openCreateChannel, closeCreateChannel }
}
