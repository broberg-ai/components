---
# @broberg/theme — neutral preset, expressed as a DESIGN.md contract.
# Agent-readable design system (Google DESIGN.md format, Apache-2.0).
# Reference it from CLAUDE.md as `@DESIGN.md` so coding agents read it at session
# start. Generate the Tailwind v4 baseline with: @broberg/theme/design-md.
# This models the `:root` (dark) theme; the light/cool/warm variants are
# @broberg/theme's extension (see css/neutral-preset.css).
colors:
  background: "oklch(0.211 0 0)"
  foreground: "oklch(0.985 0 0)"
  card: "oklch(0.239 0 0)"
  card-foreground: "oklch(0.985 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  secondary: "oklch(0.301 0 0)"
  secondary-foreground: "oklch(0.985 0 0)"
  muted: "oklch(0.260 0 0)"
  muted-foreground: "oklch(0.630 0 0)"
  accent: "oklch(0.301 0 0)"
  accent-foreground: "oklch(0.985 0 0)"
  destructive: "oklch(0.65 0.22 25)"
  border: "oklch(0.301 0 0)"
  input: "oklch(0.260 0 0)"
  ring: "oklch(0.556 0 0)"
typography:
  headline-lg:
    fontFamily: "system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.2
  body-md:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label-sm:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
rounded:
  sm: "calc(0.5rem * 0.6)"
  md: "calc(0.5rem * 0.8)"
  lg: "0.5rem"
  xl: "calc(0.5rem * 1.4)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
breakpoints:
  sm: "640px"
  md: "768px"
  lg: "1024px"
  xl: "1280px"
touch:
  target-min: "44px"
---

## Overview

The **neutral** preset of `@broberg/theme` — a restrained, shadcn/ui-compatible
(new-york) baseline meant to be copied and branded. Dark-first. The personality
is deliberately quiet: it gets out of the way so a single brand override
(`--primary`, `--radius`) defines the product's identity. Every app in the
broberg.ai estate starts here and overrides only what makes it itself.

## Colors

A neutral greyscale (zero-chroma oklch) for surfaces and text; `primary` is a
near-white in dark mode (near-black in light) — neutral, not branded. Override
`--primary`/`--ring` per app. `destructive` is the one chromatic exception
(error red). Contrast meets WCAG-AA (4.5:1) on every foreground/background pair.

## Typography

System font stack by default (apps swap in their brand font). Three reference
levels: `headline-lg` (2rem/600), `body-md` (1rem/400, 1.6 line-height for
readability), `label-sm` (0.75rem/600, tracked) for eyebrows and chips.

## Layout & Spacing

A 4px base spacing scale (`xs`=4 → `xl`=48). Use the scale; never invent
in-between values. Cards and panels use `rounded.lg` (0.5rem) and `spacing.lg`
internal padding.

## Responsive & touch

Standard breakpoints (`sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280) so every app
switches layouts at the SAME widths — use them as Tailwind variants (`md:flex`) or
read `BREAKPOINTS` from `@broberg/theme` for `matchMedia`. Every interactive
control is at least `--touch-target-min` (44px) on touch — never ship a smaller
tap target.

## Components

Buttons: `primary` background with `primary-foreground` text, `rounded.md`.
Cards: `card` background, `border`, `rounded.lg`. Reference tokens, never
hard-code values.

## Do's and Don'ts

- **Do** override only `--primary`, `--ring`, `--radius` to brand it.
- **Do** keep the spacing scale; don't invent values between the defined steps.
- **Don't** use a chromatic color for large surfaces — they stay neutral.
- **Don't** hard-code hex/oklch in components — always `var(--token)`.
- **Don't** mix font families inside body text.
