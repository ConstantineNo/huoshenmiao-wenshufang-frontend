import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, isUncertainSubmissionError, requestJson, requestOk, requestPdf } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('API response handling', () => {
  it('never treats a non-2xx JSON response as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'agent_offline' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(requestJson('/api/v1/pilot/tasks')).rejects.toMatchObject({ status: 409, code: 'agent_offline' })
  })

  it('rejects an HTML body returned for a PDF preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })))

    await expect(requestPdf('/api/v1/pilot/artifacts/a/content')).rejects.toMatchObject({ code: 'invalid_pdf' })
  })

  it('accepts a successful unknown acknowledgement without guessing its response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(requestOk('/api/v1/pilot/tasks/t/acknowledge-unknown')).resolves.toBeUndefined()
  })

  it('treats network and server failures as an uncertain task submission result', () => {
    expect(isUncertainSubmissionError(new TypeError('network'))).toBe(true)
    expect(isUncertainSubmissionError(new ApiError(503, 'service_busy'))).toBe(true)
    expect(isUncertainSubmissionError(new ApiError(409, 'agent_offline'))).toBe(false)
  })
})
