import { Module } from "@nestjs/common";

import { RateLimiterService } from "../common/rate-limiter.service";
import { CommentsController } from "./comments.controller";
import { CommentsService } from "./comments.service";

@Module({
  controllers: [CommentsController],
  providers: [CommentsService, RateLimiterService],
})
export class CommentsModule {}
