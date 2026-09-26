import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { RolesGuard } from "./common/guards/roles.guard";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule],
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule {}
