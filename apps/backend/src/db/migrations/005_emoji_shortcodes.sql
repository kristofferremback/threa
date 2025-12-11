-- Migration: Convert emoji storage to shortcode format
-- All emoji are now stored as :shortcode: instead of raw Unicode

-- Convert Ariadne's avatar emoji to shortcode
UPDATE personas SET avatar_emoji = ':thread:' WHERE avatar_emoji = '🧵';

-- Convert any existing reactions to shortcodes
-- Common reactions mapping (add more as needed)
UPDATE reactions SET emoji = ':+1:' WHERE emoji = '👍';
UPDATE reactions SET emoji = ':-1:' WHERE emoji = '👎';
UPDATE reactions SET emoji = ':heart:' WHERE emoji = '❤️' OR emoji = '❤';
UPDATE reactions SET emoji = ':joy:' WHERE emoji = '😂';
UPDATE reactions SET emoji = ':tada:' WHERE emoji = '🎉';
UPDATE reactions SET emoji = ':fire:' WHERE emoji = '🔥';
UPDATE reactions SET emoji = ':eyes:' WHERE emoji = '👀';
UPDATE reactions SET emoji = ':100:' WHERE emoji = '💯';
UPDATE reactions SET emoji = ':rocket:' WHERE emoji = '🚀';
UPDATE reactions SET emoji = ':sparkles:' WHERE emoji = '✨';
UPDATE reactions SET emoji = ':clap:' WHERE emoji = '👏';
UPDATE reactions SET emoji = ':thinking:' WHERE emoji = '🤔';
UPDATE reactions SET emoji = ':white_check_mark:' WHERE emoji = '✅';
UPDATE reactions SET emoji = ':x:' WHERE emoji = '❌';

-- Update reactions in the messages projection JSONB column
-- This is more complex because reactions are stored as { emoji: [user_ids] }
-- We need to update the keys in the JSONB object
UPDATE messages
SET reactions = (
  SELECT COALESCE(
    jsonb_object_agg(
      CASE key
        WHEN '👍' THEN ':+1:'
        WHEN '👎' THEN ':-1:'
        WHEN '❤️' THEN ':heart:'
        WHEN '❤' THEN ':heart:'
        WHEN '😂' THEN ':joy:'
        WHEN '🎉' THEN ':tada:'
        WHEN '🔥' THEN ':fire:'
        WHEN '👀' THEN ':eyes:'
        WHEN '💯' THEN ':100:'
        WHEN '🚀' THEN ':rocket:'
        WHEN '✨' THEN ':sparkles:'
        WHEN '👏' THEN ':clap:'
        WHEN '🤔' THEN ':thinking:'
        WHEN '✅' THEN ':white_check_mark:'
        WHEN '❌' THEN ':x:'
        ELSE key
      END,
      value
    ),
    '{}'::jsonb
  )
  FROM jsonb_each(messages.reactions)
)
WHERE reactions != '{}'::jsonb;
