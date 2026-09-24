export type Json = any;

type TableRow = {
  [key: string]: any;
};

type Table = {
  Row: TableRow;
  Insert: TableRow;
  Update: TableRow;
  Relationships: any[];
};

type Tables = Record<string, Table> & {
  apps: Table;
  app_visibility: Table;
  backup_records: Table;
  classes: Table;
  code_snippets: Table;
  exam_records: Table;
  exchange_records: Table;
  internet_codes: Table;
  knowledge_points: Table;
  notes: Table;
  notifications: Table;
  notification_recipients: Table;
  pet_config: Table;
  pet_foods: Table;
  pet_tips: Table;
  pets: Table;
  pk_battle_config_class_visibility: Table;
  prize_class_visibility: Table;
  prizes: Table;
  profiles: Table;
  questions: Table;
  student_answers: Table;
  student_app_usage: Table;
  student_pets: Table;
  student_word_progress: Table;
  system_config: Table;
  test_records: Table;
  tests: Table;
  user_roles: Table;
  word_list: Table;
  wrong_questions: Table;
};

export type Database = {
  public: {
    Tables: Tables;
    Enums: {
      app_role: string;
      answer_source: string;
      prize_type: string;
      question_type: string;
    };
  };
};
