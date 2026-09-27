import type { CreateRubricInput } from "@hackpulse/shared";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import {
  criterionScores,
  events,
  normalizedResults,
  rubricCriteria,
  rubrics,
  scores,
} from "../db/schema";
import { DB } from "../db/tokens";

const WEIGHT_SUM_TOLERANCE = 0.001;

@Injectable()
export class RubricsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // FR-SCORE-01: weights must sum to 1.0, checked here at write time
  // rather than left for the scoring math to silently absorb.
  async create(eventId: string, input: CreateRubricInput) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const totalWeight = input.criteria.reduce((sum, c) => sum + c.weight, 0);
    if (Math.abs(totalWeight - 1) > WEIGHT_SUM_TOLERANCE) {
      throw new UnprocessableEntityException({
        error: {
          code: "VALIDATION_ERROR",
          message: `Criterion weights must sum to 1.0 (got ${totalWeight.toFixed(4)})`,
        },
      });
    }

    return this.db.transaction(async (tx) => {
      const [rubric] = await tx
        .insert(rubrics)
        .values({
          eventId,
          trackId: input.trackId,
          name: input.name,
          scaleMin: input.scaleMin,
          scaleMax: input.scaleMax,
        })
        .returning();

      const criteria = await tx
        .insert(rubricCriteria)
        .values(
          input.criteria.map((c, i) => ({
            rubricId: rubric.id,
            name: c.name,
            description: c.description,
            weight: c.weight.toString(),
            sortOrder: i,
          })),
        )
        .returning();

      return { ...rubric, criteria };
    });
  }

  // Mirrors ScoringService's track-specific-wins-over-event-wide resolution
  // (kept in sync manually, not shared, given how different the two call
  // shapes are). Defaults to active rubrics only, since the judge scoring
  // page must never be offered an archived one; the organizer dashboard
  // passes includeArchived to see and unarchive retired ones.
  async listForEvent(eventId: string, includeArchived = false) {
    const eventRubrics = await this.db
      .select()
      .from(rubrics)
      .where(
        includeArchived
          ? eq(rubrics.eventId, eventId)
          : and(eq(rubrics.eventId, eventId), eq(rubrics.archived, false)),
      );
    return Promise.all(
      eventRubrics.map(async (r) => ({
        ...r,
        criteria: await this.db
          .select()
          .from(rubricCriteria)
          .where(eq(rubricCriteria.rubricId, r.id)),
      })),
    );
  }

  async findOne(rubricId: string) {
    const [rubric] = await this.db.select().from(rubrics).where(eq(rubrics.id, rubricId));
    if (!rubric) {
      throw new NotFoundException();
    }
    const criteria = await this.db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId));
    return { ...rubric, criteria };
  }

  // Shared by delete/deleteCriterion/archive/unarchive below: scoped by
  // eventId (not just rubricId) so an organizer can't act on another
  // event's rubric by guessing its id.
  private async findRubricOrThrow(eventId: string, rubricId: string) {
    const [rubric] = await this.db
      .select()
      .from(rubrics)
      .where(and(eq(rubrics.id, rubricId), eq(rubrics.eventId, eventId)));
    if (!rubric) {
      throw new NotFoundException();
    }
    return rubric;
  }

  // Blocked once any judge has scored against the rubric: scores.rubricId
  // has no cascade, so this would otherwise fail as a raw FK violation
  // anyway; checking first gives a clear 409 instead.
  async delete(eventId: string, rubricId: string) {
    await this.findRubricOrThrow(eventId, rubricId);

    const [score] = await this.db
      .select()
      .from(scores)
      .where(eq(scores.rubricId, rubricId))
      .limit(1);
    if (score) {
      throw new ConflictException({
        error: {
          code: "CONFLICT",
          message: "This rubric already has scores against it and can't be deleted",
        },
      });
    }

    // Found live: normalized_results.rubric_id has no cascade, and
    // ScoringService writes a row there on every score submission
    // regardless of whether results are published. A rubric whose only
    // score was later removed by deleting the judge who gave it (see
    // JudgesService.remove) would pass the check above with zero live
    // scores yet still 500 as a raw FK violation, because a stale
    // normalized_results row from before the judge was removed still
    // pointed at it. Safe to clear: no live score means it's stale
    // computed history, not source-of-truth data.
    await this.db.transaction(async (tx) => {
      await tx.delete(normalizedResults).where(eq(normalizedResults.rubricId, rubricId));
      await tx.delete(rubrics).where(eq(rubrics.id, rubricId));
    });
  }

  // Blocked if already scored (to prevent cascade loss) or if it is the last criterion.
  // Proportionally rebalances remaining criteria weights so they still sum to 1.0.
  async deleteCriterion(eventId: string, rubricId: string, criterionId: string) {
    await this.findRubricOrThrow(eventId, rubricId);

    const allCriteria = await this.db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId));
    const criterion = allCriteria.find((c) => c.id === criterionId);
    if (!criterion) {
      throw new NotFoundException();
    }

    if (allCriteria.length <= 1) {
      throw new ConflictException({
        error: {
          code: "CONFLICT",
          message: "Can't delete a rubric's last criterion. Delete the whole rubric instead",
        },
      });
    }

    const [criterionScore] = await this.db
      .select()
      .from(criterionScores)
      .where(eq(criterionScores.rubricCriterionId, criterionId))
      .limit(1);
    if (criterionScore) {
      throw new ConflictException({
        error: {
          code: "CONFLICT",
          message: "This criterion already has scores against it and can't be deleted",
        },
      });
    }

    const remaining = allCriteria.filter((c) => c.id !== criterionId);
    const remainingSum = remaining.reduce((sum, c) => sum + Number(c.weight), 0);

    await this.db.transaction(async (tx) => {
      await tx.delete(rubricCriteria).where(eq(rubricCriteria.id, criterionId));
      for (const c of remaining) {
        // weight is numeric(5,4): round explicitly to avoid float string truncation in Postgres.
        const rebalanced =
          remainingSum > 0 ? Number(c.weight) / remainingSum : 1 / remaining.length;
        await tx
          .update(rubricCriteria)
          .set({ weight: rebalanced.toFixed(4) })
          .where(eq(rubricCriteria.id, c.id));
      }
    });
  }

  // Non-destructive alternative to delete() when scores exist: hides from new scoring without deleting data.
  async archive(eventId: string, rubricId: string) {
    await this.findRubricOrThrow(eventId, rubricId);
    const [updated] = await this.db
      .update(rubrics)
      .set({ archived: true })
      .where(eq(rubrics.id, rubricId))
      .returning();
    return updated;
  }

  async unarchive(eventId: string, rubricId: string) {
    await this.findRubricOrThrow(eventId, rubricId);
    const [updated] = await this.db
      .update(rubrics)
      .set({ archived: false })
      .where(eq(rubrics.id, rubricId))
      .returning();
    return updated;
  }
}
