import { Global, Module } from "@nestjs/common";

import { db } from "./client";
import { DB } from "./tokens";

export { DB } from "./tokens";

@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
export class DatabaseModule {}
