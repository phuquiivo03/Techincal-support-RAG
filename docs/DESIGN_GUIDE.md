# Design guide — "Softly" theme

Canonical visual language for this project. Every UI change must conform to this guide. The feel: **digital minimalism meets Gen-Z lifestyle** — a calm "digital living room": warm paper background, pastel accents, rounded everything, film grain, intentionally slow motion.

## 1. Color palette

| Token | Hex | Usage |
|---|---|---|
| Background | `#FDFCF8` | Page background (warm paper white) |
| Text (dark) | `#292524` | Primary text (soft black, stone-900) |
| Text (muted) | `#78716C` | Secondary text (stone-500) |
| Primary accent — Coral | `#FFB7B2` | CTAs, active states, highlights, logo dot |
| Sage | `#E8EFE8` | Secondary surfaces, tint panels |
| Lavender | `#EFEDF4` | Tertiary surfaces, alternating panels |
| Card | `#FFFFFF` | Cards, popovers, nav pill |
| Border | `#E7E5E4` | 1px hairline borders (stone-200) |
| Hero blob 1 | `#FFE4E1` | Blurred background blob |
| Hero blob 2 | `#E6E6FA` | Blurred background blob |

Coral is the **only** accent color. Sage and lavender are supporting tints — never compete with coral for attention.

## 2. Typography

- **Primary font: `Outfit`** (sans-serif, via `next/font`, variable `--font-sans`).
  - Headings: 48px–96px, `tracking-tight` (-0.025em), weight 500–600, **sentence-case only** — never Title Case, never ALL CAPS.
  - Body: 16–18px, weight 400, stone-800/900 for body text.
  - Small labels/meta: 13–14px, stone-400/500.
- **Accent font: `Reenie Beanie`** (cursive, variable `--font-accent`) for **one expressive word** inside a headline (e.g. "support, *softly*") or handwritten signatures. Never for body copy, buttons, or UI labels. Usually coral or stone-500, slightly larger optical size than the surrounding heading.

## 3. Shape, depth, texture

- **Border radius**: 2rem–4rem for containers (use `rounded-3xl` = 24px for cards, `rounded-4xl` for hero/section panels). Pills (`rounded-full`) for buttons, nav, chips, inputs.
- **Soft shadows only**: `0 4px 20px -2px rgba(0, 0, 0, 0.05)`. Never hard or heavy drop shadows.
- **Grain overlay (signature texture)** — a global fixed layer over the whole viewport:
  - `position: fixed; inset: 0; z-index: 50; pointer-events: none;`
  - SVG noise via `feTurbulence` with `baseFrequency="0.65"`, `mix-blend-mode: overlay`, `opacity: 0.35`.
  - Implemented as the `.grain-overlay` utility class in `globals.css`; mount once in the root layout.
- Background blobs: large (`40–60vmin`) circles in `#FFE4E1` / `#E6E6FA` at 60% opacity with heavy blur (`blur-3xl`), absolutely positioned behind heroes.

## 4. Motion

All motion is **slow and fluid** — nothing bouncy or fast.

- **Reveal on scroll**: opacity 0→1, `translateY(30px)`→0, duration **0.8s**, ease-out, staggered by ~100ms between siblings. Use the shared `<Reveal>` component (IntersectionObserver, fires once).
- **Floating blobs**: 6s infinite loop, `translateY ±10px`, ease-in-out, alternate.
- **Hover**: gentle — card text shifts to a pastel accent, buttons brighten or scale subtly (`scale-[1.02]`), transitions 200–300ms.
- **Accordion**: expand/collapse height animation, 500ms ease-in-out, plus icon rotates 45°.

## 5. Layout patterns

### Navigation — floating pill

- Fixed top, centered; width capped (`calc(100% - 32px)` on mobile, max-w fit on desktop).
- Background: white at 70% opacity + `backdrop-blur 20px`; hairline border; `rounded-full`; soft shadow.
- Logo: small circle in coral `#FFB7B2` with a tiny white dot. Links: 14px Outfit medium, stone-700. CTA: dark stone `#292524` pill with white text.

### Hero

- Center-aligned. Two blurred blobs (see §3) floating behind.
- Headline ~64–72px with one cursive accent word. Sub-headline max-width 500px, stone-500.
- Dual CTAs: primary coral pill (dark text, soft shadow), secondary white pill with 1px stone-200 border.

### Horizontal scenario scroll

- Row of fixed cards: **288×160px**, white, `rounded-3xl` (24px), hairline border.
- Top-left: timestamp/label in 14px stone-400. Bottom: scenario text 20px stone-800, `leading-snug`.
- On hover: text color transitions to a pastel accent (coral). Horizontal scroll with `snap-x`, no visible scrollbar, edge fade masks.

### Content cards

- White, `rounded-3xl`, 1px stone-100 border, the soft shadow from §3.
- Optional ±1° rotation for "physical note" moments (testimonials only), signature line: 32px horizontal rule + Reenie Beanie 24px stone-500.

### Conversion / focus sections

- Full-width panel on tinted background (sage or lavender) with floating high-blur gradients.
- Icon: dark stone rounded-square with a coral dot accent. Form controls: `rounded-full`, `bg-stone-50`. Submit: black pill, scales up slightly on hover.

## 6. Special components

### FAQ accordion

- Container: white, `rounded-2xl` (16px), 1px stone-100 border.
- Header row: 24px padding, 500-weight text, plus icon rotating 45° when open.
- Content: height 0→auto, 500ms ease-in-out; text reveals with bottom padding 24px.

### Grain overlay

See §3. One instance, root layout, above everything except dialogs (dialog z-index must exceed 50 — shadcn defaults do).

## 7. shadcn/ui token mapping (light theme only)

```css
:root {
  --background: #FDFCF8;
  --foreground: #292524;
  --card: #FFFFFF;
  --card-foreground: #292524;
  --popover: #FFFFFF;
  --popover-foreground: #292524;
  --primary: #FFB7B2;        /* coral */
  --primary-foreground: #292524;
  --secondary: #E8EFE8;      /* sage */
  --secondary-foreground: #292524;
  --muted: #F5F5F4;
  --muted-foreground: #78716C;
  --accent: #EFEDF4;         /* lavender */
  --accent-foreground: #292524;
  --destructive: #DC2626;
  --border: #E7E5E4;
  --input: #E7E5E4;
  --ring: #FFB7B2;
  --radius: 1rem;
}
```

Fonts: `--font-sans` = Outfit, `--font-accent` = Reenie Beanie (both via `next/font`).

## 8. Do / don't

- **Do**: sentence-case everywhere; one cursive word max per headline; coral reserved for primary actions and highlights; lots of whitespace; grain always on.
- **Don't**: dark mode; pure black/white (`#000`/`#fff` — use `#292524`/`#FDFCF8`); sharp corners on containers; heavy shadows; more than two accent colors per view; fast/bouncy animations; gradients other than the soft blurred blobs.
