const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status = 0, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

export interface RequestOptions {
  token?: string
  signal?: AbortSignal
}

export async function post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  })

  const text = await response.text()
  let payload: unknown = undefined
  try {
    payload = text ? JSON.parse(text) : undefined
  } catch {
    payload = text
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : `Request failed (${response.status})`
    throw new ApiError(message, response.status, payload)
  }

  return unwrap<T>(payload)
}
