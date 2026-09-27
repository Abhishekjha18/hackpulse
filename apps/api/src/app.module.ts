import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { RolesGuard } from "./common/guards/roles.guard";
import { DatabaseModule } from "./db/database.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    UsersModule,
    EventsModule,
  ],
  providers: [
    // Order matters: AuthGuard resolves request.user first, RolesGuard
    // then authorizes against it (ARCHITECTURE.md §6).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
