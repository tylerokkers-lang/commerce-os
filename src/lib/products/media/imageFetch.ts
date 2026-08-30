import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { parseImageHeader } from './imageHeaderParser'

/**
 * Safe external image metadata fetching (Milestone: product media
 * intelligence, Phase 7).
 *
 * Every external media URL is untrusted input. This function:
 *   - accepts only http(s) URLs, rejecting file://, ftp://, data:, etc.
 *   - refuses obviously-private/loopback/link-local hostnames (a partial
 *     SSRF mitigation — genuinely partial: a full defence needs
 *     connect-time IP validation and re-validation across redirects,
 *     which this does not implement; documented here and in
 *     HANDOVER.md, not hidden)
 *   - never follows a redirect (`redirect: 'error'`) — an SSRF bypass via
 *     an open redirect is refused outright rather than "handled"
 *   - applies a strict timeout
 *   - only accepts a small, known allow-list of image content-types
 *   - reads at most `MAX_HEADER_BYTES` of the body — enough to parse any
 *     of JPEG/PNG/WEBP's dimension headers, never the whole file, which
 *     is also the actual performance safeguard against "download every
 *     possible image immediately"
 *
 * Dimensions come from a small, dependency-free header parser
 * (`imageHeaderParser.ts`) for JPEG/PNG/WEBP — genuinely deterministic
 * byte-format parsing, not image analysis. AVIF is detected by its
 * container signature but this codebase does not parse its (more
 * involved, ISOBMFF-nested) dimension box — an honest gap: format is
 * reported, dimensions are `null`, and the quality engine treats an
 * undetermined dimension as `not_assessed`, never a guessed pass.
 */

const FETCH_TIMEOUT_MS = 5000
const MAX_HEADER_BYTES = 262_144 // 256KB — comfortably enough for any real JPEG/PNG/WEBP header.
const ALLOWED_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

const PRIVATE_HOSTNAME_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, including the cloud metadata endpoint's own address range
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd00:/i,
]

export interface FetchedImageFacts {
  widthPx: number | null
  heightPx: number | null
  fileSizeBytes: number | null
  format: string | null
  contentType: string
}

function validateUrl(rawUrl: string): Result<URL, string> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return err('Not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return err(`Unsupported URL scheme "${url.protocol}" — only http/https are accepted.`)
  }
  const hostname = url.hostname
  if (PRIVATE_HOSTNAME_PATTERNS.some((p) => p.test(hostname))) {
    return err('The URL resolves to a private, loopback, or link-local address, which is never fetched.')
  }
  return ok(url)
}

/**
 * Fetches just enough of an image to determine its real dimensions,
 * format and (from the response header, not independently verified)
 * size. Never throws on a bad/hostile URL or an unreachable server —
 * every failure mode is a `Result` the caller must handle, since a
 * fetch failure here should route media to `MANUAL_REVIEW_REQUIRED`,
 * never crash the capture flow.
 */
export async function fetchImageFacts(rawUrl: string): Promise<Result<FetchedImageFacts, string>> {
  const urlResult = validateUrl(rawUrl)
  if (!urlResult.ok) return urlResult

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(urlResult.value.toString(), {
      signal: controller.signal,
      redirect: 'error',
      headers: { Range: `bytes=0-${MAX_HEADER_BYTES - 1}` },
    })

    if (!response.ok && response.status !== 206) {
      return err(`Fetching the image failed: ${response.status} ${response.statusText}.`)
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const format = ALLOWED_CONTENT_TYPES[contentType]
    if (!format) {
      return err(`Content-Type "${contentType || 'unknown'}" is not an accepted image type.`)
    }

    const contentLengthHeader = response.headers.get('content-range')?.split('/')[1] ?? response.headers.get('content-length')
    const fileSizeBytes = contentLengthHeader ? Number(contentLengthHeader) : null

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_HEADER_BYTES) {
      return err(`Response exceeded the ${MAX_HEADER_BYTES} byte read cap.`)
    }

    const bytes = new Uint8Array(arrayBuffer)
    const parsed = parseImageHeader(bytes)

    return ok({
      widthPx: parsed?.width ?? null,
      heightPx: parsed?.height ?? null,
      fileSizeBytes: fileSizeBytes !== null && Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      format: parsed?.format ?? format,
      contentType,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return err(`Fetching the image timed out after ${FETCH_TIMEOUT_MS}ms.`)
    }
    return err(`Fetching the image failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }
}
