-- Roadmap : priorité métier des tickets (1 = priorité maximale).
-- Fixée par l'IA (fiche Scrum, découpage, génération en masse) à partir du
-- besoin métier défini au départ ; sert au tri de la vue Roadmap.
ALTER TABLE tasks ADD COLUMN priority INT;
