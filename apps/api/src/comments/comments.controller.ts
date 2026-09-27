import { CreateCommentInput, type CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CommentsService } from "./comments.service";

@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post("submissions/:submissionId/comments")
  create(
    @Param("submissionId") submissionId: string,
    @Body(new ZodValidationPipe(CreateCommentInput)) body: CreateCommentInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.comments.create(submissionId, body, user);
  }

  @Get("submissions/:submissionId/comments")
  @Public()
  list(@Param("submissionId") submissionId: string) {
    return this.comments.list(submissionId);
  }

  @Delete("comments/:commentId")
  remove(@Param("commentId") commentId: string, @CurrentUser() user: CurrentUserType) {
    return this.comments.remove(commentId, user);
  }
}
