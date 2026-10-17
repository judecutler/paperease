// Demo documents a caregiver can "text" from the phone simulator. Each one has a
// pre-baked extraction used when no ANTHROPIC_API_KEY is set; with a key the image
// itself goes to Claude.

export interface SampleExtraction {
  readable: boolean;
  documentType: string;
  /** requirement ids this document can satisfy */
  fits: string[];
  fields: Record<string, { value: string | null; confidence: number; sourceRef?: string }>;
  note?: string;
}

export interface SampleDoc {
  id: string;
  label: string;
  file: string;
  extraction: SampleExtraction;
}

const today = () => new Date();
const ago = (days: number) => new Date(today().getTime() - days * 86_400_000).toISOString().slice(0, 10);
const ahead = (days: number) => new Date(today().getTime() + days * 86_400_000).toISOString().slice(0, 10);

export function sampleDocs(): SampleDoc[] {
  return [
    {
      id: 'training-no-hours',
      label: 'Training certificate, hours not shown (Maria)',
      file: '/samples/training-cert-maria.png',
      extraction: {
        readable: true,
        fits: ['initial_training', 'annual_training'],
        documentType: 'Training certificate',
        fields: {
          name: { value: 'Maria Lopez', confidence: 0.97, sourceRef: 'p.1 · L3' },
          course: { value: 'Home Care Aide Entry-Level Training', confidence: 0.94, sourceRef: 'p.1 · L5' },
          completion_date: { value: ago(12), confidence: 0.92, sourceRef: 'p.1 · L7' },
          hours: { value: null, confidence: 0 },
          issuer: { value: 'Golden State Caregiver Academy', confidence: 0.9, sourceRef: 'p.1 · L9' },
        },
        note: 'Training hours are not printed on this certificate.',
      },
    },
    {
      id: 'training-hours-letter',
      label: 'Training transcript with hours (Maria)',
      file: '/samples/training-transcript-maria.png',
      extraction: {
        readable: true,
        fits: ['initial_training', 'annual_training'],
        documentType: 'Training transcript',
        fields: {
          name: { value: 'Maria Lopez', confidence: 0.96, sourceRef: 'p.1 · L2' },
          course: { value: 'Home Care Aide Entry-Level Training', confidence: 0.9, sourceRef: 'p.1 · L4' },
          completion_date: { value: ago(12), confidence: 0.9, sourceRef: 'p.1 · L4' },
          hours: { value: '5', confidence: 0.95, sourceRef: 'p.1 · L6' },
          issuer: { value: 'Golden State Caregiver Academy', confidence: 0.93, sourceRef: 'p.1 · L1' },
        },
      },
    },
    {
      id: 'annual-training-ana',
      label: 'Annual training certificate (Ana)',
      file: '/samples/annual-training-ana.png',
      extraction: {
        readable: true,
        fits: ['annual_training', 'initial_training'],
        documentType: 'Training certificate',
        fields: {
          name: { value: 'Ana Reyes', confidence: 0.98, sourceRef: 'p.1 · L3' },
          course: { value: 'Annual Home Care Aide Training', confidence: 0.95, sourceRef: 'p.1 · L5' },
          completion_date: { value: ago(5), confidence: 0.94, sourceRef: 'p.1 · L7' },
          hours: { value: '5', confidence: 0.93, sourceRef: 'p.1 · L8' },
          issuer: { value: 'CareSkills Online', confidence: 0.91, sourceRef: 'p.1 · L10' },
        },
      },
    },
    {
      id: 'tb-james',
      label: 'TB test result (James)',
      file: '/samples/tb-result-james.png',
      extraction: {
        readable: true,
        fits: ['tb_test'],
        documentType: 'TB test result',
        fields: {
          name: { value: 'James Chen', confidence: 0.97, sourceRef: 'p.1 · L2' },
          test_date: { value: ago(3), confidence: 0.95, sourceRef: 'p.1 · L5' },
          result: { value: 'Negative', confidence: 0.96, sourceRef: 'p.1 · L7' },
          provider: { value: 'Pasadena Family Clinic', confidence: 0.94, sourceRef: 'p.1 · L1' },
        },
      },
    },
    {
      id: 'hca-luis',
      label: 'HCA registration, clear photo (Luis)',
      file: '/samples/hca-card-luis.png',
      extraction: {
        readable: true,
        fits: ['hca_registration'],
        documentType: 'Home Care Aide registration',
        fields: {
          name: { value: 'Luis Hernández', confidence: 0.96, sourceRef: 'card · L2' },
          registration_number: { value: 'HCA 4417-2290', confidence: 0.91, sourceRef: 'card · L3' },
          expiration_date: { value: ahead(700), confidence: 0.93, sourceRef: 'card · L5' },
        },
      },
    },
    {
      id: 'blurry',
      label: 'Blurry photo',
      file: '/samples/hca-blurry.png',
      extraction: {
        readable: false,
        fits: [],
        documentType: 'Unknown',
        fields: {},
        note: 'The photo is too blurry to read.',
      },
    },
  ];
}

export function findSample(id: string) {
  return sampleDocs().find((s) => s.id === id);
}
