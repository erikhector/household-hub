# DESIGN.md

How Squirrel should look, read and behave. **Every change that touches the
UI is held to this file**: the builder follows it, `self-review` and the
reviewer check diffs against it, and the `ux` scout reviews screenshots
through it. It has three parts:

1. **UX principles**: the seven fundamental UX design principles from the
   UX Design Institute
   ([7 fundamental UX design principles in 2026](https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/)),
   restated for this app.
2. **Squirrel design principles**: our own design system (voice, colour,
   type, layout, states, icons, accessibility). The living version, with
   token values and component previews, is the
   [Squirrel design system](https://claude.ai/artifact/2mkjwNXBcgqL1KK44jDZLj);
   the tokens themselves are the CSS custom properties in
   `src/app/globals.css`. When the two disagree, the code is what ships:
   fix whichever is wrong in the same PR.
3. **UI review checklist**: the short list every UI diff and every
   screenshot review is checked against.

## 1. UX principles

### 1. User-centricity

Design for what real households need, not for what seems clever or what is
easy to build. Squirrel's users are busy people standing in a shop or a
kitchen, often on a phone, often sharing the app with someone else.

- Start from the user's task ("what's running low?", "can we afford this?")
  and make that the shortest path, not from the data model.
- Evidence beats assumptions: a UX item cites a screenshot, route or flow
  where it hurts someone, and its acceptance line is something a person
  would notice.
- Don't add options, settings or fields "in case". Every control on screen
  costs attention.

### 2. Consistency

The same thing looks and behaves the same everywhere, so nothing has to be
relearned from page to page.

- Use the shared primitives in `src/components/ui/` and the existing
  feature patterns (dialogs, `BudgetTabs`, `CategoryManager`, list rows)
  before inventing a new one. A new pattern needs a reason in the PR.
- Same words for the same action ("Add item", "Delete", "Save") in both
  languages; same icon for the same meaning (see Iconography below).
- Same placement: the primary action sits where it sits on sibling pages;
  destructive actions are confirmed the same way everywhere.
- Platform conventions win over novelty: links look like links, the back
  gesture works, form submits on Enter.

### 3. Hierarchy

Each view makes clear what matters most and what to do next.

- One primary action per view (the `primary` button). Everything else is
  `secondary`, `outline` or `ghost`.
- Page title (`page-title`) → section/card titles (`item-title`,
  `card-title`) → body → `caption` meta. Don't skip or fake levels with
  bold body text.
- The key number or status of a page (safe to spend, items running low,
  tasks due) is the first thing the eye lands on, set large (`stat`) and
  near the top.
- Group related things on a `card`; separate groups with space
  (`space-6`), not lines.

### 4. Context

Design for where, when and on what the app is used.

- **Phone first.** Most use is one-handed on a phone in a shop or kitchen:
  thumb-reachable primary actions, big targets, bottom sheets, no hover-only
  affordances. Check every change at 412 px before desktop.
- Short sessions and interruptions: state survives a reload, forms don't
  lose input on an error, a half-finished flow can be resumed.
- Shared households: say who did what when it matters ("Added by Anna"),
  and never surprise one member with another's change.
- Two languages: layouts must survive Swedish's longer strings (~15%) and
  long names without clipping or overflow.

### 5. User control

People feel in charge: they can see what happened, change their mind and
get out.

- Every action gives visible feedback: pending (`Loader2`, disabled
  button), then a result (toast, updated row). Nothing happens silently.
- Destructive actions are confirmed or undoable. Prefer undo for
  frequent, low-stakes actions (ticking an item, removing a row) and a
  confirm dialog for rare, costly ones (deleting a household, a budget).
- Automation suggests, the user decides: automatic prices, restock
  suggestions and AI results can be reviewed, edited or turned off.
- Dialogs close with Escape, a close button and (phones) swipe/back; no
  dead ends, always a way back to where you were.

### 6. Accessibility

Accessible by default, not as a follow-up. Squirrel targets WCAG 2.2 AA,
which is also what the European Accessibility Act expects.

- Contrast: text 4.5:1 (3:1 at 24 px+), field borders, focus rings and
  meaningful icons 3:1, in both themes. `src/app/globals-contrast.test.ts`
  enforces the token pairs.
- Everything works with a keyboard and a screen reader: visible focus, a
  logical tab order, labelled controls (every icon-only button has an
  accessible name), real `<button>`/`<a>`/`<label>` elements.
- Never rely on colour alone: status pairs a colour with a word or icon.
- Touch targets at least 36 px (40 px for icon buttons) on phones.
- Respect the user's settings: text zoom to 200% without loss,
  `prefers-reduced-motion`, system theme.
- If an e2e test can't find an element by role and name, it needs a label
  (AGENTS.md "UI tests").

### 7. Usability

The app is easy to learn, fast to use and forgiving of mistakes.

- Fewer steps: sensible defaults, prefilled values, remembered choices
  (last store, last unit), bulk actions where people do things in bulk.
- Prevent errors before reporting them: constrain inputs (units,
  quantities, dates), validate inline, and write errors that say how to fix
  the problem, next to the field.
- Every state is designed: empty (explain and offer the next step),
  loading, error (what happened, what to do), and a long list.
- Plain words, no jargon or internal names; verbs on buttons.

### New technology (AI, scanning, notifications)

The same principles apply to AI and multimodal features (receipt and shelf
scanning, recipe import, suggestions): show that a result is a suggestion,
show confidence where it's uncertain, let the user correct it before it
changes data, and always offer a manual path that works without the camera
or AI.

## 2. Squirrel design principles

Squirrel is a shared household app: pantry inventory, shopping lists, meal
planning, tasks and household and personal budgets. The system is soft,
friendly and purple: rounded shapes, a rounded sans for reading, a chunky
rounded display face for headings, and a single saturated purple that
marks what to do next. It is built with Tailwind 4 and shadcn/ui on Base
UI; the tokens are the CSS custom properties in `src/app/globals.css`.

### Content fundamentals

- **Voice: a helpful housemate.** Warm, a little playful, never cute at
  the expense of clarity. Real copy: "Pantry that watches itself", "Meals,
  planned not panicked", "Budget without the spreadsheet".
- **Talk to "you"; Squirrel is "we"** when it acts: "We'll flag anything
  running low before you're stuck without it."
- **Sentence case everywhere**: titles, buttons, nav ("Shopping list",
  "Add item", "Mark all as read"). Never Title Case.
- **Buttons are verbs**: "Get started free", "Create your household",
  "Dismiss all". Keep them short.
- **Notifications name the thing**: "{name} is out of stock", "{name} cost
  {percent}% more than usual". Soften estimates ("probably expiring
  soon").
- **Empty states reassure**: "You're all caught up!", "No updates yet."
- **Every string ships in English and Swedish.** Leave room: Swedish runs
  ~15% longer.
- **No emoji** in UI copy. The em dash is welcome in longer sentences.

### Colour

- The page ground is a soft radial gradient from `gradient-start` (centre)
  to `gradient-end`, with `background` as the flat fallback. Paint content
  on `card` (or `popover` for overlays), never straight on the gradient
  when it is more than a heading.
- Text is `foreground`; secondary text is `muted-foreground`.
- `primary` is the one call to action per view (default Button), plus
  links, the active nav item and the checkbox accent. Don't use it for
  decoration: the brand's purple is carried by the mascot and the
  gradient. Put `primary-foreground` on it.
- `secondary`, `muted` and `accent` are quiet fills: secondary buttons and
  the active tab (`secondary`), tracks and hovers (`muted`), selected menu
  rows (`accent`). Pair each with its `-foreground`.
- Status is text on a tint of itself (10% light, 20% dark), never a solid
  block: `destructive` (delete, errors, over budget), `warning` (amber:
  tight, running low), `attention` (orange: needs a look), `success`
  (green: healthy, done). Always pair status colour with a word or icon
  (`TriangleAlert`, `CheckCircle2`).
- Safe to spend: `success` healthy, `warning` tight, `destructive` over,
  set in `stat` (36px bold).
- Toasts follow the same rule: success toasts `success`, errors
  `destructive`, warnings `warning`, each on its tint over `popover` with a
  30% border. Info and plain toasts stay neutral `popover`.
- Charts take `chart-1` … `chart-5` in order. Chart colours are for marks,
  not text: use `success`, not `chart-5`, for green words and numbers.
- Borders are `border` (1px) for decorative hairlines and `input` (2px)
  for field outlines, which must stay at 3:1. Cards are set apart with a
  1px ring of `foreground` at 10%, not a border colour or a shadow.

### Type

- Body and UI in **Nunito** (`sans`); headings and big numbers in
  **Baloo 2** (`heading`); **Geist Mono** (`mono`) only for codes.
- The default UI size is `body` (14px). Form fields are `body-lg` (16px)
  on phones so iOS doesn't zoom, dropping to 14px from `md`.
- Page H1 is `page-title` (24px semibold, tight tracking). Card and list
  headings are `item-title` (16px semibold); `CardTitle` and `DialogTitle`
  use `card-title` (16px medium).
- Button labels are `button` (14px semibold); badges `badge` (12px
  medium); meta text `caption` in `muted-foreground`.
- Numbers in tables and totals use `tabular-nums`.
- `hero` is for the landing page only.

### Spacing, radius and layout

- Tailwind's 4px scale. Cards pad and gap at `space-4` (16px; `space-3` at
  size "sm"). Buttons and fields pad horizontally at `space-2.5`. Stack
  sections at `space-6`.
- Everything is rounded, driven by `--radius` (0.9rem): `radius-lg` for
  buttons, fields and the tabs track; `radius-xl` for cards, the centred
  dialog and the brand badge; `radius-2xl` for the top of the phone bottom
  sheet; `radius-4xl` makes badges pills.
- Phones get a different shell: a bottom navigation bar, only `main`
  scrolls, and dialogs become bottom sheets flush with the screen edge
  (max 85dvh, safe-area padding). From `sm` (640px) dialogs are centred,
  384px wide.
- Touch targets grow on phones: default buttons go from 32px to 36px, icon
  buttons from 32px to 40px (`max-sm:` bumps).

### Depth, motion and states

- Surfaces are flat: `ring-1 ring-foreground/10`, no drop shadows.
  Designed shadows: `shadow-primary` on the default Button, deepening to
  `shadow-primary-hover`, and `shadow-popover` under floating popups.
- Buttons lift 2px on hover (`-translate-y-0.5`) and press down with
  `scale(0.98)`. Transitions are Tailwind's default 150ms.
- Focus is always visible: the control's border turns `ring` and a 3px
  halo of `ring` at 50% appears. Invalid fields swap `ring` for
  `destructive`.
- Disabled is 50% opacity with no pointer events.
- Dialogs slide up from the bottom on phones and zoom in (95%) from `sm`.

### Iconography

- **Lucide** (`lucide-react`) everywhere, stroke icons at 16px (`size-4`)
  in buttons, 12px in badges, inheriting `currentColor`. Most used: `Plus`,
  `Trash2`, `X`, `Loader2` (spinning, for pending), `Pencil`, `Check`,
  `CheckCircle2`, `TriangleAlert`, `ChevronRight`, plus domain icons
  (`ShoppingCart`, `ChefHat`, `PiggyBank`, `Package`, `Users`).
- Icon-only buttons use the `icon` sizes and always carry an accessible
  label.
- No emoji as icons.

### Brand mark

- The mark is the purple squirrel holding an acorn, on a rounded purple
  tile, shown through the BrandBadge: 40px, `radius-xl`, cropped to cover,
  beside the word "Squirrel" set in `heading`.
- It is a raster illustration: never redraw, recolour or place it on a
  busy ground.

### Accessibility (tokens)

- Every text pair passes 4.5:1 in both themes: `foreground` and
  `muted-foreground` on `background`, `card` and `muted`; each
  `-foreground` on its fill; each status colour on `card`, `background`
  and its own tint.
- Field borders (`input`) and the focus `ring` pass 3:1 on `background`
  and `card` in both themes. `border` is decorative and exempt.
- `src/app/globals-contrast.test.ts` checks these pairs on every
  `npm test`. A new colour token or pair gets added there.

## 3. UI review checklist

Use it on every diff that touches `src/app/**/page.tsx`, `src/components/`,
`globals.css` or user-facing strings, and on every screenshot review. A
failed item is a finding; name the principle it breaks.

- [ ] **User-centricity**: the change serves a real user task; no control,
      field or option that nobody asked for.
- [ ] **Consistency**: reuses `src/components/ui/` and existing patterns;
      same words, icons and placement as sibling pages; sentence case.
- [ ] **Hierarchy**: exactly one `primary` action per view; headings use
      the type scale; the key number or status is the first thing seen.
- [ ] **Context**: works at 412 px with thumb-reachable actions and no
      hover-only affordance; survives Swedish strings and long names
      without clipping or overflow.
- [ ] **User control**: pending and result feedback on every action;
      destructive actions confirmed or undoable; automation/AI output is
      editable before it changes data; dialogs can always be closed.
- [ ] **Accessibility**: labelled controls (icon buttons included),
      visible focus, keyboard reachable, colour never the only signal,
      contrast pairs covered by `globals-contrast.test.ts`, touch targets
      ≥ 36/40 px on phones.
- [ ] **Usability**: sensible defaults; inline, actionable errors next to
      the field; empty, loading and error states designed.
- [ ] **Design system**: tokens only (no raw hex, no ad-hoc shadows or
      radii), content on `card`, status as tinted text + icon, Lucide
      icons, no emoji, voice per "Content fundamentals".
