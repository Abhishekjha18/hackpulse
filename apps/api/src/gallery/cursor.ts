/** Opaque keyset-pagination cursor: base64("<updatedAt ISO>|<id>"). Chosen
 * over offset pagination for the same reason as the rest of the API
 * (API-DESIGN.md §1): stable under concurrent writes while a caller pages
 * through results. */
export interface Cursor {
  updatedAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.updatedAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) {
    return null;
  }
  try {
    const [updatedAt, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!updatedAt || !id) {
      return null;
    }
    return { updatedAt, id };
  } catch {
    return null;
  }
}
