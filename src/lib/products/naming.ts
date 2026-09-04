/**
 * Deterministic product naming (Milestone: product-catalogue correction —
 * supplier URL & clean naming).
 *
 * `products.title` is the canonical, customer-facing name — used by the
 * catalogue, Product Intelligence, dashboards, and any future marketplace
 * draft. A raw supplier title (often machine-translated, SEO-stuffed, and
 * inconsistent between products) is never fit to be that name directly.
 * This module turns a supplier title plus already-known facts (category)
 * into a clean name — and ONLY ever rearranges, normalises or removes
 * words that are already present in the source; it never introduces a
 * material, colour, size, fit, performance claim, certification, or brand
 * that the source did not state.
 *
 * Deliberately no AI call: a hallucinated attribute here would corrupt the
 * customer-facing catalogue, and a pure function is the one implementation
 * that can be exhaustively tested to never do that (see
 * `tests/product-naming.test.ts`'s "every output word traces back to the
 * source" invariant test). `ChatProvider`'s real/offline-fallback pattern
 * (`src/lib/ai/types.ts`) remains available if a constrained AI enhancement
 * is ever added on top of this — this module is written so that could
 * slot in as an optional second pass, never a requirement: import must
 * never depend on `ANTHROPIC_API_KEY` being configured.
 */

export interface NamingInput {
  supplierTitle: string
  /** e.g. "Women's Clothing > Outerwear & Jackets > Blazers" — CJ's own three-level hierarchy, already normalised text. `null` when no category is on file. */
  category: string | null
}

export interface NamingResult {
  name: string
  /**
   * `false` when no recognised garment type could be identified at all —
   * the caller should keep the original supplier title rather than trust
   * a name assembled from category/gender alone, per the "retain the
   * existing name rather than inventing information" rule.
   */
  confident: boolean
  /** Which words were kept, and why — for audit, never derived after the fact from the output string alone. */
  basis: string
}

// ---------------------------------------------------------------------------
// Curated, reviewable word/phrase lists. Every entry here is either (a) a
// pure-noise phrase that carries no product-defining information (safe to
// delete outright — "remove meaningless supplier marketing language"), or
// (b) an unambiguous supplier-jargon -> plain-retail-English mapping where
// the source phrase and its replacement describe the exact same real
// thing (never a different, stronger, or invented claim).
// ---------------------------------------------------------------------------

/**
 * Pure filler — observed directly in real CJ titles this milestone's
 * imported products actually carry. Removing these changes nothing about
 * what the product IS; they are marketing padding, not facts.
 */
const NOISE_PHRASES: readonly string[] = [
  'commuter',
  'all-matching',
  'all matching',
  'twist outer wear',
  'cool feeling',
  'high quality',
  'fashion',
  'casual', // near-universally filler in these titles; never the one word distinguishing a garment
  'new',
  'hot sale',
  'wholesale',
  'best selling',
  'sports outdoors',
  'inner match',
  'bottoming',
]

/**
 * Unambiguous jargon -> plain English. Each mapping describes the exact
 * same real characteristic the supplier already stated, in the words a
 * normal retail listing would use — never a stronger or additional claim.
 */
const PHRASE_NORMALISATIONS: ReadonlyMap<string, string> = new Map([
  ['needle woven', 'knit'],
  ['looped pile', 'loopback'],
  // "Slimming" is the supplier's own description of the garment's cut —
  // "slim-fit" is the standard retail term for that same cut, not a new
  // claim about the product.
  ['slimming', 'slim-fit'],
  ['loose slim-fit', 'slim-fit'], // "loose" and "slimming" both present is contradictory SEO stuffing; the more specific cut term wins.
])

/**
 * Recognised garment-type nouns, MOST SPECIFIC FIRST. Whichever of these
 * actually appears — in the title, in the category, or both — with the
 * lowest index here is the real product type: a blazer is a specific kind
 * of coat/jacket/suit, a cardigan a specific kind of sweater, shorts a
 * specific kind of trousers/pants. This is a specificity ranking, not a
 * source preference — the title and the category are just two places a
 * real fact can come from, and the more precise fact always wins,
 * whichever place it came from.
 */
const GARMENT_TYPE_PRIORITY: readonly string[] = [
  'cardigan',
  'blazer',
  'hoodie',
  'sweatshirt',
  'sweater',
  't-shirt',
  'tshirt',
  'shirt',
  'shorts',
  'trousers',
  'pants',
  'coat',
  'jacket',
  'suit',
  'dress',
  'skirt',
]

/** Words with no product-descriptive content of their own — safe to drop from a descriptor list without losing any fact. */
const STOPWORDS: ReadonlySet<string> = new Set(['and', 'or', 'with', 'for', 'the', 'a', 'an', 'of', 'to', 'small', 'large'])

/** Normalises one raw CJ garment-type spelling variant to the canonical form used in `GARMENT_TYPE_PRIORITY`. */
function canonicalGarmentWord(word: string): string {
  if (word === 'tshirt' || word === 't shirt') return 't-shirt'
  return word
}

/** The recognised garment-type category segment, when the category names one directly — a second, equally real source of the same fact `GARMENT_TYPE_PRIORITY` ranks against whatever the title itself says. */
const CATEGORY_LEAF_TO_TYPE: ReadonlyMap<string, string> = new Map([
  ['blazers', 'blazer'],
  ['sweaters', 'sweater'],
  ['t-shirts', 't-shirt'],
  ['casual pants', 'pants'],
  ['dresses', 'dress'],
])

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function applyPhraseCleanup(rawTitle: string): { cleaned: string; removedNoise: readonly string[]; normalised: readonly string[] } {
  let text = ` ${rawTitle.toLowerCase()} `
  const removedNoise: string[] = []
  const normalised: string[] = []

  // Longest phrases first, so a multi-word noise phrase is not left partially matched by a shorter one.
  for (const phrase of [...NOISE_PHRASES].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`\\s${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'g')
    if (pattern.test(text)) {
      text = text.replace(pattern, ' ')
      removedNoise.push(phrase)
    }
  }
  for (const [from, to] of [...PHRASE_NORMALISATIONS.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const pattern = new RegExp(`\\s${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'g')
    if (pattern.test(text)) {
      text = text.replace(pattern, ` ${to} `)
      normalised.push(`${from} -> ${to}`)
    }
  }

  return { cleaned: normaliseWhitespace(text), removedNoise, normalised }
}

function titleCase(word: string): string {
  return word
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('-')
}

/**
 * Turns one supplier title (plus its category, if known) into a clean,
 * concise Commerce OS name. Pure and deterministic — same input, same
 * output, always. Never invents a material, colour, size, fit,
 * performance claim, certification or brand; every word in `name` is
 * either a word from `supplierTitle` (verbatim or via a
 * `PHRASE_NORMALISATIONS` entry describing the exact same fact) or the
 * gender/product-type word already implied by `category`.
 */
export function generateCleanProductName(input: NamingInput): NamingResult {
  const { cleaned, removedNoise, normalised } = applyPhraseCleanup(input.supplierTitle)
  const words = cleaned.split(' ').filter(Boolean)

  // Gender: only ever the supplier's own word, or the category's — never assumed.
  const genderWord = words.find((w) => w === "men's" || w === "women's" || w === 'unisex')
  const categoryGender = input.category?.toLowerCase().includes("women's") ? "women's" : input.category?.toLowerCase().includes("men's") ? "men's" : null
  const gender = genderWord ?? categoryGender

  // Product type: the single most specific recognised garment word present
  // in EITHER the title or the category — both are real facts about the
  // same product, so both contribute candidates to the one ranking rather
  // than the category only ever being a fallback for an empty title.
  const titleHasType = (type: string) => words.some((w) => canonicalGarmentWord(w) === type)
  const categoryLeaf = input.category?.split('>').map((s) => s.trim().toLowerCase()).pop() ?? null
  const categoryType = categoryLeaf ? (CATEGORY_LEAF_TO_TYPE.get(categoryLeaf) ?? null) : null

  const productType = GARMENT_TYPE_PRIORITY.find((type) => titleHasType(type) || type === categoryType) ?? null
  const typeSource = productType && titleHasType(productType) ? 'title' : 'category'

  if (!productType) {
    return { name: input.supplierTitle, confident: false, basis: 'No recognised garment type in the title or category — kept the original supplier title rather than guessing.' }
  }

  // Descriptors: whatever real, already-cleaned words remain once gender,
  // every recognised garment-type word (the chosen one and any synonym
  // siblings), and pure stopwords are removed — at most two, in the order
  // the supplier wrote them.
  const excluded = new Set([genderWord, ...GARMENT_TYPE_PRIORITY, 'tshirt', "men's", "women's", 'unisex'].filter((w): w is string => Boolean(w)))
  const descriptorWords = words.filter((w) => !excluded.has(canonicalGarmentWord(w)) && !STOPWORDS.has(w)).slice(0, 2)

  const productTypeLabel = productType === 't-shirt' ? 'T-Shirt' : titleCase(productType)
  const nameParts = [gender ? titleCase(gender) : null, ...descriptorWords.map(titleCase), productTypeLabel].filter((p): p is string => Boolean(p))
  const name = normaliseWhitespace(nameParts.join(' '))

  const basisParts = [
    `Product type "${productTypeLabel}" from the ${typeSource}.`,
    gender ? `Gender "${gender}" from the ${genderWord ? 'title' : 'category'}.` : 'No gender stated.',
    descriptorWords.length > 0 ? `Kept descriptor(s): ${descriptorWords.join(', ')}.` : 'No additional descriptor retained.',
    removedNoise.length > 0 ? `Removed marketing filler: ${removedNoise.join(', ')}.` : '',
    normalised.length > 0 ? `Normalised jargon: ${normalised.join(', ')}.` : '',
  ].filter(Boolean)

  return { name, confident: true, basis: basisParts.join(' ') }
}
