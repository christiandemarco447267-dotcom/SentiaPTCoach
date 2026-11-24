"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { AVATAR_COLORS, EXPERIENCE_OPTIONS, FOCUS_OPTIONS, initialsOf, avatarInk } from "@/lib/profile";
import { assessExperience, behaviorFromState } from "@/lib/experience";
import type { ProfileInput } from "@/lib/storage";
import type { ExperienceSignal, FocusArea, Profile } from "@/lib/types";
import { LevelSummary } from "./level-summary";
import { MultiChoice } from "./multi-choice";
import { SIM_DISCLAIMER } from "@/lib/site";

export function ProfileSetup() {
  const { profileSetupOpen, closeProfileSetup, state, actions } = useApp();
  if (!profileSetupOpen || !state) return null;

  return (
    <ProfileSetupDialog
      initialName={state.profileName}
      initialColor={state.profile.avatarColor || AVATAR_COLORS[0]}
      initialExperiences={state.profile.experiences}
      initialFocuses={state.profile.focuses}
      goals={state.profile.goals}
      behavior={behaviorFromState(state)}
      onSave={(input) => {
        actions.saveProfile(input);
        closeProfileSetup();
      }}
    />
  );
}

function ProfileSetupDialog({
  initialName,
  initialColor,
  initialExperiences,
  initialFocuses,
  goals,
  behavior,
  onSave,
}: {
  initialName: string;
  initialColor: string;
  initialExperiences: readonly ExperienceSignal[];
  initialFocuses: readonly FocusArea[];
  goals: Profile["goals"];
  behavior: ReturnType<typeof behaviorFromState>;
  onSave: (input: ProfileInput) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [avatarColor, setAvatarColor] = useState(initialColor);
  const [experiences, setExperiences] = useState<ExperienceSignal[]>([...initialExperiences]);
  const [focuses, setFocuses] = useState<FocusArea[]>([...initialFocuses]);

  const TOTAL = 4;
  const isLast = step === TOTAL - 1;
  const initials = initialsOf(name) || "?";

  const save = () => onSave({ name, avatarColor, experiences, focuses });
  const assessment = assessExperience({ experiences, focuses, goals }, behavior);

  // Escape behaves like "Skip" (saves what's entered so far and closes).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") saveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) save();
      }}
    >
      <div className="modal stack gap-md" role="dialog" aria-modal="true" aria-label="Set up your profile">
        <div className="row between">
          <span className="eyebrow">
            Set up your profile · {step + 1} of {TOTAL}
          </span>
          <button type="button" className="btn btn-sm" onClick={save} aria-label="Skip profile setup">
            Skip
          </button>
        </div>

        {step === 0 ? (
          <div className="stack gap-md">
            <div className="row gap-md" style={{ alignItems: "center" }}>
              <span className="avatar avatar-lg" style={{ background: avatarColor, color: avatarInk(avatarColor) }}>
                {initials}
              </span>
              <div className="stack" style={{ gap: 2 }}>
                <h2 style={{ fontSize: "1.4rem" }}>Create your profile</h2>
                <span className="small muted">This stays private, on this device.</span>
              </div>
            </div>
            <p className="sim-disclaimer" role="note">
              {SIM_DISCLAIMER}
            </p>
            <div className="field">
              <label htmlFor="setup-name">Your name</label>
              <input
                id="setup-name"
                name="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex"
                maxLength={40}
                autoFocus
              />
            </div>
            <div className="field">
              <label id="setup-color-label">Pick an avatar color</label>
              <div className="row gap-sm wrap" role="group" aria-labelledby="setup-color-label">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Avatar color ${color}`}
                    aria-pressed={color === avatarColor}
                    className={clsx("swatch", color === avatarColor && "selected")}
                    style={{ background: color }}
                    onClick={() => setAvatarColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="stack gap-md">
            <h2 id="setup-exp-title" style={{ fontSize: "1.4rem" }}>
              How much investing experience do you have?
            </h2>
            <span className="small muted">Pick up to 3 that describe you. Mixed answers are fine.</span>
            <MultiChoice options={EXPERIENCE_OPTIONS} selected={experiences} onChange={setExperiences} labelledBy="setup-exp-title" />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack gap-md">
            <h2 id="setup-focus-title" style={{ fontSize: "1.4rem" }}>
              What do you want to focus on?
            </h2>
            <MultiChoice options={FOCUS_OPTIONS} selected={focuses} onChange={setFocuses} labelledBy="setup-focus-title" />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack gap-md">
            <h2 id="setup-level-title" style={{ fontSize: "1.4rem" }}>
              Here&apos;s where you&apos;re starting
            </h2>
            <LevelSummary assessment={assessment} />
            <span className="small dim">
              The coach pitches its explanations at this level. It updates as you practise, and you can redo setup anytime from Settings.
            </span>
          </div>
        ) : null}

        <div className="row between" style={{ marginTop: 4 }}>
          <div className="tour-dots" aria-hidden="true">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <span key={i} className={clsx("tour-dot", i === step && "active")} />
            ))}
          </div>
          <div className="row gap-sm">
            {step > 0 ? (
              <button type="button" className="btn btn-sm" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => (isLast ? save() : setStep((s) => s + 1))}
            >
              {isLast ? "Finish setup" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
