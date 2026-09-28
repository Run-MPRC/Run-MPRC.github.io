import React, { useState } from 'react';
import {
  Consent,
  OPTIONS,
  previewCard,
  ProfileState,
  readProfile,
  RunnerProfile,
} from '../../services/account/runnerConnectionContract';
import RunnerCard, {
  DAYS, label, paceText, timeText
} from './RunnerCard';

function blankProfile(): RunnerProfile {
  return {
    displayName: '',
    pace: { unit: 'min/mile', fastSeconds: 0, slowSeconds: 0 },
    distance: { minMetres: 0, maxMetres: 0 },
    availability: [{ day: 6, startMinute: 480, endMinute: 660 }],
    areas: [],
    terrains: [],
    styles: [],
    goals: [],
    experience: '',
    experiencePreferences: [...OPTIONS.experience],
    interests: [],
  };
}
function seconds(value: string): number {
  if (!/^\d{1,2}:[0-5]\d$/.test(value)) return NaN;
  const [paceMinutes, remainder] = value.split(':').map(Number);
  return paceMinutes * 60 + remainder;
}
function minutes(value: string): number {
  if (!/^\d{2}:[0-5]\d$/.test(value)) return NaN;
  const [hours, remainder] = value.split(':').map(Number);
  return hours * 60 + remainder;
}
function Choices({
  name,
  title,
  options,
  selected,
  maximum,
  onChange,
}: {
  name: string;
  title: string;
  options: readonly string[];
  selected: string[];
  maximum: number;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="runner-options">
      <legend>{title}</legend>
      {options.map((option) => (
        <label key={option} htmlFor={`runner-${name}-${option}`}>
          <input
            id={`runner-${name}-${option}`}
            type="checkbox"
            checked={selected.includes(option)}
            disabled={!selected.includes(option) && selected.length >= maximum}
            onChange={(event) => onChange(
              event.target.checked
                ? [...selected, option]
                : selected.filter((item) => item !== option),
            )}
          />
          {label(option)}
        </label>
      ))}
    </fieldset>
  );
}
export default function RunnerProfileForm({
  initial,
  disabled,
  onSave,
}: {
  initial: ProfileState;
  disabled: boolean;
  onSave: (profile: RunnerProfile, consent: Consent) => void;
}) {
  const [draft, setDraft] = useState<RunnerProfile>(() => initial.profile || blankProfile());
  const [fast, setFast] = useState(
    initial.profile ? paceText(initial.profile.pace.fastSeconds) : '',
  );
  const [slow, setSlow] = useState(
    initial.profile ? paceText(initial.profile.pace.slowSeconds) : '',
  );
  const [consent, setConsent] = useState(initial.consent);
  const [adult, setAdult] = useState(initial.adultConfirmed);
  const [preview, setPreview] = useState<RunnerProfile | null>(null);
  const [error, setError] = useState('');
  function update(next: RunnerProfile) {
    setDraft(next);
    setPreview(null);
    setError('');
  }
  function showPreview(event: React.FormEvent) {
    event.preventDefault();
    try {
      const profile = readProfile({
        ...draft,
        pace: { ...draft.pace, fastSeconds: seconds(fast), slowSeconds: seconds(slow) },
      });
      setPreview(profile);
      setError('');
    } catch {
      setPreview(null);
      setError(
        'Review your name, pace (minutes:seconds), distance, time windows and required choices. Ranges must be ordered and time windows must not overlap.',
      );
    }
  }
  return (
    <form onSubmit={showPreview} className="runner-form">
      <fieldset disabled={disabled}>
        <legend>Your runner card</legend>
        <p>
          Only these chosen card fields are shared. Do not put contact details or private
          information in your display name.
        </p>
        <label htmlFor="runner-name">
          Display name
          <input
            id="runner-name"
            maxLength={60}
            required
            value={draft.displayName}
            autoComplete="off"
            onChange={(event) => update({ ...draft, displayName: event.target.value })}
          />
        </label>
        <div className="runner-fields">
          <label htmlFor="runner-unit">
            Pace unit
            <select
              id="runner-unit"
              value={draft.pace.unit}
              onChange={(event) => {
                update({
                  ...draft,
                  pace: { ...draft.pace, unit: event.target.value as 'min/km' | 'min/mile' },
                });
                setFast('');
                setSlow('');
              }}
            >
              <option>min/mile</option>
              <option>min/km</option>
            </select>
          </label>
          <label htmlFor="runner-fast">
            Faster easy pace (m:ss)
            <input
              id="runner-fast"
              required
              placeholder="8:00"
              value={fast}
              onChange={(event) => {
                setFast(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label htmlFor="runner-slow">
            Slower easy pace (m:ss)
            <input
              id="runner-slow"
              required
              placeholder="10:00"
              value={slow}
              onChange={(event) => {
                setSlow(event.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label htmlFor="runner-min-distance">
            Shortest run (km)
            <input
              id="runner-min-distance"
              required
              type="number"
              min="0.5"
              max="50"
              step="0.1"
              value={draft.distance.minMetres / 1000 || ''}
              onChange={(event) => update({
                ...draft,
                distance: {
                  ...draft.distance,
                  minMetres: Math.round(Number(event.target.value) * 1000),
                },
              })}
            />
          </label>
          <label htmlFor="runner-max-distance">
            Longest run (km)
            <input
              id="runner-max-distance"
              required
              type="number"
              min="0.5"
              max="50"
              step="0.1"
              value={draft.distance.maxMetres / 1000 || ''}
              onChange={(event) => update({
                ...draft,
                distance: {
                  ...draft.distance,
                  maxMetres: Math.round(Number(event.target.value) * 1000),
                },
              })}
            />
          </label>
        </div>
        <p>
          Use your comfortable easy pace, not a race best. Supported pace is equivalent to
          2:00–30:00 min/km. Changing units clears the pace fields so they cannot be
          misinterpreted.
        </p>
        <fieldset>
          <legend>Usual availability — Pacific time</legend>
          <p>
            Review the suggested Saturday window. Availability does not confirm attendance at a
            club run.
          </p>
          {draft.availability.map((window, index) => (
            // Windows have positional identity only while editing this bounded form.
            // eslint-disable-next-line react/no-array-index-key
            <div className="runner-fields" key={index}>
              <label htmlFor={`runner-day-${index}`}>
                {`Day ${index + 1}`}
                <select
                  id={`runner-day-${index}`}
                  value={window.day}
                  onChange={(event) => update({
                    ...draft,
                    availability: draft.availability.map((item, i) => (
                      i === index ? { ...item, day: Number(event.target.value) } : item
                    )),
                  })}
                >
                  {DAYS.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`runner-start-${index}`}>
                {`Start ${index + 1}`}
                <input
                  id={`runner-start-${index}`}
                  required
                  type="time"
                  value={timeText(window.startMinute)}
                  onChange={(event) => update({
                    ...draft,
                    availability: draft.availability.map((item, i) => (i === index
                      ? { ...item, startMinute: minutes(event.target.value) }
                      : item),),
                  })}
                />
              </label>
              <label htmlFor={`runner-end-${index}`}>
                {`End ${index + 1}`}
                <select
                  id={`runner-end-${index}`}
                  value={window.endMinute}
                  onChange={(event) => update({
                    ...draft,
                    availability: draft.availability.map((item, i) => (i === index
                      ? { ...item, endMinute: Number(event.target.value) }
                      : item),),
                  })}
                >
                  {Array.from(
                    new Set([
                      window.endMinute,
                      ...Array.from({ length: 96 }, (_, i) => (i + 1) * 15),
                    ]),
                  )
                    .sort((a, b) => a - b)
                    .map((end) => (
                      <option key={end} value={end}>
                        {timeText(end)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={draft.availability.length === 1}
                onClick={() => update({
                  ...draft,
                  availability: draft.availability.filter((_, i) => i !== index),
                })}
              >
                {`Remove window ${index + 1}`}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={draft.availability.length >= 7}
            onClick={() => update({
              ...draft,
              availability: [
                ...draft.availability,
                { day: 0, startMinute: 480, endMinute: 660 },
              ],
            })}
          >
            Add time window
          </button>
        </fieldset>
        <Choices
          name="areas"
          title="Running areas — choose 1–3"
          options={OPTIONS.areas}
          selected={draft.areas}
          maximum={3}
          onChange={(areas) => update({ ...draft, areas })}
        />
        <Choices
          name="terrains"
          title="Terrain — choose at least one"
          options={OPTIONS.terrains}
          selected={draft.terrains}
          maximum={2}
          onChange={(terrains) => update({ ...draft, terrains })}
        />
        <Choices
          name="styles"
          title="Running style — choose at least one"
          options={OPTIONS.styles}
          selected={draft.styles}
          maximum={3}
          onChange={(styles) => update({ ...draft, styles })}
        />
        <Choices
          name="goals"
          title="Goals — choose 1–5"
          options={OPTIONS.goals}
          selected={draft.goals}
          maximum={5}
          onChange={(goals) => update({ ...draft, goals })}
        />
        <label htmlFor="runner-experience">
          Your running experience
          <select
            id="runner-experience"
            required
            value={draft.experience}
            onChange={(event) => update({ ...draft, experience: event.target.value })}
          >
            <option value="">Choose your experience</option>
            {OPTIONS.experience.map((option) => (
              <option key={option} value={option}>
                {label(option)}
              </option>
            ))}
          </select>
        </label>
        <Choices
          name="preferences"
          title="Experience you are comfortable running with — private matching preference"
          options={OPTIONS.experience}
          selected={draft.experiencePreferences}
          maximum={4}
          onChange={(experiencePreferences) => update({ ...draft, experiencePreferences })}
        />
        <Choices
          name="interests"
          title="Optional interests — choose up to four"
          options={OPTIONS.interests}
          selected={draft.interests}
          maximum={4}
          onChange={(interests) => update({ ...draft, interests })}
        />
        <fieldset className="runner-options">
          <legend>Age and sharing choices</legend>
          <label htmlFor="runner-adult">
            <input
              id="runner-adult"
              type="checkbox"
              checked={adult}
              onChange={(event) => setAdult(event.target.checked)}
            />
            I confirm I am 18 or older
          </label>
          <p>
            This is your confirmation, not age or identity verification. Current club
            membership is checked separately.
          </p>
          <label htmlFor="runner-discovery">
            <input
              id="runner-discovery"
              type="checkbox"
              checked={consent.memberDiscovery}
              onChange={(event) => setConsent(
                event.target.checked
                  ? { ...consent, memberDiscovery: true }
                  : { memberDiscovery: false, similarity: false, broadenCircle: false },
              )}
            />
            Let participating adult MPRC members see this runner card
          </label>
          <label htmlFor="runner-similarity">
            <input
              id="runner-similarity"
              type="checkbox"
              checked={consent.similarity}
              disabled={!consent.memberDiscovery}
              onChange={(event) => setConsent({ ...consent, similarity: event.target.checked })}
            />
            Use my card for similar-runner suggestions
          </label>
          <label htmlFor="runner-broaden">
            <input
              id="runner-broaden"
              type="checkbox"
              checked={consent.broadenCircle}
              disabled={!consent.memberDiscovery}
              onChange={(event) => setConsent({ ...consent, broadenCircle: event.target.checked })}
            />
            Broaden my circle with different goals, experience or interests
          </label>
          <p>
            Broadening still requires a feasible shared run and both people to opt in. These
            choices do not change the separate officer finder. Saving with discovery off keeps
            the card private.
          </p>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Preview my card</button>
        {preview && (
          <section aria-label="Exact runner card preview">
            <h2>Your card preview</h2>
            <p>
              This is the card people can see if you turn on discovery. No account photo,
              email, birth date or private experience preference is included. Pace is rounded
              to whole seconds for matching.
            </p>
            <RunnerCard card={previewCard(preview)} />
            <button type="button" disabled={!adult} onClick={() => onSave(preview, consent)}>
              {consent.memberDiscovery ? 'Save and share my card' : 'Save private card'}
            </button>
            {!adult && <p>Confirm you are 18 or older before saving.</p>}
          </section>
        )}
      </fieldset>
    </form>
  );
}
