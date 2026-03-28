-- Defense-in-depth: unique hash prevents collision or code bugs from
-- silently sharing a key value across rows.
CREATE UNIQUE INDEX idx_user_api_keys_hash ON user_api_keys (key_hash);
