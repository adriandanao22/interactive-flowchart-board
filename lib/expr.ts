/**
 * A very small expression language, just big enough for the pseudocode people
 * actually write inside flowchart shapes: `i = i + 1`, `i % 15 == 0`,
 * `limit > 0`, `ok = validate(limit)`.
 *
 * Deliberately tiny — no loops, no objects, no closures. A flowchart already
 * supplies the control flow; this only has to evaluate what sits inside one
 * shape. Anything it cannot parse is not an error, it just means that shape has
 * prose in it and the runner falls back to asking the user.
 */

export type Value = number | string | boolean;

/** Variable bindings, innermost scope last. */
export type Scope = Record<string, Value>;

export class ExprError extends Error {}

// ---- tokenising ---------------------------------------------------------

type TokenType = "num" | "str" | "ident" | "op" | "eof";
interface Token {
  type: TokenType;
  text: string;
  /** Numeric or string literal value. */
  value?: Value;
}

/** Longest first, so `<=` wins over `<` and `==` over `=`. */
const OPERATORS = [
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "<",
  ">",
  "=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  ",",
  "!",
];

/** Word forms people write in pseudocode, mapped to their symbol. */
const WORD_OPERATORS: Record<string, string> = {
  and: "&&",
  or: "||",
  not: "!",
  mod: "%",
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // String literal, single or double quoted.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let text = "";
      i += 1;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          const next = input[i + 1];
          text += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
          continue;
        }
        text += input[i];
        i += 1;
      }
      if (i >= input.length) throw new ExprError("Unterminated string.");
      i += 1;
      tokens.push({ type: "str", text, value: text });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      let text = "";
      while (i < input.length && /[0-9._]/.test(input[i])) {
        if (input[i] !== "_") text += input[i];
        i += 1;
      }
      const value = Number(text);
      if (Number.isNaN(value)) throw new ExprError(`"${text}" is not a number.`);
      tokens.push({ type: "num", text, value });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let text = "";
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        text += input[i];
        i += 1;
      }
      const word = WORD_OPERATORS[text.toLowerCase()];
      if (word) tokens.push({ type: "op", text: word });
      else if (text.toLowerCase() === "true") tokens.push({ type: "num", text, value: true });
      else if (text.toLowerCase() === "false") tokens.push({ type: "num", text, value: false });
      else tokens.push({ type: "ident", text });
      continue;
    }

    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (!op) throw new ExprError(`Unexpected character "${ch}".`);
    i += op.length;
    tokens.push({ type: "op", text: op });
  }

  tokens.push({ type: "eof", text: "" });
  return tokens;
}

// ---- syntax tree --------------------------------------------------------

export type Node =
  | { kind: "literal"; value: Value }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: string; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

export interface Assignment {
  kind: "assign";
  target: string;
  value: Node;
}

export type Statement = Assignment | { kind: "expression"; value: Node };

/**
 * Type names accepted in front of a variable, so `int num = 0` reads as the
 * declaration it obviously is.
 *
 * A closed list rather than "any two identifiers in a row": that pattern would
 * also swallow prose like `Total cost = 5` and quietly declare `cost`. `num`
 * is deliberately absent — it is far more often a variable name than a type.
 */
const TYPE_KEYWORDS: Record<string, Value> = {
  int: 0,
  integer: 0,
  long: 0,
  short: 0,
  float: 0,
  double: 0,
  real: 0,
  number: 0,
  decimal: 0,
  string: "",
  str: "",
  text: "",
  char: "",
  bool: false,
  boolean: false,
  var: 0,
  let: 0,
  const: 0,
  auto: 0,
};

class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.at];
  }
  private eat(text: string): boolean {
    if (this.peek().type === "op" && this.peek().text === text) {
      this.at += 1;
      return true;
    }
    return false;
  }
  private expect(text: string): void {
    if (!this.eat(text)) throw new ExprError(`Expected "${text}".`);
  }

  /**
   * One or more statements from a single segment.
   *
   * A preparation shape is where people set several things up at once, so
   * `int i = 0, j = 1` and `i = 0, j = 1` both read as a list. A declaration
   * carries its type across the commas, which is what makes `int i, j` give
   * both variables the type's zero value rather than leaving `j` unset.
   */
  parseStatementList(): Statement[] {
    const out: Statement[] = [];
    const declared = this.peek();
    const named = this.tokens[this.at + 1];

    if (
      declared.type === "ident" &&
      named?.type === "ident" &&
      declared.text.toLowerCase() in TYPE_KEYWORDS
    ) {
      const zero = TYPE_KEYWORDS[declared.text.toLowerCase()];
      this.at += 1; // the type name
      do {
        const name = this.peek();
        if (name.type !== "ident") throw new ExprError("Expected a variable name.");
        this.at += 1;
        out.push({
          kind: "assign",
          target: name.text,
          value: this.eat("=") ? this.parseExpression() : { kind: "literal", value: zero },
        });
      } while (this.eat(","));
      this.expectEnd();
      return out;
    }

    do {
      out.push(this.parseSingle());
    } while (this.eat(","));
    this.expectEnd();
    return out;
  }

  /** One statement, with no trailing-comma handling and no end check. */
  private parseSingle(): Statement {
    if (this.peek().type === "ident" && this.tokens[this.at + 1]?.text === "=") {
      const target = this.peek().text;
      this.at += 2;
      return { kind: "assign", target, value: this.parseExpression() };
    }
    return { kind: "expression", value: this.parseExpression() };
  }

  parseStatement(): Statement {
    // `int num = 0`, or `int num` on its own — a declaration is just an
    // assignment with the type spelled out, and an uninitialised one gets its
    // type's zero value so later shapes have something to read.
    const declared = this.peek();
    const named = this.tokens[this.at + 1];
    if (
      declared.type === "ident" &&
      named?.type === "ident" &&
      declared.text.toLowerCase() in TYPE_KEYWORDS
    ) {
      this.at += 2;
      if (this.eat("=")) {
        const value = this.parseExpression();
        this.expectEnd();
        return { kind: "assign", target: named.text, value };
      }
      this.expectEnd();
      return {
        kind: "assign",
        target: named.text,
        value: { kind: "literal", value: TYPE_KEYWORDS[declared.text.toLowerCase()] },
      };
    }

    // `x = expr` is an assignment; `==` is comparison and handled below.
    if (this.peek().type === "ident" && this.tokens[this.at + 1]?.text === "=") {
      const target = this.peek().text;
      this.at += 2;
      const value = this.parseExpression();
      this.expectEnd();
      return { kind: "assign", target, value };
    }
    const value = this.parseExpression();
    this.expectEnd();
    return { kind: "expression", value };
  }

  private expectEnd(): void {
    if (this.peek().type !== "eof") throw new ExprError(`Unexpected "${this.peek().text}".`);
  }

  parseExpression(): Node {
    return this.parseOr();
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.eat("||")) left = { kind: "binary", op: "||", left, right: this.parseAnd() };
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseComparison();
    while (this.eat("&&"))
      left = { kind: "binary", op: "&&", left, right: this.parseComparison() };
    return left;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    for (;;) {
      const op = ["==", "!=", "<=", ">=", "<", ">"].find(
        (candidate) => this.peek().type === "op" && this.peek().text === candidate,
      );
      if (!op) return left;
      this.at += 1;
      left = { kind: "binary", op, left, right: this.parseAdditive() };
    }
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eat("+")) left = { kind: "binary", op: "+", left, right: this.parseMultiplicative() };
      else if (this.eat("-"))
        left = { kind: "binary", op: "-", left, right: this.parseMultiplicative() };
      else return left;
    }
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      const op = ["*", "/", "%"].find(
        (candidate) => this.peek().type === "op" && this.peek().text === candidate,
      );
      if (!op) return left;
      this.at += 1;
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
  }

  private parseUnary(): Node {
    if (this.eat("-")) return { kind: "unary", op: "-", operand: this.parseUnary() };
    if (this.eat("!")) return { kind: "unary", op: "!", operand: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();

    if (token.type === "num" || token.type === "str") {
      this.at += 1;
      return { kind: "literal", value: token.value! };
    }

    if (token.type === "ident") {
      this.at += 1;
      if (this.eat("(")) {
        const args: Node[] = [];
        if (!this.eat(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.eat(","));
          this.expect(")");
        }
        return { kind: "call", name: token.text, args };
      }
      return { kind: "variable", name: token.text };
    }

    if (this.eat("(")) {
      const inner = this.parseExpression();
      this.expect(")");
      return inner;
    }

    throw new ExprError(token.type === "eof" ? "Expression ended early." : `Unexpected "${token.text}".`);
  }
}

/**
 * Strip the way people phrase a decision out loud — a leading "is"/"does" and
 * a trailing question mark — so `is num > 0?` reads as `num > 0`.
 *
 * Returns the candidates to try in order, most literal first, so a label that
 * already parses is never second-guessed.
 */
export function conditionCandidates(source: string): string[] {
  const text = source.trim();
  const candidates = [text];

  const withoutMark = text.endsWith("?") ? text.slice(0, -1).trim() : null;
  if (withoutMark) candidates.push(withoutMark);

  const base = withoutMark ?? text;
  const withoutPrefix = base.replace(/^(?:is|are|does|do|was|were|has|have)\s+/i, "");
  if (withoutPrefix !== base) candidates.push(withoutPrefix);

  return candidates;
}

/**
 * Split on separators that are not inside a string or brackets, so a label
 * like `Display "a; b"` or a call `f(a, b)` is never cut in half.
 */
function splitSegments(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && i + 1 < source.length) {
        current += source[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && (ch === ";" || ch === "\n")) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Parse a shape that may set several things at once — separated by commas,
 * semicolons or line breaks. Null when any part of it is not code.
 */
export function parseStatements(source: string): Statement[] | null {
  const segments = splitSegments(source);
  if (segments.length === 0) return null;

  const out: Statement[] = [];
  for (const segment of segments) {
    try {
      out.push(...new Parser(tokenize(segment)).parseStatementList());
    } catch {
      return null;
    }
  }
  return out.length ? out : null;
}

/** Parse a statement, or return null when the text is prose rather than code. */
export function parseStatement(source: string): Statement | null {
  const text = source.trim();
  if (!text) return null;
  try {
    return new Parser(tokenize(text)).parseStatement();
  } catch {
    return null;
  }
}

/** Parse a bare expression, or null if it is not one. */
export function parseExpression(source: string): Node | null {
  const statement = parseStatement(source);
  return statement && statement.kind === "expression" ? statement.value : null;
}

/**
 * True for a statement that is nothing but a single name or literal.
 *
 * Grammatically these are valid expressions, but as a *label* they are almost
 * always prose — "Start", "End", "A" — and evaluating them would fail with
 * "Start has no value yet". Callers falling back to a node's label should skip
 * them; an explicit `expr` of `ok` is honoured, because that was deliberate.
 */
export function isBareReference(statement: Statement): boolean {
  if (statement.kind !== "expression") return false;
  return statement.value.kind === "variable" || statement.value.kind === "literal";
}

// ---- evaluation ---------------------------------------------------------

/** A call the evaluator cannot perform itself, handed back to the runner. */
export interface CallRequest {
  name: string;
  args: Value[];
}

export class PendingCall extends Error {
  constructor(readonly request: CallRequest) {
    super(`Call to ${request.name}`);
  }
}

export interface EvalContext {
  scope: Scope;
  /**
   * Resolves a function call. Returning `undefined` means "not a function I
   * know", which becomes an error naming the call.
   */
  call?: (name: string, args: Value[]) => Value | undefined;
}

function truthy(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.length > 0;
}

function needNumbers(op: string, left: Value, right: Value): [number, number] {
  if (typeof left !== "number" || typeof right !== "number") {
    throw new ExprError(`"${op}" needs numbers, got ${describe(left)} and ${describe(right)}.`);
  }
  return [left, right];
}

function describe(value: Value): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.kind) {
    case "literal":
      return node.value;

    case "variable": {
      if (!(node.name in ctx.scope)) {
        throw new ExprError(`"${node.name}" has no value yet.`);
      }
      return ctx.scope[node.name];
    }

    case "unary": {
      const operand = evaluate(node.operand, ctx);
      if (node.op === "!") return !truthy(operand);
      if (typeof operand !== "number") throw new ExprError(`"-" needs a number.`);
      return -operand;
    }

    case "binary": {
      // Short-circuit before evaluating the right side.
      if (node.op === "&&") {
        return truthy(evaluate(node.left, ctx)) ? truthy(evaluate(node.right, ctx)) : false;
      }
      if (node.op === "||") {
        return truthy(evaluate(node.left, ctx)) ? true : truthy(evaluate(node.right, ctx));
      }

      const left = evaluate(node.left, ctx);
      const right = evaluate(node.right, ctx);

      switch (node.op) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "+": {
          if (typeof left === "string" || typeof right === "string") {
            return `${stringify(left)}${stringify(right)}`;
          }
          const [a, b] = needNumbers("+", left, right);
          return a + b;
        }
        case "-": {
          const [a, b] = needNumbers("-", left, right);
          return a - b;
        }
        case "*": {
          const [a, b] = needNumbers("*", left, right);
          return a * b;
        }
        case "/": {
          const [a, b] = needNumbers("/", left, right);
          if (b === 0) throw new ExprError("Division by zero.");
          return a / b;
        }
        case "%": {
          const [a, b] = needNumbers("%", left, right);
          if (b === 0) throw new ExprError("Division by zero.");
          return a % b;
        }
        default: {
          const [a, b] = needNumbers(node.op, left, right);
          if (node.op === "<") return a < b;
          if (node.op === "<=") return a <= b;
          if (node.op === ">") return a > b;
          return a >= b;
        }
      }
    }

    case "call": {
      const args = node.args.map((arg) => evaluate(arg, ctx));
      const result = ctx.call?.(node.name, args);
      if (result === undefined) throw new ExprError(`There is no routine called "${node.name}".`);
      return result;
    }
  }
}

function asNumber(fn: string, value: Value): number {
  if (typeof value !== "number") {
    throw new ExprError(`${fn}() needs a number, got ${describe(value)}.`);
  }
  return value;
}

/**
 * Functions available to every chart, so a shape can ask questions the
 * operators cannot — most importantly whether a value is a number at all,
 * which is what lets a validate routine actually validate.
 */
export const BUILTINS: Record<string, (args: Value[]) => Value> = {
  isnumber: ([value]) => typeof value === "number",
  istext: ([value]) => typeof value === "string",
  abs: ([value]) => Math.abs(asNumber("abs", value)),
  floor: ([value]) => Math.floor(asNumber("floor", value)),
  ceil: ([value]) => Math.ceil(asNumber("ceil", value)),
  round: ([value]) => Math.round(asNumber("round", value)),
  int: ([value]) => Math.trunc(asNumber("int", value)),
  sqrt: ([value]) => {
    const n = asNumber("sqrt", value);
    if (n < 0) throw new ExprError("sqrt() needs a number that is not negative.");
    return Math.sqrt(n);
  },
  min: (args) => Math.min(...args.map((a) => asNumber("min", a))),
  max: (args) => Math.max(...args.map((a) => asNumber("max", a))),
  len: ([value]) => {
    if (typeof value !== "string") throw new ExprError("len() needs text.");
    return value.length;
  },
  text: ([value]) => stringify(value ?? ""),
};

/** Resolve a builtin call; returns undefined so routines get first refusal. */
export function callBuiltin(name: string, args: Value[]): Value | undefined {
  const fn = BUILTINS[name.toLowerCase()];
  return fn ? fn(args) : undefined;
}

/** Display form used by `print` and the variables panel. */
export function stringify(value: Value): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  return String(value);
}

export { truthy };

/** Turn typed-in text into a value, preferring numbers and booleans. */
export function coerceInput(text: string): Value {
  const trimmed = text.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}
