import { HubPage, hubMetadata } from "../../HubPage";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props) {
  return hubMetadata("theme", decodeURIComponent((await params).slug));
}

export default async function ThemeHub({ params }: Props) {
  return <HubPage kind="theme" slug={decodeURIComponent((await params).slug)} />;
}
