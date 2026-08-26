import Image from "next/image";

export function AllianceMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark${compact ? " small" : ""}`} aria-label="Alliance Manager">
      <Image src="/rscl-alliance-emblem.png" alt="" width={64} height={64} priority />
    </div>
  );
}
