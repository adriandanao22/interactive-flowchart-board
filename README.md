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

Open http://localhost:3000. The board loads a FizzBuzz example straight away.

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

Each account gets one chart, saved automatically about a second after you stop
editing. Sign-up uses email and password — Supabase Auth owns the hashing,
sessions and rate limiting — with the display name kept alongside the account.
Supabase sends a confirmation email by default; turn that off under
Authentication -> Providers if you would rather accounts work immediately.

Row Level Security is what keeps charts private: the anon key is public, so the
policies in the schema are the only thing stopping one account reading
another's. Do not skip running the SQL.

## Using it

**Import** — *Paste JSON*, or paste JSON straight onto the page: a clean paste
imports immediately, and anything needing a second look opens the dialog with
the text in place. To turn a picture into JSON, run it through a chat model
with the prompt in [PASTE.md](PASTE.md). The result is auto-laid-out with
dagre. No API key and no network call: transcription happens outside the app.

**Edit** — drag shapes, pan and zoom, select and press `Delete` to remove
things. Every shape has a connection point on each of its four sides, and each
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

**Add shapes** — the palette at the top-left of the canvas holds all seven
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
| [lib/parse.ts](lib/parse.ts) | Pasted text → `FlowchartDocument`, with repair and validation |
| [app/components/Board.tsx](app/components/Board.tsx) | Wires state, editing, run controls, and import together |
| [app/components/ShapeOutline.tsx](app/components/ShapeOutline.tsx) | The SVG geometry for all seven shapes, at any size |
| [app/components/ShapeNode.tsx](app/components/ShapeNode.tsx) | A canvas node: outline, HTML label, handles, run highlight |
| [app/components/ShapePalette.tsx](app/components/ShapePalette.tsx) | Click-or-drag palette for adding shapes |
| [app/components/RoutinePanel.tsx](app/components/RoutinePanel.tsx) | The callee, floated over the caller while a subroutine runs |
| [app/components/Console.tsx](app/components/Console.tsx) | Program output, docked along the bottom of the canvas |
| [app/components/ChartBar.tsx](app/components/ChartBar.tsx) | Chart switcher and routine management |
| [app/components/AccountPanel.tsx](app/components/AccountPanel.tsx) | Sign in / sign up, and the autosave indicator |

## Supported shapes

Terminator (start/end), process, decision, input/output, subroutine, and
connector. Colours and teaching copy for each live in `KIND_INFO`, and the
built-in sample chart exercises all seven.

**Shapes can actually run.** A shape carrying an `expr` — or whose label is
itself code — executes rather than being stepped over: a process assigns, a
decision evaluates its condition and takes its own branch, `print x` appends to
an output log, `read x` pauses and asks for a value. Variables appear in the
run panel; printed output goes to a console docked along the bottom of the
canvas, which marks program output `›`, values you typed `‹`, and errors `✕`,
and collapses to a single bar when you want the space back. Routines take parameters and return values, so
`ok = validate(limit)` feeds the next decision directly.

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
and similar synonyms are mapped onto the seven kinds, missing edge ids are
generated, missing labels become `""`, and arrows pointing at non-existent
nodes are dropped. Anything it corrects is listed in the sidebar after import
so you can check it. Anything it can't correct — an unknown shape kind,
duplicate ids, malformed JSON — fails with a message naming the culprit.
