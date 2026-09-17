import { hc } from 'hono/client'
import type { AppType } from '@second-brain/api'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export const api = hc<AppType>(apiUrl)
