"use client";

import type { User } from "@supabase/supabase-js";
import { useState } from "react";

import { configProblem, displayName, getSupabase, supabaseConfigured } from "@/lib/supabase";

/** Where the autosave has got to, shown next to the account. */
export type SaveState =
  | { kind: "off" }
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

interface Props {
  user: User | null;
  saveState: SaveState;
  onSignedOut: () => void;
}

const SAVE_TEXT: Record<SaveState["kind"], string> = {
  off: "",
  clean: "All changes saved",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Could not save",
};

export function AccountPanel({ user, saveState, onSignedOut }: Props) {
  if (!supabaseConfigured) {
    return (
      <div className="shrink-0 border-b border-line px-5 py-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">Account</p>
        {configProblem ? (
          <p className="mt-1 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs leading-relaxed text-danger">
            {configProblem}
          </p>
        ) : (
          <p className="mt-1 text-xs leading-relaxed text-muted-fg">
            Saving is off. Add <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to{" "}
            <code className="font-mono">.env.local</code> to enable accounts. The board works
            without them.
          </p>
        )}
      </div>
    );
  }

  return user ? (
    <SignedIn user={user} saveState={saveState} onSignedOut={onSignedOut} />
  ) : (
    <SignedOut />
  );
}

function SignedIn({ user, saveState, onSignedOut }: Props & { user: User }) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="shrink-0 border-b border-line px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{displayName(user)}</p>
          <p
            className={`truncate text-xs ${
              saveState.kind === "error" ? "text-danger" : "text-muted-fg"
            }`}
            title={saveState.kind === "error" ? saveState.message : undefined}
          >
            {SAVE_TEXT[saveState.kind]}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await getSupabase()?.auth.signOut();
            onSignedOut();
            setBusy(false);
          }}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function SignedOut() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase || busy) return;

    setBusy(true);
    setMessage(null);

    if (mode === "up") {
      // The username lives in user metadata rather than its own table: it is
      // a display name, and this way sign-up is a single call that works even
      // when email confirmation delays the session.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username: username.trim() || undefined } },
      });
      if (error) setMessage({ tone: "error", text: error.message });
      else if (!data.session) {
        setMessage({ tone: "info", text: "Check your email to confirm the account, then sign in." });
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage({ tone: "error", text: error.message });
    }
    setBusy(false);
  }

  return (
    <div className="shrink-0 border-b border-line px-5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
          {mode === "in" ? "Sign in" : "Create account"}
        </p>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setMessage(null);
          }}
          className="text-xs font-medium text-accent hover:underline"
        >
          {mode === "in" ? "Create one" : "I have one"}
        </button>
      </div>

      <form className="mt-2 space-y-2" onSubmit={submit}>
        {mode === "up" && (
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Display name"
            autoComplete="nickname"
            className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        )}
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          required
          minLength={6}
          placeholder="Password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
      </form>

      {message && (
        <p
          className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed ${
            message.tone === "error"
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-line bg-surface-muted text-muted-fg"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
