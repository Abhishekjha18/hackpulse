import { CreatePrizeInput, UpdatePrizeInput } from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";

import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { PrizesService } from "./prizes.service";

@Controller("events/:eventId/prizes")
export class PrizesController {
  constructor(private readonly prizes: PrizesService) {}

  @Post()
  @Roles("organizer")
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreatePrizeInput)) body: CreatePrizeInput,
  ) {
    return this.prizes.create(eventId, body);
  }

  @Get()
  @Public()
  list(@Param("eventId") eventId: string) {
    return this.prizes.listForEvent(eventId);
  }

  @Patch(":prizeId")
  @Roles("organizer")
  update(
    @Param("eventId") eventId: string,
    @Param("prizeId") prizeId: string,
    @Body(new ZodValidationPipe(UpdatePrizeInput)) body: UpdatePrizeInput,
  ) {
    return this.prizes.update(eventId, prizeId, body);
  }

  @Delete(":prizeId")
  @Roles("organizer")
  delete(@Param("eventId") eventId: string, @Param("prizeId") prizeId: string) {
    return this.prizes.delete(eventId, prizeId);
  }
}
