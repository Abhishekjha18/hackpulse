ALTER TABLE "events" ALTER COLUMN "registration_open_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "registration_close_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "submission_open_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "submission_close_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "judging_open_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "judging_close_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lifecycle_dates_all_or_none" CHECK (
        ("events"."registration_open_at" IS NULL AND "events"."registration_close_at" IS NULL AND
         "events"."submission_open_at" IS NULL AND "events"."submission_close_at" IS NULL AND
         "events"."judging_open_at" IS NULL AND "events"."judging_close_at" IS NULL)
        OR
        ("events"."registration_open_at" IS NOT NULL AND "events"."registration_close_at" IS NOT NULL AND
         "events"."submission_open_at" IS NOT NULL AND "events"."submission_close_at" IS NOT NULL AND
         "events"."judging_open_at" IS NOT NULL AND "events"."judging_close_at" IS NOT NULL)
      );
