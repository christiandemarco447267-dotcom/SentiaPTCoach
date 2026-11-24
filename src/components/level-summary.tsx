import type { ExperienceAssessment } from "@/lib/experience";

/** "Your level: Developing" card with a 0–100 meter and the 1–3 reasons behind it. */
export function LevelSummary({ assessment, headingId }: { assessment: ExperienceAssessment; headingId?: string }) {
  return (
    <div className="level-card stack gap-sm">
      <div className="row between gap-sm wrap">
        <strong id={headingId}>Your level: {assessment.label}</strong>
        <span className="small muted">{assessment.score} / 100</span>
      </div>
      <div
        className="level-meter"
        role="meter"
        aria-label="Experience score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={assessment.score}
        aria-valuetext={`${assessment.score} out of 100, ${assessment.label}`}
      >
        <span style={{ width: `${Math.max(4, assessment.score)}%` }} />
      </div>
      <ul className="small muted level-reasons">
        {assessment.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
