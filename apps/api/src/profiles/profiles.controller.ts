import {
  type CurrentUser as CurrentUserType,
  SetOrganizerStatusInput,
  UpdateProfileInput,
} from "@hackpulse/shared";
import { Body, Controller, ForbiddenException, Get, Param, Patch } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { ProfilesService } from "./profiles.service";

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get("users/me/profile")
  getMine(@CurrentUser() user: CurrentUserType) {
    return this.profiles.getMine(user.id);
  }

  @Patch("users/me/profile")
  update(
    @Body(new ZodValidationPipe(UpdateProfileInput)) body: UpdateProfileInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.profiles.update(user.id, body);
  }

  // Public so a gallery card or team roster can link to a profile without
  // requiring sign-in; visibility is enforced field-by-field in the
  // service, not by gating the whole route.
  @Get("users/:userId/profile")
  @Public()
  getPublic(@Param("userId") userId: string, @CurrentUser() currentUser: CurrentUserType | null) {
    const isPrivileged = currentUser?.id === userId || !!currentUser?.isAdmin;
    return this.profiles.getPublic(userId, isPrivileged, !!currentUser?.isAdmin);
  }

  // Admin-only, the only place a user's site-wide organizer capability can
  // be granted or revoked. Not @Roles()-guarded: that decorator checks a
  // per-event role against an :eventId route param, which doesn't exist
  // here, so this is a plain isAdmin check instead.
  @Patch("users/:userId/organizer-status")
  setOrganizerStatus(
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(SetOrganizerStatusInput)) body: SetOrganizerStatusInput,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    if (!currentUser.isAdmin) {
      throw new ForbiddenException();
    }
    return this.profiles.setOrganizerStatus(userId, body.canOrganizeEvents, currentUser.id);
  }
}
