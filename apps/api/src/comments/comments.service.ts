import { type CreateCommentInput, type CurrentUser, ERROR_CODE } from "@hackpulse/shared";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { isEventOrganizer } from "../common/auth/is-event-organizer";
import { RateLimiterService } from "../common/rate-limiter.service";
import type { Database } from "../db/client";
import { comments } from "../db/schema";
import { loadSubmissionWithEvent } from "../db/submission-lookups";
import { DB } from "../db/tokens";

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  // FR-COMMENT-01 — any authenticated user may comment on a submitted,
  // visible project. FR-ABUSE-01 — rate limited per author.
  async create(submissionId: string, input: CreateCommentInput, currentUser: CurrentUser) {
    const { submission, event } = await loadSubmissionWithEvent(this.db, submissionId);
    if (submission.status !== "submitted" || event.galleryVisibility === "hidden") {
      throw new NotFoundException();
    }

    if (!this.rateLimiter.consume("comment", currentUser.id, 60_000, 10)) {
      // 429, not 403: a client checking for 429 to drive retry/backoff
      // would otherwise read this as a permissions error. Matches
      // voting.service.ts's rate-limit response.
      throw new HttpException(
        {
          error: { code: ERROR_CODE.RATE_LIMITED, message: "Too many comments, please slow down" },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [comment] = await this.db
      .insert(comments)
      .values({
        submissionId,
        authorLabel: currentUser.name,
        authorUserId: currentUser.id,
        body: input.body,
      })
      .returning();

    return comment;
  }

  async list(submissionId: string) {
    return this.db
      .select()
      .from(comments)
      .where(and(eq(comments.submissionId, submissionId), isNull(comments.hiddenAt)));
  }

  // FR-COMMENT-02 — author or organizer/admin; soft delete, audit-preserving.
  async remove(commentId: string, currentUser: CurrentUser) {
    const [comment] = await this.db.select().from(comments).where(eq(comments.id, commentId));
    if (!comment) {
      throw new NotFoundException();
    }

    const { event } = await loadSubmissionWithEvent(this.db, comment.submissionId);

    if (comment.authorUserId !== currentUser.id && !isEventOrganizer(currentUser, event.id)) {
      throw new ForbiddenException();
    }

    await this.db
      .update(comments)
      .set({ hiddenAt: new Date(), hiddenByUserId: currentUser.id })
      .where(eq(comments.id, commentId));
  }
}
