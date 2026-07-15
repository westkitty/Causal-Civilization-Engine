# UI Asset Manifest

Date: 2026-07-15

This manifest covers interface assets that are loaded by the application after the UI/UX polish pass. Lucide icons are code dependencies and are listed as an existing icon system rather than copied assets.

## Pre-implementation inventory

| File / system | Purpose before polish | Use status | Audit decision |
|---|---|---|---|
| `public/favicon.svg` | Browser icon | Loaded | Default Vite artwork, visually unrelated; replace. |
| `public/icons.svg` | Social/document symbol sheet | Unused | Unrelated starter asset; remove if no references remain. |
| `src/assets/react.svg` | React starter logo | Unused | Remove if no references remain. |
| `src/assets/vite.svg` | Vite starter logo | Unused | Remove if no references remain. |
| `src/assets/hero.png` | Unnamed starter image | Unused | Keep out of the interface; remove only if provenance and references are safely resolved. |
| `lucide-react` | Interface controls and status symbols | Loaded from local package | Retain; use one 1.75–2 px stroke language and visible text for unfamiliar actions. |

## Active asset manifest

| Filename / system | Purpose | Dimensions / viewBox | Component usage | Accessibility treatment | Classification | Source |
|---|---|---|---|---|---|---|
| `public/favicon.svg` | Product mark combining a branching causal path, terrain contours, and baseline/counterfactual endpoints | `viewBox="0 0 48 48"`; 48×48 intrinsic use | Browser favicon, compact header mark, empty Inspector mark | SVG contains a descriptive `<title>`; in-page copies are `alt=""`/`aria-hidden` because adjacent text names the product or state | Meaningful as favicon; decorative when repeated beside text | Original local SVG created for this pass |
| `lucide-react` icons | Playback, overlay, selection, status, branch, evidence, and recovery affordances | CSS-normalized primarily to 16–20 px inside ≥44 px controls | `App`, `Timeline`, `DivergenceControls`, `Inspector` | Familiar icon buttons have explicit accessible names; unfamiliar icons retain visible text; decorative SVG instances use `aria-hidden` | Meaningful when paired with labels | Existing local package dependency |
| CSS legend swatches and state keys | Explain terrain, political factions, resources, and active/ruined/suppressed infrastructure without hue alone | 10–14 px symbols inside textual legend rows | `DivergenceControls` | Every swatch is adjacent to a visible name; infrastructure states use circle, diamond, and crossed-line shapes as well as color | Meaningful | Original local CSS |
| CSS causal loader motif | Shows one history node branching into baseline/counterfactual endpoints during real Worker progress | 72×35 px layout box | `App` loading status card | `aria-hidden`; operation name, explanation, progressbar, and percentage carry all meaning | Decorative reinforcement | Original local CSS |
| CSS comparison divider handle | Makes the map split boundary visible and visually draggable | 24×48 px handle on a 2 px divider | `App` split-map overlay; controlled by the labeled range input in `DivergenceControls` | Visual copy is `aria-hidden`; the real range has accessible name/value text and keyboard support | Meaningful visual affordance | Original local CSS |

## Removed assets

| File | Reason |
|---|---|
| `public/icons.svg` | Unused social/document starter sheet; unrelated to the simulator. |
| `src/assets/react.svg` | Unused framework starter logo. |
| `src/assets/vite.svg` | Unused framework starter logo. |

`src/assets/hero.png` remains an inactive, unreferenced repository file. It is not loaded, copied, or claimed as part of this interface. Removing the binary without a provenance decision was not necessary to the bounded UI pass.

## Asset rules applied

- No external resources, custom fonts, or Content Delivery Network (CDN) assets are loaded.
- No asset is used as a substitute for a label or state announcement.
- The active visual language uses one Lucide stroke system, small local CSS symbols, and one original SVG mark.
