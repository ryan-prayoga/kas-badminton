import { describe, expect, it } from "vitest";
import { buildDebtSummary, planInstallment, planSettle } from "./debt";
import { enrichGame, normalizeStoredGame } from "./game";
import { fmtDateRange } from "../format";
import {
  bracketSize,
  buildBracket,
  enrichTournament,
  koksByDate,
  koksByMatch,
  koksTotal,
  matchTitle,
  maxGames,
  normalizeStoredTournament,
  pairLabel,
  participantNames,
  roundLabel,
  roundRobinMatchCount,
  scoreLine,
  suggestFee,
  syncFees,
  tournamentCost,
  tournamentDays,
  tournamentStatus,
} from "./tournament";
import type {
  MatchScore,
  StoredGame,
  StoredTournament,
  TournamentKok,
} from "./types";

let seq = 0;
const genId = () => `k${++seq}`;

function kok(price: number, matchId: string | null = null, date = "2026-03-01"): TournamentKok {
  return { id: genId(), typeId: null, typeName: null, pricePerPerson: price, matchId, date };
}

/** Skor "biasa" — 1 game sampai 30. */
function sc(a: number, b: number): MatchScore {
  return { format: "single", games: [{ a, b }] };
}

/** Skor rally 21, best of 3 game. */
function bo3(...games: [number, number][]): MatchScore {
  return { format: "bo3", games: games.map(([a, b]) => ({ a, b })) };
}

/** Bagan dengan pasangan "P1".."Pn" — slot kosong ditulis sebagai "". */
function tour(partial: Partial<StoredTournament> & { names?: string[][] }): StoredTournament {
  const size = partial.size ?? 4;
  const names = partial.names ?? Array.from({ length: size }, (_, i) => [`A${i}`, `B${i}`]);
  return normalizeStoredTournament({
    id: "t1",
    name: "Tarkam",
    date: "2026-03-01",
    size,
    fee: 0,
    pairs: names.map(([a, b], slot) => ({ id: `p${slot}`, slot, a, b })),
    results: {},
    koks: [],
    fees: [],
    notes: null,
    recordedBy: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...partial,
  });
}

function game(partial: Partial<StoredGame>): StoredGame {
  return normalizeStoredGame({
    id: "g1",
    date: "2026-01-01",
    players: [
      { name: "A", paid: false },
      { name: "B", paid: false },
      { name: "C", paid: false },
      { name: "D", paid: false },
    ],
    koks: [kok(3000)],
    notes: null,
    recordedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  });
}

describe("pairLabel & participantNames", () => {
  it("gabung dua nama, buang yang kosong", () => {
    expect(pairLabel({ id: "p", slot: 0, a: "Fahri", b: "Alan" })).toBe("Fahri / Alan");
    expect(pairLabel({ id: "p", slot: 0, a: "Fahri", b: "" })).toBe("Fahri");
    expect(pairLabel({ id: "p", slot: 0, a: "", b: "" })).toBe("");
  });
  it("peserta unik, case-insensitive, urut slot", () => {
    const names = participantNames([
      { id: "p0", slot: 0, a: "Roni", b: "Yahya" },
      { id: "p1", slot: 1, a: "roni", b: "Dika" },
    ]);
    expect(names).toEqual(["Roni", "Yahya", "Dika"]);
  });
});

describe("normalizeStoredTournament", () => {
  it("selalu balik `size` slot walau input kurang", () => {
    const t = tour({ size: 8, names: [["A", "B"]] });
    expect(t.pairs).toHaveLength(8);
    expect(t.pairs[7]).toMatchObject({ slot: 7, a: "", b: "" });
  });
  it("ukuran ngawur jatuh ke 8", () => {
    expect(normalizeStoredTournament({ size: 99 }).size).toBe(32);
    expect(normalizeStoredTournament({ size: 0 }).size).toBe(2);
    expect(normalizeStoredTournament({ size: 7 }).size).toBe(7);
  });
  it("skor 0-0 dianggap belum dimainkan", () => {
    const t = tour({ results: { "r0-0": sc(0, 0), "r0-1": sc(21, 15) } });
    expect(t.results["r0-0"]).toBeUndefined();
    expect(t.results["r0-1"]).toEqual(sc(21, 15));
  });
});

describe("roundLabel", () => {
  it("dihitung dari sisa babak menuju final", () => {
    expect(roundLabel(3, 4)).toBe("Final");
    expect(roundLabel(2, 4)).toBe("Semifinal");
    expect(roundLabel(1, 4)).toBe("Perempat Final");
    expect(roundLabel(0, 4)).toBe("Babak 16 Besar");
    expect(roundLabel(0, 2)).toBe("Semifinal");
  });
});

describe("buildBracket", () => {
  it("4 pasangan → 2 babak: semifinal (2 match) + final (1 match)", () => {
    const b = buildBracket(tour({ size: 4 }));
    expect(b.rounds.map((r) => r.matches.length)).toEqual([2, 1]);
    expect(b.rounds.map((r) => r.label)).toEqual(["Semifinal", "Final"]);
    expect(b.champion).toBeNull();
  });

  it("skor menentukan pemenang dan mengisi babak berikutnya", () => {
    const t = tour({ size: 4, results: { "r0-0": sc(21, 12), "r0-1": sc(15, 21) } });
    const b = buildBracket(t);
    expect(b.rounds[0].matches[0].winner).toBe("a");
    expect(b.rounds[1].matches[0].a.pair?.id).toBe("p0");
    expect(b.rounds[1].matches[0].b.pair?.id).toBe("p3");
    expect(b.champion).toBeNull(); // final belum dimainkan
  });

  it("slot kosong = BYE, lawannya lolos otomatis tanpa skor", () => {
    const t = tour({
      size: 4,
      names: [
        ["Fahri", "Alan"],
        ["", ""],
        ["Andre", "Enyok"],
        ["Wuri", "Sakha"],
      ],
    });
    const b = buildBracket(t);
    const m = b.rounds[0].matches[0];
    expect(m.b.bye).toBe(true);
    expect(m.winner).toBe("a");
    expect(m.autoWin).toBe(true);
    expect(b.rounds[1].matches[0].a.pair?.id).toBe("p0");
  });

  it("skor seri tidak meloloskan siapa pun", () => {
    const t = tour({ size: 4, results: { "r0-0": sc(21, 21) } });
    expect(buildBracket(t).rounds[0].matches[0].winner).toBeNull();
  });

  it("juara terisi setelah final punya pemenang", () => {
    const t = tour({
      size: 4,
      results: {
        "r0-0": sc(21, 12),
        "r0-1": sc(21, 9),
        "r1-0": sc(18, 21),
      },
    });
    expect(buildBracket(t).champion?.id).toBe("p2");
  });

  it("cabang yang isinya BYE semua tetap BYE di babak berikutnya", () => {
    const t = tour({
      size: 4,
      names: [
        ["Roni", "Yahya"],
        ["Dika", "Sandi"],
        ["", ""],
        ["", ""],
      ],
      results: { "r0-0": sc(21, 10) },
    });
    const b = buildBracket(t);
    expect(b.rounds[1].matches[0].b.bye).toBe(true);
    // Pemenang semifinal atas langsung jadi juara.
    expect(b.champion?.id).toBe("p0");
  });

  it("16 pasangan → 4 babak", () => {
    const b = buildBracket(tour({ size: 16 }));
    expect(b.rounds.map((r) => r.matches.length)).toEqual([8, 4, 2, 1]);
  });
});

describe("jumlah pasangan fleksibel", () => {
  it("bagan dipadatkan ke pangkat 2 terdekat, sisanya BYE", () => {
    expect(bracketSize(14)).toBe(16);
    expect(bracketSize(8)).toBe(8);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(2)).toBe(2);
  });

  it("6 pasangan → bagan 8 slot, BYE disebar bukan menumpuk", () => {
    const t = enrichTournament(tour({ size: 6 }));
    expect(t.bracket!.rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
    const first = t.bracket!.rounds[0].matches;
    // 2 partai nyata + 2 partai ber-BYE (bukan satu partai kosong-lawan-kosong).
    expect(first.filter((m) => m.autoWin)).toHaveLength(2);
    expect(first.filter((m) => m.a.bye && m.b.bye)).toHaveLength(0);
    // Yang dihitung cuma partai yang benar-benar dimainkan: 2 di babak 1 + 2 + 1.
    expect(t.totalCount).toBe(5);
  });

  it("jumlah partai round robin = n(n-1)/2", () => {
    expect(roundRobinMatchCount(4)).toBe(6);
    expect(roundRobinMatchCount(3)).toBe(3);
  });
});

describe("round robin", () => {
  const rr = (partial: Partial<StoredTournament> = {}) =>
    enrichTournament(tour({ format: "round_robin", size: 3, ...partial }));

  it("bikin partai semua lawan semua", () => {
    const t = rr();
    expect(t.bracket).toBeNull();
    expect(t.matches.map((m) => m.id)).toEqual(["rr0-1", "rr0-2", "rr1-2"]);
    expect(t.totalCount).toBe(3);
  });

  it("klasemen urut menang, lalu selisih poin", () => {
    const t = rr({
      results: {
        "rr0-1": sc(21, 10), // A0 menang
        "rr0-2": sc(21, 19), // A0 menang tipis
        "rr1-2": sc(15, 21), // slot 2 menang
      },
    });
    const s = t.roundRobin!.standings;
    expect(s[0].pair.id).toBe("p0");
    expect(s[0].won).toBe(2);
    expect(s[1].pair.id).toBe("p2");
    expect(t.champion?.id).toBe("p0");
    expect(t.finished).toBe(true);
  });

  it("juara kosong selama masih ada partai belum main", () => {
    const t = rr({ results: { "rr0-1": sc(21, 10) } });
    expect(t.champion).toBeNull();
    expect(t.playedCount).toBe(1);
    expect(t.finished).toBe(false);
  });

  it("seri di puncak klasemen belum menghasilkan juara", () => {
    // Tiga pasangan saling mengalahkan → semua 1 menang.
    const t = rr({
      results: { "rr0-1": sc(21, 10), "rr1-2": sc(21, 10), "rr0-2": sc(10, 21) },
    });
    expect(t.roundRobin!.standings.every((r) => r.won === 1)).toBe(true);
    expect(t.champion).toBeNull();
  });

  it("slot kosong tidak masuk klasemen dan partainya tidak dihitung", () => {
    const t = enrichTournament(
      tour({
        format: "round_robin",
        size: 3,
        names: [
          ["A", "B"],
          ["C", "D"],
          ["", ""],
        ],
      }),
    );
    expect(t.roundRobin!.standings).toHaveLength(2);
    expect(t.totalCount).toBe(1);
  });

  it("id partai di luar format dibuang saat normalisasi", () => {
    // Skor bergaya knockout tidak berlaku di round robin.
    const t = enrichTournament(
      tour({ format: "round_robin", size: 3, results: { "r0-0": sc(21, 10) } }),
    );
    expect(Object.keys(t.results)).toEqual([]);
  });
});

describe("tournamentStatus", () => {
  const base = { endDate: null, finished: false };
  it("tanggal mulai di depan = akan datang", () => {
    expect(tournamentStatus({ ...base, date: "2026-09-01" }, "2026-08-05")).toBe("akan-datang");
  });
  it("sudah mulai tapi belum kelar = berjalan", () => {
    expect(tournamentStatus({ ...base, date: "2026-08-05" }, "2026-08-05")).toBe("berjalan");
  });
  it("selesai menang atas tanggal", () => {
    expect(tournamentStatus({ ...base, date: "2026-09-01", finished: true }, "2026-08-05")).toBe(
      "selesai",
    );
  });
});

describe("syncFees", () => {
  it("nama baru masuk belum bayar, nama yang hilang dibuang, lunas dipertahankan", () => {
    const pairs = [
      { id: "p0", slot: 0, a: "Roni", b: "Yahya" },
      { id: "p1", slot: 1, a: "Dika", b: "" },
    ];
    const fees = syncFees(pairs, [
      { name: "Roni", paid: true, paidAt: "2026-03-01T10:00:00.000Z", paidBy: "Admin" },
      { name: "Hilang", paid: true },
    ]);
    expect(fees.map((f) => f.name)).toEqual(["Roni", "Yahya", "Dika"]);
    expect(fees[0]).toMatchObject({ paid: true, paidBy: "Admin" });
    expect(fees[1].paid).toBe(false);
  });
});

describe("tournamentCost", () => {
  it("nilai kok = pricePerPerson × 4 per kok; iuran dihitung dari peserta", () => {
    const t = tour({
      size: 4,
      names: [
        ["A", "B"],
        ["C", "D"],
        ["", ""],
        ["", ""],
      ],
      fee: 5000,
      koks: [kok(3000), kok(3000)],
    });
    const cost = tournamentCost(t);
    expect(cost.kokCount).toBe(2);
    expect(cost.kokTotal).toBe(24_000);
    expect(cost.participants).toBe(4);
    expect(cost.feeTotal).toBe(20_000);
    expect(cost.feeUnpaid).toBe(20_000);
  });
  it("suggestFee dibulatkan ke atas per 500", () => {
    expect(suggestFee(24_000, 4)).toBe(6000);
    expect(suggestFee(25_000, 4)).toBe(6500);
    expect(suggestFee(0, 4)).toBe(0);
    expect(suggestFee(24_000, 0)).toBe(0);
  });
});

describe("format skor", () => {
  it("single: menang 1 game langsung lolos", () => {
    const b = buildBracket(tour({ size: 4, results: { "r0-0": sc(30, 28) } }));
    expect(b.rounds[0].matches[0].winner).toBe("a");
    expect(b.rounds[0].matches[0].gamesWon).toEqual({ a: 1, b: 0 });
  });

  it("bo3: baru lolos setelah menang 2 game", () => {
    const satu = buildBracket(tour({ size: 4, results: { "r0-0": bo3([21, 15]) } }));
    expect(satu.rounds[0].matches[0].winner).toBeNull();

    const dua = buildBracket(tour({ size: 4, results: { "r0-0": bo3([21, 15], [21, 19]) } }));
    expect(dua.rounds[0].matches[0].winner).toBe("a");
  });

  it("bo3: kalah game pertama tapi menang dua berikutnya", () => {
    const t = tour({ size: 4, results: { "r0-0": bo3([15, 21], [21, 18], [21, 19]) } });
    const m = buildBracket(t).rounds[0].matches[0];
    expect(m.gamesWon).toEqual({ a: 2, b: 1 });
    expect(m.winner).toBe("a");
  });

  it("bo3: 1-1 belum ada pemenang", () => {
    const t = tour({ size: 4, results: { "r0-0": bo3([21, 15], [18, 21]) } });
    expect(buildBracket(t).rounds[0].matches[0].winner).toBeNull();
  });

  it("game 0-0 dibuang, game lebih dari format dipotong", () => {
    const t = tour({
      size: 4,
      results: { "r0-0": bo3([21, 15], [0, 0], [21, 19]), "r0-1": { format: "single", games: [{ a: 30, b: 20 }, { a: 21, b: 5 }] } },
    });
    expect(t.results["r0-0"].games).toHaveLength(2);
    expect(t.results["r0-1"].games).toHaveLength(1);
  });

  it("skor lama bentuk {a,b} dibaca sebagai 1 game sampai 30", () => {
    const t = tour({
      size: 4,
      results: { "r0-0": { a: 21, b: 15 } as unknown as MatchScore },
    });
    expect(t.results["r0-0"]).toEqual(sc(21, 15));
    expect(buildBracket(t).rounds[0].matches[0].winner).toBe("a");
  });

  it("scoreLine merangkai semua game", () => {
    expect(scoreLine(bo3([21, 18], [19, 21], [21, 15]))).toBe("21-18 · 19-21 · 21-15");
    expect(scoreLine(null)).toBe("");
  });

  it("format turnamen dinormalisasi, default 'single'", () => {
    expect(tour({}).scoreFormat).toBe("single");
    expect(tour({ scoreFormat: "bo3" }).scoreFormat).toBe("bo3");
    expect(tour({ scoreFormat: "ngawur" as never }).scoreFormat).toBe("single");
    expect(maxGames("bo3")).toBe(3);
    expect(maxGames("single")).toBe(1);
  });
});

describe("turnamen lebih dari sehari", () => {
  it("tanggal selesai disimpan kalau setelah tanggal mulai", () => {
    expect(tour({ date: "2026-08-04", endDate: "2026-08-06" }).endDate).toBe("2026-08-06");
  });
  it("tanggal selesai sama / sebelum mulai dianggap sehari", () => {
    expect(tour({ date: "2026-08-04", endDate: "2026-08-04" }).endDate).toBeNull();
    expect(tour({ date: "2026-08-04", endDate: "2026-08-01" }).endDate).toBeNull();
    expect(tour({ date: "2026-08-04" }).endDate).toBeNull();
  });
  it("format rentang menyingkat bagian yang sama", () => {
    expect(fmtDateRange("2026-08-04", "2026-08-06")).toBe("4 – 6 Agu 2026");
    expect(fmtDateRange("2026-07-30", "2026-08-02")).toBe("30 Jul – 2 Agu 2026");
    expect(fmtDateRange("2026-12-28", "2027-01-03")).toBe("28 Des 2026 – 3 Jan 2027");
    expect(fmtDateRange("2026-08-04", null)).toBe("4 Agu 2026");
    expect(fmtDateRange("2026-08-04", "2026-08-04")).toBe("4 Agu 2026");
  });
});

describe("kok per partai", () => {
  it("kok terikat ke partai muncul di match-nya, sisanya jadi kok umum", () => {
    const t = tour({
      size: 4,
      koks: [kok(3000, "r0-0"), kok(5000, "r0-0"), kok(4000, "r1-0"), kok(3000, null)],
    });
    const b = buildBracket(t);
    const semi = b.rounds[0].matches[0];
    expect(semi.koks).toHaveLength(2);
    // Tiap partai boleh campur harga: (3000 + 5000) × 4.
    expect(semi.kokTotal).toBe(32_000);
    expect(b.rounds[1].matches[0].koks).toHaveLength(1);
    expect(b.rounds[0].matches[1].koks).toHaveLength(0);

    const cost = tournamentCost(t);
    expect(cost.kokCount).toBe(4);
    expect(cost.kokTotal).toBe(60_000);
    expect(cost.looseKoks).toHaveLength(1);
  });

  it("matchId di luar bagan diperlakukan sebagai kok umum, bukan hilang", () => {
    const t = tour({ size: 4, koks: [kok(3000, "r9-9"), kok(3000, "bukan-id")] });
    expect(t.koks.every((k) => k.matchId === null)).toBe(true);
    expect(tournamentCost(t).kokCount).toBe(2);
  });

  it("koksByMatch mengelompokkan termasuk kunci null", () => {
    const map = koksByMatch([kok(3000, "r0-0"), kok(3000, null), kok(3000, "r0-0")]);
    expect(map.get("r0-0")).toHaveLength(2);
    expect(map.get(null)).toHaveLength(1);
  });

  it("koksTotal = pricePerPerson × 4 per kok", () => {
    expect(koksTotal([kok(3000), kok(5000)])).toBe(32_000);
  });

  it("tanggal kok dijepit ke rentang turnamen", () => {
    const t = tour({
      date: "2026-08-04",
      endDate: "2026-08-06",
      koks: [
        kok(3000, null, "2026-08-05"), // di dalam rentang → tetap
        kok(3000, null, "2026-08-01"), // sebelum mulai → jadi tanggal mulai
        kok(3000, null, "2026-09-01"), // setelah selesai → jadi tanggal selesai
        kok(3000, null, "bukan-tanggal"), // ngawur → tanggal mulai
      ],
    });
    expect(t.koks.map((k) => k.date)).toEqual([
      "2026-08-05",
      "2026-08-04",
      "2026-08-06",
      "2026-08-04",
    ]);
  });

  it("turnamen sehari: semua kok jatuh ke tanggal itu", () => {
    const t = tour({ date: "2026-08-04", endDate: null, koks: [kok(3000, null, "2026-08-09")] });
    expect(t.koks[0].date).toBe("2026-08-04");
  });

  it("koksByDate mengelompokkan urut tanggal", () => {
    const groups = koksByDate([
      kok(3000, null, "2026-08-06"),
      kok(3000, null, "2026-08-04"),
      kok(3000, null, "2026-08-06"),
    ]);
    expect(groups.map((g) => [g.date, g.koks.length])).toEqual([
      ["2026-08-04", 1],
      ["2026-08-06", 2],
    ]);
  });

  it("tournamentDays merangkai semua hari turnamen", () => {
    expect(tournamentDays("2026-08-04", "2026-08-06")).toEqual([
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
    ]);
    expect(tournamentDays("2026-08-04", null)).toEqual(["2026-08-04"]);
  });

  it("matchTitle menomori partai hanya kalau babaknya lebih dari satu partai", () => {
    const ko = { format: "knockout" as const, size: 8 };
    expect(matchTitle(ko, { round: 0, index: 1 })).toBe("Perempat Final · Partai 2");
    expect(matchTitle(ko, { round: 2, index: 0 })).toBe("Final");
    expect(matchTitle({ format: "round_robin" as const, size: 4 }, { round: 0, index: 2 })).toBe(
      "Partai 3",
    );
  });
});

describe("hutang campuran game + turnamen", () => {
  const games = [enrichGame(game({ id: "g1", date: "2026-01-01", koks: [kok(3000)] }))];
  const tournaments = [
    enrichTournament(
      tour({
        id: "t1",
        date: "2026-02-01",
        size: 4,
        fee: 5000,
        names: [
          ["A", "X"],
          ["", ""],
          ["", ""],
          ["", ""],
        ],
      }),
    ),
  ];

  it("iuran belum bayar masuk rekap sebagai item terpisah", () => {
    const debt = buildDebtSummary(games, {}, tournaments);
    const a = debt.find((d) => d.name === "A")!;
    expect(a.owedGross).toBe(3000 + 5000);
    expect(a.items.map((i) => i.kind)).toEqual(["game", "turnamen"]);
    expect(a.items[1]).toMatchObject({ label: "Tarkam", amount: 5000, kokCount: 0 });
  });

  it("turnamen dengan iuran 0 tidak menagih siapa pun", () => {
    const gratis = [enrichTournament(tour({ id: "t2", fee: 0 }))];
    expect(buildDebtSummary([], {}, gratis)).toEqual([]);
  });

  it("cicilan nutup tagihan terlama dulu, lintas game & turnamen", () => {
    const plan = planInstallment(
      games.map((g) => g as StoredGame),
      {},
      "A",
      3000,
      tournaments,
    );
    expect(plan.touched).toEqual([{ kind: "game", id: "g1", index: 0 }]);
    expect(plan.clearsDebt).toBe(false);
  });

  it("cicilan pas nutup tagihan yang nominalnya pas (best-fit), bukan yang tertua", () => {
    // Kok 3000 (tertua) + kok 2500 + patungan 10000. Cicil 10000 harus pas
    // nutup patungan (diff 0), bukan malah nyicil kok dulu (5500) lalu nyisa
    // ganjil di patungan.
    const kokGames = [
      enrichGame(game({ id: "kok1", date: "2026-01-01", koks: [kok(3000)] })),
      enrichGame(game({ id: "kok2", date: "2026-01-15", koks: [kok(2500)] })),
    ];
    const bigTournament = [
      enrichTournament(
        tour({
          id: "t-besar",
          date: "2026-02-01",
          size: 4,
          fee: 10000,
          names: [
            ["A", "X"],
            ["", ""],
            ["", ""],
            ["", ""],
          ],
        }),
      ),
    ];
    const plan = planInstallment(
      kokGames.map((g) => g as StoredGame),
      {},
      "A",
      10000,
      bigTournament,
    );
    expect(plan.touched).toEqual([{ kind: "turnamen", id: "t-besar", index: 0 }]);
    expect(plan.carryAfter).toBeNull();
    expect(plan.clearsDebt).toBe(false); // kok 3000 & 2500 masih nunggak
  });

  it("lunasin semua ikut menandai iuran turnamen", () => {
    const plan = planSettle(
      games.map((g) => g as StoredGame),
      {},
      "A",
      tournaments,
    );
    expect(plan.touched).toEqual([
      { kind: "game", id: "g1", index: 0 },
      { kind: "turnamen", id: "t1", index: 0 },
    ]);
    expect(plan.paymentAmount).toBe(8000);
  });
});
