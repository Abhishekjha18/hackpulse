import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { createParamDecorator, ExecutionContext } from "@nestjs/common";

interface RequestWithUser {
  user: CurrentUserType | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
