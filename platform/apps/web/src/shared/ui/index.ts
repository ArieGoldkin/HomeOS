// Group barrel for shared/ui — low-level cross-surface primitives.
// Public API only; never `export *`. Consumers import from "@shared/ui".
export { Button, type ButtonProps } from "./Button";
export { Field, type FieldProps } from "./Field";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Modal, type ModalProps } from "./Modal";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./SegmentedControl";
export { Sheet, type SheetProps } from "./Sheet";
export { Skeleton, type SkeletonProps } from "./Skeleton";
