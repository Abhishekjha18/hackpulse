"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "./api";
import { useAuth } from "./auth-context";

// Shared by the login and register pages — both submit to a Better Auth
// email/password endpoint, then do the exact same "refresh the session,
// go home" on success and "surface the API's own error message" on
// failure. What differs between the two pages (the form fields, the
// endpoint, the copy) stays in each page's own JSX rather than being
// folded into a generic configurable component.
export function useAuthSubmit(endpoint: string) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const { refresh } = useAuth();

  async function submit(body: Record<string, string>) {
    setError(null);
    setSubmitting(true);
    try {
      await api.post(endpoint, body);
      await refresh();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, error, submitting };
}
