import React from 'react';
import { RunnerCard as Card } from '../../services/account/runnerConnectionContract';

export const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const LABELS: Record<string, string> = {
  bay_trail: 'Bay Trail',
  san_mateo: 'San Mateo',
  foster_city: 'Foster City',
  belmont: 'Belmont',
  redwood_city: 'Redwood City',
  road: 'Road',
  trail: 'Trail',
  continuous: 'Continuous running',
  run_walk: 'Run/walk',
  walk: 'Walking',
  consistency: 'Build consistency',
  first_5k: 'First 5K',
  first_10k: 'First 10K',
  half_marathon: 'Half marathon',
  marathon: 'Marathon',
  trails: 'Trail running',
  social: 'Social running',
  return_gradually: 'Return gradually',
  volunteer: 'Volunteer',
  mentor: 'Welcome other runners',
  beginner: 'Beginner',
  returning: 'Returning',
  regular: 'Regular',
  experienced: 'Experienced',
  coffee: 'Coffee',
  food: 'Food',
  books: 'Books',
  music: 'Music',
  outdoors: 'Outdoors',
  volunteering: 'Volunteering',
  pace_overlap: 'Overlapping easy pace',
  shared_availability: 'Overlapping usual availability',
  shared_area: 'Shared running area',
  shared_distance: 'Overlapping distance',
  shared_terrain: 'Shared terrain',
  shared_run_style: 'Shared running style',
  shared_goals: 'Shared goals',
  shared_interests: 'Shared interests',
  different_experience: 'Different running experience',
  different_goals: 'Different goals',
  different_interests: 'Different interests',
};
export const label = (value: string) => LABELS[value] || value;
export function paceText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function timeText(minutes: number): string {
  if (!Number.isFinite(minutes)) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export default function RunnerCard({
  card,
}: {
  card: Omit<Card, 'entryRef' | 'reasons'> & { reasons?: string[] };
}) {
  const factor = card.pace.preferredUnit === 'min/mile' ? 1.609344 : 1;
  const list = (values: string[]) => values.map(label).join(', ');
  return (
    <div className="runner-card">
      <h3>{card.displayName}</h3>
      <dl>
        <div>
          <dt>Easy pace</dt>
          <dd>
            {paceText(Math.round(card.pace.fastSecondsPerKm * factor))}
            –
            {paceText(Math.round(card.pace.slowSecondsPerKm * factor))}
            {' '}
            {card.pace.preferredUnit}
          </dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            {card.distance.minMetres / 1000}
            –
            {card.distance.maxMetres / 1000}
            {' '}
            km
          </dd>
        </div>
        <div>
          <dt>Usual availability (Pacific time)</dt>
          <dd>
            {card.availability.map((window) => (
              <div key={`${window.day}-${window.startMinute}`}>
                {DAYS[window.day]}
                {' '}
                {timeText(window.startMinute)}
                –
                {timeText(window.endMinute)}
              </div>
            ))}
          </dd>
        </div>
        <div>
          <dt>Areas</dt>
          <dd>{list(card.areas)}</dd>
        </div>
        <div>
          <dt>Terrain</dt>
          <dd>{list(card.terrains)}</dd>
        </div>
        <div>
          <dt>Running style</dt>
          <dd>{list(card.styles)}</dd>
        </div>
        <div>
          <dt>Goals</dt>
          <dd>{list(card.goals)}</dd>
        </div>
        <div>
          <dt>Experience</dt>
          <dd>{label(card.experience)}</dd>
        </div>
        <div>
          <dt>Interests</dt>
          <dd>{card.interests.length ? list(card.interests) : 'Not supplied'}</dd>
        </div>
      </dl>
      {!!card.reasons?.length && (
        <p>
          <strong>Why this suggestion:</strong>
          {' '}
          {list(card.reasons)}
          .
        </p>
      )}
    </div>
  );
}
