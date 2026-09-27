import type { CurrentUser, SaveScoreInput } from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import type { Database } from "../db/client";
import {
  criterionScores,
  judgeAssignments,
  rubricCriteria,
  rubrics,
  scoreRevisions,
  scores,
  submissions,
} from "../db/schema";
import { DB } from "../db/tokens";
import { WebhooksService } from "../webhooks/webhooks.service";
import { assertJudgingWindowOpen } from "./judging-window.util";
import { NormalizationService } from "./normalization.service";

@Injectable()
export class ScoringService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly normalization: NormalizationService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  // Track-specific rubric takes precedence over event-wide fallback (trackId null).
  private async resolveRubric(eventId: string, trackId: string) {
    const candidates = await this.db
      .select()
      .from(rubrics)
      .where(and(eq(rubrics.eventId, eventId), eq(rubrics.archived, false)));
    const trackSpecific = candidates.find((r) => r.trackId === trackId);
    return trackSpecific ?? candidates.find((r) => r.trackId === null) ?? null;
  }

  private async loadAssignmentAndSubmission(assignmentId: string) {
    const [assignment] = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.id, assignmentId));
    if (!assignment) {
      throw new NotFoundException();
    }
    const [submission] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, assignment.submissionId));
    return { assignment, submission };
  }

  private async validateCriterionScores(
    rubricId: string,
    input: SaveScoreInput,
    scaleMin: number,
    scaleMax: number,
  ) {
    const criteria = await this.db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId));
    const validIds = new Set(criteria.map((c) => c.id));

    for (const cs of input.criterionScores) {
      if (!validIds.has(cs.rubricCriterionId)) {
        throw new BadRequestException({
          error: { code: "VALIDATION_ERROR", message: `Unknown criterion ${cs.rubricCriterionId}` },
        });
      }
      if (cs.value < scaleMin || cs.value > scaleMax) {
        throw new BadRequestException({
          error: {
            code: "VALIDATION_ERROR",
            message: `Score ${cs.value} outside the rubric's ${scaleMin}-${scaleMax} scale`,
          },
        });
      }
    }
    return criteria;
  }

  private computeRawWeighted(
    criteria: { id: string; weight: string }[],
    values: { rubricCriterionId: string; value: number }[],
  ) {
    const weightByCriterion = new Map(criteria.map((c) => [c.id, Number(c.weight)]));
    return values.reduce(
      (sum, v) => sum + v.value * (weightByCriterion.get(v.rubricCriterionId) ?? 0),
      0,
    );
  }

  // FR-SCORE-02/04 (draft) and FR-SCORE-05 (post-submit edit -> revision).
  async save(assignmentId: string, input: SaveScoreInput, currentUser: CurrentUser) {
    const { assignment, submission } = await this.loadAssignmentAndSubmission(assignmentId);
    await assertJudgingWindowOpen(this.db, this.audit, assignment.eventId, currentUser.id, "save");
    const rubric = await this.resolveRubric(assignment.eventId, submission.trackId);
    if (!rubric) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "No rubric configured for this track yet" },
      });
    }

    const criteria = await this.validateCriterionScores(
      rubric.id,
      input,
      rubric.scaleMin,
      rubric.scaleMax,
    );

    const [existing] = await this.db
      .select()
      .from(scores)
      .where(eq(scores.judgeAssignmentId, assignmentId));

    const wasSubmitted = existing?.status === "submitted";

    const result = await this.db.transaction(async (tx) => {
      let score = existing;
      if (!score) {
        [score] = await tx
          .insert(scores)
          .values({
            judgeAssignmentId: assignmentId,
            rubricId: rubric.id,
            status: "draft",
            overallFeedback: input.overallFeedback ?? null,
          })
          .returning();
      } else if (wasSubmitted) {
        // FR-SCORE-05: log the pre-edit snapshot before mutating.
        const priorCriterionScores = await tx
          .select()
          .from(criterionScores)
          .where(eq(criterionScores.scoreId, score.id));
        await tx.insert(scoreRevisions).values({
          scoreId: score.id,
          snapshot: { ...score, criterionScores: priorCriterionScores },
          revisedByUserId: currentUser.id,
        });
      }

      for (const cs of input.criterionScores) {
        await tx
          .insert(criterionScores)
          .values({
            scoreId: score.id,
            rubricCriterionId: cs.rubricCriterionId,
            value: cs.value.toString(),
            feedback: cs.feedback ?? null,
          })
          .onConflictDoUpdate({
            target: [criterionScores.scoreId, criterionScores.rubricCriterionId],
            set: { value: cs.value.toString(), feedback: cs.feedback ?? null },
          });
      }

      const rawWeighted = this.computeRawWeighted(criteria, input.criterionScores);
      const [updated] = await tx
        .update(scores)
        .set({
          overallFeedback: input.overallFeedback ?? null,
          ...(wasSubmitted ? { rawWeightedScore: rawWeighted.toString() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(scores.id, score.id))
        .returning();

      if (!wasSubmitted) {
        await tx
          .update(judgeAssignments)
          .set({ status: "in_progress" })
          .where(eq(judgeAssignments.id, assignmentId));
      }

      return updated;
    });

    if (wasSubmitted) {
      await this.normalization.recompute(rubric.id);
      // FR-ABUSE-05: audit log post-submit edits (draft saves are excluded).
      await this.audit.log({
        eventId: assignment.eventId,
        actorUserId: currentUser.id,
        action: "score.edit",
        resourceType: "score",
        resourceId: result.id,
        metadata: { assignmentId, submissionId: assignment.submissionId },
      });
    }

    return result;
  }

  // FR-SCORE-02: locks in the raw score and triggers normalization.
  async submit(assignmentId: string, currentUser: CurrentUser) {
    const [assignment] = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.id, assignmentId));
    if (!assignment) {
      throw new NotFoundException();
    }
    await assertJudgingWindowOpen(
      this.db,
      this.audit,
      assignment.eventId,
      currentUser.id,
      "submit",
    );

    const [score] = await this.db
      .select()
      .from(scores)
      .where(eq(scores.judgeAssignmentId, assignmentId));
    if (!score) {
      throw new BadRequestException({
        error: { code: "VALIDATION_ERROR", message: "Save a draft score before submitting" },
      });
    }
    if (score.status === "submitted") {
      throw new ConflictException({
        error: {
          code: "CONFLICT",
          message: "Already submitted. Use the save endpoint to revise it",
        },
      });
    }

    const criteria = await this.db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, score.rubricId));
    const values = await this.db
      .select()
      .from(criterionScores)
      .where(eq(criterionScores.scoreId, score.id));

    if (values.length !== criteria.length) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "Every criterion must be scored before submitting",
        },
      });
    }

    const rawWeighted = this.computeRawWeighted(
      criteria,
      values.map((v) => ({ rubricCriterionId: v.rubricCriterionId, value: Number(v.value) })),
    );

    const [updated] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(scores)
        .set({
          status: "submitted",
          rawWeightedScore: rawWeighted.toString(),
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(scores.id, score.id))
        .returning();

      await tx
        .update(judgeAssignments)
        .set({ status: "completed" })
        .where(eq(judgeAssignments.id, assignmentId));

      return rows;
    });

    await this.normalization.recompute(score.rubricId);
    await this.maybeFireJudgingCompleted(assignmentId);

    await this.audit.log({
      eventId: assignment.eventId,
      actorUserId: currentUser.id,
      action: "score.submit",
      resourceType: "score",
      resourceId: score.id,
      metadata: { assignmentId, submissionId: assignment.submissionId },
    });

    return updated;
  }

  // FR-API-03: fires once when all assignments for a submission reach completed status.
  private async maybeFireJudgingCompleted(assignmentId: string) {
    const [assignment] = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.id, assignmentId));
    if (!assignment) {
      return;
    }

    const siblings = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.submissionId, assignment.submissionId));

    const allCompleted = siblings.every((a) => a.status === "completed");
    if (!allCompleted) {
      return;
    }

    await this.webhooks.trigger(assignment.eventId, "judging.completed", {
      submissionId: assignment.submissionId,
      judgeCount: siblings.length,
    });
  }

  async findOne(assignmentId: string) {
    const [score] = await this.db
      .select()
      .from(scores)
      .where(eq(scores.judgeAssignmentId, assignmentId));
    if (!score) {
      throw new NotFoundException();
    }
    const criteria = await this.db
      .select()
      .from(criterionScores)
      .where(eq(criterionScores.scoreId, score.id));
    return { ...score, criterionScores: criteria };
  }
}
