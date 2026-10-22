// Stands in for `@get-bb/plugin-sdk/app` in the shelf's Kit build: Kit's
// components only need its Icon, which BB draws from its own icon set. In a
// mini app's frame there is no BB, so the few icons Kit uses come from Lucide.
import type { ReactElement } from "react";
import { Check, ChevronDown, ChevronUp, Circle, X, type LucideProps } from "lucide-react";

const ICONS: Record<string, (props: LucideProps) => unknown> = { Check, ChevronDown, ChevronUp, X };

export type ExperimentalIconProps = LucideProps & { name: string };

export function experimental_Icon({ name, ...props }: ExperimentalIconProps) {
  const Component = (ICONS[name] ?? Circle) as (props: LucideProps) => ReactElement;
  return <Component aria-hidden {...props} />;
}
