-- Projets de type socle : tickets communs déduits par l'IA de plusieurs
-- projets sélectionnés. `kind` vaut 'standard' ou 'foundation'.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard';
