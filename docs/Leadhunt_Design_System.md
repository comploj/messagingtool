# Leadhunt Internal Tools — Design System

This document defines the visual language, UI patterns, and interaction principles for all tools built within the Leadhunt ecosystem. Every team member building an internal tool must follow this guide to ensure consistency across the Leadhunt product family.

**How to use this document:** Paste it into your Claude Code project or reference it in your prompts. When asking Claude Code to build UI, include: "Use the Leadhunt design system from this document."

---

## 1. Core Aesthetic Direction

**Style:** Dark, minimal, data-dense, professional SaaS. No gradients as primary elements. No rounded playful shapes. No neon glow effects. Clean typography, disciplined spacing, colored accents only where they carry meaning (profile identity, status, category).

**Inspiration references:** Linear, Vercel dashboard, Raycast, Notion (dark mode), Arc browser settings.

**What we are NOT:** Not corporate blue-and-white SaaS. Not pastel. Not glassmorphism. Not Material Design. Not Bootstrap-looking.

---

## 2. Color System

### Backgrounds (dark theme, always)
```
Primary background:    #0a0a0f  (near-black, main canvas)
Secondary background:  #12121f  (cards, panels)
Tertiary background:   #1a1a2e  (hover states, nested panels)
Border / divider:      rgba(255, 255, 255, 0.06)
Border (stronger):     rgba(255, 255, 255, 0.1)
```

### Text
```
Primary text:    #e2e8f0  (body, main content)
Secondary text:  #94a3b8  (labels, supporting info)
Tertiary text:   #64748b  (meta info, timestamps)
Muted text:      #475569  (disabled, placeholders)
```

### Accent (interactive elements)
```
Primary accent:       #6366f1  (indigo — primary buttons, links, active states)
Primary accent hover: #8b5cf6  (purple — gradient target)
Primary gradient:     linear-gradient(135deg, #6366f1, #8b5cf6)

Success:  #22c55e  (pushed, confirmed, complete)
Warning:  #f59e0b  (draft, pending, caution)
Danger:   #ef4444  (error, delete, critical)
Info:     #06b6d4  (informational, neutral highlight)
```

### Profile Colors (Leadhunt team identities)
Use these exact colors whenever a profile is referenced in any tool:
```
Valeria Schmidt:        #f87171  (coral pink)
David Götte:            #3b82f6  (electric blue)
Leon Winkel:            #f59e0b  (amber)
David Comploj:          #14b8a6  (teal)
Eleonora Schmidt:       #a855f7  (violet)
Charles Henry Uzoma:    #10b981  (emerald)
```

### Content Category Colors
```
Hot Take:              #8b5cf6  (purple badge)
Educational:           #3b82f6  (blue badge)
Lead Magnet:           #f59e0b  (amber badge)
Client Success Story:  #22c55e  (green badge)
```

### Tier Colors (for Content Bank and similar ranking UIs)
```
TIER 1:    #fbbf24  (gold)
TIER 2:    #94a3b8  (silver)
TIER 3:    #a16207  (bronze)
Untiered:  #475569  (grey)
```

---

## 3. Typography

**Primary font family:** DM Sans (headings, body, UI)
**Monospace (when needed):** Space Mono (timestamps, code, log output)

Load via Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
```

### Type scale
```
Display:     32px / 700 weight / -0.02em letter-spacing
H1:          24px / 700 weight / -0.01em
H2:          18px / 700 weight / -0.01em
H3:          15px / 600 weight
Body:        14px / 400 weight / 1.5 line-height
Body small:  13px / 400 weight
Label:       11px / 600 weight / uppercase / 0.05em letter-spacing (used for section headers, column headers)
Caption:     12px / 400 weight
Mono:        12px / 400 weight (Space Mono, for logs/timestamps)
```

**Rules:**
- Never use more than 3 font sizes in one view
- Labels (section headers, column headers) are always UPPERCASE with 0.05em letter-spacing
- Headlines use -0.01em or -0.02em letter-spacing to feel tight
- Body text is never below 13px
- Line-height for body is 1.5, for headings 1.2

---

## 4. Spacing

Use a 4px base unit. All spacing values are multiples of 4:
```
xs:   4px
sm:   8px
md:   12px
base: 16px  (default gap between elements)
lg:   20px
xl:   24px
2xl:  32px
3xl:  48px
```

**Padding conventions:**
- Button: 12px vertical × 28px horizontal (primary), 10px × 20px (secondary)
- Card: 16-20px padding inside
- Input: 10-12px vertical × 12-14px horizontal
- Modal: 24-32px padding
- Page container: max-width 1280px, margin auto, 24-32px horizontal padding

---

## 5. Border Radius

```
Small:    6px   (inputs, small buttons, badges)
Medium:   8px   (standard buttons, cards)
Large:    10px  (larger cards, panels)
XL:       12px  (modals, major panels)
Pill:     999px (tags, status pills, avatars)
```

**Never use border-radius greater than 12px on cards.** Nothing should feel "playfully rounded."

---

## 6. Components

### Buttons

**Primary button:**
```css
background: linear-gradient(135deg, #6366f1, #8b5cf6);
color: #ffffff;
padding: 12px 28px;
border-radius: 8px;
font-size: 14px;
font-weight: 600;
border: none;
cursor: pointer;
transition: opacity 0.15s;
```
On hover: `opacity: 0.9`. Disabled: `opacity: 0.4; cursor: not-allowed`.

**Secondary / ghost button:**
```css
background: rgba(255, 255, 255, 0.06);
color: #94a3b8;
border: 1px solid rgba(255, 255, 255, 0.1);
padding: 10px 20px;
border-radius: 8px;
font-size: 13px;
font-weight: 500;
```

**Destructive button:**
```css
background: rgba(239, 68, 68, 0.1);
color: #fca5a5;
border: 1px solid rgba(239, 68, 68, 0.3);
```

### Inputs & Textareas
```css
background: rgba(255, 255, 255, 0.04);
border: 1px solid rgba(255, 255, 255, 0.1);
border-radius: 6px;
padding: 10px 12px;
color: #e2e8f0;
font-size: 13px;
font-family: inherit;
outline: none;
```
On focus: `border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);`

### Cards / Panels
```css
background: rgba(255, 255, 255, 0.03);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 10px;
padding: 16px 20px;
```
When categorized (e.g., post type), add a 3px left border in the category color:
`border-left: 3px solid <category-color>;`

### Badges (tier, category, status)
```css
display: inline-flex;
align-items: center;
gap: 4px;
padding: 4px 10px;
border-radius: 6px;
font-size: 11px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: 0.04em;
```
Background: 15% opacity of the badge color. Text: the badge color at full opacity.
Example for TIER 1: `background: rgba(251, 191, 36, 0.15); color: #fbbf24;`

### Tables
- No zebra striping
- Row hover: `background: rgba(255, 255, 255, 0.03)`
- Column headers: 11px uppercase with 0.05em letter-spacing, color `#64748b`
- Row borders: `border-bottom: 1px solid rgba(255, 255, 255, 0.04)` (very subtle)
- Row padding: 12-14px vertical

### Modals / Dialogs
- Backdrop: `rgba(0, 0, 0, 0.5)` with `backdrop-filter: blur(4px)`
- Modal itself uses the card styling (large variant: 12px border-radius)
- Close button top-right, ghost styling
- Actions bottom-right, primary button on the right

### Status indicators (dots / pills)
- Pushed / success: `#22c55e`
- Draft / pending: `#f59e0b` or the accent color
- Not generated / inactive: `rgba(255, 255, 255, 0.2)`
- Use a small 8px circle for inline status, or a pill badge for labeled status

### Icons
- Use Lucide React (`lucide-react`) for all icons. Never mix icon libraries.
- Default icon size: 16px. Small: 14px. Large: 20px.
- Icon color inherits from text color unless specifically styled.

---

## 7. Layout Patterns

### App shell
- Left sidebar: 240px fixed width, dark secondary background
- Main content area: flexible, max-width 1280px centered, 24-32px padding
- Top header (if used): 64px height, border-bottom

### Sidebar navigation item
```css
display: flex;
align-items: center;
gap: 12px;
padding: 10px 14px;
border-radius: 8px;
color: #94a3b8;
font-size: 14px;
font-weight: 500;
```
Active state: `background: rgba(99, 102, 241, 0.1); color: #e2e8f0;` with a colored left border or dot indicator.

### Section header pattern
```
<Label>TOP TRAFFIC DRIVERS</Label>  (11px uppercase, #64748b)
<Subtitle>Posts driving the most visits via UTM tracking</Subtitle>  (13px, #94a3b8)
<Content>...</Content>
```

### Empty states
- Centered text
- Primary message: 15px medium weight, `#94a3b8`
- Secondary hint: 13px, `#64748b`
- Optional CTA button below

### Loading states
- Use a spinner: 40-48px circle, 3px border, `rgba(99, 102, 241, 0.2)` with top border `#6366f1`, animated rotation 1s linear infinite
- Accompany with a 15px semibold message below

---

## 8. Interaction Rules

- **Transitions:** 0.15s to 0.2s ease on interactive state changes. Never longer — snappy feel matters.
- **Hover feedback:** every interactive element must have a visible hover state (opacity change, background change, or border change).
- **No heavy animations:** no bouncing, no elastic easing, no spinning logos. We're a productivity tool, not a marketing site.
- **Toast notifications:** bottom-right, slide in from below, auto-dismiss in 3-5 seconds. Success: green accent. Error: red accent. Info: indigo accent.
- **Confirmation for destructive actions:** always inline confirmation ("Are you sure?" with explicit Cancel / Confirm buttons), never a browser alert() or window.confirm().

---

## 9. Writing & Voice in UI

- **Button labels:** verb + noun, Title Case. "Push to OneUp" not "Push it to OneUp!"
- **Empty states:** direct, no emojis. "No posts yet. Import from CSV to get started."
- **Error messages:** honest, specific, no blame. "Couldn't reach OneUp. Check your connection and retry."
- **Section headers:** UPPERCASE, short, specific. "TOP TRAFFIC DRIVERS" not "Your Top Performing Content"
- **British English:** favour, organisation, recognise, colour (except in CSS properties which use `color`)
- **No exclamation marks.** Ever. This is a tool, not a party.

---

## 10. Accessibility

- Minimum contrast: WCAG AA (4.5:1 for body text, 3:1 for large text / UI elements)
- Focus states must be visible (`outline: 2px solid #6366f1; outline-offset: 2px`)
- All interactive elements must be keyboard-accessible
- Icon-only buttons must have `aria-label` or tooltip
- Form inputs must have associated `<label>` elements

---

## 11. What to Avoid

- Generic AI-looking layouts (centered hero with rounded card and gradient button)
- Glassmorphism (frosted glass backgrounds)
- Neon glows or heavy drop shadows
- Rainbow gradients or more than 2-color gradients
- Emojis in UI chrome (OK in content, never in buttons/labels/headings)
- Animated SVG illustrations as decoration
- "Card grid with 3 equal cards" as a default layout
- Center-aligned body text
- Font sizes below 12px
- Border-radius above 12px on any container
- Serif fonts anywhere
- Light mode (unless specifically requested — we are dark-first)

---

## 12. Example Component (reference implementation)

```jsx
// Standard page header with subtitle and primary action
<div style={{
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "24px",
}}>
  <div>
    <h1 style={{
      fontSize: "24px",
      fontWeight: 700,
      letterSpacing: "-0.01em",
      color: "#e2e8f0",
      margin: 0,
    }}>
      Content Bank
    </h1>
    <p style={{
      fontSize: "13px",
      color: "#94a3b8",
      marginTop: "4px",
    }}>
      240 posts · Filter, sort, and assign to profiles
    </p>
  </div>
  <button style={{
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    padding: "12px 28px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
  }}>
    + Add Post
  </button>
</div>
```

---

## 13. For Claude Code

When asked to build or style any UI in the Leadhunt ecosystem:

1. Read this entire document before writing any JSX/CSS
2. Use the exact hex values, spacing scale, and typography rules above
3. Default to the dark theme — never build light mode unless explicitly asked
4. When in doubt about a color or size, pick the more restrained option
5. Reference components in section 6 before inventing new patterns
6. If building something not covered here, extend the system consistently rather than inventing new visual language
7. Use DM Sans for everything unless the user explicitly asks for something else
8. Never use Tailwind arbitrary classes like `bg-[#123456]` — use the defined color palette
9. All profile references anywhere in the UI must use the 6 profile colors exactly as defined
10. When showing tier, category, or status, use the badge pattern from section 6

If a request conflicts with this design system, flag it and ask rather than silently breaking the system.
