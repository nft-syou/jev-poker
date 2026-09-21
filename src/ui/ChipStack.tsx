import type { CSSProperties, ReactNode } from "react";
import { chipBreakdown } from "./chips";

interface Props {
  /** Chips in the stack. Nothing is drawn for zero or less. */
  amount: number;
  bigBlind: number;
  /** Extra class on the wrapper, for whoever is positioning the stack. */
  className?: string;
  style?: CSSProperties;
  /** Shown instead of the raw amount — the pot passes its counted-up number here. */
  label?: ReactNode;
}

/**
 * A bet drawn as poker chips: coloured discs stacked with a slight overlap, the amount
 * printed underneath. The discs are decoration, so they are hidden from the accessibility
 * tree and the number carries the meaning.
 */
export function ChipStack({ amount, bigBlind, className, style, label }: Props) {
  const chips = chipBreakdown(amount, bigBlind);
  if (chips.length === 0) return null;
  // The key is built here rather than in the JSX: a stack is a pile of identical discs, so
  // its position in the pile is genuinely all that tells two of them apart.
  const discs = chips.map((chip, index) => ({
    tier: chip.tier,
    key: `${index}-${chip.tier}`,
    lift: index,
  }));

  return (
    <div
      className={className === undefined ? "chip-stack" : `chip-stack ${className}`}
      style={style}
    >
      <span className="chip-stack-discs" aria-hidden="true">
        {discs.map((disc) => (
          <span
            key={disc.key}
            className={`chip chip-${disc.tier}`}
            style={{ "--lift": disc.lift } as CSSProperties}
          />
        ))}
      </span>
      <span className="chip-stack-amount">{label ?? amount}</span>
    </div>
  );
}
