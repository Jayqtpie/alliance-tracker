import type { TrackerState } from "@/lib/types";

const capturedAt = "2026-08-25T12:00:00.000Z";
const raw: Array<[string, number]> = [
  ["Super McNasty", 74831650], ["Retired Goblin", 49744827], ["JCutty24", 47346461],
  ["구름DongJa", 42716513], ["PRINCESSss", 42007156], ["Queenie", 37645273],
  ["IREZEY", 36460571], ["PeTeNueng", 34789438], ["민예진 Min", 33463299],
  ["The Grooch", 32399522], ["Pauly Provolone", 32280099], ["S L E D", 31728150],
  ["Lunchbox1114", 31062668], ["Lys The Yapper", 30936274], ["FRIJOLERO", 30454872],
  ["NotDoc", 29132438], ["KrIZ", 28789802], ["Donciukas", 28677351],
  ["BadLui", 28594458], ["이힛 IHit", 27743009], ["WAR6DOG", 27738622],
  ["InfernoBlaze", 27631366], ["JayQT", 27477473], ["war parrot", 27236292],
  ["Trash010", 27103201], ["Märqush tR1t", 26908691], ["MaveriC", 26894661],
  ["YouJustDied", 26890629], ["SooooorrrY", 26246464], ["War Sgt", 26047716],
  ["천사star", 25652915], ["琳蜜露", 25258999], ["Obsius", 25203319],
  ["Shan Baratheon", 25124589], ["CubeWorld", 25121347], ["ApacheJohn", 24729612],
  ["fALIENangel", 24078926], ["Newsshooter", 24029671], ["JoyDivișion", 23709342],
  ["Bomahni", 22758859], ["Sugar Lin", 22673394], ["Tymmers", 22450990],
  ["Thomas the Tommy", 22325344], ["iaReChachi", 22290896], ["BananaFade", 22257726],
  ["WayV", 22167769], ["I Orion I", 21626763], ["Viccked", 21626192],
  ["Abbaqq", 21228338], ["AndyQuarezmin", 20678774], ["까망 Uchiha", 20581764],
  ["LickRoyFeetkins", 20549059], ["Youmei Qiu", 20547637], ["WAR BLVCK", 20544939],
  ["Stoops Visor", 19965573], ["RageAndHatred", 19760552], ["PAYOBER", 19669738],
  ["리니지 Lineage", 19424888], ["Gillegthakid18", 19160201], ["Petros888", 19016919],
  ["jason98890", 18627558], ["AlvaAlt", 18360843], ["Zothargirl", 18163338],
  ["monsta717", 17968612], ["Hoax LeBeau", 17884459], ["NACHÓ", 17847893],
  ["Big Moo5e", 17098913], ["클래식 classic", 17097211], ["ackeng", 16674581],
  ["NotDoom", 16492768], ["ItBurnsWheniPvp", 16310768], ["UÇ 19", 16161432],
  ["MMmmmmmmmmmmmmmmmmmmmm", 16114701], ["Lawsishet", 16063387], ["AsrExpress", 16063346],
  ["Saiyan Prince", 15824475], ["Zeflash", 15688750], ["GhostT’", 15347859],
  ["Toutounator", 15338401], ["Panic888", 14965813], ["notFiiSSSHHHH", 14897375],
  ["AlvaAlva", 14724290], ["TCal", 14254873], ["Leandro Pinto", 14132648],
  ["derpynoob", 13975875], ["Sappy Chappy", 13888125], ["I Mystery I", 12949788],
  ["RamboCamel", 12626025], ["moefo", 10208438], ["Gino the chaos", 6643564],
];

const members = raw.map(([name], index) => ({
  id: `member-${String(index + 1).padStart(3, "0")}`,
  canonicalName: name,
  aliases: [] as string[],
  active: true,
  joinedAt: "2026-08-25",
}));

export const INITIAL_STATE: TrackerState = {
  version: 1,
  alliance: { name: "The Rascals", tag: "RSCL", server: "927" },
  members,
  snapshots: [
    {
      id: "snapshot-2026-08-25",
      capturedAt,
      weekStart: "2026-08-24",
      dayLabel: "Tuesday",
      status: "live",
      sourceType: "screenshots",
      notes: "Initial Tuesday capture supplied during the transfer period. Names should be reviewed.",
      entries: raw.map(([displayName, points], index) => ({
        id: `entry-2026-08-25-${index + 1}`,
        memberId: members[index].id,
        rank: index + 1,
        displayName,
        points,
        confidence: 0.84,
        needsReview: [26, 29, 39, 50, 59, 72, 73, 78].includes(index + 1),
      })),
    },
  ],
  uploads: [],
  updatedAt: capturedAt,
};
