import type { Transition, Variants } from "framer-motion";

/** Soft desk spring — nav pills, cards, modals. */
export const deskSpring: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 28,
  mass: 0.85,
};

/** Slightly snappier for buttons / taps. */
export const tapSpring: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 32,
};

export const easeOut: Transition = {
  duration: 0.45,
  ease: [0.22, 1, 0.36, 1],
};

/** Staggered children for KPI / meta rails. */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.055, delayChildren: 0.04 },
  },
};

export const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: easeOut,
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35 } },
};

export const pageSection: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: easeOut,
  },
};

export const hoverLift = {
  y: -3,
  transition: deskSpring,
};

export const hoverScale = {
  scale: 1.03,
  transition: tapSpring,
};

export const tapPress = { scale: 0.97 };
