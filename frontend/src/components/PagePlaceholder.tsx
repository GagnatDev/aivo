export interface PagePlaceholderProps {
  title: string;
  description: string;
  /** Which delivery milestone (PRD §6) brings this page to life. */
  milestone: string;
}

/** M0 stub for pages that arrive in later milestones (PRD §6 build order). */
export function PagePlaceholder({ title, description, milestone }: PagePlaceholderProps) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
      <div className="card empty-state">
        <p>Nothing here yet — this page ships with {milestone}.</p>
      </div>
    </section>
  );
}
