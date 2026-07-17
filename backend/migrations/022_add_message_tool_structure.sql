-- Up Migration

-- Structured tool-turn persistence. Assistant turns that requested tools used to be
-- flattened to a "Used tool: …" text row and tool results stored as bare `tool` rows,
-- which made faithful replay impossible — buildContext had to exclude every tool row,
-- so the model forgot everything a tool returned the moment the turn ended.
--
-- `tool_calls` stores the assistant turn's requested calls (JSONB array of
-- {id, name, arguments}, mirroring the provider shape); `tool_call_id` + `tool_name`
-- link a `tool`-role result row back to the call it answers. With the linkage in
-- place, buildContext can replay recent tool exchanges verbatim. Rows from before
-- this migration keep NULLs and are simply excluded from replay (the old behavior).
ALTER TABLE messages
    ADD COLUMN tool_calls   JSONB,
    ADD COLUMN tool_call_id TEXT,
    ADD COLUMN tool_name    TEXT;
