import { type CurrentUser as CurrentUserType, ERROR_CODE } from "@hackpulse/shared";
import { BadRequestException, Controller, Get, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Public()
  search(
    @Query("q") q: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType | null,
  ) {
    const query = (q ?? "").trim();
    if (query.length < 2) {
      throw new BadRequestException({
        error: { code: ERROR_CODE.VALIDATION_ERROR, message: "q must be at least 2 characters" },
      });
    }
    return this.searchService.search(query, user, limit ? Number(limit) : undefined);
  }
}
