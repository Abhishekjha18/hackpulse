import { createHash } from "node:crypto";

import { CastVoteInput, type CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { VotingService } from "./voting.service";

interface RequestWithIp {
  ip: string;
}

@Controller("events/:eventId")
export class VotingController {
  constructor(private readonly voting: VotingService) {}

  @Get("ballot")
  @Public()
  ballot(
    @Param("eventId") eventId: string,
    @CurrentUser() user: CurrentUserType | null,
    @Headers("x-voter-token") voterToken: string | undefined,
  ) {
    const voter = this.voting.resolveVoter(user, voterToken);
    return this.voting.getBallot(eventId, voter);
  }

  @Post("votes")
  @Public()
  vote(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CastVoteInput)) body: CastVoteInput,
    @CurrentUser() user: CurrentUserType | null,
    @Headers("x-voter-token") voterToken: string | undefined,
    @Headers("x-voter-email") voterEmail: string | undefined,
    @Req() req: RequestWithIp,
  ) {
    const ipHash = createHash("sha256").update(req.ip).digest("hex");
    return this.voting.castVote(eventId, body, user, voterToken, voterEmail, ipHash);
  }

  @Get("votes/tally")
  @Public()
  tally(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType | null) {
    const isPrivileged = isEventOrganizer(user, eventId);
    return this.voting.getTally(eventId, isPrivileged);
  }
}
