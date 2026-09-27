import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Controller, Get } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";

@Controller("users")
export class UsersController {
  @Get("me")
  me(@CurrentUser() user: CurrentUserType) {
    // No @Public() here — AuthGuard already requires a valid session for
    // this route and populates `user`, so this can never be null.
    return user;
  }
}
