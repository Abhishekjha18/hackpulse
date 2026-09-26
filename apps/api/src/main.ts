import "reflect-metadata";
import "dotenv/config";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { fromNodeHeaders } from "better-auth/node";

import { AppModule } from "./app.module";
import { AuditService } from "./audit/audit.service";
import { auth } from "./auth/auth.config";
import { setupOpenApi } from "./openapi/setup";

/**
 * Only the fields toWebRequest actually reads, to avoid importing
 * FastifyRequest's full generic type: it duplicate-installs across
 * @nestjs/platform-fastify's internal fastify version and ours, then fails
 * to structurally match.
 */
interface MinimalRequest {
  protocol: string;
  hostname: string;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/**
 * Fastify always drains the request stream itself before a route handler
 * runs, so there is no unconsumed stream left for Better Auth's Node adapter
 * (toNodeHandler) to read from `request.raw`. Building a standard Web
 * Request from the already-buffered body sidesteps that entirely, and is
 * the same shape Better Auth expects from any fetch-based runtime (Hono,
 * SvelteKit, Cloudflare Workers, ...).
 */
function toWebRequest(request: MinimalRequest): Request {
  const url = `${request.protocol}://${request.hostname}${request.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.append(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = !["GET", "HEAD"].includes(request.method);
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? new Uint8Array(request.body as Buffer) : undefined,
  });
}

// FR-ABUSE-05 "auth": Better Auth owns /api/v1/auth/* directly (see
// bootstrap() below), so there is no Nest controller layer to log these
// from; this handler is the only place a sign-in/sign-up can be observed.
// (sign-out is handled inline in bootstrap() instead, since it needs the
// session read before auth.handler runs, which invalidates it.) Best-effort
// by design: a logging failure here must never turn a successful auth
// response into a failed one for the user.
async function logSignInOrSignUp(
  auditService: AuditService,
  path: string,
  bodyBuffer: Buffer,
): Promise<void> {
  const isSignIn = path.endsWith("/sign-in/email");
  const isSignUp = path.endsWith("/sign-up/email");
  if (!isSignIn && !isSignUp) {
    return;
  }

  try {
    const body = JSON.parse(bodyBuffer.toString("utf-8")) as { user?: { id?: string } };
    const actorUserId = body.user?.id;
    if (actorUserId) {
      await auditService.log({
        actorUserId,
        action: isSignIn ? "auth.sign_in" : "auth.sign_up",
        resourceType: "user",
        resourceId: actorUserId,
      });
    }
  } catch {
    // Best-effort, see doc comment above.
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );
  const auditService = app.get(AuditService);

  // Better Auth owns /api/v1/auth/* directly on the raw Fastify instance,
  // not a Nest controller, since its route surface (sign-up/email,
  // sign-in/email, get-session, ...) is generated from its own config
  // rather than declared as our own DTOs. The passthrough buffer parser is
  // scoped to this plugin's encapsulation context only, so it never affects
  // Nest controllers' normal JSON body parsing.
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(async (instance) => {
    // Fastify's built-in application/json parser takes priority over a "*"
    // wildcard, so it has to be overridden by name here, not just added.
    const passthrough = (_req: unknown, payload: Buffer, done: (err: null, body: Buffer) => void) =>
      done(null, payload);
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, passthrough);
    instance.addContentTypeParser("*", { parseAs: "buffer" }, passthrough);
    instance.all("/api/v1/auth/*", async (request, reply) => {
      const webRequest = toWebRequest(request);
      const path = request.url.split("?")[0];
      // Read before auth.handler runs: sign-out invalidates the very
      // session logAuthEvent would otherwise need to look up afterward.
      const preSignOutSession = path.endsWith("/sign-out")
        ? await auth.api.getSession({ headers: fromNodeHeaders(request.headers) }).catch(() => null)
        : null;

      const response = await auth.handler(webRequest);
      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(bodyBuffer);

      if (response.status < 400) {
        if (path.endsWith("/sign-out")) {
          const actorUserId = preSignOutSession?.user?.id;
          if (actorUserId) {
            await auditService
              .log({
                actorUserId,
                action: "auth.sign_out",
                resourceType: "user",
                resourceId: actorUserId,
              })
              .catch(() => {});
          }
        } else {
          await logSignInOrSignUp(auditService, path, bodyBuffer);
        }
      }
    });
  });

  app.setGlobalPrefix("api/v1");
  setupOpenApi(app, "api/v1");

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
}

bootstrap();
