ALTER TABLE "submissions" DROP CONSTRAINT "submissions_track_id_tracks_id_fk";
--> statement-breakpoint
ALTER TABLE "pairwise_comparisons" DROP CONSTRAINT "pairwise_comparisons_submission_a_id_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "pairwise_comparisons" DROP CONSTRAINT "pairwise_comparisons_submission_b_id_submissions_id_fk";
--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairwise_comparisons" ADD CONSTRAINT "pairwise_comparisons_submission_a_id_submissions_id_fk" FOREIGN KEY ("submission_a_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairwise_comparisons" ADD CONSTRAINT "pairwise_comparisons_submission_b_id_submissions_id_fk" FOREIGN KEY ("submission_b_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;