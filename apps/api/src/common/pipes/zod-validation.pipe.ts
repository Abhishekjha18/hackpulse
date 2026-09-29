import { ERROR_CODE } from "@hackpulse/shared";
import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
/**
 * Validates a request body/params/query against a Zod schema from
 * @hackpulse/shared — the same schema the frontend validates forms against
 * (ADR-010: one source of truth for the API contract).
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      });
    }
    return result.data;
  }
}
