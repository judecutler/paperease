import type { Extraction } from './llm';
import type { Caregiver, ExtractedFieldValue, PhotoCheck, PhotoCheckItem, RequirementType } from './types';

type InspectPhotoInput = {
  caregiver: Caregiver;
  requirement: RequirementType;
  extraction: Extraction;
  minConfidence: number;
  existingFields?: ExtractedFieldValue[];
  checkedAt?: string;
};

function initialChecks(): PhotoCheckItem[] {
  return [
    { id: 'readability', label: 'Photo readability', status: 'not-checked', detail: 'Not evaluated.' },
    { id: 'document-type', label: 'Requested document', status: 'not-checked', detail: 'Not evaluated.' },
    { id: 'name', label: 'Caregiver name', status: 'not-checked', detail: 'Not evaluated.' },
    { id: 'confidence', label: 'Reading confidence', status: 'not-checked', detail: 'Not evaluated.' },
    { id: 'required-fields', label: 'Required information', status: 'not-checked', detail: 'Not evaluated.' },
  ];
}

/** Unavailable analysis is not evidence that the photograph is blurry or incorrect. */
export function uncheckedPhoto(reason: string, requirementName?: string): PhotoCheck {
  const checks = initialChecks();
  checks[0].detail = reason;
  return {
    status: 'not-checked',
    source: 'none',
    requirementName,
    summary: 'Photo not checked.',
    nextStep: reason,
    checkedAt: new Date().toISOString(),
    checks,
  };
}

const valueOf = (value: string | null | undefined): string | null => value?.trim() || null;

function nameTokens(value: string): string[] {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/u).filter(Boolean);
}

export function sameCaregiverName(actual: string, expected: string): boolean {
  const a = nameTokens(actual);
  const b = nameTokens(expected);
  return a.length > 0 && b.length > 0 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/** A preliminary, per-photo check. A ready result still requires staff verification. */
export function inspectPhoto({ caregiver, requirement, extraction, minConfidence, existingFields = [], checkedAt = new Date().toISOString() }: InspectPhotoInput): PhotoCheck {
  if (extraction.by === 'none') {
    return {
      ...uncheckedPhoto(extraction.note || 'AI analysis is unavailable. Agency staff need to read this document.', requirement.name),
      documentType: extraction.documentType,
      checkedAt,
    };
  }

  const checks = initialChecks();
  if (requirement.minHours !== undefined) checks.push({ id: 'training-hours', label: 'Training hours', status: 'not-checked', detail: 'Not evaluated.' });
  const setCheck = (id: PhotoCheckItem['id'], status: PhotoCheckItem['status'], detail: string) => {
    Object.assign(checks.find((check) => check.id === id)!, { status, detail });
  };
  const result = (status: PhotoCheck['status'], summary: string, nextStep: string): PhotoCheck => ({
    status,
    source: extraction.by,
    requirementName: requirement.name,
    documentType: extraction.documentType,
    summary: `${extraction.by === 'sample' ? 'Demo result: ' : ''}${summary}`,
    nextStep,
    checkedAt,
    checks,
  });

  if (!extraction.readable) {
    setCheck('readability', 'attention', extraction.note || 'The photograph could not be read reliably.');
    return result('needs-review', 'This photo needs staff review.', 'Send a clearer photo with the whole document visible, or ask agency staff to review it.');
  }
  setCheck('readability', 'pass', 'The document was readable enough for a preliminary check.');

  if (!extraction.matchesRequirement) {
    setCheck('document-type', 'attention', `Detected ${extraction.documentType}; requested ${requirement.name}.`);
    return result('needs-info', 'This is not the requested document.', `Send the requested ${requirement.name}, or ask agency staff which document to provide.`);
  }
  setCheck('document-type', 'pass', `The photo appears to match ${requirement.name}.`);

  let needsReview = false;
  const photoName = valueOf(extraction.fields.name?.value);
  if (photoName) {
    const matches = sameCaregiverName(photoName, caregiver.name);
    setCheck('name', matches ? 'pass' : 'attention', matches ? `The visible name matches ${caregiver.name}.` : `The visible name “${photoName}” does not match ${caregiver.name}.`);
    if (!matches) needsReview = true;
  } else {
    setCheck('name', 'not-checked', 'No caregiver name was visible in this photo. Staff must match it to the other documents.');
  }

  const threshold = Number.isFinite(minConfidence) ? Math.max(0, Math.min(1, minConfidence)) : 0.8;
  const newlyRead = requirement.fields.filter((field) => field.required && valueOf(extraction.fields[field.key]?.value) !== null);
  const uncertain = newlyRead.filter((field) => {
    const confidence = extraction.fields[field.key]?.confidence;
    return typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < threshold || confidence > 1;
  });
  if (uncertain.length) {
    needsReview = true;
    setCheck('confidence', 'attention', `Staff need to check the reading of: ${uncertain.map((field) => field.label).join(', ')}.`);
  } else if (newlyRead.length) {
    setCheck('confidence', 'pass', `Newly read required fields meet the ${Math.round(threshold * 100)}% confidence threshold. Staff still need to verify them.`);
  } else {
    setCheck('confidence', 'not-checked', 'No required field values were visible to assess.');
  }

  // Earlier values may fill gaps, but must not hide a mismatch in this new photo.
  const previous = new Map(existingFields.map((field) => [field.key, valueOf(field.value)]));
  const combinedValue = (key: string) => previous.get(key) || valueOf(extraction.fields[key]?.value);
  const required = requirement.fields.filter((field) => field.required);
  const missing = required.filter((field) => !combinedValue(field.key));
  setCheck('required-fields', missing.length ? 'attention' : 'pass', missing.length
    ? `Still missing: ${missing.map((field) => field.label).join(', ')}.`
    : `All ${required.length} required fields are present${existingFields.length ? ' across the submitted documents' : ''}. Staff must verify them.`);

  let missingHours = false;
  if (requirement.minHours !== undefined) {
    // A new hours value takes priority for validation, even when an old value exists.
    const newHours = valueOf(extraction.fields.hours?.value);
    const hoursText = newHours || previous.get('hours');
    if (!hoursText) {
      missingHours = true;
      setCheck('training-hours', 'attention', `Training hours are missing; at least ${requirement.minHours} hours are required.`);
    } else {
      const hours = Number(hoursText);
      const enough = Number.isFinite(hours) && hours >= requirement.minHours;
      setCheck('training-hours', enough ? 'pass' : 'attention', enough
        ? `${newHours ? 'This photo' : 'An earlier submission'} states ${hoursText} hours; the minimum is ${requirement.minHours}.`
        : `The hours value “${hoursText}” does not establish the required ${requirement.minHours} hours. Staff must check it.`);
      if (!enough) needsReview = true;
    }
  }

  if (needsReview) return result('needs-review', 'This photo needs staff review.', 'Agency staff must compare the flagged information with the original photo before using it in the record.');
  if (missing.length || missingHours) return result('needs-info', 'More information is needed.', `Provide ${missing.length ? missing.map((field) => field.label).join(', ') : 'the training hours'} in another photo or message. Staff will review the completed record.`);
  return result('ready', 'Ready for staff review.', 'Agency staff must verify the extracted information against the original document before approving the record.');
}
