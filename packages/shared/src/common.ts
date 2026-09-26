import { z } from "zod";

export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "DEADLINE_PASSED",
  "CONFLICT",
  "RATE_LIMITED",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string().uuid(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

// Found live: every user-supplied URL field (banner image, submission
// thumbnail/repo/live/demo links, profile links) used plain z.string().url(),
// which only checks the string parses as a URL -- it accepts any scheme,
// including `javascript:`. Several of these render as a clickable <a href>
// (the gallery widget's hand-built HTML, and the main app's own JSX, which
// doesn't sanitize href values either), so a `javascript:` URL stored in
// one of these fields would execute when clicked. Restricting to http(s)
// at the schema level fixes every render site at once, rather than
// patching each one individually.
export function httpUrl() {
  return z.string().refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Must be an http:// or https:// URL" },
  );
}
