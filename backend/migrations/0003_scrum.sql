-- Fiches Scrum sur les tickets + hiérarchie epic / story / tâche.
-- La suppression d'un parent détache ses enfants (SET NULL), la suppression
-- d'un ticket rattache sa consommation IA au projet (SET NULL sur ai_usage.task_id)
-- pour que le total projet reste exact.
ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'task';
ALTER TABLE tasks ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN user_story TEXT;
ALTER TABLE tasks ADD COLUMN context TEXT;
ALTER TABLE tasks ADD COLUMN expected_results JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN acceptance_criteria JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN definition_of_done JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN technical_notes TEXT;
ALTER TABLE tasks ADD COLUMN story_points INT;
CREATE INDEX tasks_parent_idx ON tasks (parent_task_id);

ALTER TABLE ai_usage ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX ai_usage_task_idx ON ai_usage (task_id);
