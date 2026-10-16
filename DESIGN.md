# DESIGN.md

How Squirrel should look, read and behave. **Every change that touches the
UI is held to this file**: the builder follows it, `self-review` and the
reviewer check diffs against it, and the `ux` scout reviews screenshots
through it. It has four parts:

1. **UX principles**: the seven fundamental UX design principles from the
   UX Design Institute
   ([7 fundamental UX design principles in 2026](https://www.uxdesigninstitute.com/blog/ux-design-principles-2026/)),
   restated for this app.
2. **Mobile UX rules**: hard, testable rules for the phone, adapted from
   Toptal's
   [Mobile UX design constraints and best practices](https://www.toptal.com/designers/ux/mobile-ux-design-best-practices).
   Unlike the principles, these are not judgement calls: a UI change that
   breaks one doesn't merge.
3. **Squirrel design principles**: our own design system (voice, colour,
   type, layout, states, icons, accessibility). The living version, with
   token values and component previews, is the
   [Squirrel design system](https://claude.ai/artifact/2mkjwNXBcgqL1KK44jDZLj);
   the tokens themselves are the CSS custom properties in
   `src/app/globals.css`. When the two disagree, the code is what ships:
   fix whichever is wrong in the same PR.
4. **UI review checklist**: the short list every UI diff and every
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
- Touch targets at least 44 × 44 px on phones (rule M3 below).
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

## 2. Mobile UX rules (hard)

Most Squirrel use is one-handed, on a phone, in a shop or a kitchen, with
the user's attention somewhere else. These rules turn the "Context" and
"Accessibility" principles into lines a reviewer can check without taste.

**How they're enforced.**

- **New UI** (a new page, component, dialog, form or flow) meets every
  rule before it merges. A rule break is a blocking review finding, the
  same as a missing `requireHousehold()`.
- **Existing UI you touch** is brought up to the rules in the same PR, for
  the component or page the diff changes. That is in scope, not a
  drive-by refactor: a bug fix or feature in a component leaves that
  component compliant. Keep it to what you touched; a sweep across
  unrelated pages is its own `UX-` item.
- **Existing UI nobody is touching** is found by the `ux` scout, which
  reviews the mobile screenshots against these rules and files `UX-`
  items. The builder takes `UX-` items first.
- **An exception** needs a written reason in the PR Summary ("M3: the
  calendar day cells are 40 px because seven must fit in 412 px; the
  whole row is the tap target") and the reviewer's agreement. "It was
  already like that" is not a reason.

Measure at the `mobile` e2e project's viewport (Pixel 7, 412 px, touch),
in Swedish as well as English.

### M1. Mobile first

Design and verify the phone layout first; desktop is the extension, not
the other way round. Look at the mobile screenshot of every page a diff
changes (`npm run test:e2e:screenshots`), not just the code. No
horizontal page scroll at 412 px (`expectNoHorizontalOverflow`), and no
table or row that only makes sense wider than the screen.

In forms, a combobox or select gets its own row on a phone. The one
pairing that fits is a short number beside it (a `6rem` quantity column
and the unit taking the rest); two comboboxes, or three columns of
anything, stack below `sm`. A field whose value can't be read isn't a
field.

### M2. Thumb zone

The primary action lives where a thumb reaches it: the bottom half of the
screen, or the bottom of a bottom sheet (sticky, above the safe area,
never scrolled out of view in a long form). Top-level navigation is the
bottom bar. Nothing a user does often sits only in a top corner.
Destructive actions sit apart from the primary action, never next to it
where a slip hits them.

### M3. Touch targets

Every tap target is at least **44 × 44 CSS px** on phones (Apple HIG's
44 pt; Material's 48 dp is better where it fits), with at least **8 px**
between neighbouring targets. The visible control can be smaller if its
hit area isn't (padding, a pseudo-element, the whole row as the target).
Inline links inside running text are exempt, as WCAG 2.5.8 allows.
Checkboxes, switches, steppers (`+`/`-`), close buttons, row menus and
chips count.

### M4. Minimise typing

Every field a phone user has to type into costs a lost user.

- Don't ask for what we can default, remember or derive (last store,
  last unit, today's date, the household's currency).
- Pick, don't type, where the options are known: selects, steppers,
  chips, date pickers.
- Every text field sets the right keyboard and autofill: `type` (`email`,
  `tel`, `url`, `password`), `inputMode` (`decimal` for money and
  quantities, `numeric` for whole numbers), `autoComplete`
  (`email`, `current-password`, `new-password`, `name`, or `off` for
  household data), and `enterKeyHint` on the last field of a form.
- Fields are 16 px on phones so iOS doesn't zoom (see Type), and the
  focused field and its submit button are never hidden behind the
  on-screen keyboard.

### M5. Feedback on every touch

Every tap shows a response at once: a pressed state on the control, then
pending (`Loader2`, disabled) if the work takes time, then the result
(updated row, toast). A user must never wonder whether a tap registered.
Colour, motion or vibration is never the only signal; an optimistic update
rolls back visibly when the server says no.

### M6. One task per screen, most important first

A phone screen does one job. The key number, status or next step is
above the fold; secondary information and rare actions go behind a
disclosure, a tab or a "More" menu, not stacked below it. Repeated empty
placeholders collapse (one "Add" per group, not a "Nothing here" per
slot). Long lists stay scannable: grouped, with the most relevant items
first.

### M7. Navigation and gestures

- The user always knows where they are (active bottom-bar item, page
  title) and can always go back: the browser/OS back gesture closes a
  dialog or returns to the previous view, never leaves the app by
  surprise.
- Every gesture (swipe to delete, drag to reorder, pull to refresh) has a
  visible button that does the same. Nothing is gesture-only. Row swipes
  go through `SwipeRow`, which works by clicking that button (see
  REQUIREMENTS.md, "Swipe row actions"). On a phone a swiped row's Edit
  and Delete sit behind its ⋯ menu rather than as icons too, so no
  action shows twice.
- A gesture that destroys data is undoable.
- Don't take over system gestures: the screen edges belong to the OS back
  swipe.

### M8. Interruptions, slow networks and performance

- A call, a notification or a locked screen mid-flow loses nothing: form
  input survives a reload or backgrounding, and a half-done flow can be
  picked up.
- Every data view has a loading state (skeleton or spinner in place, no
  layout jump when content arrives) and an error state that says what to
  do, including "you're offline".
- Pages stay fast on a mid-range phone on mobile data: no large
  unoptimised images (`next/image`), no heavy client bundle for a mostly
  static view.

### M9. Readable and adaptable

Body text at least 14 px and form fields 16 px on phones; text zoom to
200% and landscape both work without clipping; content respects the
safe-area insets (notch, home indicator). Swedish strings and long names
wrap or truncate with the full value reachable, never overflow.

Exception: the bottom bar's tab labels and the notification count badge
are chrome, not body text. Five equal tabs at 412 px leave ~80 px per
label, which fits Swedish words at 12 px (`text-xs`) but not 14 px. 12 px
is the floor for them; nothing smaller anywhere.

### M10. Accessible on a phone

About 15% of people live with some form of disability, and small screens
make every barrier worse. Everything in principle 6 (Accessibility)
applies at 412 px: screen-reader names (TalkBack/VoiceOver), visible focus
with a hardware keyboard, contrast in sunlight-bright and dark themes.

## 3. Squirrel design principles

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
- `secondary`, `muted` and `accent` are quiet fills: secondary buttons,
  segmented tracks and hovers (`muted`), selected menu rows (`accent`). The
  active segmented tab is a `card` pill, ringed and lifted off the track —
  the `secondary` fill was 1.03:1 against `muted`, so the edge and shadow
  carry the selection, not the fill. Pair each with its `-foreground`.
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
- Borders are `border` (1px) for decorative hairlines and `input` (1px)
  for field outlines, which must stay at 3:1. Cards are set apart with a
  1px ring of `foreground` at 10%, not a border colour or a shadow.

### Type

- Body and UI in **Nunito** (`sans`); headings and big numbers in
  **Baloo 2** (`heading`); **Geist Mono** (`mono`) only for codes.
- The default UI size is `body` (14px). Form fields are `body-lg` (16px)
  on phones so iOS doesn't zoom, dropping to 14px from `md`.
- Page H1 is `page-title` (24px semibold, tight tracking), set through
  `PageTitle`; on phones it's a 30px large title that collapses into the
  top bar on scroll. Card and list headings are `item-title` (16px semibold); `CardTitle` and `DialogTitle`
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
  384px wide. A page's primary action goes in `PrimaryAction`, which floats
  it at the bottom right above the bottom bar on phones (M2) and leaves it
  in the header from `sm`.
- Touch targets grow on phones and touch screens (paired `max-sm:` and
  `pointer-coarse:` bumps, so an iPad or a landscape phone counts) and reach
  44px (rule M3): every `Button` size, `Input`, select and combobox trigger,
  `Checkbox` and `Radio` (hit area extended by a pseudo-element). For a
  link or custom control use the `touch-target` utility or `max-sm:min-h-11 pointer-coarse:min-h-11`.
  `expectTouchTargets` in `e2e/ui.ts` fails the smoke run on a touch project
  (mobile, landscape, tablet) on a miss.

### Depth, motion and states

- Surfaces are flat: `ring-1 ring-foreground/10`, no drop shadows.
  Designed shadows: `shadow-primary` on the default Button, deepening to
  `shadow-primary-hover`, and `shadow-popover` under floating popups.
- Buttons lift 2px on hover (`-translate-y-0.5`) and press down with
  `scale(0.98)`. Transitions are Tailwind's default 150ms.
- Focus is always visible: the control's border turns `ring` and a 3px
  halo of `ring` at 50% appears. Invalid fields swap `ring` for
  `destructive`.
- Disabled keeps its shape at full opacity for solid fills (`muted` fill,
  `muted-foreground` label — white on a faded primary was ~1.5:1). Other
  controls fade to 50% opacity. Everything disabled has no pointer events.
- Dialogs slide up from the bottom on phones and zoom in (95%) from `sm`.
  On phones the sheet drags down to dismiss (a grabber pill marks it), a
  long form rests at half or full height, and the page behind scales down
  while a sheet is open; none of it animates under reduced motion.
- **Motion tokens** (`globals.css`, `--motion-*`), for anything new that
  moves:
  - `duration-fast` 120 ms for exits, `duration-base` 200 ms for entrances
    and small shifts, `duration-slow` 320 ms for morphs,
    `duration-spring` 400 ms with `ease-spring`.
  - `ease-out` for things arriving, `ease-in` for things leaving,
    `ease-in-out` for things going from one place to another, `ease-spring`
    (slight overshoot) for an object that physically moves to a new place.
  - Exits are quicker than entrances: what's leaving shouldn't compete with
    what's arriving.
- **List rows move at tap time** (a tick, an untick, a delete), with the
  save in the background and a visible roll-back if it fails. They glide
  there with `useFlipList` on the real element, so a moving row can still
  be tapped: rows rise in, fade out, and glide (`duration-spring`) when
  they or their neighbours move, and a ticked row slides to "Done". Key new
  list rows with `data-flip-key`.
- **Navigations** are view transitions: a tab change fades the page in with
  a small rise, and a row's title morphs into its detail page's heading
  (`MorphTitle`). Keep the phone header and bottom bar still.
- Motion is never the only signal (M5), and with `prefers-reduced-motion`
  every animation, view transitions included, is instant.

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
- In empty states it heads the dashed box at 64px with its own alt text
  (`MascotEmptyState`), and it fills the "All done" ring once when the
  last shopping item is ticked. Nowhere on money: budget surfaces stay
  calm.

### Accessibility (tokens)

- Every text pair passes 4.5:1 in both themes: `foreground` and
  `muted-foreground` on `background`, `card` and `muted`; each
  `-foreground` on its fill; each status colour on `card`, `background`
  and its own tint.
- Field borders (`input`) and the focus `ring` pass 3:1 on `background`
  and `card` in both themes. `border` is decorative and exempt.
- `src/app/globals-contrast.test.ts` checks these pairs on every
  `npm test`. A new colour token or pair gets added there.

## 4. UI review checklist

Use it on every diff that touches `src/app/**/page.tsx`, `src/components/`,
`globals.css` or user-facing strings, and on every screenshot review. A
failed item is a finding; name the principle it breaks.

- [ ] **User-centricity**: the change serves a real user task; no control,
      field or option that nobody asked for.
- [ ] **Consistency**: reuses `src/components/ui/` and existing patterns;
      same words, icons and placement as sibling pages; sentence case.
- [ ] **Hierarchy**: exactly one `primary` action per view; headings use
      the type scale; the key number or status is the first thing seen.
- [ ] **Mobile rules M1–M10 (hard)**: every rule in section 2 holds for
      what the diff adds *and* for the existing component or page it
      touches: mobile screenshot reviewed, no overflow, primary action in
      the thumb zone, targets ≥ 44 × 44 px with 8 px gaps, right keyboard
      and autofill on fields, feedback on every tap, one task per screen,
      no gesture-only action, loading and offline states, safe areas.
      Any failure blocks merge unless the PR Summary gives an exception
      the reviewer accepts.
- [ ] **Context**: works at 412 px with thumb-reachable actions and no
      hover-only affordance; survives Swedish strings and long names
      without clipping or overflow.
- [ ] **User control**: pending and result feedback on every action;
      destructive actions confirmed or undoable; automation/AI output is
      editable before it changes data; dialogs can always be closed.
- [ ] **Accessibility**: labelled controls (icon buttons included),
      visible focus, keyboard reachable, colour never the only signal,
      contrast pairs covered by `globals-contrast.test.ts`, touch targets
      ≥ 44 × 44 px on phones.
- [ ] **Usability**: sensible defaults; inline, actionable errors next to
      the field; empty, loading and error states designed.
- [ ] **Design system**: tokens only (no raw hex, no ad-hoc shadows or
      radii), content on `card`, status as tinted text + icon, Lucide
      icons, no emoji, voice per "Content fundamentals".
