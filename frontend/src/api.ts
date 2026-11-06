import type {
  Column,
  Comment,
  GenerationSummary,
  Project,
  ProjectDetail,
  ScrumResult,
  SplitResult,
  Task,
  TaskWithComments,
  User,
  UserLite,
} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new ApiError(401, 'Non authentifié');
  }
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Comme req(), mais pour multipart/form-data : le navigateur fixe
// lui-même l'en-tête Content-Type (boundary), il ne faut PAS le définir.
async function reqForm(path: string, form: FormData): Promise<any> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', body: form });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new ApiError(401, 'Non authentifié');
  }
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

export const api = {
  me: () => req('/api/me') as Promise<User>,
  logout: () => req('/api/auth/logout', { method: 'POST' }),

  listProjects: () => req('/api/projects') as Promise<Project[]>,
  createProject: (name: string) =>
    req('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }) as Promise<Project>,
  getProject: (id: string) => req(`/api/projects/${id}`) as Promise<ProjectDetail>,
  addMember: (projectId: string, login: string) =>
    req(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ login }),
    }) as Promise<UserLite>,
  removeMember: (projectId: string, userId: string) =>
    req(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  createColumn: (projectId: string, name: string) =>
    req(`/api/projects/${projectId}/columns`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }) as Promise<Column>,
  renameColumn: (columnId: string, name: string) =>
    req(`/api/columns/${columnId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteColumn: (columnId: string) => req(`/api/columns/${columnId}`, { method: 'DELETE' }),

  getTask: (taskId: string) => req(`/api/tasks/${taskId}`) as Promise<TaskWithComments>,
  createTask: (projectId: string, columnId: string, title: string) =>
    req(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ column_id: columnId, title }),
    }) as Promise<Task>,
  updateTask: (
    taskId: string,
    patch: {
      title: string;
      description: string | null;
      column_id: string;
      position: number;
      assignee_id: string | null;
    },
  ) => req(`/api/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (taskId: string) => req(`/api/tasks/${taskId}`, { method: 'DELETE' }),

  addComment: (taskId: string, body: string) =>
    req(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }) as Promise<Comment>,
  deleteComment: (commentId: string) => req(`/api/comments/${commentId}`, { method: 'DELETE' }),

  generateTasks: (projectId: string, prompt: string, files: File[]) => {
    const form = new FormData();
    form.append('prompt', prompt);
    for (const f of files) form.append('files', f, f.name);
    return reqForm(`/api/projects/${projectId}/generate`, form) as Promise<GenerationSummary>;
  },

  scrumTask: (taskId: string) =>
    req(`/api/tasks/${taskId}/scrum`, { method: 'POST' }) as Promise<ScrumResult>,

  splitTask: (taskId: string) =>
    req(`/api/tasks/${taskId}/split`, { method: 'POST' }) as Promise<SplitResult>,
};
