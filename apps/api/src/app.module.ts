import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";

import { AuditModule } from "./audit/audit.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { BulkModule } from "./bulk/bulk.module";
import { CertificatesModule } from "./certificates/certificates.module";
import { RolesGuard } from "./common/guards/roles.guard";
import { CommentsModule } from "./comments/comments.module";
import { DatabaseModule } from "./db/database.module";
import { EventsModule } from "./events/events.module";
import { GalleryModule } from "./gallery/gallery.module";
import { HealthModule } from "./health/health.module";
import { JudgingModule } from "./judging/judging.module";
import { QueueModule } from "./queue/queue.module";
import { ResultsModule } from "./results/results.module";
import { SubmissionsModule } from "./submissions/submissions.module";
import { TeamsModule } from "./teams/teams.module";
import { UsersModule } from "./users/users.module";
import { VotingModule } from "./voting/voting.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    UsersModule,
    EventsModule,
    TeamsModule,
    SubmissionsModule,
    GalleryModule,
    JudgingModule,
    QueueModule,
    WebhooksModule,
    CertificatesModule,
    AuditModule,
    VotingModule,
    CommentsModule,
    ResultsModule,
    BulkModule,
  ],
  providers: [
    // Order matters: AuthGuard resolves request.user first, RolesGuard
    // then authorizes against it (ARCHITECTURE.md §6).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
