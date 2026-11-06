import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../api';
import type { Project } from '../types';

export default function ProjectsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await api.createProject(name.trim());
      setProjects((prev) => (prev ? [project, ...prev] : [project]));
      setName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
        <TextField
          fullWidth
          label="Nouveau projet"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
        <Button variant="contained" onClick={() => void create()} disabled={busy || !name.trim()}>
          Créer
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {(projects ?? []).map((p) => (
          <Card
            key={p.id}
            onClick={() => onSelect(p.id)}
            sx={{ width: 260, cursor: 'pointer', '&:hover': { boxShadow: 6 } }}
          >
            <CardContent>
              <Typography variant="h6">{p.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                créé le {new Date(p.created_at).toLocaleDateString('fr-FR')}
              </Typography>
            </CardContent>
          </Card>
        ))}
        {projects !== null && projects.length === 0 && (
          <Typography color="text.secondary">
            Aucun projet pour l'instant. Créez-en un ci-dessus.
          </Typography>
        )}
      </Box>
    </Container>
  );
}
