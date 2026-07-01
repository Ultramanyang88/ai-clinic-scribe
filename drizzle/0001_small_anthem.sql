CREATE INDEX "enc_patient_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "enc_provider_idx" ON "encounters" USING btree ("provider_id");