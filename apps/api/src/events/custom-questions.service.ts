import type { CreateCustomQuestionInput } from "@hackpulse/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { customQuestions, events } from "../db/schema";
import { DB } from "../db/tokens";

@Injectable()
export class CustomQuestionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(eventId: string, input: CreateCustomQuestionInput) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(customQuestions)
      .where(eq(customQuestions.eventId, eventId));

    const [question] = await this.db
      .insert(customQuestions)
      .values({
        eventId,
        trackId: input.trackId,
        label: input.label,
        type: input.type,
        options: input.options,
        required: input.required,
        sortOrder: count,
      })
      .returning();

    return question;
  }

  // Event-wide questions (trackId null) apply to every submission; a
  // track-scoped question applies only within that track. Public, since a
  // participant needs this list before they have any role beyond "logged in."
  async listForEvent(eventId: string, trackId?: string) {
    return this.db
      .select()
      .from(customQuestions)
      .where(
        and(
          eq(customQuestions.eventId, eventId),
          trackId
            ? or(isNull(customQuestions.trackId), eq(customQuestions.trackId, trackId))
            : undefined,
        ),
      )
      .orderBy(customQuestions.sortOrder);
  }
}
