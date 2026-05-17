-- Add workflow_status separate from hydra_status; backfill existing rows to "complete".
ALTER TABLE sources ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'pending';
UPDATE sources SET workflow_status = 'complete' WHERE workflow_status = 'pending' AND hydra_status IN ('success');
UPDATE sources SET workflow_status = 'failed_fetch' WHERE hydra_status = 'failed_fetch';
UPDATE sources SET workflow_status = 'failed_upload' WHERE hydra_status = 'failed_upload';
UPDATE sources SET hydra_status = 'errored' WHERE hydra_status IN ('hydra_errored', 'failed_fetch', 'failed_upload');
