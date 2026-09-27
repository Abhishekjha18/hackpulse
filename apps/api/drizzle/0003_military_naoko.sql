CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_key_id" text NOT NULL,
	"public_key_der" text NOT NULL,
	"private_key_der" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_keys_public_key_id_unique" UNIQUE("public_key_id")
);
