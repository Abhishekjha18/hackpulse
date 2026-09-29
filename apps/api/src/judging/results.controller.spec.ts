import { NotFoundException } from "@nestjs/common";

import type { NormalizationService } from "./normalization.service";
import { ResultsController } from "./results.controller";
import type { RubricsService } from "./rubrics.service";
import type { ScoringService } from "./scoring.service";

// ScoringService transitively imports better-auth (ESM), which jest does not
// transform; only the class token is needed here.
jest.mock("./scoring.service", () => ({ ScoringService: class ScoringService {} }));

// F3 regression (found live): @Roles("organizer") only proves the caller
// organizes the event in the URL. An organizer of event B could pass event
// A's rubricId under B's URL and read A's embargoed rankings and judge
// names, because rubricId was never tied back to :eventId.
describe("ResultsController rubric scoping", () => {
  const RUBRIC_OF_OTHER_EVENT = "11111111-1111-4111-8111-111111111111";
  const normalization = {
    getResults: jest.fn().mockResolvedValue([{ secret: "A's ranking" }]),
    getNormalizationProof: jest.fn().mockResolvedValue([]),
    getOutlierJudges: jest.fn().mockResolvedValue([]),
  };
  const rubrics = {
    // Only knows the rubric under its real event; anything else is a 404,
    // exactly what a rubric-scoped-by-event lookup does.
    findOne: jest.fn(async (eventId: string, rubricId: string) => {
      if (eventId === "event-a" && rubricId === RUBRIC_OF_OTHER_EVENT) {
        return { id: rubricId };
      }
      throw new NotFoundException();
    }),
  };
  const controller = new ResultsController(
    normalization as unknown as NormalizationService,
    rubrics as unknown as RubricsService,
    { listRevisions: jest.fn().mockResolvedValue([]) } as unknown as ScoringService,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["results", () => controller.results("event-b", RUBRIC_OF_OTHER_EVENT)],
    ["normalization-proof", () => controller.normalizationProof("event-b", RUBRIC_OF_OTHER_EVENT)],
    ["outlier-judges", () => controller.outlierJudges("event-b", RUBRIC_OF_OTHER_EVENT)],
  ])("%s rejects a rubric that belongs to a different event", async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    expect(normalization.getResults).not.toHaveBeenCalled();
    expect(normalization.getNormalizationProof).not.toHaveBeenCalled();
    expect(normalization.getOutlierJudges).not.toHaveBeenCalled();
  });

  it("still serves the rubric's own event", async () => {
    await expect(controller.results("event-a", RUBRIC_OF_OTHER_EVENT)).resolves.toEqual([
      { secret: "A's ranking" },
    ]);
  });
});
