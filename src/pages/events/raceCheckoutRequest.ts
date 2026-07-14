import type { CheckoutArgs } from '../../services/events/eventsService';
import type {
  CustomField,
  RegistrationRunner,
  SignupType,
} from '../../types/events';

interface BuildRaceCheckoutRequestInput {
  eventId: string;
  runner: RegistrationRunner;
  customValues: Record<string, unknown>;
  eventCustomFields: CustomField[];
  volunteerCustomFields?: CustomField[];
  priceTier: NonNullable<CheckoutArgs['priceTier']>;
  signupType: SignupType;
}

export function customValuesAfterSignupTypeChange(
  currentType: SignupType,
  nextType: SignupType,
  currentValues: Record<string, unknown>,
): Record<string, unknown> {
  return currentType === nextType ? currentValues : {};
}

function selectedFields({
  signupType,
  eventCustomFields,
  volunteerCustomFields,
}: Pick<
  BuildRaceCheckoutRequestInput,
  'signupType' | 'eventCustomFields' | 'volunteerCustomFields'
>): CustomField[] {
  if (signupType === 'volunteer' && volunteerCustomFields?.length) {
    return volunteerCustomFields;
  }
  return eventCustomFields;
}

/**
 * Project the current form state into the exact callable shape.
 *
 * This is compatibility hygiene only. The server still validates every field,
 * price tier, waiver value, and event definition independently.
 */
function buildRaceCheckoutRequest({
  eventId,
  runner,
  customValues,
  eventCustomFields,
  volunteerCustomFields,
  priceTier,
  signupType,
}: BuildRaceCheckoutRequestInput): CheckoutArgs {
  const customFields = Object.fromEntries(selectedFields({
    signupType,
    eventCustomFields,
    volunteerCustomFields,
  }).flatMap(({ key }) => (
    Object.prototype.hasOwnProperty.call(customValues, key)
      && customValues[key] !== undefined
      ? [[key, customValues[key]]]
      : []
  )));

  return {
    eventId,
    runner,
    customFields,
    signupType,
    acceptedWaiver: true,
    ...(signupType === 'participant' ? { priceTier } : {}),
  };
}

export default buildRaceCheckoutRequest;
