// A Space's colors, like an Arc Space's. Kept free of imports: the web UI
// reads it too, and the contract's server SDK can't enter the app bundle.

/** The colors offered when picking one, and handed out in turn to new Spaces. */
export const SPACE_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#14b8a6", "#eab308", "#ef4444", "#64748b"] as const;
