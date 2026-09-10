---
name: Mineral Horizon
colors:
  surface: '#f8f9fc'
  surface-dim: '#d9dadd'
  surface-bright: '#f8f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f7'
  surface-container: '#edeef1'
  surface-container-high: '#e7e8eb'
  surface-container-highest: '#e1e2e6'
  on-surface: '#191c1e'
  on-surface-variant: '#43474d'
  inverse-surface: '#2e3133'
  inverse-on-surface: '#f0f1f4'
  outline: '#73777e'
  outline-variant: '#c3c7ce'
  surface-tint: '#45617f'
  primary: '#365371'
  on-primary: '#ffffff'
  primary-container: '#4f6b8a'
  on-primary-container: '#dceaff'
  inverse-primary: '#acc9ec'
  secondary: '#49626d'
  on-secondary: '#ffffff'
  secondary-container: '#cce7f4'
  on-secondary-container: '#4f6874'
  tertiary: '#7b4200'
  on-tertiary: '#ffffff'
  tertiary-container: '#9e5700'
  on-tertiary-container: '#ffe5d2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d0e4ff'
  primary-fixed-dim: '#acc9ec'
  on-primary-fixed: '#001d35'
  on-primary-fixed-variant: '#2c4966'
  secondary-fixed: '#cce7f4'
  secondary-fixed-dim: '#b0cad8'
  on-secondary-fixed: '#031e28'
  on-secondary-fixed-variant: '#324a55'
  tertiary-fixed: '#ffdcc2'
  tertiary-fixed-dim: '#ffb77a'
  on-tertiary-fixed: '#2e1500'
  on-tertiary-fixed-variant: '#6d3a00'
  background: '#f8f9fc'
  on-background: '#191c1e'
  surface-variant: '#e1e2e6'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Manrope
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.005em
  headline-sm:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.015em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-xxs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-base: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
  space-2xl: 2rem
  space-3xl: 2.5rem
  space-4xl: 3rem
  panel-nav-width: 16rem
  panel-list-width: 22rem
  panel-meta-width: 20rem
  chat-max-bubble-width: 80%
---

## Brand & Style

The design system embodies a calm, precise, and human-centric service environment tailored for customer support agents and their end customers. Its personality balances high-velocity productivity with visual serenity—mitigating fatigue across long support shifts while offering an inviting, non-threatening customer-facing experience. 

The aesthetic is grounded in **Minimalism** enriched with **Tonal Layering** and soft, tactile boundaries. Visual weight is kept intentionally gentle: heavy dark slates, pitch-black fills, and stark contrast blocks are entirely eliminated in favor of warm stone neutrals, luminous mineral slates, and tranquil indigo-tinted highlights. Interfaces evoke clarity, responsiveness, and composed authority, ensuring agents maintain spatial orientation across dense multi-pane ticket desks while customer chat widgets feel as approachable as a high-end personal concierge.

## Colors

The palette establishes an airy, light-neutral foundation built upon warm stone and mineral undertones. The primary accent (`#4f6b8a`) is a soft mineral indigo-slate that delivers clear affordance without visual aggression. The secondary tone (`#627b87`) introduces a grounding teal-slate cast for secondary interactive states, subtle tabs, and inactive indicators. Warm amber (`#d9822b`) acts as a selective tertiary accent for priority warnings and SLA escalations, complemented by a balanced muted emerald (`#2e7d5b`) for resolution states.

### Palette Roles & Values

- **Canvas Background (`surface-base`):** `#f9f9fb` — A delicate warm-stone tint that eliminates screen glare.
- **Surface Elevation 1 (`surface-raised`):** `#ffffff` — Crisp white reserved for message bubbles, cards, floating panes, and active inputs.
- **Surface Elevation 2 (`surface-sunken`):** `#f1f3f6` — Cool heather stone for agent transcript backgrounds, message streams, and sidebar rails.
- **Inbound Message Bubble:** `#ffffff` with a subtle 1px border of `#e2e6eb`. Text rendered in `#2d3748`.
- **Outbound Message Bubble:** `#e8eff7` (gentle ice-indigo tint) with border `#d5e2f0`. Text rendered in `#1e293b`. Never black or dark slate.
- **Text Primary:** `#1e293b` — Deep soft slate; never pure `#000000`.
- **Text Secondary / Muted:** `#5d6b7a` — Readable medium-contrast mineral gray (exceeds WCAG 4.5:1 on light fills).
- **Border Subtle:** `#e5e9ee` — Gentle division line for panels, list dividers, and subtle segment boundaries.
- **Border Focus / Interactive:** `#7b97b8` — Restrained indigo-tinted ring outline with 20% alpha glow.

## Typography

The type system blends the geometric balance of **Manrope** for primary headers and panel titles with the hyper-legible neutral ergonomics of **Hanken Grotesk** for messaging transcripts, conversation streams, and dense ticket attributes. 

- **Headers:** Rendered in Manrope with a snug letter-spacing to form cohesive, distinct structural anchors throughout the multi-pane console.
- **Chat Transcripts & Body:** Set exclusively in Hanken Grotesk at 14px and 15px with generous line heights (22px to 24px). This prevents eye-strain during prolonged reading of customer exchanges.
- **Metadata, Timestamps & Statuses:** Utilize `label-md` and `label-sm` in medium weight (500), rendered in muted mineral tints to keep context immediate without competing with the conversation text.
- **Monospace Snippets:** JetBrains Mono is designated for API logs, ticket UUIDs, and technical payload details within ticket inspection drawers.

## Layout & Spacing

The layout is built upon an 8-point geometric scale, complemented by a 4-point half-step (`0.25rem`) reserved for tight alignments in metadata badges, button interiors, and chat header grouping.

### Multi-Pane Architecture (Desktop Helpdesk)
- **Primary Shell:** A three-to-four pane fluid horizontal split:
  1. **Global Rail:** Collapsible (64px mini / 256px expanded) for queues, routing, and system tools.
  2. **Ticket/Chat Stream List:** Fixed width (352px) housing incoming conversations and queue cards.
  3. **Active Workspace:** Fluid central stage displaying conversation history, timeline events, and internal reply composer.
  4. **Customer Context / CRM Inspector:** Flexible side sheet (320px to 360px) toggleable based on agent need.
- **Margins & Gutters:** High-density zones (lists, internal notes) enforce 8px gutters; structural panel margins remain at 16px to maintain clear spatial division without wasted surface area.

### Breakpoints & Responsive Behavior
- **Desktop (>= 1280px):** Full 3-4 pane workstation layout with simultaneous active view of queue, message transcript, and user profile.
- **Tablet / Small Desktop (768px – 1279px):** Inspector slides into a modal sheet or off-canvas drawer; conversation stage maintains central focus.
- **Mobile / Customer Widget (< 768px):** Single-column stacked mode. Navigation tabs switch to a bottom dock or sliding sheet. Customer chat bubbles widen to 85% of screen width with 12px outer edge padding.

## Elevation & Depth

This system avoids dark, muddy drop shadows and thick borders. Depth is realized through **tonal surface stacking** combined with **subtle, wide-diffusion mineral shadows** tinted with cool slate.

### Elevation Hierarchy
- **Level 0 (Base Floor):** `#f9f9fb` — The underlying canvas behind panels. Flat with no shadow.
- **Level 1 (Panels & Sidebar Sheets):** `#ffffff` or `#f1f3f6` — Separated purely by crisp hairline dividers (`1px solid #e5e9ee`).
- **Level 2 (Chat Bubbles, Field Sets & Cards):** `#ffffff` resting over `#f1f3f6` with an ultra-light ambient glow: `0 1px 3px rgba(30, 41, 59, 0.04), 0 1px 2px rgba(30, 41, 59, 0.02)`.
- **Level 3 (Dropdowns, Canned Responses & Hover Previews):** `#ffffff` elevated with `0 4px 16px -2px rgba(51, 65, 85, 0.08), 0 2px 6px -1px rgba(51, 65, 85, 0.04)`.
- **Level 4 (Customer Chat Launcher & Modal Overlays):** Elevated floating layers using `0 12px 32px -4px rgba(30, 41, 59, 0.12), 0 4px 12px -2px rgba(30, 41, 59, 0.04)`.

All elevated surfaces carry a microscopic `1px` translucent outline (`rgba(226, 232, 240, 0.8)`) to preserve perimeter integrity against lighter backgrounds.

## Shapes

The design adopts a moderately rounded form language (`roundedness: 2`, where base radius equals `0.5rem` / 8px). This creates a polished, contemporary presence that feels approachable without appearing overly whimsical or toy-like.

- **Base Radius (`rounded-md` / 8px):** Standard inputs, ticket table rows, action buttons, alert boxes, and dropdown menus.
- **Large Radius (`rounded-lg` / 16px):** Outer panel containers, customer side drawer, context cards, and modal dialogs.
- **Chat Bubbles:** Tailored asymmetric radius. Standard bubbles receive `14px` border radius across three corners, with the anchor corner (bottom-left for incoming, bottom-right for outgoing) tightened to `4px`.
- **Pill Radius (`rounded-full` / 9999px):** Status indicators, tag chips, counter badges, user avatar frames, and the customer floating chat trigger.

## Components

### Chat Bubbles & Conversation Feed
- **Customer (Inbound) Bubbles:** Pure white (`#ffffff`) fill with a `1px` border of `#e2e6eb`. Text set in `#2d3748`. Anchor radius at bottom-left (`4px`). Metadata and timestamps render outside or subtly below the message in `#718096`.
- **Agent (Outbound) Bubbles:** Soft mineral ice-indigo (`#e8eff7`) fill with a `1px` border of `#d5e2f0`. Text in `#1e293b`. Under no circumstances should outgoing bubbles be black, saturated royal blue, or dark slate.
- **Internal Team Notes:** Soft pale amber fill (`#fffbeb`) with a dashed border of `#fcd34d` and text in `#78350f`, clearly differentiating private collaboration from customer-visible remarks.

### Buttons
- **Primary:** Filled in soft mineral indigo (`#4f6b8a`) with white text (`#ffffff`). Hover transitions to `#415a75`. Active state depresses subtly without drop shadow.
- **Secondary:** Surface white (`#ffffff`) with a `1px solid #d8e0e8` border and slate text (`#334155`). Hover shifts surface to `#f4f7fa`.
- **Ghost / Subtle:** Transparent background with `#475569` text. Hover adds `#eef2f6` fill. Used inside thread headers and message reaction toolbars.
- **Destructive:** Soft strawberry-tinted fill (`#fef2f2`) with `#b91c1c` text and `#fecaca` border, avoiding overwhelming crimson blocks.

### Badges & Status Chips
- **Open / In-Progress:** Soft sky tint (`#e0f2fe`) fill with `#0369a1` text.
- **Pending / Escalated:** Soft amber tint (`#fef3c7`) fill with `#92400e` text.
- **Resolved / Closed:** Soft sage tint (`#ecfdf5`) fill with `#047857` text.
- **Dimensions:** Height `22px`, horizontal padding `8px`, font size `11px`, weight `600`, shape `rounded-full`.

### Input Fields & Reply Composer
- **Resting State:** `#ffffff` background with `1px solid #dbe2ea` border and placeholder in `#94a3b8`.
- **Focus State:** Border shifts to `#7b97b8` with a continuous `0 0 0 3px rgba(123, 151, 184, 0.2)` ring.
- **Composer Window:** Rich multi-line editor integrated into the conversation stage base. Features a unified top toolbar for rich text controls, attachment drag-and-drop zone, and a distinct toggle between "Public Reply" and "Internal Note".

### Ticket & Queue Lists
- **Row Architecture:** 64px compact rows featuring agent assignee avatar, priority dot, ticket subject (`body-md`, semibold), customer name, and relative elapsed time.
- **Selected Row:** Clear slate-indigo wash (`#f0f4f9`) accented by a 3px vertical bar in `#4f6b8a` flush to the left edge.
- **Hover State:** Gentle background shift to `#f8fafc`.

### Checkboxes & Radios
- **Control Frame:** 18px rounded square (4px radius) for checkboxes, circular for radios. `1.5px` border in `#cbd5e1`.
- **Checked State:** Filled with `#4f6b8a`, rendering a crisp white checkmark or center pip. No stark black fills.