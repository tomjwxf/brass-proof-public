'use client'

import { useState, useCallback } from 'react'

export interface UseBrassOptions {
  issuerUrl?: string
  scope?: string
  onError?: (error: Error) => void
  onSuccess?: (result: { remaining?: number }) => void
}

export interface UseBrassReturn {
  mintAndSubmit: <T = unknown>(
    endpoint: string,
    data: Record<string, unknown>,
    options?: RequestInit
  ) => Promise<T>
  isLoading: boolean
  error: Error | null
  remaining: number | null
}

export function useBrass(options: UseBrassOptions = {}): UseBrassReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  const issuerUrl = options.issuerUrl || 'https://issuer.brassproof.com'
  const scope = options.scope || 'generic'

  const mintAndSubmit = useCallback(
    async <T = unknown>(
      endpoint: string,
      data: Record<string, unknown>,
      fetchOptions: RequestInit = {}
    ): Promise<T> => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...fetchOptions.headers,
          },
          body: JSON.stringify(data),
          ...fetchOptions,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Request failed with status ${response.status}`)
        }

        const result = await response.json()

        if (result.remaining !== undefined) {
          setRemaining(result.remaining)
        }

        if (options.onSuccess) {
          options.onSuccess(result)
        }

        return result as T
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error occurred')
        setError(error)
        
        if (options.onError) {
          options.onError(error)
        }
        
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [issuerUrl, scope, options]
  )

  return {
    mintAndSubmit,
    isLoading,
    error,
    remaining,
  }
}
