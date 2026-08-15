# Interactive Flowchart Board

Paste a picture of a flowchart and get a live board back: draggable shapes, an
inspector that explains what each shape means, and a step-through mode that
walks the chart one node at a time.

Built for teaching programming flowcharting — the point is that a static image
becomes something a learner can poke at.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. The board loads an *Exam Grader* example straight away.

**Accounts and saving are optional.** Without them the board is a local
scratchpad and nothing is stored. To turn them on, create a project at
[supabase.com](https://supabase.com), run [supabase/schema.sql](supabase/schema.sql)
in its SQL editor, then:

```bash
cp .env.example .env.local   # Project Settings -> API Keys gives you both values
```

Use the **publishable** key (`sb_publishable_…`); the older anon JWT also works,
under either variable name. Never use the secret key — anything in a
`NEXT_PUBLIC_` variable is compiled into the JavaScript every visitor
downloads, and a secret key there bypasses Row Level Security entirely. The app
checks for this and refuses to start the client rather than doing it quietly.

An account holds as many charts as you like, one row each, saved automatically
about a second after you stop editing. Sign-up uses email and password —
Supabase Auth owns the hashing, sessions and rate limiting — with the display
name kept alongside the account.
Supabase sends a confirmation email by default; turn that off under
Authentication -> Providers if you would rather accounts work immediately.

Row Level Security is what keeps charts private: the anon key is public, so the
policies in the schema are the only thing stopping one account reading
another's. Do not skip running the SQL.

Share links are the one exception, and they are deliberately *not* a policy.
A policy grants access to a set of rows, so `using (share_id is not null)`
would let anyone with the publishable key list every shared chart in the
project. Instead the table stays owner-only and a single `security definer`
function takes a token and returns at most the one row matching it — no
wildcard, no enumeration. If you set this up before share links existed, re-run
the schema; it is written to be applied more than once.

## Using it

**Your charts** — the sidebar lists every chart on the account. Click one to
open it, *+ New* to start another from a bare start-and-end pair, and the row
buttons to rename (`✎`), duplicate (`⧉`) or delete (`✕`). A `◈` marks a chart
with a live share link. Deleting asks first, because it is the only one of
these that cannot be undone — and it takes any share link with it.

Switching charts flushes whatever the autosave timer is still holding, so a
change made a moment before you click away is not lost. The chart you had open
is remembered per account, so a reload comes back to it. Renaming a chart also
renames the flowchart itself: the file name and the title in the header are the
same thing.

**Import** — *Paste JSON*, or paste JSON straight onto the page. Signed in, the
dialog always asks where it should land: **Add as new chart** keeps everything
you already have, **Replace this chart** overwrites the open one. Signed out
there is nowhere else for it to go, so a clean paste imports immediately and
only a paste needing repair opens the dialog. To turn a picture into JSON, run
it through a chat model with the prompt in [PASTE.md](PASTE.md). The result is
auto-laid-out with dagre. No API key and no network call: transcription happens
outside the app.

**Edit** — drag shapes, pan and zoom, select and press `Delete` or
`Backspace` to remove things.

**Select several at once** — with the *Select* tool (top-left of the canvas),
drag on empty canvas to draw a box; anything it touches is selected. Drag any
one of them to move the whole group, or press `Delete`. A toolbar appears with
the count and a delete button, so it does not depend on knowing the keyboard
shortcut. Middle-drag or right-drag pans while in this mode. Switch to the
*Pan* tool if you would rather left-drag moved the canvas — `Shift`-drag still
draws a selection box either way. Every shape has a connection point on each of its four sides, and each
one works as both an exit and an entry, so an arrow can be drawn from any side
to any other; the sides you drag between are the ones the arrow keeps. Pick a shape to edit its
label, or change its type if the image was read wrong. *Tidy layout* re-runs
auto-layout and discards manual positions.

**Choose what you are editing** — the bar under the header switches the canvas
between the main chart and each routine, and adds, renames, deletes, or sets
the parameters of a routine. There is one editable canvas rather than an editor
per chart, so selection, the inspector and the palette are only ever in one
place. The floating routine view has an *Edit* button that hands that routine
to the canvas.

**Add shapes** — the palette at the top-left of the canvas holds all eight
kinds. Click one to drop it into the middle of the view, or drag it onto the
canvas to place it exactly. New shapes arrive with a placeholder label and are
selected straight away, so the inspector is ready to type into. They start
unconnected, so the warnings panel will flag them as unreachable dead ends
until you draw arrows to and from them.

**Inspect** — click a shape for what that notation means, what it looks like in
code, and everything that flows in and out of it. Click an arrow to edit its
branch condition.

**Run** — *Step* advances one node; *Play* auto-advances. At a decision the run
pauses and asks which branch the condition takes, then resumes. The panel keeps
a numbered path of everything visited, nodes entered more than once get a visit
badge, and structural problems (unreachable node, unlabelled branch, dead end)
are collected as warnings. Stepping into a subroutine opens its body over the
canvas and shows a call stack; the trace marks calls with `⤵`, returns with
`⤴`, and connector jumps with `↷`.

*Copy JSON* puts the underlying graph on the clipboard.

**Share** — two kinds of link, both opening a board the viewer can run, edit
and break without touching the original.

| | Live link | Snapshot link |
|---|---|---|
| URL | `/c/<token>` | `/#c=<payload>` |
| Needs an account | to publish, not to open | no |
| Needs the database | yes | no |
| Tracks your edits | yes, on reload | no — frozen when copied |
| Length | fixed, short | grows with the chart (the sample is ~1.3 kB) |
| Revocable | yes, *Stop sharing* | no — it is out there once sent |

Use a live link for a chart you are still working on, and a snapshot when the
other end should not need an account, or when you want the chart to stay
exactly as it is. A snapshot rides in the URL fragment, which browsers never
send to the server, so the chart does not pass through this app's host on its
way to the recipient — but the whole chart *is* in the link, so treat sending
one as publishing it.

Opening either shows a banner saying the chart is not yours and nothing is
being saved. Edits stay local to that tab; your own chart is untouched, and
autosave is switched off for as long as you are looking at someone else's
board. *Back to my board* returns to it.

## On a phone

Below Tailwind's `md` breakpoint the same app reflows rather than losing
features. The sidebar becomes a sheet along the bottom — collapsed to one bar,
tabbed into *Inspect* / *Run* / *Chart* when opened, because scrolling past
three panels to reach the fourth on a phone is miserable. The shape palette
turns into a scrolling row along the top, and the minimap and zoom controls
step aside for pinch and drag.

Two behavioural differences, not just layout:

- **The canvas always pans on touch,** so the select/pan toggle is a desktop
  control. In its place the palette offers **Select many**: with it on, tapping
  shapes adds them to the selection rather than replacing it, and the same
  count-and-delete toolbar appears. A drag marquee is not an option on touch —
  React Flow skips it for touch pointers, and forcing it on would disable
  panning and pinch-zoom outright.
- **The sheet opens itself** when the run needs an answer — a branch choice or
  an input prompt is useless behind a closed panel.

Height is `dvh` rather than a percentage so mobile browser chrome does not clip
the board, and the sheet pads for the home indicator on notched phones.

## How it fits together

Everything hangs off one intermediate representation in
[lib/flowchart.ts](lib/flowchart.ts). A `FlowchartSpec` is a title, a list of
typed nodes, and a list of labelled edges; a `FlowchartDocument` is one of
those plus the routines its subroutine nodes can call, held flat so a routine
can call another routine without the JSON becoming a tree. Import produces a
document and the board only ever consumes one, so a future text or Mermaid
importer just has to emit the same shape.

| File | Role |
| --- | --- |
| [lib/flowchart.ts](lib/flowchart.ts) | The IR, the per-shape teaching copy, the structural linter, the sample chart |
| [lib/layout.ts](lib/layout.ts) | Text measurement, dagre auto-layout, and which side each arrow leaves and enters |
| [lib/runner.ts](lib/runner.ts) | The step-through engine: a pure `(doc, state) → state` walk, with connector jumps and a subroutine call stack |
| [lib/expr.ts](lib/expr.ts) | A tiny expression language: tokeniser, parser, evaluator |
| [lib/supabase.ts](lib/supabase.ts) | Browser client, and whether the project is configured at all |
| [lib/storage.ts](lib/storage.ts) | Loading and saving the user's one chart |
| [lib/useMediaQuery.ts](lib/useMediaQuery.ts) | Breakpoint and pointer-type checks, via `useSyncExternalStore` |
| [lib/parse.ts](lib/parse.ts) | Pasted text → `FlowchartDocument`, with repair and validation |
| [app/components/Board.tsx](app/components/Board.tsx) | Wires state, editing, run controls, and import together |
| [app/components/ShapeOutline.tsx](app/components/ShapeOutline.tsx) | The SVG geometry for all eight shapes, at any size |
| [app/components/ShapeNode.tsx](app/components/ShapeNode.tsx) | A canvas node: outline, HTML label, handles, run highlight |
| [app/components/ShapePalette.tsx](app/components/ShapePalette.tsx) | Click-or-drag palette for adding shapes |
| [app/components/RoutinePanel.tsx](app/components/RoutinePanel.tsx) | The callee, floated over the caller while a subroutine runs |
| [app/components/Console.tsx](app/components/Console.tsx) | Program output, docked along the bottom of the canvas |
| [app/components/ChartBar.tsx](app/components/ChartBar.tsx) | Chart switcher and routine management |
| [app/components/AccountPanel.tsx](app/components/AccountPanel.tsx) | Sign in / sign up, and the autosave indicator |
| [app/components/MobileSheet.tsx](app/components/MobileSheet.tsx) | The sidebar reflowed into a tabbed bottom sheet on phones |

## Supported shapes

Terminator (start/end), process, decision, input/output, subroutine,
connector, and preparation (the hexagon, for setup such as initialising a
variable before a loop).

**Preparation and process shapes can set several things at once** — separated
by commas, semicolons or line breaks, with a declared type carrying across the
commas, so `int i, j` gives both the value 0. Later statements see what earlier
ones set, and line breaks you type are kept when the shape is drawn. Colours and teaching copy for each live in `KIND_INFO`, and the
built-in sample chart exercises all eight.

**Shapes can actually run.** A shape carrying an `expr` — or whose label is
itself code — executes rather than being stepped over: a process assigns, a
decision evaluates its condition and takes its own branch, `print x` appends to
an output log, `read x` pauses and asks for a value. Variables appear in the
run panel; printed output goes to a console docked along the bottom of the
canvas, which marks program output `›`, values you typed `‹`, and errors `✕`,
and collapses to a single bar when you want the space back. Routines take parameters and return values, so
`ok = validate(limit)` feeds the next decision directly.

The built-in example is deliberately small: read a score, hand it to a
`checkScore` routine that returns whether it is valid, then grade it against
two marks — pass, passable, or fail. A bad score prints a notice and jumps back
to the prompt through connector pair `A` — which is both a loop and the textbook
reason connectors exist. Pair `B` shows the other reason: it carries the happy
path straight on, but because a jump breaks the chain, layout puts the grading
half in its own column instead of running the chart off the bottom of the
screen. A second routine, `letterFor`, turns the score into a
letter grade and is drawn the way switch/case is drawn by hand: a preparation
hexagon computes the subject once, then a column of diamonds tests one case
each, every false arm falling through to the next and the last into a default.
All four arms converge on a single return. Between them the three charts use
all eight shapes, and exactly one shape needs a separate `expr`.

**A decision is not limited to Yes/No.** Where the condition is a comparison,
the run takes the `Yes`/`No` (or `True`/`False`) arm. Where it evaluates to a
value instead — a diamond labelled `band?` — the run takes the arrow whose
label matches that value. One arrow may list several cases separated by commas
(`10, 9`), and an arrow labelled `otherwise`, `default`, `else`, `any` or
`other` catches whatever is left; matching ignores case. If nothing matches and
there is no catch-all, the run asks rather than guessing. So a switch reads
either way — as one diamond fanning out, or as the chained diamonds `letterFor`
uses.

Labels can be written the way flowcharts are usually drawn. `int num = 0`
declares and initialises; `Display "..."` and `Input num` are output and input
(`print`/`read` work too); and a decision may be asked as a question, so
`is num > 0?` needs no separate code. What a shape cannot parse stays prose.

The language is deliberately tiny — arithmetic, comparison, `and`/`or`/`not`,
`mod`, strings, and calls.
Built-in functions: `isnumber(x)`, `istext(x)`, `abs`, `floor`, `ceil`,
`round`, `int` (truncate), `sqrt`, `min(...)`, `max(...)`, `len(text)`,
`text(x)`. Anything it cannot parse is *not* an error: that
shape is prose, and the run behaves exactly as it did before, asking the reader
at each decision. That is what keeps a chart transcribed from a photo working.
Evaluation failures (an unset variable, division by zero) stop the run with a
message naming the shape rather than crashing.

**Subroutines call and return.** A subroutine shape links to a routine either
by picking one in the inspector, or just by writing the call as its code —
`validate(limit)` finds the routine keyed `validate`. Name a routine the way
you will call it and both fall out: typing `function(i)` into **+ Routine**
creates key `function`, title `function(i)`, parameter `i`. Stepping into it pushes a frame, runs
that routine's own chart in a panel floated over the canvas, and returns to the
call site when the routine reaches its end — the call site stays visible behind
the panel marked *waiting* the whole time, which is the part worth watching. A
subroutine with no `calls` field is simply stepped over, since its body lives
outside the document; one naming a routine that is not there is reported as a
warning. Runaway recursion stops at twelve frames deep.

**Connectors jump.** A connector pair is drawn with no arrow between the two
halves — that is the whole point of the notation — so the runner treats two
connectors sharing a label as the same point and continues the trace at the
matching one. Matching ignores case and surrounding spaces, and a jump is
marked with `↷` in the path list. A connector with nothing to pair with, or
three sharing one label, is reported as a warning rather than silently
mis-traced.

## Transcription prompt

Paste a flowchart image into any chat model along with the prompt in
[PASTE.md](PASTE.md), then paste the result into *Paste JSON*.

It is kept in its own file rather than inlined here so there is one copy to
edit — an earlier duplicate in this README drifted out of sync with it.


The importer is deliberately forgiving, so minor deviations still work: code
fences and surrounding prose are stripped, `Start`/`input`/`predefined process`
and similar synonyms are mapped onto the eight kinds, missing edge ids are
generated, missing labels become `""`, and arrows pointing at non-existent
nodes are dropped. Anything it corrects is listed in the sidebar after import
so you can check it. Anything it can't correct — an unknown shape kind,
duplicate ids, malformed JSON — fails with a message naming the culprit.
