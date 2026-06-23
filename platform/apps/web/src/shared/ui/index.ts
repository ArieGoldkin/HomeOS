// Group barrel for shared/ui — low-level cross-surface primitives.
// Public API only; never `export *`. Consumers import from "@shared/ui".
export { Button, type ButtonProps } from "./Button";
export { Card, type CardProps } from "./Card";
export { Dialog, type DialogProps } from "./Dialog";
export { Field, type FieldProps } from "./Field";
export { IconButton, type IconButtonProps } from "./IconButton";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./SegmentedControl";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export { StatusPill, type StatusPillProps } from "./StatusPill";
export { Switch, type SwitchProps } from "./Switch";
