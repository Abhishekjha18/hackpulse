"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "../lib/auth-context";

export function Nav() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-pulse" aria-hidden="true" />
          HackPulse
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/events"
            className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
          >
            Events
          </Link>
          <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
          {loading ? null : user ? (
            <>
              <Link
                href="/teams/mine"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
              >
                My teams
              </Link>
              <Link
                href={`/users/${user.id}`}
                data-testid="nav-profile-link"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
              >
                {user.name}
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  router.push("/");
                  router.refresh();
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
