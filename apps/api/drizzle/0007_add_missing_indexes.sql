CREATE INDEX "submissions_track_status_idx" ON "submissions" USING btree ("track_id","status");--> statement-breakpoint
CREATE INDEX "judge_assignments_judge_status_idx" ON "judge_assignments" USING btree ("judge_user_id","status");--> statement-breakpoint
CREATE INDEX "scores_rubric_submitted_idx" ON "scores" USING btree ("rubric_id","status") WHERE "scores"."status" = 'submitted';--> statement-breakpoint
CREATE INDEX "audit_log_event_created_idx" ON "audit_log_entries" USING btree ("event_id","created_at");
