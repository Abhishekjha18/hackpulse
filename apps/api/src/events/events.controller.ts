import {
  CreateEventInput,
  CreateTrackInput,
  type CurrentUser as CurrentUserType,
  EVENT_ROLE,
  UpdateEventInput,
} from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { EventsService } from "./events.service";

@Controller("events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateEventInput)) body: CreateEventInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.events.create(body, user);
  }

  @Get()
  @Public()
  list(
    @CurrentUser() user: CurrentUserType | null,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("phase") phase: string | undefined,
    @Query("search") search: string | undefined,
  ) {
    return this.events.list(user, {
      cursor,
      limit: limit ? Number(limit) : undefined,
      phase:
        phase === "past"
          ? "past"
          : phase === "active"
            ? "active"
            : phase === "mine"
              ? "mine"
              : undefined,
      search,
    });
  }

  // Declared before the parameterized :eventId route below: Fastify's
  // router prioritizes the static segment regardless, but this keeps the
  // intent obvious on read (same convention as the bulk-export
  // controller's :resourceWithExt route).
  @Get("stats")
  @Public()
  stats() {
    return this.events.getInstanceStats();
  }

  @Get(":eventId")
  @Public()
  findOne(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType | null) {
    return this.events.findOne(eventId, user);
  }

  @Patch(":eventId")
  @Roles(EVENT_ROLE.ORGANIZER)
  update(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(UpdateEventInput)) body: UpdateEventInput,
  ) {
    return this.events.update(eventId, body);
  }

  @Get(":eventId/tracks")
  @Public()
  listTracks(@Param("eventId") eventId: string) {
    return this.events.listTracks(eventId);
  }

  @Post(":eventId/tracks")
  @Roles(EVENT_ROLE.ORGANIZER)
  createTrack(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateTrackInput)) body: CreateTrackInput,
  ) {
    return this.events.createTrack(eventId, body);
  }

  @Delete(":eventId/tracks/:trackId")
  @Roles(EVENT_ROLE.ORGANIZER)
  deleteTrack(@Param("eventId") eventId: string, @Param("trackId") trackId: string) {
    return this.events.deleteTrack(eventId, trackId);
  }
}
