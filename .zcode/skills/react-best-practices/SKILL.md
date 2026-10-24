---
name: react-best-practices
description: "Use when writing, reviewing, or refactoring React or Next.js code in this workspace: components, hooks, state, App Router structure, data fetching, styling with Tailwind CSS and shadcn/ui. Encodes this project's UI conventions so new code matches them without re-deriving the rules."
---

# React best practices — this workspace

## Component rules

- Function components only. No class components.
- Name files `kebab-case.tsx` matching the default or main exported component (`chat-message.tsx` → `ChatMessage`).
- Compose shadcn/ui primitives from `components/ui/*`; never edit files under `components/ui/` — wrap them in a feature component instead.
- Use the `cn()` helper (`lib/utils`) for conditional class merging. Don't call `clsx`/`tailwind-merge` directly in feature code.

## Server vs Client components (App Router)

- Components are Server Components by default. Add `"use client"` only when the file needs state, effects, event handlers, browser APIs, or context.
- Keep the `"use client"` boundary as deep (leaf) as possible so parents stay server-rendered.
- Data fetching from the Express API happens in client components via `lib/api.ts`, not in server components — pages must not fail to build when the API server is down.

## Hooks & state

- Follow the Rules of Hooks: top level of the component, never conditional or in loops.
- Colocate state as close to its usage as possible; lift only when genuinely shared.
- Derive values during render instead of mirroring them into `useState` + `useEffect`.
- `useEffect` is for synchronizing with external systems (network, timers, DOM); it is not for transforming data for render.
- Type state explicitly when inference isn't obvious. No `any`.

## Data fetching

- Use the typed helpers in `lib/api.ts`; never scatter raw `fetch` calls with hand-built URLs through components.
- Every async UI must handle three states explicitly: loading (skeletons/spinners), error (toast via sonner + inline message), and empty.
- Only `NEXT_PUBLIC_*` values reach the browser. API keys live exclusively in `server/.env` on the Express backend.

## Styling (Tailwind + design system)

- Follow `docs/DESIGN_GUIDE.md` (the "Softly" theme): palette, radius, shadows, grain overlay, motion specs.
- Prefer semantic tokens (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `bg-card`) over raw hex values in components.
- Signature look: containers `rounded-3xl`/`rounded-4xl` white cards, soft shadow `0 4px 20px -2px rgba(0,0,0,0.05)`, sentence-case headings with `tracking-tight`, cursive (`font-accent`) for one expressive word — never for body text.
- Motion: `reveal-on-scroll` (translateY 30px→0, 0.8s) via the shared `Reveal` component; slow floating blobs; no fast or bouncy animations.

## Accessibility

- Interactive elements are real `<Button>`/`<Link>` with accessible names.
- Icon-only controls need `aria-label` or `sr-only` text.
- Keep visible focus rings (`ring-ring`); never remove outlines without a replacement.
- Use shadcn Dialog/Popover as-is for focus management; don't rebuild them.

## Performance

- No premature `memo`/`useMemo`/`useCallback` — add only for measured problems.
- Fonts come from `next/font` (Outfit + Reenie Beanie). No external font links.
- Dynamic-import heavy client components only when bundle size actually matters.

## Conventions

- TypeScript strict mode; no `any`, avoid non-null assertions.
- API response shapes come from `@rag/shared` — don't redeclare them in web code.
- Feature components live in `components/<feature>/`; shared UI wrappers in `components/`.
- Keep chat thread, upload, and debugger logic in dedicated hooks or components — pages stay thin.
