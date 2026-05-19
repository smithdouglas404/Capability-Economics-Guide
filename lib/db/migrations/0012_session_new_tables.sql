-- 0012_session_new_tables.sql
--
-- Idempotent CREATE TABLE IF NOT EXISTS for every new table added to the
-- schema in this session (Move 6-13 + portfolio). Ensures the tables exist
-- in Postgres BEFORE drizzle-kit's --force schema push runs, so drizzle-kit
-- sees them as already-present and doesn't hit the interactive
-- "create vs rename" prompt that has been crashing the deploy on each
-- new schema file added (see 0010 and 0011 for the same pattern).
--
-- Tables created here:
--   uploaded_analyses
--   user_interaction_log
--   user_learning_profiles
--   ai_feedback
--   forum_threads
--   forum_posts
--   member_profiles
--   member_experience
--   member_education
--   member_skills
--   member_skill_endorsements
--   member_posts
--   member_post_reactions
--   member_post_comments
--   member_connections
--
-- The exact column shapes mirror the drizzle declarations in
-- lib/db/src/schema/{uploaded-analyses,user-learning,forums,member-profiles}.ts.
-- Each block is wrapped in CREATE TABLE IF NOT EXISTS so re-runs are a no-op.

CREATE TABLE IF NOT EXISTS uploaded_analyses (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  filename     TEXT NOT NULL,
  file_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  extracted    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_interaction_log (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  label       TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interaction_log_user_type_idx ON user_interaction_log (user_id, type, created_at);
CREATE INDEX IF NOT EXISTS interaction_log_user_created_idx ON user_interaction_log (user_id, created_at);

CREATE TABLE IF NOT EXISTS user_learning_profiles (
  id                    SERIAL PRIMARY KEY,
  user_id               TEXT NOT NULL,
  persona               TEXT,
  top_industries        JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_capabilities      JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_topics            JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_ai_generations  INTEGER NOT NULL DEFAULT 0,
  total_page_views      INTEGER NOT NULL DEFAULT 0,
  last_visited_at       TIMESTAMP,
  onboarding_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  vector                DOUBLE PRECISION[],
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_learning_profiles_user_unique ON user_learning_profiles (user_id);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id                   SERIAL PRIMARY KEY,
  user_id              TEXT NOT NULL,
  interaction_log_id   INTEGER NOT NULL,
  liked                BOOLEAN NOT NULL,
  comment              TEXT,
  endpoint             TEXT,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_feedback_user_idx ON ai_feedback (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_interaction_unique ON ai_feedback (user_id, interaction_log_id);

CREATE TABLE IF NOT EXISTS forum_threads (
  id                   SERIAL PRIMARY KEY,
  industry_id          INTEGER NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
  capability_id        INTEGER REFERENCES capabilities(id) ON DELETE SET NULL,
  author_user_id       TEXT NOT NULL,
  author_display_name  TEXT,
  title                TEXT NOT NULL,
  body                 TEXT NOT NULL,
  locked_at            TIMESTAMP,
  post_count           INTEGER NOT NULL DEFAULT 0,
  last_post_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS forum_threads_industry_idx ON forum_threads (industry_id, last_post_at);
CREATE INDEX IF NOT EXISTS forum_threads_capability_idx ON forum_threads (capability_id);
CREATE INDEX IF NOT EXISTS forum_threads_author_idx ON forum_threads (author_user_id);

CREATE TABLE IF NOT EXISTS forum_posts (
  id                   SERIAL PRIMARY KEY,
  thread_id            INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_user_id       TEXT NOT NULL,
  author_display_name  TEXT,
  body                 TEXT NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS forum_posts_thread_idx ON forum_posts (thread_id, created_at);
CREATE INDEX IF NOT EXISTS forum_posts_author_idx ON forum_posts (author_user_id);

CREATE TABLE IF NOT EXISTS member_profiles (
  id                  SERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  slug                TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  headline            TEXT,
  bio                 TEXT,
  avatar_url          TEXT,
  cover_image_url     TEXT,
  location            TEXT,
  current_role        TEXT,
  open_to             JSONB NOT NULL DEFAULT '[]'::jsonb,
  website_url         TEXT,
  linkedin_url        TEXT,
  industry_slugs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  capability_tags     JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_visibility   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_user_unique ON member_profiles (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_profiles_slug_unique ON member_profiles (slug);

CREATE TABLE IF NOT EXISTS member_experience (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT,
  employment_type TEXT,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  description     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_experience_user_idx ON member_experience (user_id);

CREATE TABLE IF NOT EXISTS member_education (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  school      TEXT NOT NULL,
  degree      TEXT,
  field       TEXT,
  start_year  INTEGER,
  end_year    INTEGER,
  activities  TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_education_user_idx ON member_education (user_id);

CREATE TABLE IF NOT EXISTS member_skills (
  id                 SERIAL PRIMARY KEY,
  user_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  endorsement_count  INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_skills_user_idx ON member_skills (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_skills_user_name_unique ON member_skills (user_id, name);

CREATE TABLE IF NOT EXISTS member_skill_endorsements (
  id                SERIAL PRIMARY KEY,
  skill_id          INTEGER NOT NULL REFERENCES member_skills(id) ON DELETE CASCADE,
  endorser_user_id  TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_skill_endorsements_skill_idx ON member_skill_endorsements (skill_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_skill_endorsements_unique ON member_skill_endorsements (skill_id, endorser_user_id);

CREATE TABLE IF NOT EXISTS member_posts (
  id                SERIAL PRIMARY KEY,
  author_user_id    TEXT NOT NULL,
  body              TEXT NOT NULL,
  link_url          TEXT,
  image_url         TEXT,
  capability_tags   JSONB NOT NULL DEFAULT '[]'::jsonb,
  industry_slugs    JSONB NOT NULL DEFAULT '[]'::jsonb,
  like_count        INTEGER NOT NULL DEFAULT 0,
  comment_count     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_posts_author_idx ON member_posts (author_user_id, created_at);
CREATE INDEX IF NOT EXISTS member_posts_created_idx ON member_posts (created_at);

CREATE TABLE IF NOT EXISTS member_post_reactions (
  id          SERIAL PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES member_posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_post_reactions_unique ON member_post_reactions (post_id, user_id);

CREATE TABLE IF NOT EXISTS member_post_comments (
  id              SERIAL PRIMARY KEY,
  post_id         INTEGER NOT NULL REFERENCES member_posts(id) ON DELETE CASCADE,
  author_user_id  TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_post_comments_post_idx ON member_post_comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS member_connections (
  id            SERIAL PRIMARY KEY,
  user_a        TEXT NOT NULL,
  user_b        TEXT NOT NULL,
  requested_by  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS member_connections_pair_unique ON member_connections (user_a, user_b);
CREATE INDEX IF NOT EXISTS member_connections_user_a_idx ON member_connections (user_a);
CREATE INDEX IF NOT EXISTS member_connections_user_b_idx ON member_connections (user_b);
