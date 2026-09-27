import { HubPage, hubMetadata } from "../../HubPage";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  return hubMetadata("system", decodeURIComponent((await params).slug));
}

export default async function SystemHub({ params }: Props) {
  return <HubPage kind="system" slug={decodeURIComponent((await params).slug)} />;
}
