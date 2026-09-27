"use client";

import { useState } from "react";

import { useAuthSubmit } from "../../lib/use-auth-submit";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, submitting } = useAuthSubmit("/auth/sign-in/email");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit({ email, password });
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-h1 font-semibold text-ink">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Email</label>
          <input
            type="email"
            required
            data-testid="login-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Password</label>
          <input
            type="password"
            required
            data-testid="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        {error && (
          <p data-testid="login-error" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          data-testid="login-submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
