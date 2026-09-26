/**
 * LocationPicker: the citizen chooses where the problem is (ADR 0003, decision Q5).
 * OWNER: agent "location-picker". Placeholder until implemented.
 *
 * @param {{
 *   value: { lat: number, lng: number } | null,
 *   onChange: (point: { lat: number, lng: number }) => void,
 *   onAddressChange: (address: string | null) => void,
 * }} props
 */
export default function LocationPicker() {
  return <div data-testid="location-picker">Location picker (not built yet)</div>
}
