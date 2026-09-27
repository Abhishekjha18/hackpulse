import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "hackpulse:isPublic";

/**
 * Marks a route as not requiring an authenticated session. Everything else
 * requires one by default (AuthGuard is applied globally): this is an
 * explicit opt-out, so a new route is deny-by-default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
