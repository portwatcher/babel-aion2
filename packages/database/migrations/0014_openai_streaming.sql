-- Clear only defaults that depend on the retired provider paths.
UPDATE room SET default_output_language = NULL
WHERE default_output_language IN (
  SELECT code FROM output_language
  WHERE recognition_configuration_id IN
          (SELECT id FROM provider_configuration WHERE provider_type <> 'openai')
     OR translation_configuration_id IN
          (SELECT id FROM provider_configuration WHERE provider_type <> 'openai')
);
--> statement-breakpoint
-- Retire unsupported processing paths before removing their protected credentials.
UPDATE output_language
SET enabled = false,
    recognition_configuration_id = NULL,
    translation_configuration_id = NULL,
    path_validated_at = NULL,
    validation = NULL,
    last_attempt = NULL,
    version = version + 1,
    path_version = path_version + 1
WHERE recognition_configuration_id IN
        (SELECT id FROM provider_configuration WHERE provider_type <> 'openai')
   OR translation_configuration_id IN
        (SELECT id FROM provider_configuration WHERE provider_type <> 'openai');
--> statement-breakpoint
DELETE FROM provider_configuration WHERE provider_type <> 'openai';
--> statement-breakpoint
UPDATE language_catalog SET version = version + 1 WHERE id = 'global';
