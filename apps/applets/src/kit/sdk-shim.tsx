// Stands in for @get-bb/plugin-sdk/app inside applets, where BB's plugin
// runtime doesn't exist. The Studio kit only needs its Icon, which BB draws
// from Lucide by name, so this draws the same Lucide icons.
import { icons, type LucideProps } from "lucide-react";

export type ExperimentalIconProps = LucideProps & { name: string };

export function experimental_Icon({ name, ...props }: ExperimentalIconProps) {
  const Lucide = icons[name as keyof typeof icons];
  return Lucide ? <Lucide data-icon-root="" strokeWidth={2} {...props} /> : null;
}
