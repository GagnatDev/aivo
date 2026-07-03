-- Up Migration

-- Reactions + freeform replies folded back into the interest profile
-- (docs/data-model.md). Button signals (keep | drop | too_long | wrong_topic) land
-- with their digest_item_id; freeform replies land with signal = freeform (and a null
-- digest_item_id when the feedback is global rather than about one entry). `applied`
-- flips once the next digest run folds the row into a profile update. The user's
-- keep/drop vocabulary is deliberately distinct from the system's pick/reject —
-- keep/drop records whether the user AGREED with a decision, which is what the
-- cold-start rejected-list taper measures.
CREATE TABLE feedback (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    digest_item_id UUID REFERENCES digest_items(id) ON DELETE SET NULL,
    signal         TEXT NOT NULL,   -- keep | drop | too_long | wrong_topic | freeform
    freeform_text  TEXT,
    applied        BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feedback_user_created_idx ON feedback (user_id, created_at);
