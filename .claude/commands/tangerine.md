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

/* Accent ramp */
--color-tangerine: #E8763A;  /* PRIMARY accent */
--color-ember:     #C85A24;  /* hover / press */
--color-brick:     #A34518;  /* deep accent / active */

/* Ink */
--color-clay:      #3E2A1E;  /* body text, warm near-black */
--fg-muted:        #7A5A44;
--fg-subtle:       #9A7E66;

/* Semantic */
--color-sage:      #8B9A5B;  /* success */
--color-sky:       #7A9AB8;  /* info */
--color-mustard:   #C89A3C;  /* warning */
--color-plum:      #7A3B4A;  /* danger */

/* Borders */
--line:            #E0CFB4;  /* default hairline */
--line-strong:     #C9B592;

/* On-accent: WCAG AA on tangerine fill */
--on-accent:       #1F1108;
```

Never use pure `#000000` or `#FFFFFF`. Use Clay for ink, Paper for white surfaces.

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
color: var(--color-tangerine);
/* hover: background accent-soft (#FBDDC2), color ember */
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
box-shadow: 0 0 0 3px rgba(232, 118, 58, 0.18), var(--shadow-inset);
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

To use all tokens and semantic type classes in a project:

```css
@import url('./path/to/colors_and_type.css');
```

Or copy the file into your repo — it is fully self-contained.
