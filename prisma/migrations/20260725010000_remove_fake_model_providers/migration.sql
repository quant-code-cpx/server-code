DELETE FROM "ai_model_providers"
WHERE "kind" = 'fake'
   OR "model" LIKE 'fake-%';
