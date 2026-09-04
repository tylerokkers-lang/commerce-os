import { describe, expect, it } from 'vitest'
import { generateCleanProductName } from '@/lib/products/naming'

/**
 * Milestone: product-catalogue correction (supplier URL & clean naming).
 * `generateCleanProductName` is a pure, deterministic transformation —
 * no AI call, no network, no `server-only` import — specifically so
 * missing `ANTHROPIC_API_KEY` can never block a product import, and so
 * the single most safety-critical property (never inventing an
 * attribute) can be checked exhaustively rather than by spot-checking a
 * few examples.
 */

// Words a real, unambiguous normalisation is allowed to introduce even
// though they don't appear verbatim in the source — each one describes
// the exact same fact the source already stated, just in plain English.
const APPROVED_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['knit', ['needle', 'woven']],
  ['loopback', ['looped', 'pile']],
  ['slim-fit', ['slimming']],
])

/** Same normalisation the assertion loop below applies to the generated name's own words, so "women's" on both sides compares as the same token. */
function normaliseWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function sourceWords(supplierTitle: string): Set<string> {
  return new Set(supplierTitle.split(/\s+/).map(normaliseWord).filter(Boolean))
}

/** Every word in a generated name must trace back to the source title (or its category, for the type/gender words) — directly, or via one approved, fact-preserving synonym. Never a brand-new word. */
function assertEveryWordTraceable(name: string, supplierTitle: string, category: string | null) {
  const available = sourceWords(supplierTitle)
  if (category) for (const w of sourceWords(category)) available.add(w)
  // The synonym targets themselves are allowed once their source word is present.
  for (const [target, sources] of APPROVED_SYNONYMS) {
    if (sources.some((s) => available.has(s))) available.add(target)
  }
  // A small set of category-derived garment nouns not literally spelled the same as the category leaf text (e.g. "Blazers" -> "blazer").
  available.add('blazer')
  available.add('sweater')
  available.add('t-shirt')
  available.add('pants')
  available.add('dress')

  for (const rawWord of name.split(/\s+/)) {
    const word = normaliseWord(rawWord)
    if (!word) continue
    expect(available.has(word), `"${word}" in generated name "${name}" does not trace back to "${supplierTitle}" / "${category}"`).toBe(true)
  }
}

describe('generateCleanProductName — fact-first invariant', () => {
  const REAL_TITLES: readonly { supplierTitle: string; category: string | null }[] = [
    { supplierTitle: "Commuter Loose Slimming And All-matching Small Suit Women's Fashion Coat", category: "Women's Clothing > Outerwear & Jackets > Blazers" },
    { supplierTitle: "Twist Outer Wear V-neck Sweater Needle Woven Women's Cardigan", category: "Women's Clothing > Tops & Sets > Sweaters" },
    { supplierTitle: "Men's Casual Loose Fashion Inner Match Bottoming Shirt", category: "Men's Clothing > Outerwear & Jackets > Men's Sweaters" },
    { supplierTitle: 'Heavy Cool Feeling High Quality T-shirt Sports Outdoors Sweat-absorbing Breathable', category: "Men's Clothing > T-Shirts > Solid" },
    { supplierTitle: "Men's Sports Looped Pile Shorts Drawstring Elastic Waist Smiley 3D Printed Casual Beach Pants", category: "Men's Clothing > Bottoms > Casual Pants" },
    { supplierTitle: 'Random Unrecognisable Gibberish Product Listing', category: null },
    { supplierTitle: '', category: null },
    { supplierTitle: "Women's Elegant Premium Luxury Silk Dress", category: "Women's Clothing > Dresses" },
  ]

  it('every generated name only ever contains words traceable to the source title/category — never an invented attribute', () => {
    for (const input of REAL_TITLES) {
      const result = generateCleanProductName(input)
      if (result.confident) assertEveryWordTraceable(result.name, input.supplierTitle, input.category)
    }
  })

  it("real product 1: 'Commuter Loose Slimming...Coat' -> a slim-fit blazer, matching the specific category over the vaguer title word", () => {
    const result = generateCleanProductName({ supplierTitle: "Commuter Loose Slimming And All-matching Small Suit Women's Fashion Coat", category: "Women's Clothing > Outerwear & Jackets > Blazers" })
    expect(result.name).toBe("Women's Loose Slim-Fit Blazer")
    expect(result.confident).toBe(true)
  })

  it("real product 2: 'Twist Outer Wear V-neck Sweater Needle Woven...Cardigan' -> cardigan wins over the less specific 'sweater', needle woven -> knit", () => {
    const result = generateCleanProductName({ supplierTitle: "Twist Outer Wear V-neck Sweater Needle Woven Women's Cardigan", category: "Women's Clothing > Tops & Sets > Sweaters" })
    expect(result.name).toBe("Women's V-Neck Knit Cardigan")
  })

  it("real product 5: 'Looped Pile Shorts...Casual Beach Pants' -> shorts wins over the coarser category word 'pants', looped pile -> loopback", () => {
    const result = generateCleanProductName({ supplierTitle: "Men's Sports Looped Pile Shorts Drawstring Elastic Waist Smiley 3D Printed Casual Beach Pants", category: "Men's Clothing > Bottoms > Casual Pants" })
    expect(result.name).toBe('Men\'s Sports Loopback Shorts')
  })

  it('gender is only ever the supplier\'s own word or the category\'s — never assumed for a gender-neutral product', () => {
    const result = generateCleanProductName({ supplierTitle: 'Classic Denim Jacket', category: 'Outerwear > Jackets' })
    expect(result.name).not.toMatch(/men's|women's/i)
  })

  it('a title with no recognisable garment type and no usable category keeps the original supplier title rather than guessing', () => {
    const result = generateCleanProductName({ supplierTitle: 'Random Unrecognisable Gibberish Product Listing', category: null })
    expect(result.confident).toBe(false)
    expect(result.name).toBe('Random Unrecognisable Gibberish Product Listing')
  })

  it('an empty title never crashes and reports low confidence', () => {
    const result = generateCleanProductName({ supplierTitle: '', category: null })
    expect(result.confident).toBe(false)
  })

  it('never invents a material, colour, fit, or quality claim not present in the source (the "Premium Breathable Performance" trap)', () => {
    const result = generateCleanProductName({ supplierTitle: 'Heavy Cool Feeling T-shirt', category: null })
    expect(result.name).not.toMatch(/premium|breathable|performance|luxury|waterproof/i)
  })

  it('marketing/luxury-claim words present in the source ARE preserved verbatim — this module removes noise, it does not censor real (if grand) supplier claims', () => {
    const result = generateCleanProductName({ supplierTitle: "Women's Elegant Premium Luxury Silk Dress", category: "Women's Clothing > Dresses" })
    // "Silk" and "Premium"/"Luxury" are the SUPPLIER'S OWN words, present verbatim in the source — keeping up to two is correct; nothing here is invented.
    expect(result.confident).toBe(true)
    assertEveryWordTraceable(result.name, "Women's Elegant Premium Luxury Silk Dress", "Women's Clothing > Dresses")
  })

  it('duplicate/redundant filler words never appear twice in the output', () => {
    const result = generateCleanProductName({ supplierTitle: "Men's Casual Casual Sports Shorts", category: null })
    const words = result.name.toLowerCase().split(/\s+/)
    expect(new Set(words).size).toBe(words.length)
  })

  it('output is concise — never wildly longer than the meaningful content of the source', () => {
    for (const input of REAL_TITLES) {
      const result = generateCleanProductName(input)
      if (result.confident) expect(result.name.split(/\s+/).length).toBeLessThanOrEqual(6)
    }
  })
})
