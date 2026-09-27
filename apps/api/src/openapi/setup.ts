import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";

import { IS_PUBLIC_KEY } from "../common/decorators/public.decorator";
import { ROLES_KEY } from "../common/decorators/roles.decorator";

const HTTP_VERB_NAMES: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: "get",
  [RequestMethod.POST]: "post",
  [RequestMethod.PUT]: "put",
  [RequestMethod.DELETE]: "delete",
  [RequestMethod.PATCH]: "patch",
  [RequestMethod.OPTIONS]: "options",
  [RequestMethod.HEAD]: "head",
};

function joinPath(...segments: Array<string | undefined>): string {
  const cleaned = segments
    .filter((s): s is string => Boolean(s))
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  const joined = `/${cleaned.join("/")}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  return joined === "" ? "/" : joined;
}

/**
 * FR-API-02's "required role" clause, satisfied by reading the same
 * @Roles/@Public metadata RolesGuard already enforces at request time
 * (see common/guards/roles.guard.ts) — annotating by hand would drift the
 * moment a route's guard changed without its doc comment following along.
 * Matching is done by recomputing each handler's path the same way Nest's
 * own router does; an operation that doesn't match anything is left alone
 * rather than throwing, since a missed annotation is far cheaper than a
 * broken spec.
 */
export function annotateRequiredAccess(
  app: INestApplication,
  document: OpenAPIObject,
  globalPrefix: string,
): void {
  const reflector = app.get(Reflector);
  const modulesContainer = app.get(ModulesContainer);

  for (const module of modulesContainer.values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) {
        continue;
      }
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, instance.constructor) as
        string | undefined;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") {
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handler = (prototype as any)[methodName];
        if (typeof handler !== "function") {
          continue;
        }

        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const verb = httpMethod !== undefined ? HTTP_VERB_NAMES[httpMethod] : undefined;
        if (methodPath === undefined || !verb) {
          continue;
        }

        const fullPath = joinPath(globalPrefix, controllerPath, methodPath);
        const operation = document.paths[fullPath]?.[verb as keyof (typeof document.paths)[string]];
        if (!operation || typeof operation !== "object") {
          continue;
        }

        const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler) === true;
        const roles = reflector.get<string[]>(ROLES_KEY, handler);
        const access = isPublic
          ? "**Access:** public. No authentication required."
          : roles?.length
            ? `**Access:** requires event role \`${roles.join("` or `")}\`.`
            : "**Access:** requires an authenticated session.";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const op = operation as any;
        op.description = op.description ? `${op.description}\n\n${access}` : access;
        op["x-required-access"] = isPublic ? "public" : roles?.length ? roles : ["authenticated"];
      }
    }
  }
}

// Shared by setupOpenApi (mounts it live at /docs, /docs-json) and
// export.ts (dumps it to docs/openapi.yaml) — one document builder, so the
// committed file and the live-served spec can never describe two
// different DocumentBuilder configs.
export function buildOpenApiDocument(app: INestApplication, globalPrefix: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("HackPulse API")
    .setDescription("REST API covering every action available in the HackPulse UI (FR-API-01).")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  annotateRequiredAccess(app, document, globalPrefix);
  return document;
}

export function setupOpenApi(app: INestApplication, globalPrefix: string): void {
  const document = buildOpenApiDocument(app, globalPrefix);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);
}
