import type { CreatePrizeInput, UpdatePrizeInput } from "@hackpulse/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { events, prizes } from "../db/schema";
import { DB } from "../db/tokens";

@Injectable()
export class PrizesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(eventId: string, input: CreatePrizeInput) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const [prize] = await this.db
      .insert(prizes)
      .values({
        eventId,
        trackId: input.trackId,
        name: input.name,
        description: input.description,
        winnerCount: input.winnerCount,
      })
      .returning();

    return prize;
  }

  // Public: prizes are part of what draws participants to an event
  // before they have any role in it, same reasoning as the public gallery.
  async listForEvent(eventId: string) {
    return this.db.select().from(prizes).where(eq(prizes.eventId, eventId));
  }

  // Lets an organizer adjust winnerCount (or the name/track) after the
  // fact instead of deleting and recreating the prize, which would also
  // lose its id (and anything that comes to reference one directly later).
  async update(eventId: string, prizeId: string, input: UpdatePrizeInput) {
    const [existing] = await this.db
      .select()
      .from(prizes)
      .where(and(eq(prizes.id, prizeId), eq(prizes.eventId, eventId)));
    if (!existing) {
      throw new NotFoundException();
    }

    const [updated] = await this.db
      .update(prizes)
      .set(input)
      .where(eq(prizes.id, prizeId))
      .returning();
    return updated;
  }

  async delete(eventId: string, prizeId: string) {
    const [prize] = await this.db
      .select()
      .from(prizes)
      .where(and(eq(prizes.id, prizeId), eq(prizes.eventId, eventId)));
    if (!prize) {
      throw new NotFoundException();
    }

    await this.db.delete(prizes).where(eq(prizes.id, prizeId));
  }
}
