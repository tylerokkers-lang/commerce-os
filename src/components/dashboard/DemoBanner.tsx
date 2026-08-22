/**
 * Every screen carries this while demo mode is on.
 *
 * Simulated figures must be impossible to mistake for real trading data (§55).
 */
export function DemoBanner() {
  return (
    <div className="border-b border-demo/25 bg-demo-soft px-6 py-2">
      <p className="text-xs text-demo">
        <span className="font-semibold">Demo mode.</span> Every figure on this screen is simulated.
        No marketplace, supplier, accounting or email account is connected, and nothing here
        represents real trading, stock or tax data.
      </p>
    </div>
  )
}
