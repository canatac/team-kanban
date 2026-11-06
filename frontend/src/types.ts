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

export type TaskType = 'epic' | 'story' | 'task' | 'bug';

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
  task_type: TaskType;
  parent_task_id: string | null;
  user_story: string | null;
  context: string | null;
  expected_results: string[];
  acceptance_criteria: string[];
  definition_of_done: string[];
  technical_notes: string | null;
  story_points: number | null;
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
  ai_usage: AiUsage;
}

export interface AiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cost_eur: number;
}

export interface ProjectDetail {
  project: Project;
  members: UserLite[];
  columns: Column[];
  tasks: Task[];
  ai_usage: AiUsage;
}

export interface GenerationSummary {
  columns_created: number;
  tasks_created: number;
}

export interface ScrumResult {
  task: Task;
  split_recommendation: boolean;
  split_reason: string;
}

export interface SplitResult {
  created: Task[];
}
