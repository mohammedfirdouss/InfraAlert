# InfraAlert design system

InfraAlert is about streets, pipes and repair crews, so the interface borrows from
**road signage and survey fieldwork**: sign plates, lane markings, hazard stripes,
surveyor readouts. It is used mostly on phones, often outdoors, by people who may be
stressed. High contrast, big targets, plain words.

## Tokens (tailwind.config.js)

| Token | Use |
|---|---|
| `ink` / `asphalt-*` | Text, header, borders of interactive plates, readouts |
| `concrete-*` | Page background (`concrete-50` + `bg-grid` survey dots), quiet surfaces, dividers |
| `signal-*` (hi-vis yellow) | The primary action, current step, pin, highlights. Always with **ink text**, never white |
| `hazard-*` (safety orange) | Danger and errors only: emergency panel, field errors, failed uploads |
| `go-*` (green) | Success only: resolved, uploaded, sent |
| `survey-*` (blue) | Rare: links inside body text |

Fonts: **Overpass** (from Highway Gothic, used on road signs) for everything, 800–900
for headlines; **Overpass Mono** for coordinates, reference numbers, section numbers
and counts. Both are self-hosted (no third-party font requests).

## Components (src/index.css)

- `.btn-primary` is a yellow sign plate: 2px ink border and an ink bottom edge (`shadow-plate`)
  that presses in when tapped. Use it for **one** main action per screen. `.btn-secondary` is a
  white plate, `.btn-danger` orange, `.btn-ghost` an underlined text action.
- `.card` is a white surface. Field-report sections are titled `.section-no` + `.section-title`:
  `01` in mono, then `WHERE` in small caps with sign tracking.
- `.input`, `.label`, `.hint`, `.field-error`. Inputs are 16px so iOS doesn't zoom.
  `aria-invalid="true"` turns the border orange automatically.
- `.readout` is a mono yellow-on-ink chip for coordinates and IDs. `.tag` is a small uppercase label.
- `.lane-strip` (the dashed road marking under the header) and `.hazard-edge` (diagonal
  orange/ink stripes). Decorative: always `aria-hidden`.
- The map pin is `markerIcon` in src/map.js: a yellow plate with an ink crosshair.

## Rules

- Hierarchy through weight and size, not colour: one yellow action per view.
- Orange means danger. Never use it decoratively.
- Minimum 44px touch targets. Focus is a 3px ink outline, visible even on yellow.
- Motion is short and purposeful (`animate-rise-in` for newly shown content, `animate-beacon` for
  the live/current state) and is disabled under `prefers-reduced-motion`.
- Words: plain, calm, second person. Say what happens next. No internal terms
  (triage, incident, extraction) on citizen screens.
