import { describe, expect, it } from "vitest";
import {
  buildKoks,
  enrichGame,
  gameCost,
  normalizeStoredGame,
  parsePlayersFromBody,
  validatePlayers,
} from "./game";
import { buildDebtSummary, planInstallment, planSettle } from "./debt";
import { countKoksByType, stockDeltas, stockDiffError } from "./stock";
import { summarize } from "./summary";
import type { CarryMap, Kok, KokType, StoredGame } from "./types";

let seq = 0;
const genId = () => `k${++seq}`;

function kok(price: number, typeId: string | null = null): Kok {
  return { id: genId(), typeId, typeName: null, pricePerPerson: price };
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

describe("gameCost", () => {
  it("jumlahkan pricePerPerson tiap kok, total = *4", () => {
    const g = game({ koks: [kok(3000), kok(2000)] });
    expect(gameCost(g)).toEqual({ perPerson: 5000, total: 20000, kokCount: 2 });
  });
  it("tanpa kok = 0", () => {
    expect(gameCost(game({ koks: [] }))).toEqual({ perPerson: 0, total: 0, kokCount: 0 });
  });
});

describe("normalizeStoredGame", () => {
  it("selalu 4 pemain + trim nama", () => {
    const g = normalizeStoredGame({ players: [{ name: "  Ryan   Pra ", paid: true }] });
    expect(g.players).toHaveLength(4);
    expect(g.players[0]).toEqual({ name: "Ryan Pra", paid: true });
    expect(g.players[3]).toEqual({ name: "", paid: false });
  });
});

describe("enrichGame", () => {
  it("split pairs + summary paid", () => {
    const g = enrichGame(
      game({
        koks: [kok(3000)],
        players: [
          { name: "A", paid: true },
          { name: "B", paid: false },
          { name: "C", paid: false },
          { name: "D", paid: false },
        ],
      }),
    );
    expect(g.cost.perPerson).toBe(3000);
    expect(g.players.every((p) => p.amount === 3000)).toBe(true);
    expect(g.pairs.a.players.map((p) => p.name)).toEqual(["A", "B"]);
    expect(g.pairs.b.players.map((p) => p.name)).toEqual(["C", "D"]);
    expect(g.summary).toMatchObject({
      paidCount: 1,
      unpaidCount: 3,
      paidTotal: 3000,
      unpaidTotal: 9000,
      allPaid: false,
    });
  });
});

describe("parsePlayersFromBody + validatePlayers", () => {
  it("pairs a/b → 4 pemain", () => {
    const r = parsePlayersFromBody({ pairs: { a: ["A", "B"], b: ["C", "D"] } });
    expect(r.players?.map((p) => p.name)).toEqual(["A", "B", "C", "D"]);
    expect(validatePlayers(r.players)).toBeNull();
  });
  it("tolak nama dobel", () => {
    const r = parsePlayersFromBody({ pairs: { a: ["A", "A"], b: ["C", "D"] } });
    expect(validatePlayers(r.players)).toBe("Nama pemain tidak boleh dobel");
  });
  it("pertahankan paid dari existing kalau body string", () => {
    const existing = [
      { name: "A", paid: true },
      { name: "B", paid: false },
      { name: "C", paid: true },
      { name: "D", paid: false },
    ];
    const r = parsePlayersFromBody({ players: ["A", "B", "C", "D"] }, existing);
    expect(r.players?.map((p) => p.paid)).toEqual([true, false, true, false]);
  });
});

describe("buildKoks", () => {
  const types: KokType[] = [
    {
      id: "t1",
      name: "RS",
      pricePerPerson: 4000,
      pricePerSlop: 0,
      stock: 10,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ];
  it("kokCount pakai harga default type", () => {
    const koks = buildKoks({ kokCount: 3, typeId: "t1" }, 3000, types, genId);
    expect(koks).toHaveLength(3);
    expect(koks.every((k) => k.pricePerPerson === 4000 && k.typeId === "t1")).toBe(true);
  });
  it("koks eksplisit di-snapshot", () => {
    const koks = buildKoks(
      { koks: [{ typeId: "t1", pricePerPerson: 5000 }] },
      3000,
      types,
      genId,
    );
    expect(koks[0].pricePerPerson).toBe(5000);
    expect(koks[0].typeName).toBe("RS");
  });
  it("fallback default price kalau tanpa type", () => {
    const koks = buildKoks({ kokCount: 1 }, 3000, [], genId);
    expect(koks[0].pricePerPerson).toBe(3000);
  });
});

describe("buildDebtSummary", () => {
  it("akumulasi unpaid, carry kurangi, urut total desc", () => {
    const games = [
      enrichGame(
        game({
          id: "g1",
          koks: [kok(3000)],
          players: [
            { name: "A", paid: false },
            { name: "B", paid: false },
            { name: "C", paid: true },
            { name: "D", paid: false },
          ],
        }),
      ),
      enrichGame(
        game({
          id: "g2",
          koks: [kok(3000), kok(3000)],
          players: [
            { name: "A", paid: false },
            { name: "X", paid: false },
            { name: "Y", paid: false },
            { name: "Z", paid: false },
          ],
        }),
      ),
    ];
    const carry: CarryMap = { A: 2000 };
    const debt = buildDebtSummary(games, carry);
    const a = debt.find((d) => d.name === "A")!;
    expect(a.owedGross).toBe(3000 + 6000);
    expect(a.carry).toBe(2000);
    expect(a.total).toBe(7000);
    // urutan menurun berdasarkan total
    expect(debt[0].total).toBeGreaterThanOrEqual(debt[debt.length - 1].total);
  });
});

describe("planInstallment (greedy oldest-first)", () => {
  const games = [
    game({ id: "old", date: "2026-01-01", koks: [kok(3000)] }),
    game({ id: "new", date: "2026-02-01", koks: [kok(3000)] }),
  ];
  it("bayar cukup 1 game terlama dulu, sisa jadi carry", () => {
    const plan = planInstallment(games, {}, "A", 4000);
    expect(plan.touched).toEqual([{ gameId: "old", index: 0 }]);
    expect(plan.carryAfter).toBe(1000);
    expect(plan.paymentAmount).toBe(4000);
  });
  it("carry lama ikut jadi kredit", () => {
    const plan = planInstallment(games, { A: 2000 }, "A", 4000); // 6000 → lunasi 2 game
    expect(plan.touched).toEqual([
      { gameId: "old", index: 0 },
      { gameId: "new", index: 0 },
    ]);
    expect(plan.carryAfter).toBeNull();
  });
});

describe("planSettle", () => {
  it("flip semua unpaid, payment = settled − carry titipan", () => {
    const games = [
      game({ id: "g1", koks: [kok(3000)] }),
      game({ id: "g2", koks: [kok(3000)] }),
    ];
    const plan = planSettle(games, { A: 2000 }, "A");
    expect(plan.touched).toHaveLength(2);
    expect(plan.carryAfter).toBeNull();
    expect(plan.paymentAmount).toBe(6000 - 2000);
  });
});

describe("stock", () => {
  const types: KokType[] = [
    {
      id: "t1",
      name: "RS",
      pricePerPerson: 4000,
      pricePerSlop: 0,
      stock: 2,
      active: true,
      createdAt: "",
      updatedAt: "",
    },
  ];
  it("countKoksByType", () => {
    const m = countKoksByType([kok(1, "t1"), kok(1, "t1"), kok(1, null)]);
    expect(m.get("t1")).toBe(2);
  });
  it("stockDeltas: pakai 2 kok baru → delta -2", () => {
    const d = stockDeltas([], [kok(1, "t1"), kok(1, "t1")]);
    expect(d.get("t1")).toBe(-2);
  });
  it("stockDiffError kalau butuh > sisa", () => {
    const err = stockDiffError(types, [], [kok(1, "t1"), kok(1, "t1"), kok(1, "t1")]);
    expect(err).toMatch(/tidak cukup/);
  });
  it("stockDiffError null kalau cukup", () => {
    expect(stockDiffError(types, [], [kok(1, "t1"), kok(1, "t1")])).toBeNull();
  });
});

describe("summarize", () => {
  it("publik sembunyikan merchantQris, admin tampil + kas", () => {
    const db = {
      settings: { defaultPricePerPerson: 3000, merchantQris: "QRISPAYLOAD" },
      players: [{ name: "A", photo: null }],
      games: [game({ id: "g1", koks: [kok(3000)] })],
      kokTypes: [],
      carry: {},
      totalExpense: 5000,
    };
    const pub = summarize(db, false);
    expect(pub.settings.qrisEnabled).toBe(true);
    expect(pub.settings.merchantQris).toBeUndefined();
    expect(pub.kas).toBeUndefined();

    const adm = summarize(db, true);
    expect(adm.settings.merchantQris).toBe("QRISPAYLOAD");
    expect(adm.kas).toEqual({ paid: 0, expense: 5000, net: -5000 });
  });
});
