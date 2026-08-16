import { documentOf, type FlowchartDocument, type FlowchartSpec } from "./flowchart";

/**
 * Worked examples for the in-app guide.
 *
 * Each one is small enough to read in a glance and does exactly one new thing,
 * so a reader who has never programmed can load it, step through it, and see
 * that single idea happen. They are real charts, not pictures: the guide loads
 * them onto the board and they run.
 */

export interface GuideExample {
  id: string;
  /** Shown on the button that loads it. */
  title: string;
  /** One line on what the reader should watch for. */
  blurb: string;
  doc: FlowchartDocument;
}

const HELLO: FlowchartSpec = {
  title: "Say hello",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "io", label: 'Display "Hello, world!"' },
    { id: "n3", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
  ],
};

const VARIABLES: FlowchartSpec = {
  title: "Remember a value",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "preparation", label: "int apples = 3\nint oranges = 4" },
    { id: "n3", kind: "process", label: "int total = apples + oranges" },
    { id: "n4", kind: "io", label: 'Display "You have " + total + " pieces of fruit"' },
    { id: "n5", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "" },
  ],
};

const INPUT: FlowchartSpec = {
  title: "Ask a question",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "io", label: 'Display "What is your name? "' },
    { id: "n3", kind: "io", label: "Input name" },
    { id: "n4", kind: "io", label: 'Display "Nice to meet you, " + name + "!"' },
    { id: "n5", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "" },
  ],
};

const DECISION: FlowchartSpec = {
  title: "Make a decision",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "io", label: 'Display "How old are you? "' },
    { id: "n3", kind: "io", label: "Input age" },
    { id: "n4", kind: "decision", label: "is age >= 18?" },
    { id: "n5", kind: "io", label: 'Display "You are old enough to vote."' },
    { id: "n6", kind: "io", label: 'Display "Not quite yet."' },
    { id: "n7", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "YES" },
    { id: "e5", source: "n4", target: "n6", label: "NO" },
    { id: "e6", source: "n5", target: "n7", label: "" },
    { id: "e7", source: "n6", target: "n7", label: "" },
  ],
};

const LOOP: FlowchartSpec = {
  title: "Repeat something",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "preparation", label: "int count = 1" },
    // Entry half of the loop: the arrow below leaves it.
    { id: "n3", kind: "connector", label: "A" },
    { id: "n4", kind: "io", label: "Display count" },
    { id: "n5", kind: "process", label: "count = count + 1" },
    { id: "n6", kind: "decision", label: "is count <= 5?" },
    // Exit half: no arrow out, so control jumps back to the other A.
    { id: "n7", kind: "connector", label: "A" },
    { id: "n8", kind: "io", label: 'Display "Done!"' },
    { id: "n9", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "" },
    { id: "e5", source: "n5", target: "n6", label: "" },
    { id: "e6", source: "n6", target: "n7", label: "YES" },
    { id: "e7", source: "n6", target: "n8", label: "NO" },
    { id: "e8", source: "n8", target: "n9", label: "" },
  ],
};

const SUBROUTINE_MAIN: FlowchartSpec = {
  title: "Use a subroutine",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "io", label: 'Display "Give me a number: "' },
    { id: "n3", kind: "io", label: "Input n" },
    { id: "n4", kind: "subroutine", label: "answer = double(n)", calls: "double" },
    { id: "n5", kind: "io", label: 'Display "Twice that is " + answer' },
    { id: "n6", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "" },
    { id: "e5", source: "n5", target: "n6", label: "" },
  ],
};

const DOUBLE_ROUTINE: FlowchartSpec = {
  title: "double(n)",
  params: ["n"],
  nodes: [
    { id: "d1", kind: "start", label: "START" },
    { id: "d2", kind: "process", label: "int result = n * 2" },
    // No separate `expr`: the label alone is enough, which is what the guide
    // tells the reader to write. An example must not need more than the text.
    { id: "d3", kind: "end", label: "Return result" },
  ],
  edges: [
    { id: "de1", source: "d1", target: "d2", label: "" },
    { id: "de2", source: "d2", target: "d3", label: "" },
  ],
};

const SWITCH: FlowchartSpec = {
  title: "Many choices at once",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    { id: "n2", kind: "io", label: 'Display "Enter a day number (1-7): "' },
    { id: "n3", kind: "io", label: "Input day" },
    { id: "n4", kind: "decision", label: "day?" },
    { id: "n5", kind: "io", label: 'Display "That is a weekday."' },
    { id: "n6", kind: "io", label: 'Display "That is the weekend!"' },
    { id: "n7", kind: "io", label: 'Display "There is no such day."' },
    { id: "n8", kind: "end", label: "END" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    // One arrow, five cases.
    { id: "e4", source: "n4", target: "n5", label: "1, 2, 3, 4, 5" },
    { id: "e5", source: "n4", target: "n6", label: "6, 7" },
    // Anything the arrows above did not match comes here.
    { id: "e6", source: "n4", target: "n7", label: "otherwise" },
    { id: "e7", source: "n5", target: "n8", label: "" },
    { id: "e8", source: "n6", target: "n8", label: "" },
    { id: "e9", source: "n7", target: "n8", label: "" },
  ],
};

export const GUIDE_EXAMPLES: GuideExample[] = [
  {
    id: "hello",
    title: "Say hello",
    blurb: "Three shapes. Press Step and watch the glow move.",
    doc: documentOf(HELLO),
  },
  {
    id: "variables",
    title: "Remember a value",
    blurb: "Store two numbers, add them, show the answer.",
    doc: documentOf(VARIABLES),
  },
  {
    id: "input",
    title: "Ask a question",
    blurb: "The run stops and waits for you to type something.",
    doc: documentOf(INPUT),
  },
  {
    id: "decision",
    title: "Make a decision",
    blurb: "One diamond, two ways out. Try 20, then try 12.",
    doc: documentOf(DECISION),
  },
  {
    id: "loop",
    title: "Repeat something",
    blurb: "Counts to five by jumping back through a connector.",
    doc: documentOf(LOOP),
  },
  {
    id: "subroutine",
    title: "Use a subroutine",
    blurb: "A small chart of its own that hands an answer back.",
    doc: { main: SUBROUTINE_MAIN, routines: { double: DOUBLE_ROUTINE } },
  },
  {
    id: "switch",
    title: "Many choices at once",
    blurb: "One diamond with three ways out, not two.",
    doc: documentOf(SWITCH),
  },
];

export function exampleById(id: string): GuideExample | undefined {
  return GUIDE_EXAMPLES.find((example) => example.id === id);
}
