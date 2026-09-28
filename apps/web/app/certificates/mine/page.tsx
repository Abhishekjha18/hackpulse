"use client";

import type { CertificateType } from "@hackpulse/shared";
import { useEffect, useState } from "react";

import { LoadingState } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";

interface MyCertificate {
  id: string;
  eventId: string;
  eventName: string;
  type: CertificateType;
  issuedAt: string;
  ready: boolean;
}
interface MyJudgeRecord {
  id: string;
  eventId: string;
  eventName: string;
  issuedAt: string;
}
interface MyCertificatesResponse {
  certificates: MyCertificate[];
  judgeRecords: MyJudgeRecord[];
}

const TYPE_LABEL: Record<CertificateType, string> = {
  participation: "Participation",
  winner: "Winner",
  judge: "Judge participation",
};

export default function MyCertificatesPage() {
  const [data, setData] = useState<MyCertificatesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MyCertificatesResponse>("/users/me/certificates")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load certificates"));
  }, []);

  return (
    <div className="max-w-xl">
      <h1 className="text-h1 font-semibold text-ink">My certificates</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        PDF certificates and signed judge-participation records issued to you, across every event.
      </p>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {data === null && !error && <LoadingState className="mt-4" />}

      {data && (
        <>
          <h2 className="mt-8 text-h2 font-semibold text-ink">Certificates</h2>
          {data.certificates.length === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              No certificates issued to you yet.
            </p>
          ) : (
            <ul data-testid="my-certificates-list" className="mt-3 space-y-2">
              {data.certificates.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-ink">
                      {TYPE_LABEL[c.type]} for {c.eventName}
                    </div>
                    <div className="text-xs leading-normal text-muted">
                      {new Date(c.issuedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {c.ready ? (
                    <a
                      href={`/api/v1/events/${c.eventId}/certificates/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-md border border-line px-3 py-1.5 font-medium text-accent hover:bg-surface-alt"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted">Generating…</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-h2 font-semibold text-ink">
            Signed judge-participation records
          </h2>
          {data.judgeRecords.length > 0 && (
            <p className="mt-1 text-xs leading-normal text-muted">
              This is the cryptographic backing for each &ldquo;Judge participation&rdquo;
              certificate above, not a separate award. The PDF links to the same record verified
              here, so anyone can confirm it&rsquo;s genuine without asking the organizer.
            </p>
          )}
          {data.judgeRecords.length === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">
              No judge records issued to you yet.
            </p>
          ) : (
            <ul data-testid="my-judge-records-list" className="mt-3 space-y-2">
              {data.judgeRecords.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-ink">{r.eventName}</div>
                    <div className="text-xs leading-normal text-muted">
                      {new Date(r.issuedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <a
                    href={`/api/v1/verify/judge-record/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 font-medium text-accent hover:bg-surface-alt"
                  >
                    Verify
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
