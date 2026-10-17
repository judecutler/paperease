import type { Metadata } from 'next';
import { CaregiverLink } from './CaregiverLink';

export const metadata: Metadata = { title: 'Send your document', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CaregiverLink token={token} />;
}
