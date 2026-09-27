"use client";

import { useState } from "react";

import { useAuthSubmit } from "../../lib/use-auth-submit";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, error, submitting } = useAuthSubmit("/auth/sign-up/email");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit({ name, email, password });
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-h1 font-semibold text-ink">Create an account</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Name</label>
          <input
            required
            data-testid="register-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Email</label>
          <input
            type="email"
            required
            data-testid="register-email"
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
            minLength={10}
            data-testid="register-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs leading-normal text-muted">At least 10 characters.</p>
        </div>
        {error && (
          <p data-testid="register-error" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          data-testid="register-submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
