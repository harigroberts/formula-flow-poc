# Tangerine Design System

You are now working with the **Tangerine** brand and design system. Tangerine is an AI consultancy that helps customers launch their AI journey with Claude — democratising data so AI can access it, create automation, and improve knowledge actionability.

**Tagline:** _Supercharge your AI transformation_

Apply these rules precisely whenever generating UI, copy, or code for Tangerine.

---

## Voice & copy rules

- **Person:** _we_ for the team, _you_ for the reader. Never passive voice.
- **Casing:** Sentence case everywhere. Title Case Only For Proper Nouns.
- **Punctuation:** Em-dashes for asides. Oxford comma yes.
- **Numbers:** Spell out one–twelve in prose; numerals for metrics ("83%", "6 hours").
- **Emoji:** No. Decorative Unicode kickers (`↘`, `✳`, `—`) are OK, sparingly.
- **CTAs:** Verb-first and specific — _Book a kickoff_, _See our work_, _Read the playbook_. Never _Learn more_ or _Get started_.
- **Hype words to avoid:** revolutionary, game-changing, AI-powered, synergy, unlock value.
- **Hype words that are fine:** ship, production, live, pilot, playbook, democratise.

---

## Color tokens

```css
/* Canvas & surfaces */
--color-linen:     #F5EDE0;  /* page background */
--color-paper:     #FDF7EC;  /* cards, panels */
--color-cream:     #FBF5EC;  /* alt panel / sunk */
--color-sand:      #F4D9A8;  /* warm fill, highlights */
--color-canvas:    #F0E5D3;  /* recessed diagram surface (--canvas) */

/* Accent ramp */
--color-tangerine: #E8763A;  /* PRIMARY accent */
--color-ember:     #C85A24;  /* hover / press */
--color-brick:     #A34518;  /* deep accent / active */

/* Ink */
--color-clay:      #3E2A1E;  /* body text, warm near-black */
--fg-muted:        #7A5A44;
--fg-subtle:       #83664F;  /* lightest text allowed — 4.95:1 on paper */

/* Supporting hues — fills, borders, strokes. Too light for small text: see ink variants */
--color-sage:      #8B9A5B;  /* success */
--color-olive:     #6B7A3F;
--color-sky:       #7A9AB8;  /* info (marketing only) */
--color-teal:      #3E6B68;  /* cool counterpoint — sub-flows, info text */
--color-mustard:   #C89A3C;  /* warning */
--color-plum:      #7A3B4A;  /* "stop" — End nodes; no longer danger */
--color-crimson:   #A8323E;  /* danger / destructive / error */

/* Semantic */
--accent-ink:      var(--color-brick);   /* accent-coloured text */
--accent-soft:     #FBDDC2;              /* ghost hover fill */
--accent-tint:     rgba(200, 90, 36, 0.10); /* active row / tab wash */
--danger:          var(--color-crimson);

/* Ink variants — text set in a hue. Each passes AA on paper and on its own 14–16% tint */
--success-ink:     #5C6A30;
--success-strong:  #5E6C33;  /* solid fill carrying paper text (5.4:1) */
--warning-ink:     #86601A;
--info-ink:        var(--color-teal);
--danger-ink:      var(--color-crimson);

/* Diagram & interaction */
--canvas:          var(--color-canvas);
--edge:            #8A6C54;  /* connectors — 3.9:1 on canvas */
--focus-ring:      0 0 0 3px rgba(232, 118, 58, 0.22);
--scrim:           rgba(62, 42, 30, 0.45);

/* Borders */
--line:            #E0CFB4;  /* default hairline */
--line-strong:     #C9B592;

/* On-accent: WCAG AA on tangerine fill */
--on-accent:       #1F1108;
```

Never use pure `#000000` or `#FFFFFF`. Use Clay for ink, Paper for white surfaces.

### Contrast rules

- **AA floor.** Any text under 14px (labels, chips, captions) must reach 4.5:1 against what it sits on. `--fg-subtle` is the lightest text colour; nothing lighter is ever text.
- **Ink variants.** Never set text in a raw supporting hue (`--color-sage`, `--color-mustard`, `--color-sky`, `--color-tangerine`): they sit at 2–3:1. Use the matching `-ink` token for the text and keep the raw hue for the fill, border, or stroke.
- **Orange means "act here".** Tangerine is for the primary CTA, focus, hover, and selection — not for informational tags, labels, or status. Decorative brand marks (logo, palette icons) are fine.
- **Destructive is crimson.** Delete / remove / reset use `--danger`, never tangerine, so they can't be mistaken for the primary action. Plum is reserved for "stop" (End nodes).
- **Focus rings** use `--focus-ring`; overlays use `--scrim`. Don't inline the `rgba()`.

---

## Typography

**Fonts (Google Fonts):**
```html
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,500&family=Caveat:wght@700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Role | Family | Weight | Notes |
|---|---|---|---|
| Display / h1 | Work Sans | 800 | `letter-spacing: -0.028em`, `text-wrap: balance` |
| Headings h2–h3 | Work Sans | 700 | Tight tracking |
| h4 / labels | Work Sans | 600 | |
| Body | Work Sans | 400/500/600 | 16px base, 1.6 line-height |
| Lead / intro | Work Sans | 400 | 20px, muted color |
| Eyebrow | Work Sans | 600 | 12px, `letter-spacing: 0.14em`, uppercase |
| Hand kicker | Caveat | 700 | 24px, accent color, `rotate(-2deg)` — one per page max |
| Code / mono | JetBrains Mono | 400/500 | |

```css
--font-display: 'Work Sans', system-ui, sans-serif;
--font-body:    'Work Sans', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;
--font-hand:    'Caveat', cursive;
```

---

## Spacing (4px base scale)

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
--space-12: 48px; --space-16: 64px; --space-20: 80px; --space-24: 96px;
```

Section padding: 64px mobile, 96–120px desktop. Between blocks inside a section: 24–40px.

---

## Border radius

```css
--radius-xs:  8px;
--radius-sm:  12px;
--radius-md:  18px;   /* buttons, inputs */
--radius-lg:  24px;   /* cards */
--radius-xl:  32px;   /* large cards */
--radius-2xl: 44px;   /* hero wells, CTA strips */
--radius-pill: 999px; /* badges only */
```

---

## Shadows (always warm ink, never grey)

```css
--shadow-xs: 0 1px 0 rgba(42, 24, 16, 0.06);
--shadow-sm: 0 1px 2px rgba(42, 24, 16, 0.08), 0 1px 0 rgba(42, 24, 16, 0.04);
--shadow-md: 0 4px 12px -2px rgba(42, 24, 16, 0.10), 0 2px 4px rgba(42, 24, 16, 0.05);
--shadow-lg: 0 16px 36px -12px rgba(42, 24, 16, 0.18), 0 4px 8px rgba(42, 24, 16, 0.04);
--shadow-xl: 0 32px 64px -20px rgba(42, 24, 16, 0.24);
--shadow-inset: inset 0 1px 2px rgba(42, 24, 16, 0.08);
```

Cards: `--shadow-sm` at rest → `--shadow-md` on hover with `translateY(-2px)`.

---

## Motion

```css
--ease-out:    cubic-bezier(0.2, 0.7, 0.2, 1);
--ease-in-out: cubic-bezier(0.6, 0.0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);  /* drawer open only */
--dur-fast:    120ms;   /* state flips */
--dur-base:    220ms;   /* default */
--dur-slow:    420ms;   /* page-level */
```

No parallax. No continuous animation loops on content.

---

## Component patterns

### Buttons

```css
/* Primary */
background: var(--color-tangerine);
color: var(--on-accent);           /* #1F1108 warm-black for WCAG AA */
border-radius: var(--radius-md);
padding: 12px 24px;
font-weight: 600;
transition: background var(--dur-fast) var(--ease-out),
            transform  var(--dur-fast) var(--ease-out),
            box-shadow var(--dur-fast) var(--ease-out);

/* Primary hover */
background: var(--color-ember);
transform: translateY(-1px);
box-shadow: var(--shadow-md);

/* Primary press — lose the lift, keep the color */
transform: translateY(0);

/* Secondary — outlined */
background: transparent;
border: 1.5px solid var(--color-clay);
color: var(--color-clay);
/* hover: fill clay, flip text to paper */

/* Ghost */
background: transparent;
color: var(--accent-ink);          /* raw tangerine text fails AA */
/* hover: background accent-soft (#FBDDC2) */

/* Destructive — ghost shape, its own hue */
background: transparent;
color: var(--danger-ink);
/* hover: background color-mix(in srgb, var(--danger) 10%, transparent) */
```

### Cards

```css
background: var(--color-paper);
border: 1px solid var(--line);
border-radius: var(--radius-lg);   /* or --radius-xl for large */
box-shadow: var(--shadow-sm);
padding: 24px 28px;
transition: box-shadow var(--dur-base) var(--ease-out),
            transform  var(--dur-base) var(--ease-out);

/* hover */
box-shadow: var(--shadow-md);
transform: translateY(-2px);
```

**Never** use a colored left-border accent bar on cards — that's a slop pattern.

### Inputs / form fields

```css
background: var(--color-paper);
border: 1px solid var(--line);
border-radius: var(--radius-md);
padding: 12px 16px;
font-size: 16px;
color: var(--color-clay);

/* focus */
border-color: var(--color-tangerine);
box-shadow: var(--focus-ring), var(--shadow-inset);
outline: none;
```

### Badges / pills

```css
border-radius: var(--radius-pill);
padding: 4px 12px;
font-size: 12px;
font-weight: 600;
letter-spacing: 0.04em;
```

Two families, so different kinds of metadata never blur together:

| Family | Use | Style |
|---|---|---|
| **Status** | state or signal (Manual / Auto, RAG/KB, info-gap, ML, gut-feel) | tinted fill (hue at 14–16%), `-ink` text |
| **Measure** | quantities (durations, counts) | no fill, `1px solid var(--line-strong)`, `--fg-muted` text, `--font-mono` |

Status hues: success → sage fill / `--success-ink`; warning → mustard fill / `--warning-ink`; neutral state (e.g. Manual) → sand fill / `--color-umber`. No tangerine badges.

### Diagrams / canvas

- **Surfaces step down, cards step up.** The diagram sits on `--canvas` (darker than linen); cards and nodes sit on `--color-paper` with a `1.5px solid var(--line-strong)` border at rest. A dot grid in `--line-strong` at 20px gives the canvas texture.
- **Edges** use `--edge` at 1.75px; selected edges switch to tangerine at 2.25px. Arrowheads must use the literal `#8A6C54` (SVG `<defs>` may not resolve custom properties) — keep it in step with `--edge`.
- **Node-type hues:** task neutral (paper + line-strong), sub-flow `--color-teal` border with `--info-ink` text, decision neutral, Start `--success-strong` fill, End `--color-plum` fill. Paper text on both terminal fills.
- **Branch labels:** Yes in `--success-ink`, No in `--color-plum`, 11px / 700.
- **Loops:** guarded back edges dashed in `--warning-ink`; unguarded (modelling error) in `--danger`.

### Sticky header

```css
background: rgba(245, 237, 224, 0.82);
backdrop-filter: saturate(140%) blur(10px);
```

Backdrop blur is used **only** on the sticky header. Nowhere else.

### Dividers

```css
border: none;
border-top: 1px dashed var(--line);  /* hand-stitched feel */
```

### Section backgrounds

Alternate between `--color-linen` and `--color-paper` (or `--color-cream`) for rhythm. One section per page may use a warm-dark (`--color-clay`) bg with `--fg-inverse` text for contrast.

---

## Assets (paths relative to project root)

| Asset | Path | Usage |
|---|---|---|
| Logo mark | `assets/logo-mark.svg` | Square/icon contexts |
| Logo wordmark | `assets/logo-wordmark.svg` | Nav, footer |
| Icons | `assets/icons.svg` | `<use href="assets/icons.svg#i-spark">` |
| Paper texture | `assets/texture-paper.svg` | `mix-blend-mode: multiply; opacity: 0.15` |
| Waves pattern | `assets/pattern-waves.svg` | Section dividers |
| Illustrations | `assets/illustration-orchard.svg` | Hero / feature sections |
| | `assets/illustration-data-democracy.svg` | |
| Squiggle underline | `assets/underline-squiggle.svg` | Headline accent |

**Icon IDs** (use via `#i-<name>`):
`spark`, `arrow-right`, `arrow-up-right`, `check`, `close`, `menu`, `search`, `chat`, `bolt`, `brain`, `book`, `compass`, `layers`, `plug`, `user`, `calendar`, `doc`, `chart`, `settings`, `heart`, `play`, `globe`, `lock`, `star`, `sparkle-claude`

All icons: 24×24, 1.75px stroke, `stroke-linecap="round"`, `stroke-linejoin="round"`, `currentColor`.

---

## Layout rules

- **Mobile-first.** `min-width` breakpoints: 700px (tablet), 900px (desktop).
- **Container max-width:** 1200px, centered.
- **Grid:** CSS Grid or flex with `gap`. Never inline-block siblings separated by whitespace.
- **Section padding:** `var(--space-16)` (64px) mobile → 96–120px desktop.
- **Between blocks:** 24–40px.
- **Fixed elements:** header only. No floating back-to-top.

---

## Anti-patterns — never do these

- UI gradients (gradients only inside the logo mark)
- Pure black `#000` or pure white `#fff`
- Grey shadows — always use warm ink shadows
- Left-border accent bars on cards
- Emoji in UI or marketing copy
- `border-radius` tighter than 8px in Tangerine UI
- Parallax or looping animations on page content
- `backdrop-filter` anywhere except the sticky header
- Passive voice, hype words, generic CTAs

---

## CSS import

Import `src/styles/tangerine/styles.css` — the single entry point, which pulls in `colors_and_type.css` (all tokens and semantic type classes). Every token in the **Color tokens** block above must exist there with the same value; change both together.
