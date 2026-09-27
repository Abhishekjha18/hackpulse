import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Controller, ForbiddenException, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { GalleryService } from "./gallery.service";
import { renderGalleryWidget, renderWidgetUnavailable } from "./widget-renderer";

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

  // FR-WIDGET-01: a standalone, iframe-able HTML snapshot. No auth, no
  // JSON: something an organizer can drop into an <iframe src="..."> on
  // their own event site without writing any client-side code themselves.
  @Get("widget")
  @Public()
  async widget(
    @Param("eventId") eventId: string,
    @Query("track") track: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("theme") theme: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const resolvedTheme = theme === "dark" ? "dark" : "light";
    reply.header("Cache-Control", "public, max-age=60");
    // No X-Frame-Options here: it has no "allow everyone" value (ALLOWALL
    // isn't a real directive), so the standards-compliant way to permit
    // embedding from any origin is to omit it and rely on CSP instead.
    reply.header("Content-Security-Policy", "frame-ancestors *");

    try {
      const { items, eventName } = await this.gallery.listForWidget(eventId, {
        track,
        limit: limit ? Number(limit) : 12,
      });
      reply
        .type("text/html; charset=utf-8")
        .send(renderGalleryWidget(eventName, items, resolvedTheme));
    } catch (err) {
      if (err instanceof ForbiddenException) {
        reply.type("text/html; charset=utf-8").send(renderWidgetUnavailable());
        return;
      }
      throw err;
    }
  }
}
