import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Controller, Get, Param, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { GalleryService } from "./gallery.service";

@Controller("events/:eventId/gallery")
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get()
  @Public()
  list(
    @Param("eventId") eventId: string,
    @Query("search") search: string | undefined,
    @Query("track") track: string | undefined,
    @Query("tag") tag: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType | null,
  ) {
    return this.gallery.list(
      eventId,
      { search, track, tag, cursor, limit: limit ? Number(limit) : undefined },
      user,
    );
  }
}
