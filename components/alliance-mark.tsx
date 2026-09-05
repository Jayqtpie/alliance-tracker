import Image from "next/image";
import type { TrackerState } from "@/lib/types";

export function AllianceMark({ compact = false, alliance }: { compact?: boolean; alliance?: TrackerState["alliance"] }) {
  return (
    <div className={`brand-mark${compact ? " small" : ""}`} aria-label={alliance?.name || "Alliance Manager"}>
      <Image src={alliance?.emblem || "/rscl-alliance-emblem.png"} alt="" width={64} height={64} unoptimized={Boolean(alliance?.emblem)} loading="eager" />
    </div>
  );
}
