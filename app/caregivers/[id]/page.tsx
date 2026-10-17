import { CaregiverView } from './CaregiverView';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ req?: string }> }) {
  const { id } = await params;
  const { req } = await searchParams;
  return <CaregiverView id={id} initialReq={req} />;
}
