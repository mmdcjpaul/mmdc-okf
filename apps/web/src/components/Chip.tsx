import Link from "next/link";
import { Chip as BaseChip, type ChipProps } from "@lore/ui";

/** The shared chip, navigating with the app's router. */
export function Chip(props: Omit<ChipProps, "link">) {
  return <BaseChip {...props} link={Link} />;
}
