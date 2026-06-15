#!/usr/bin/env node
// Generates the @broberg/components inventory artifacts from the workflow mini-specs.
//   in:  /tmp/components-inventory/specs.json   (32 code-grounded mini-specs)
//   out: docs/INVENTORY.md                      (scored reference table, committed)
//        /tmp/components-inventory/manifest.json (card-creation manifest)
//        /tmp/components-inventory/plandocs/F0NN-<slug>.md  (32 full plan-docs → cardmem owns repo copies)
// Re-runnable: edit the override config below + re-run.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SPECS = JSON.parse(readFileSync('/tmp/components-inventory/specs.json', 'utf8'))
const byKey = Object.fromEntries(SPECS.map(s => [s.key, s]))

// ---- build order (foundation first) → F-number assignment F001.. ----
const ORDER = [
  // L0 Rails
  'tokens', 'stack-b-base', 'stack-a-base', 'config-single-source', 'mail', 'media', 'mcp-toolkit',
  // L1 Identity
  'oauth-login', 'user-mgmt', 'apikey-ratelimit', 'event-log', 'profile-upload', 'gravatar', 'consent-cookie',
  // L2 Shell
  'mode-switch', 'ui-controls', 'settings', 'cmdk', 'i18n', 'seo-metadata', 'pwa', 'pwa-update-banner',
  // L3 Domain
  'mail-templates', 'forms-turnstile', 'chat-ui', 'soundkit', 'deployment-mgmt', 'podcast',
  // L4 Capstone
  'multi-tenant', 'mobile-boilerplate', 'greenfield-scaffolder', 'create-app-cli',
]

// ---- synthesis overrides (Opus judgment over the Sonnet specs) ----
// Graduate recommendation: big/standalone specs that should get their own repo+project.
const GRADUATE = new Set(['podcast', 'multi-tenant', 'mobile-boilerplate', 'create-app-cli', 'deployment-mgmt'])
// priority comes from spec.impact: critical→critical, high→high, medium→medium, low→low
const prio = s => s.impact
const ROLE = {
  tokens: 'infra · design', 'stack-a-base': 'scaffold', 'stack-b-base': 'scaffold',
  'config-single-source': 'infra', mail: 'backend', 'media': 'backend', 'mcp-toolkit': 'infra · mcp',
  'oauth-login': 'auth', 'user-mgmt': 'auth', 'profile-upload': 'auth · UI', gravatar: 'backend',
  'event-log': 'backend · GDPR', 'apikey-ratelimit': 'backend · security', 'consent-cookie': 'UI · GDPR',
  settings: 'UI', 'mode-switch': 'UI', cmdk: 'UI', i18n: 'UI · infra', pwa: 'infra', 'ui-controls': 'UI',
  'seo-metadata': 'infra', 'chat-ui': 'UI', 'forms-turnstile': 'UI · backend', 'mail-templates': 'UI · email',
  soundkit: 'backend', podcast: 'product', 'deployment-mgmt': 'infra · CI', 'mobile-boilerplate': 'scaffold',
  'multi-tenant': 'backend · infra', 'greenfield-scaffolder': 'scaffold', 'create-app-cli': 'scaffold',
  'pwa-update-banner': 'UI',
}
// story points from effort
const SP = { S: 2, M: 5, L: 8, XL: 13 }

// ---- dependency graph (curated, prerequisite → dependent) ----
// type 'blocks' = hard prerequisite; 'related' = soft coupling
const EDGES = [
  ['tokens', 'mode-switch', 'blocks'], ['tokens', 'ui-controls', 'blocks'], ['tokens', 'settings', 'blocks'],
  ['tokens', 'cmdk', 'blocks'], ['tokens', 'stack-a-base', 'blocks'], ['tokens', 'chat-ui', 'blocks'],
  ['tokens', 'forms-turnstile', 'blocks'], ['tokens', 'consent-cookie', 'blocks'], ['tokens', 'mail-templates', 'related'],
  ['mode-switch', 'settings', 'related'],
  ['mail', 'mail-templates', 'blocks'], ['mail', 'user-mgmt', 'related'],
  ['media', 'profile-upload', 'blocks'],
  ['oauth-login', 'user-mgmt', 'related'], ['user-mgmt', 'multi-tenant', 'blocks'],
  ['user-mgmt', 'profile-upload', 'related'], ['apikey-ratelimit', 'mcp-toolkit', 'related'],
  ['event-log', 'consent-cookie', 'related'],
  ['pwa', 'mobile-boilerplate', 'blocks'], ['pwa', 'pwa-update-banner', 'blocks'],
  ['stack-a-base', 'greenfield-scaffolder', 'related'], ['stack-b-base', 'greenfield-scaffolder', 'related'],
  ['greenfield-scaffolder', 'create-app-cli', 'blocks'], ['ui-controls', 'settings', 'related'],
  ['ui-controls', 'forms-turnstile', 'related'], ['settings', 'i18n', 'related'],
]

const fnum = key => 'F' + String(ORDER.indexOf(key) + 1).padStart(3, '0')
const slug = key => key
const rel = p => (p || '').replace('/Users/cb/Apps/', '')
const graduateLine = key => GRADUATE.has(key)
  ? 'Graduate-candidate: YES — should get its own repo + cardmem project (recommendation, confirm with Christian).'
  : 'Graduate-candidate: no — small core npm that stays in `components`.'

function planDoc(s) {
  const F = fnum(s.key)
  const adapters = (s.adapters || []).map(a => `- **${a.stack}** — ${a.scope}`).join('\n') || '- None'
  const otherSrc = (s.otherSources || []).length
    ? s.otherSources.map(o => `- \`${rel(o.repo)}\` — ${o.note}\n${(o.files || []).map(f => `  - \`${f}\``).join('\n')}`).join('\n')
    : '- None beyond the best source above.'
  const deps = EDGES.filter(([f, t]) => t === s.key).map(([f, t, ty]) => `- ${fnum(f)} — ${byKey[f] ? byKey[f].title : f} (${ty})`)
  const extDeps = (s.dependencies || []).filter(d => !ORDER.some(k => d.toLowerCase().includes(k.replace(/-/g, ' ')) || d.toLowerCase().includes(k)))
  const depLines = [...deps, ...extDeps.map(d => `- External: ${d}`)]
  const stories = (s.stories || []).map((st, i) => `- **${F}.${i + 1}** — ${st.title} — _AC:_ ${st.ac}`).join('\n')
  const acs = [
    `1. \`@broberg/${slug(s.key)}\` builds + typechecks clean (\`tsc --noEmit\`); the headless core imports no framework packages (no \`next/*\`, no React/Hono in core).`,
    `2. Every story above (${F}.1–${F}.${(s.stories || []).length}) meets its own AC.`,
    `3. Piloted in **${rel(s.ownerSession)}** and adopted back with no behavioural regression (Lens / runtime-verified, not just curl).`,
    `4. At least one second consumer has migrated off its local copy onto the shared package with identical behaviour.`,
  ]
  const oq = (s.openQuestions || []).length ? s.openQuestions.map(q => `- ${q}`).join('\n') : '- None — all decisions captured in the spec.'

  return `# ${F} — ${s.title}

> ${s.layer} · ${s.reuseModel} · effort **${s.effort}** · impact **${s.impact}** · owner \`${rel(s.ownerSession)}\`. Status: Backlog.
> ${graduateLine(s.key)}

## Motivation
${s.what}

This pattern is currently re-implemented per repo. The cleanest existing example is **\`${rel(s.bestSource.repo)}\`** — ${s.bestSource.why} Centralising it removes per-repo drift and makes a fix propagate (or, for copy-owned UI, gives every new app a vetted starting point).

## Solution
**${s.reuseModel}.** ${s.reuseRationale}

(Headless-core/adapter split is detailed under Architecture.)

## Scope

### In scope
- Extract the real implementation from \`${rel(s.bestSource.repo)}\`:
${(s.bestSource.files || []).map(f => `  - \`${f}\``).join('\n')}
- The framework-agnostic headless core (see Architecture) + thin per-stack adapters.
- Public API as sketched below.

### Out of scope
- Per-brand visual divergence and consumer-specific features (those stay in the consuming app${s.reuseModel === 'copy-owned' ? ' — this is copy-owned by design' : ''}).
- Big-bang migration of all consumers at once (strangler only — see Rollout).
- Anything a dependency component owns (see Dependencies).

## Architecture

### Best source (reference implementation)
\`${rel(s.bestSource.repo)}\`
${(s.bestSource.files || []).map(f => `- \`${f}\``).join('\n')}

Why this source: ${s.bestSource.why}

### Other implementations seen (contract cross-check)
${otherSrc}

### Headless core vs. adapters
- **Core (no React, no \`next/*\`):** ${s.headlessCore}
${adapters}

### Public API
${s.publicApi}

## Stories
${stories || `- **${F}.1** — Build it — _AC:_ shippable.`}

## Acceptance criteria
${acs.join('\n')}

## Dependencies
${depLines.length ? depLines.join('\n') : '- None'}

## Rollout
Strangler, never big-bang: ${s.migrationOrder}

${graduateLine(s.key)}

## Open Questions
${oq}

## Effort estimate
**${s.effort}** — owner session: \`${rel(s.ownerSession)}\`. Reuse model: ${s.reuseModel}.

## Risks
${s.risks}
`
}

// ---- emit ----
mkdirSync('/tmp/components-inventory/plandocs', { recursive: true })
const manifest = []
for (const key of ORDER) {
  const s = byKey[key]
  if (!s) { console.error('MISSING SPEC:', key); continue }
  const F = fnum(key)
  const content = planDoc(s)
  const file_path = `docs/features/${F}-${slug(key)}.md`
  writeFileSync(`/tmp/components-inventory/plandocs/${F}-${slug(key)}.md`, content)
  manifest.push({
    fnum: F, key, slug: slug(key), title: s.title, layer: s.layer,
    reuseModel: s.reuseModel, effort: s.effort, impact: s.impact, priority: prio(s),
    graduate: GRADUATE.has(key), role: ROLE[key] || 'infra', ownerSession: rel(s.ownerSession),
    file_path, storyPoints: SP[s.effort] || 3,
    task: `${s.what.split('. ')[0]}. Reuse model: ${s.reuseModel}.`,
    context: `Best source: ${rel(s.bestSource.repo)}. ${s.reuseRationale}`,
    constraints: [
      'Headless core imports no framework packages (no next/*, no React in core).',
      'No hardcoded values — config/tokens from a single source (Christian UFRAVIGELIG rule).',
      ...(ROLE[key] || '').includes('UI') ? ['Interactive elements get kebab-case data-testid (F086); no native dialogs/controls (custom only).'] : [],
      'Strangler migration — pilot in one repo, never big-bang.',
    ],
    stories: (s.stories || []).map((st, i) => ({ fnum: `${F}.${i + 1}`, title: st.title, ac: st.ac })),
  })
}

writeFileSync('/tmp/components-inventory/manifest.json', JSON.stringify(manifest, null, 2))

// ---- ready-to-use create_cards story payload (parent referenced by global_slug) ----
const storyCards = []
for (const m of manifest) {
  m.stories.forEach((st, i) => {
    const pts = i === 0 ? (SP[m.effort] || 3) : (m.role.includes('docs') ? 2 : 3)
    storyCards.push({
      kind: 'story',
      parent_card_id: `components-${m.fnum}`,
      f_number: st.fnum,
      title: st.title,
      priority: m.priority === 'critical' ? 'high' : m.priority,
      story_points: i === 0 ? 5 : 3,
      role: m.role,
      ac: [{ text: st.ac }],
    })
  })
}
writeFileSync('/tmp/components-inventory/story-cards.json', JSON.stringify(storyCards, null, 2))

// ---- dependency edges payload (global_slug refs) ----
const depCards = EDGES
  .filter(([f, t]) => byKey[f] && byKey[t])
  .map(([f, t, ty]) => ({ from_slug: `components-${fnum(f)}`, to_slug: `components-${fnum(t)}`, type: ty, _label: `${fnum(f)}→${fnum(t)} ${ty}` }))
writeFileSync('/tmp/components-inventory/dep-edges.json', JSON.stringify(depCards, null, 2))

// ---- INVENTORY.md (scored reference) ----
const layers = ['L0 Rails', 'L1 Identity', 'L2 Shell', 'L3 Domain', 'L4 Capstone']
let md = `# @broberg/components — Inventory & Vision

> Generated from a code-grounded estate sweep (80 repos under \`~/Apps\`, 52-agent workflow, 2026-06-08). Each component below is a cardmem **epic** with a full plan-doc + stories on the [components board](https://www.cardmem.com/board). This file is the scored reference; the board is the live index.
>
> **Reuse models:** 📦 runtime-package · 📋 copy-owned · 🏗️ scaffold · 🔀 hybrid. **Graduate** = should get its own repo + cardmem project.

`
for (const L of layers) {
  const rows = manifest.filter(m => m.layer === L)
  if (!rows.length) continue
  md += `## ${L}\n\n| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |\n|---|---|---|---|---|---|---|---|\n`
  for (const m of rows) {
    md += `| ${m.fnum} | ${m.title} | ${m.reuseModel} | ${m.effort} | ${m.impact} | ${m.graduate ? 'yes' : '—'} | \`${byKey[m.key].bestSource.repo.replace('/Users/cb/Apps/', '')}\` | \`${m.ownerSession}\` |\n`
  }
  md += `\n`
}
md += `## Method & guardrails
- **Evidence-based:** every "best source" is a file path read by a deep-read agent, not memory.
- **Ruthless share/copy line:** runtime-package only when genuinely identical across ≥3 repos, stable, and painful to sync; otherwise copy-owned. Over-sharing is the bigger risk.
- **Headless core + thin adapters:** Stack A (Next.js) and Stack B (Bun/Hono) share framework-agnostic core TS; a package importing \`next/*\` is dead weight in Stack B.
- **Foundation first:** F001 design-tokens underpins every UI layer.
- **Strangler, never big-bang;** owner-session per package; \`components\` stays a multi-package monorepo, big epics graduate out into their own repos.

_Full per-component specs (architecture, file refs, headless/adapter split, public API, stories, AC) live in each F-doc and on the board._
`
writeFileSync('docs/INVENTORY.md', md)

console.log(`Generated ${manifest.length} plan-docs + manifest + INVENTORY.md`)
console.log('Layers:', layers.map(L => `${L}=${manifest.filter(m => m.layer === L).length}`).join(' '))
console.log('Graduate:', manifest.filter(m => m.graduate).map(m => m.fnum + ' ' + m.key).join(', '))
