/* eslint-env jest */

import type { CustomField } from '../../types/events';
import buildRaceCheckoutRequest, {
  customValuesAfterSignupTypeChange,
} from './raceCheckoutRequest';

const participantFields: CustomField[] = [{
  key: 'pace_group',
  label: 'Pace group',
  type: 'text',
  required: true,
}];

const volunteerFields: CustomField[] = [{
  key: 'shift',
  label: 'Shift',
  type: 'select',
  required: true,
  options: ['Morning', 'Afternoon'],
}];

const runner = {
  firstName: 'Test',
  lastName: 'Runner',
  email: 'runner@example.test',
};

describe('race checkout browser request projection', () => {
  test('participant submission keeps only participant answers and includes its tier', () => {
    const customValues = {
      pace_group: '8:00',
      shift: 'Morning',
      unrelated: 'must not leave the browser',
    };

    const result = buildRaceCheckoutRequest({
      eventId: 'race-1',
      runner,
      customValues,
      eventCustomFields: participantFields,
      volunteerCustomFields: volunteerFields,
      priceTier: 'member',
      signupType: 'participant',
    });

    expect(result).toEqual({
      eventId: 'race-1',
      runner,
      customFields: { pace_group: '8:00' },
      priceTier: 'member',
      signupType: 'participant',
      acceptedWaiver: true,
    });
    expect(customValues).toEqual({
      pace_group: '8:00',
      shift: 'Morning',
      unrelated: 'must not leave the browser',
    });
  });

  test('volunteer submission drops stale participant answers and omits priceTier', () => {
    const result = buildRaceCheckoutRequest({
      eventId: 'race-1',
      runner,
      customValues: {
        pace_group: '8:00',
        shift: 'Morning',
        unset: undefined,
      },
      eventCustomFields: participantFields,
      volunteerCustomFields: volunteerFields,
      priceTier: 'nonMember',
      signupType: 'volunteer',
    });

    expect(result).toEqual({
      eventId: 'race-1',
      runner,
      customFields: { shift: 'Morning' },
      signupType: 'volunteer',
      acceptedWaiver: true,
    });
    expect(Object.prototype.hasOwnProperty.call(result, 'priceTier')).toBe(false);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test('volunteer submission uses shared event fields when no volunteer fields exist', () => {
    const result = buildRaceCheckoutRequest({
      eventId: 'race-1',
      runner,
      customValues: { pace_group: '8:00', stale: 'drop me' },
      eventCustomFields: participantFields,
      volunteerCustomFields: [],
      priceTier: 'nonMember',
      signupType: 'volunteer',
    });

    expect(result.customFields).toEqual({ pace_group: '8:00' });
    expect(Object.prototype.hasOwnProperty.call(result, 'priceTier')).toBe(false);
  });

  test('changing signup type clears a same-key answer before its meaning can change', () => {
    const participantValues = { field_1: 'participant pace answer' };
    const clearedValues = customValuesAfterSignupTypeChange(
      'participant',
      'volunteer',
      participantValues,
    );
    const result = buildRaceCheckoutRequest({
      eventId: 'race-1',
      runner,
      customValues: clearedValues,
      eventCustomFields: [{
        key: 'field_1',
        label: 'Participant pace',
        type: 'text',
        required: false,
      }],
      volunteerCustomFields: [{
        key: 'field_1',
        label: 'Volunteer is a course marshal',
        type: 'checkbox',
        required: false,
      }],
      priceTier: 'nonMember',
      signupType: 'volunteer',
    });

    expect(clearedValues).toEqual({});
    expect(result.customFields).toEqual({});
    expect(participantValues).toEqual({ field_1: 'participant pace answer' });
  });

  test('selecting the current signup type keeps its current answers', () => {
    const currentValues = { pace_group: '8:00' };

    expect(customValuesAfterSignupTypeChange(
      'participant',
      'participant',
      currentValues,
    )).toBe(currentValues);
  });
});
