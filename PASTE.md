You are transcribing a flowchart image into JSON. Read the diagram carefully
before answering — trace every arrow from tail to head, including ones that
loop backwards or cross other arrows.

Output JSON matching exactly this shape:

{
"title": string, // short name for what the flowchart does
"nodes": [
{
"id": string, // unique slug, e.g. "n1"
"kind": string, // one of the seven kinds listed below
"label": string, // the text inside the shape, verbatim
"expr": string, // optional; executable code for this shape
"calls": string // optional; on a subroutine, the routine it invokes
}
],
"edges": [
{
"id": string, // unique slug, e.g. "e1"
"source": string, // id of the node the arrow leaves
"target": string, // id of the node the arrow enters
"label": string // condition on the arrow, or "" if unlabelled
}
],
"routines": { // optional; omit if the image has no subroutine bodies
"<key>": { // <key> is a plain identifier — the name code calls
"title": string, // display name; may include the signature
"params": [string], // optional; names bound from the call's arguments
"nodes": [ ... ],
"edges": [ ... ]
}
}
}

"kind" must be exactly one of:
"start" — stadium/oval terminator where the chart begins
"end" — stadium/oval terminator where the chart finishes
"process" — plain rectangle: an action or assignment
"decision" — diamond: a condition with multiple labelled exits
"io" — parallelogram: input or output crossing the program boundary
"subroutine" — rectangle with double bars on its sides: a call to another routine
"connector" — small circle with a letter or number: an on/off-page jump

Rules:

- If a shape's drawn geometry is ambiguous, classify by its role instead:
  something with two labelled outgoing arrows is a decision even when drawn
  as a rectangle.
- Transcribe labels verbatim — preserve wording, casing, operators, and code.
  Do not paraphrase, summarise, or fix typos.
- Give every arrow its own edge object. An arrow with a condition on it
  ("Yes", "No", "n < 0") carries that text as its label; an unlabelled arrow
  gets "" — never omit the label field.
- Include loop-back arrows and arrows that merge several paths into one node.
- For connector pairs, emit both connector nodes and the edges that reach
  them. Do not invent a direct edge between the two halves. Both halves of a
  pair carry the same label, which is what links them.
- Every node except the start must be reachable, and every node except an end
  must have at least one outgoing arrow. If the image genuinely lacks an
  arrow, leave it missing rather than inventing one.
- ids must be unique. Every edge's source and target must match a node id.

- A shape may carry "expr": executable pseudocode, for when the label is
  prose. Use it only when the diagram makes the intent unambiguous:
  a process assigns ("i = i + 1"), a decision is a condition ("i % 15 == 0"),
  I/O is "print <expr>" or "read <name>", a routine's end is "return <expr>".
  Leave "expr" off when you are guessing — a shape without it still works,
  the reader is just asked at decisions. Omit it too when the label is already
  the code, as in "i = i + 1"; the label is used when there is no "expr".
- In expressions: "=" assigns and "==" compares. Operators are + - * / %
  (or "mod"), == != < <= > >=, and "and" / "or" / "not". Functions available:
  isnumber, istext, abs, floor, ceil, round, int, sqrt, min, max, len, text.
- Decisions with runnable code take their own branch, so label the outgoing
  arrows "Yes" and "No" for a true/false condition. For a decision that picks
  among several values, label each arrow with the value it matches.

- A routine's key must be a plain identifier — "validate", never
  "validate(limit)". Put the signature in "title" and the argument names in
  "params", e.g.
  "routines": {"validate": {"title": "validate(limit)", "params": ["limit"],
  "nodes": [...], "edges": [...]}}
- A subroutine shape links to a routine by naming it in the call, so
  "validate(limit)" as the label or "expr" is enough. Use "calls" only to
  disambiguate. Do not set "calls" for a routine whose body is not in the
  image — that shape is simply stepped over, which is correct.
- When a routine's result is used later, make that visible on the diagram:
  write the call site's label as an assignment, "valid = validate(limit)", and
  have the following decision branch on that variable, "valid?". A reader must
  be able to follow the value from shape to shape without seeing "expr".

- Escape every double quote inside a label as \" and every line break as \n.
  A label that quotes text from the diagram — "Buy items that fit your budget."
  — must be written as "\"Buy items that fit your budget.\"". Unescaped quotes
  inside labels are the single most common way this output breaks.

Output only the JSON object. No commentary, no explanation, no markdown code
fences.

Example of the expected output for a trivial chart:
{"title":"Check sign","nodes":[{"id":"n1","kind":"start","label":"Start"},{"id":"n2","kind":"decision","label":"n > 0?"},{"id":"n3","kind":"io","label":"print \"positive\""},{"id":"n4","kind":"end","label":"End"}],"edges":[{"id":"e1","source":"n1","target":"n2","label":""},{"id":"e2","source":"n2","target":"n3","label":"Yes"},{"id":"e3","source":"n2","target":"n4","label":"No"},{"id":"e4","source":"n3","target":"n4","label":""}]}

If the image is not a flowchart, reply with exactly: NOT_A_FLOWCHART
