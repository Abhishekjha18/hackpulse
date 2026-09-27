interface WidgetSubmission {
  id: string;
  name: string;
  tagline: string;
  thumbnailUrl: string | null;
  techTags: string[];
  liveUrl: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Defense in depth alongside the shared httpUrl() schema validator
// (packages/shared/src/common.ts) that now rejects non-http(s) schemes at
// submission-creation time: this renderer hand-builds raw HTML sent into
// someone else's iframe, so a stray javascript: URL that predates that fix
// (or reaches here some other way) still can't end up in a clickable href.
function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// FR-WIDGET-01: a minimal, theme-aware, iframe-able snapshot of the
// gallery. Deliberately dependency-free inline HTML/CSS: an embed target
// shouldn't need its own build step or CDN fetch to render.
export function renderGalleryWidget(
  eventName: string,
  submissions: WidgetSubmission[],
  theme: "light" | "dark",
): string {
  const bg = theme === "dark" ? "#0b0d10" : "#ffffff";
  const fg = theme === "dark" ? "#e6e6e6" : "#111111";
  const cardBg = theme === "dark" ? "#16191d" : "#f7f7f8";
  const muted = theme === "dark" ? "#9aa0a6" : "#5f6368";
  const accent = "#6366f1";

  const cards = submissions
    .map((s) => {
      const thumb =
        s.thumbnailUrl && isSafeHttpUrl(s.thumbnailUrl)
          ? `<img src="${escapeHtml(s.thumbnailUrl)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px 8px 0 0;">`
          : `<div style="width:100%;height:120px;background:${accent}22;border-radius:8px 8px 0 0;"></div>`;
      const tags = s.techTags
        .slice(0, 4)
        .map(
          (t) =>
            `<span style="font-size:11px;color:${muted};border:1px solid ${muted}55;border-radius:999px;padding:2px 8px;margin-right:4px;">${escapeHtml(t)}</span>`,
        )
        .join("");
      const link = s.liveUrl && isSafeHttpUrl(s.liveUrl) ? escapeHtml(s.liveUrl) : "#";
      return `
      <a href="${link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;">
        <div style="background:${cardBg};border-radius:8px;overflow:hidden;display:flex;flex-direction:column;">
          ${thumb}
          <div style="padding:10px 12px;">
            <div style="font-weight:600;font-size:14px;margin-bottom:2px;">${escapeHtml(s.name)}</div>
            <div style="font-size:12px;color:${muted};margin-bottom:6px;">${escapeHtml(s.tagline)}</div>
            <div>${tags}</div>
          </div>
        </div>
      </a>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(eventName)}: Gallery</title>
</head>
<body style="margin:0;padding:16px;background:${bg};color:${fg};font-family:system-ui,-apple-system,sans-serif;">
  <div style="font-size:13px;color:${muted};margin-bottom:12px;">
    <strong style="color:${fg};">${escapeHtml(eventName)}</strong> powered by HackPulse
  </div>
  ${
    submissions.length === 0
      ? `<div style="color:${muted};font-size:13px;">No public submissions yet.</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">${cards}</div>`
  }
</body>
</html>`;
}

export function renderWidgetUnavailable(): string {
  return `<!doctype html>
<html><body style="margin:0;padding:16px;font-family:system-ui,sans-serif;color:#5f6368;font-size:13px;">
This event's gallery is not public.
</body></html>`;
}
