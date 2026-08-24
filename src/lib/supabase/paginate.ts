import 'server-only'

/**
 * Bounded pagination for a Supabase query (Milestone 8.5, extracted to a
 * shared module in Milestone 10 §19 so `monitoring/liveSubjects.ts` and
 * `analytics/liveAnalyticsFacts.ts` share one implementation rather than
 * two copies that could drift). A real ceiling, never an unbounded "load
 * everything" query — a single organisation's data cannot make one caller
 * loop indefinitely. One source failing never throws; it returns whatever
 * rows were gathered plus the error, so a caller can decide whether a
 * partial result is still useful.
 */

const DEFAULT_PAGE_SIZE = 500
const DEFAULT_MAX_PAGES = 20 // 10,000 rows per call by default — see module comment.

type SupabaseQueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export async function paginate<T>(
  fetchPage: (from: number, to: number) => SupabaseQueryResult<T>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<{ rows: T[]; error: string | null }> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES
  const rows: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const to = from + pageSize - 1
    const { data, error } = await fetchPage(from, to)
    if (error) return { rows, error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }
  return { rows, error: null }
}
