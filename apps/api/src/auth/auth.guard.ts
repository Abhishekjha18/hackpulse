import type { CurrentUser } from "@hackpulse/shared";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";

import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { auth } from "./auth.config";
import { AuthService } from "./auth.service";

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  user: CurrentUser | null;
}

/**
 * Populates request.user from the Better Auth session cookie. Applied
 * globally (see app.module.ts) so every route is authenticated by default;
 * @Public() is an explicit, auditable opt-out, never the default.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestLike>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    request.user = session ? await this.authService.toCurrentUser(session.user as never) : null;

    if (!isPublic && !request.user) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
