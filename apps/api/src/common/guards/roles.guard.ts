import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

// Placeholder role-isolation guard: real per-event role enforcement lands
// once event roles exist. Always allows for now, wired into APP_GUARD from
// day one so every future route passes through here without a later refactor.
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
