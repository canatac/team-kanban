export interface User {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface UserLite {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface Project {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface Column {
  id: string;
  project_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  column_id: string;
  title: string;
  description: string | null;
  position: number;
  assignee_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface CommentWithAuthor extends Comment {
  author_login: string;
  author_avatar: string | null;
}

export interface TaskWithComments {
  task: Task;
  comments: CommentWithAuthor[];
}

export interface ProjectDetail {
  project: Project;
  members: UserLite[];
  columns: Column[];
  tasks: Task[];
}

export interface GenerationSummary {
  columns_created: number;
  tasks_created: number;
}
