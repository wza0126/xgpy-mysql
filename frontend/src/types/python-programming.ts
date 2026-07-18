// Python编程模块类型定义

export interface PythonTask {
  id: string;
  title: string;
  description?: string;
  task_type: 'code' | 'fill_blank';
  class_ids?: string[] | string;
  total_score: number;
  deadline?: string;
  allow_late_submission: boolean;
  allow_run_code: boolean;
  max_run_seconds: number;
  reference_code?: string;
  expected_output?: string;
  hint?: string;
  required_keywords?: string[] | string;
  is_active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface PythonDraft {
  id: string;
  student_id: string;
  title: string;
  code?: string;
  task_id?: string;
  last_run_output?: string;
  created_at: string;
  updated_at: string;
}

export interface PythonSubmission {
  id: string;
  task_id: string;
  student_id: string;
  code: string;
  submitted_at: string;
  is_late: boolean;
  status: 'unsubmitted' | 'submitted' | 'graded' | 'resubmitted';
}

export interface PythonGrading {
  id: string;
  submission_id: string;
  task_id: string;
  student_id: string;
  total_score: number;
  syntax_score: number;
  output_score: number;
  logic_score: number;
  comment?: string;
  syntax_errors?: any[] | string;
  output_diff?: string;
  missing_keywords?: string[] | string;
  is_ai_graded: boolean;
  manually_adjusted: boolean;
  adjusted_score?: number;
  adjusted_by?: string;
  adjusted_comment?: string;
  show_reference_code: boolean;
  graded_at: string;
  updated_at: string;
}

export interface PythonRunLog {
  id: string;
  student_id: string;
  code?: string;
  code_hash?: string;
  input_data?: string;
  actual_output?: string;
  error_output?: string;
  execution_time_ms?: number;
  memory_used_kb?: number;
  status: 'success' | 'syntax_error' | 'runtime_error' | 'timeout' | 'blocked';
  blocked_reason?: string;
  run_at: string;
}

export interface PythonWrongProblem {
  id: string;
  student_id: string;
  task_id: string;
  submission_id?: string;
  error_type?: string;
  error_detail?: string;
  is_resolved: boolean;
  resolved_at?: string;
  wrong_count: number;
  last_wrong_at: string;
  created_at: string;
}

export interface RunCodeRequest {
  code: string;
  input?: string;
}

export interface RunCodeResponse {
  success: boolean;
  output?: string;
  error?: string;
  execution_time_ms?: number;
  status: string;
}

export interface GradeSubmissionRequest {
  submission_id: string;
}

export interface GradeSubmissionResponse {
  success: boolean;
  grading?: PythonGrading;
  error?: string;
}
