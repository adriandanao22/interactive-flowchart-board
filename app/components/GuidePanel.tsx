"use client";

import { useEffect, useRef, useState } from "react";

import { KIND_INFO, type FlowchartDocument, type NodeKind } from "@/lib/flowchart";
import { GUIDE_EXAMPLES, type GuideExample } from "@/lib/guide";

import { ExamplePreview } from "./ExamplePreview";
import { ShapeOutline } from "./ShapeOutline";

interface Props {
  /**
   * Loading an example never overwrites work when this is true — it lands as
   * a new chart. Signed out there is nowhere else for it to go, so the button
   * says so.
   */
  canAddNew: boolean;
  onLoadExample: (doc: FlowchartDocument) => void;
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Inline code, so the guide can show notation without it reading as prose. */
function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  );
}

/** A block of notation with a plain-English gloss beside each line. */
function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <div className="my-2.5 overflow-hidden rounded-md border border-line">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map(([code, meaning], i) => (
            <tr key={code + i} className="border-b border-line last:border-0">
              <td className="w-1/2 border-r border-line bg-surface-muted px-2.5 py-1.5 align-top font-mono break-all">
                {code}
              </td>
              <td className="px-2.5 py-1.5 align-top leading-relaxed text-muted-fg">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Shape({ kind, children }: { kind: NodeKind; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <div className="relative mt-0.5 shrink-0" style={{ width: 54, height: 30 }}>
        <ShapeOutline kind={kind} width={54} height={30} strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{KIND_INFO[kind].name}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-fg">{children}</p>
      </div>
    </div>
  );
}

function Try({
  example,
  onPreview,
}: {
  example: GuideExample;
  onPreview: (example: GuideExample) => void;
}) {
  return (
    <div className="my-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-line bg-surface-muted px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{example.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-fg">{example.blurb}</p>
      </div>
      <button
        type="button"
        onClick={() => onPreview(example)}
        className="min-h-8 shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg"
        title="Opens it here, ready to run — your own charts are not touched"
      >
        Try it
      </button>
    </div>
  );
}

function byId(id: string): GuideExample {
  // Every id here is checked by the guide test suite, so this cannot miss.
  return GUIDE_EXAMPLES.find((e) => e.id === id)!;
}

function buildSections(onPreview: (example: GuideExample) => void): Section[] {
  const t = (id: string) => <Try example={byId(id)} onPreview={onPreview} />;

  return [
    {
      id: "start",
      title: "Start here",
      body: (
        <>
          <p>
            A <b>flowchart</b> is a picture of a set of instructions. You read it
            by starting at the top and following the arrows. Each box is one
            step. That is the whole idea — everything below is detail.
          </p>
          <p>
            What makes this board different from a drawing is that it{" "}
            <b>actually runs</b>. Press <i>Run</i> and a glow moves from shape to
            shape along the arrows, in the order a computer would follow them.
            When a shape says to show something, it appears in the console at the
            bottom. When one asks a question, the board stops and waits for you.
          </p>
          <p>
            You do not need to know how to program. If you can describe the steps
            in order, you can build one.
          </p>
          {t("hello")}
          <p className="text-xs text-muted-fg">
            Every example in this guide opens right here, ready to run. Press{" "}
            <i>Step</i> to move one shape at a time, or <i>Play</i> to watch it
            go. Nothing you open is added to your own charts unless you ask for
            it.
          </p>
        </>
      ),
    },
    {
      id: "shapes",
      title: "The shapes",
      body: (
        <>
          <p>
            Each shape has a meaning, and the shape itself tells you what kind of
            step it is. This is a convention older than computers, so a chart you
            draw here reads the same to anyone who has seen one before.
          </p>
          <div className="mt-3">
            <Shape kind="start">
              Where the chart begins and ends. Every chart needs one of each.
              They are the same shape, so the palette has a single button for
              both — pick <i>START</i> or <i>END</i> in the sidebar once it is
              on the board.
            </Shape>
            <Shape kind="process">
              Do something — a calculation, or storing a value.
            </Shape>
            <Shape kind="io">
              Show something to the person, or ask them for something.
            </Shape>
            <Shape kind="decision">
              Ask a question. Arrows leaving it are labelled with the answers, so
              this is where a chart splits into different paths.
            </Shape>
            <Shape kind="preparation">
              Set things up before the real work starts — usually the first
              values your chart needs.
            </Shape>
            <Shape kind="subroutine">
              Run another whole chart and come back with its answer.
            </Shape>
            <Shape kind="connector">
              A labelled dot. Circles sharing a letter are joined, so the chart
              can jump between them without drawing a long arrow.
            </Shape>
          </div>
          <p className="mt-3">
            Add one by clicking it in the palette at the top-left of the canvas,
            or drag it where you want it. Click any shape on the board and the
            sidebar explains it and lets you edit its text.
          </p>
        </>
      ),
    },
    {
      id: "writing",
      title: "Writing inside a shape",
      body: (
        <>
          <p>
            Whatever you type inside a shape is its label. If the board can make
            sense of it, that shape <b>does</b> what it says when the chart runs.
            If it cannot, nothing breaks — the shape is just a note, and the run
            steps straight past it. So you can start with plain English and make
            it precise later.
          </p>

          <h4>Remembering a value</h4>
          <p>
            A <b>variable</b> is a named box holding a value. You put something
            in it, and later you can ask for it back by name.
          </p>
          <Lines
            rows={[
              ["int count = 0", "Make a box called count, put 0 in it."],
              ['String name = "Ada"', "A box holding text. Text goes in quotes."],
              ["count = count + 1", "Take what is in count, add one, put it back."],
              ["int a = 1, b = 2", "Two boxes at once, separated by a comma."],
            ]}
          />
          <p>
            The word in front (<C>int</C>, <C>String</C>, <C>bool</C>…) says what
            kind of value it is. It is optional here, and mostly there because
            that is how textbooks write it. <C>int</C> means a whole number,{" "}
            <C>String</C> means text, <C>bool</C> means yes-or-no.
          </p>
          <p>
            A preparation shape can set several at once — put each on its own
            line, or separate them with <C>;</C>.
          </p>
          {t("variables")}

          <h4>Showing and asking</h4>
          <Lines
            rows={[
              ['Display "Hello!"', "Prints Hello! to the console."],
              ["Display total", "Prints whatever is in the box called total."],
              ['Display "You have " + total', "Joins text and a value together with +."],
              ["Input age", "Stops and waits. What is typed goes in age."],
            ]}
          />
          <p className="text-xs text-muted-fg">
            <C>Print</C>, <C>Output</C>, <C>Write</C> and <C>Show</C> all mean the
            same as <C>Display</C>. <C>Read</C>, <C>Get</C> and <C>Ask</C> all mean
            the same as <C>Input</C>. Use whichever your class uses.
          </p>
          {t("input")}
        </>
      ),
    },
    {
      id: "decisions",
      title: "Asking a question",
      body: (
        <>
          <p>
            A diamond is where the chart chooses. Write a question inside it, and
            label each arrow leaving it with an answer.
          </p>
          <Lines
            rows={[
              ["is age >= 18?", "Is the value in age eighteen or more?"],
              ["is score > 0 and score <= 100?", "Two conditions, both must hold."],
              ['is name == "Ada"?', "Is the text in name exactly Ada?"],
            ]}
          />
          <p>
            Label the two arrows <C>Yes</C> and <C>No</C>. When the run reaches the
            diamond it works the question out and takes the matching arrow by
            itself. If it cannot work the question out — because it is written in
            plain English, say — it stops and asks <i>you</i> which way to go,
            which is just as useful when you are explaining a chart to a class.
          </p>
          {t("decision")}

          <h4>More than two ways out</h4>
          <p>
            A diamond is not limited to yes and no. If the question produces a{" "}
            <i>value</i> rather than a yes-or-no — write it as{" "}
            <C>day?</C> — then label each arrow with the value it matches.
          </p>
          <Lines
            rows={[
              ["1", "Taken when day is 1."],
              ["1, 2, 3, 4, 5", "One arrow covering five possible values."],
              ["otherwise", "Taken when nothing else matched."],
            ]}
          />
          <p className="text-xs text-muted-fg">
            <C>default</C>, <C>else</C>, <C>any</C> and <C>other</C> all work the
            same as <C>otherwise</C>.
          </p>
          {t("switch")}
        </>
      ),
    },
    {
      id: "repeating",
      title: "Repeating steps",
      body: (
        <>
          <p>
            To repeat something, send an arrow <i>backwards</i> to a step you
            already passed. The run goes round again. Add a diamond somewhere in
            the circle to decide when to stop — without one it repeats forever.
          </p>
          <p>
            A long arrow curving back up the page gets messy, so flowcharts use a{" "}
            <b>connector</b> instead: two circles with the same letter. Control
            leaves the one with no arrow coming out of it and reappears at its
            twin. It is exactly the same as drawing the arrow, only tidier.
          </p>
          {t("loop")}
          <p className="text-xs text-muted-fg">
            Watch the number badge that appears on the shapes as it goes round —
            that is how many times the run has entered each one.
          </p>
          <p>
            Connectors are also useful without a loop: breaking a long chart in
            two lets the second half sit beside the first instead of running off
            the bottom of the screen. The built-in <i>Exam Grader</i> uses one of
            each.
          </p>
          <p>
            A letter is not limited to two circles. If three different paths all
            need to carry on at the same place, mark all three with the same
            letter — the one circle with an arrow <i>leaving</i> it is where they
            all resume. That is much easier to read than three long arrows
            crossing the page to meet at one shape.
          </p>
        </>
      ),
    },
    {
      id: "subroutines",
      title: "Reusing a chart",
      body: (
        <>
          <p>
            When part of your chart is worth a name — or you need it in several
            places — pull it out into its own small chart and call it. That is a{" "}
            <b>subroutine</b>.
          </p>
          <p>
            Use the bar under the header: <i>+ Routine</i> makes a new one, and
            the tabs switch between them. Give it a name like <C>double(n)</C> —
            the <C>n</C> in brackets is the value it is handed. End it with a
            terminator labelled <C>Return result</C> to send an answer back.
          </p>
          <p>
            Then in your main chart, add a subroutine shape and write{" "}
            <C>answer = double(5)</C>. The run goes into the small chart, works it
            out, comes back, and puts the answer in <C>answer</C>.
          </p>
          {t("subroutine")}
          <p className="text-xs text-muted-fg">
            While the run is inside a subroutine its chart appears over the
            canvas, and the call site is marked <i>waiting</i>.
          </p>
        </>
      ),
    },
    {
      id: "running",
      title: "Watching it run",
      body: (
        <>
          <p>
            <i>Step</i> moves one shape at a time — the best way to see what is
            happening. <i>Play</i> does it automatically. <i>Reset</i> starts over.
          </p>
          <Lines
            rows={[
              ["The glow", "The shape the run is on right now."],
              ["Thicker arrows", "The path taken so far."],
              ["A number badge", "How many times that shape has been entered."],
              ["Console (bottom)", "› what the chart printed, ‹ what you typed, ✕ errors."],
              ["Variables", "Every box and what is currently in it."],
              ["Path taken", "A numbered list of every step, in order."],
            ]}
          />
          <p>
            If a shape cannot be worked out — a variable used before it was set,
            or dividing by zero — the run stops and says which shape and why. It
            does not crash, and it does not carry on pretending.
          </p>
          <p>
            The <i>Warnings</i> list flags structural problems before you even
            run: a shape nothing points at, a diamond whose arrows are not
            labelled, a step with no way out.
          </p>
        </>
      ),
    },
    {
      id: "saving",
      title: "Saving and sharing",
      body: (
        <>
          <p>
            Sign in and your charts save themselves about a second after you stop
            editing — there is no save button. <i>Your charts</i> in the sidebar
            lists them all: click to open, <i>+ New</i> to start another, and the
            small buttons on each row to rename, duplicate or delete.
          </p>
          <p>
            <i>Share</i> gives you a link. A <b>live link</b> always shows your
            latest version, so you can hand it out and keep editing. A{" "}
            <b>snapshot link</b> packs the whole chart into the link itself and
            needs no account at either end, but it is frozen at the moment you
            copied it.
          </p>
          <p>
            Either way, whoever opens it can run and edit freely without touching
            your copy — their changes are thrown away when they leave.
          </p>
          <p>
            People opening a live link can also <b>leave comments</b>, with no
            account — just a name. Clicking a shape first pins the comment to
            it, and that shape then shows a 💬 badge, so &ldquo;why does this
            diamond go left?&rdquo; points at the diamond. Everyone with the
            link sees the same thread. On your own board you can read them all,
            delete any of them, and switch off new ones.
          </p>
          <p className="text-xs text-muted-fg">
            <i>Copy JSON</i> gives you the chart as text, and <i>Paste JSON</i>{" "}
            takes it back. That is also how a photo of a flowchart gets in: have a
            chat model transcribe it using the prompt in the project&rsquo;s{" "}
            <C>PASTE.md</C>, then paste the result.
          </p>
        </>
      ),
    },
    {
      id: "cheatsheet",
      title: "Cheat sheet",
      body: (
        <>
          <h4>Comparing</h4>
          <Lines
            rows={[
              ["==   !=", "is the same as / is not the same as"],
              ["<   <=   >   >=", "less than, at most, more than, at least"],
              ["and   or   not", "combine conditions"],
            ]}
          />
          <h4>Arithmetic</h4>
          <Lines
            rows={[
              ["+   -   *   /", "add, subtract, multiply, divide"],
              ["mod", "remainder — 7 mod 3 is 1"],
              ["+ with text", 'joins it together: "a" + "b" is "ab"'],
            ]}
          />
          <h4>Ready-made functions</h4>
          <Lines
            rows={[
              ["int(x)", "throw away the decimals — int(7.9) is 7"],
              ["round(x)   floor(x)   ceil(x)", "to the nearest, down, up"],
              ["abs(x)   sqrt(x)", "distance from zero, square root"],
              ["min(a, b)   max(a, b)", "the smaller, the larger"],
              ["len(text)", "how many characters"],
              ["text(x)", "turn a number into text"],
              ["isnumber(x)   istext(x)", "check what kind of value it is"],
            ]}
          />
          <h4>Arrow labels on a diamond</h4>
          <Lines
            rows={[
              ["Yes / No", "also y/n, true/false, t/f — any capitalisation"],
              ["3", "taken when the value is 3"],
              ["1, 2, 3", "one arrow, several values"],
              ["otherwise", "everything not matched above"],
            ]}
          />
          <h4>Selecting and deleting</h4>
          <Lines
            rows={[
              ["Delete / Backspace", "remove every shape and arrow selected"],
              ["Drag on empty canvas", "with the Select tool, draws a box round several shapes"],
              ["Shift + drag", "draws that box whichever tool is active"],
              ["Ctrl + V", "paste chart JSON anywhere on the page"],
            ]}
          />
          <p className="text-xs text-muted-fg">
            On a phone there is no marquee — dragging pans the canvas instead.
            Turn on the multi-select toggle and tap each shape you want.
          </p>
        </>
      ),
    },
  ];
}

export function GuidePanel({ canAddNew, onLoadExample, onClose }: Props) {
  const [active, setActive] = useState("start");
  /** The example being watched, over the top of the guide. */
  const [preview, setPreview] = useState<GuideExample | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = buildSections(setPreview);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // The preview sits on top and closes itself on Escape; closing the guide
      // out from under it would dismiss both at once.
      if (event.key === "Escape" && !preview) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preview]);

  // Jumping between sections should start the new one at the top, or a short
  // section read after a long one opens half way down.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [active]);

  const current = sections.find((s) => s.id === active) ?? sections[0];
  const index = sections.indexOf(current);

  return (
    <>
      {preview && (
        <ExamplePreview
          example={preview}
          canAddNew={canAddNew}
          onOpenOnBoard={(doc) => {
            onLoadExample(doc);
            setPreview(null);
            onClose();
          }}
          onClose={() => setPreview(null)}
        />
      )}

    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 id="guide-title" className="text-sm font-semibold">
            How to use this board
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Contents: a rail on a laptop, a scrolling strip on a phone. */}
          <nav className="shrink-0 overflow-x-auto border-b border-line md:w-52 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0">
            <ul className="flex gap-1 p-2 md:flex-col md:gap-0.5">
              {sections.map((section, i) => (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setActive(section.id)}
                    className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium whitespace-nowrap ${
                      section.id === active
                        ? "bg-accent/12 text-accent"
                        : "text-muted-fg hover:bg-surface-muted"
                    }`}
                  >
                    <span className="mr-1.5 tabular-nums opacity-60">{i + 1}</span>
                    {section.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            <h3 className="text-base font-semibold">{current.title}</h3>
            {/* Spacing and heading styles for the prose above, in one place. */}
            <div className="guide-prose mt-2 text-sm leading-relaxed">{current.body}</div>

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-3">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setActive(sections[index - 1].id)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-40"
              >
                ← {index > 0 ? sections[index - 1].title : "Back"}
              </button>
              <button
                type="button"
                disabled={index === sections.length - 1}
                onClick={() => setActive(sections[index + 1].id)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-40"
              >
                {index < sections.length - 1 ? sections[index + 1].title : "Done"} →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
