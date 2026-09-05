import type { Member } from "@/lib/types";

export function MemberName({ member, name }: { member?: Member; name?: string }) {
  return <span className="member-nameplate" data-rank={member?.gameProfile?.rank}>
    {member?.gameProfile?.rank === "R5" && <svg className="leader-crown" viewBox="0 0 24 24" role="img" aria-label="Alliance leader" focusable="false">
      <title>Alliance leader · R5</title>
      <path d="M4 16 2.5 5.5 8 9l4-6 4 6 5.5-3.5L20 16Z" fill="#efc66b" stroke="#9a6b29" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M4 16h16v4H4z" fill="#d9a544" stroke="#9a6b29" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="m12 10 2 2.5-2 2.5-2-2.5Z" fill="#b85546" />
      <path d="M6 18h2m8 0h2" stroke="#fff0bb" strokeWidth="1.4" strokeLinecap="round" />
    </svg>}
    <span className="alliance-member-name">{member?.canonicalName ?? name}</span>
  </span>;
}
