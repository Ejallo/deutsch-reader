-- Friends' accounts and synced data (Cloudflare D1)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,        -- Google account id (sub)
  email TEXT,
  name TEXT,
  created INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, -- SHA-256 of the session token; the token itself is never stored
  user_id TEXT NOT NULL,
  created INTEGER,
  user_agent TEXT,             -- browser/device of the latest request on this session
  last_seen INTEGER
);
-- Migration for existing databases (run once):
-- ALTER TABLE sessions ADD COLUMN user_agent TEXT;
-- ALTER TABLE sessions ADD COLUMN last_seen INTEGER;

CREATE TABLE IF NOT EXISTS data (
  user_id TEXT PRIMARY KEY,
  body BLOB NOT NULL,          -- gzipped JSON of the app data
  version INTEGER NOT NULL,
  updated INTEGER
);
