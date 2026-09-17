// Lock strength: the partner passphrase, the escalating cooldown, the lock window, and
// the managed-policy merge.
//
// The invariant that matters most here is the asymmetry: these paths govern turning the
// tool OFF, and none of them may touch the per-page escape hatch. A hard lock over a
// detector with a real false-positive rate is how a blocker gets uninstalled.

import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export default async function () {
  const t = makeTester("lock strength");
  const { run, runAsync } = createEnv();

  // ── Partner passphrase ─────────────────────────────────────────────────────
  t("hashes to 64 hex chars", async () => {
    const h = await runAsync(`return hashPassphrase("keep going friend")`);
    eq(typeof h, "string");
    eq(h.length, 64);
    ok(/^[0-9a-f]+$/.test(h));
  });

  t("the same phrase always hashes the same", async () => {
    const a = await runAsync(`return hashPassphrase("keep going friend")`);
    const b = await runAsync(`return hashPassphrase("keep going friend")`);
    eq(a, b);
  });

  t("different phrases hash differently", async () => {
    const a = await runAsync(`return hashPassphrase("keep going friend")`);
    const b = await runAsync(`return hashPassphrase("keep going  friends")`);
    ok(a !== b);
  });

  // Typed recall by a human, not a credential — case and spacing must not decide it.
  t("case and whitespace are normalized", async () => {
    const a = await runAsync(`return hashPassphrase("Keep Going Friend")`);
    const b = await runAsync(`return hashPassphrase("  keep   going friend  ")`);
    eq(a, b);
  });

  t("the raw phrase is never recoverable from storage", async () => {
    const h = await runAsync(`return hashPassphrase("keep going friend")`);
    notOk(h.includes("keep"), "hash must not contain the phrase");
  });

  t("empty phrase hashes to null", async () => {
    eq(await runAsync(`return hashPassphrase("   ")`), null);
  });

  t("matching accepts the right phrase", async () => {
    ok(await runAsync(`
      const h = await hashPassphrase("keep going friend");
      return partnerPassphraseMatches("KEEP GOING FRIEND", h);
    `));
  });

  t("matching rejects the wrong phrase", async () => {
    notOk(await runAsync(`
      const h = await hashPassphrase("keep going friend");
      return partnerPassphraseMatches("keep going", h);
    `));
  });

  // A missing hash must never mean "anything matches".
  t("matching against no stored hash always fails", async () => {
    notOk(await runAsync(`return partnerPassphraseMatches("anything", null)`));
    notOk(await runAsync(`return partnerPassphraseMatches("", null)`));
  });

  t("minimum length is enforced", () => {
    notOk(run(`isValidPartnerPassphrase("short")`));
    ok(run(`isValidPartnerPassphrase("long enough")`));
    notOk(run(`isValidPartnerPassphrase("   ")`));
  });

  // ── Escalating cooldown ────────────────────────────────────────────────────
  t("first disable waits one hour", () => eq(run(`computeCooldownMs([])`), HOUR));
  t("undefined history waits one hour", () => eq(run(`computeCooldownMs(undefined)`), HOUR));

  t("each disable this week doubles the wait", () => {
    const now = run(`Date.now()`);
    eq(run(`computeCooldownMs([${now - HOUR}])`), 2 * HOUR);
    eq(run(`computeCooldownMs([${now - HOUR}, ${now - 2 * HOUR}])`), 4 * HOUR);
    eq(run(`computeCooldownMs([${now - HOUR}, ${now - 2 * HOUR}, ${now - 3 * HOUR}])`), 8 * HOUR);
  });

  t("the wait caps at 24 hours", () => {
    const now = run(`Date.now()`);
    const many = Array.from({ length: 12 }, (_, i) => now - (i + 1) * 1000);
    eq(run(`computeCooldownMs(${JSON.stringify(many)})`), DAY);
  });

  // Escalation has to decay, or one bad week punishes someone for good.
  t("disables older than the window are forgotten", () => {
    const now = run(`Date.now()`);
    eq(run(`computeCooldownMs([${now - 8 * DAY}])`), HOUR);
    eq(run(`recentDisableCount([${now - 8 * DAY}, ${now - HOUR}])`), 1);
  });

  t("recording trims outside the window", () => {
    const now = run(`Date.now()`);
    const out = run(`recordDisableEvent([${now - 9 * DAY}, ${now - HOUR}])`);
    eq(out.length, 2); // the 9-day-old one is dropped, the new one added
  });

  t("recording tolerates junk in the list", () => {
    const out = run(`recordDisableEvent([null, "nope", undefined])`);
    eq(out.length, 1);
  });

  t("cooldown descriptions read naturally", () => {
    eq(run(`describeCooldown(${HOUR})`), "1-hour");
    eq(run(`describeCooldown(${2 * HOUR})`), "2-hour");
    eq(run(`describeCooldown(${DAY})`), "24-hour");
  });

  // ── Lock window ────────────────────────────────────────────────────────────
  // Hours are local, and a window like 22→6 wraps past midnight.
  const at = (hour) => Date.parse(`2026-09-17T${String(hour).padStart(2, "0")}:30:00`);

  t("a wrapping window covers both sides of midnight", () => {
    const w = `{enabled:true,startHour:22,endHour:6}`;
    ok(run(`isWithinLockWindow(${w}, ${at(23)})`), "23:30 is inside");
    ok(run(`isWithinLockWindow(${w}, ${at(2)})`), "02:30 is inside");
    notOk(run(`isWithinLockWindow(${w}, ${at(12)})`), "12:30 is outside");
    notOk(run(`isWithinLockWindow(${w}, ${at(6)})`), "06:30 is outside — end is exclusive");
  });

  t("a same-day window does not wrap", () => {
    const w = `{enabled:true,startHour:9,endHour:17}`;
    ok(run(`isWithinLockWindow(${w}, ${at(12)})`));
    notOk(run(`isWithinLockWindow(${w}, ${at(20)})`));
    notOk(run(`isWithinLockWindow(${w}, ${at(3)})`));
  });

  t("a disabled window is never active", () =>
    notOk(run(`isWithinLockWindow({enabled:false,startHour:0,endHour:23}, ${at(12)})`)));

  t("a missing or degenerate window is never active", () => {
    notOk(run(`isWithinLockWindow(null, ${at(12)})`));
    notOk(run(`isWithinLockWindow({enabled:true}, ${at(12)})`));
    // start === end is ambiguous: it could mean "never" or "always". Never is safer,
    // because "always" would strand the user with no off switch at all.
    notOk(run(`isWithinLockWindow({enabled:true,startHour:5,endHour:5}, ${at(5)})`));
  });

  t("hours format for humans", () => {
    eq(run(`formatHour(0)`), "12am");
    eq(run(`formatHour(12)`), "12pm");
    eq(run(`formatHour(22)`), "10pm");
    eq(run(`describeLockWindow({enabled:true,startHour:22,endHour:6})`), "10pm–6am");
  });

  // ── Managed settings ───────────────────────────────────────────────────────
  t("managed values override local ones", () => {
    const merged = run(`effectiveSettings({sensitivity:"lenient"}, {sensitivity:"strict"})`);
    eq(merged.sensitivity, "strict");
  });

  t("unset managed keys leave the user's choice alone", () => {
    const merged = run(`effectiveSettings({sensitivity:"lenient",goalMinutes:90}, {})`);
    eq(merged.sensitivity, "lenient");
    eq(merged.goalMinutes, 90);
  });

  // An admin can only set what the schema declares; anything else must not leak through.
  t("only manageable keys are merged", () => {
    const merged = run(`effectiveSettings({goalMinutes:90}, {goalMinutes:5, enabled:false})`);
    eq(merged.goalMinutes, 90);
    notOk(merged.enabled === false);
  });

  t("a managed false is honoured, not treated as absent", () => {
    const merged = run(`effectiveSettings({enableDwellDetection:true}, {enableDwellDetection:false})`);
    eq(merged.enableDwellDetection, false);
    ok(run(`isSettingManaged({enableDwellDetection:false}, "enableDwellDetection")`));
  });

  t("no managed object means nothing is managed", () => {
    notOk(run(`isSettingManaged(null, "sensitivity")`));
    notOk(run(`isSettingManaged({}, "sensitivity")`));
  });

  // ── The combined gate ──────────────────────────────────────────────────────
  t("policy can remove the off switch", () => {
    const p = run(`disablePermission({}, {allowDisable:false})`);
    notOk(p.allowed);
    eq(p.reason, "managed");
  });

  t("the lock window removes the off switch", () => {
    const p = run(`disablePermission({lockWindow:{enabled:true,startHour:22,endHour:6}}, {}, ${at(23)})`);
    notOk(p.allowed);
    eq(p.reason, "window");
    ok(p.detail.includes("10pm–6am"), "must say which window");
  });

  t("a partner lock allows the flow but names the holder", () => {
    const p = run(`disablePermission({partnerLockHash:"abc",partnerLockLabel:"Sam"}, {}, ${at(12)})`);
    ok(p.allowed);
    eq(p.reason, "partner");
    ok(p.detail.includes("Sam"));
  });

  t("an unnamed partner still gets a sensible prompt", () => {
    const p = run(`disablePermission({partnerLockHash:"abc"}, {}, ${at(12)})`);
    ok(p.detail.includes("accountability partner"));
  });

  t("with nothing configured the user may disable", () => {
    const p = run(`disablePermission({}, {}, ${at(12)})`);
    ok(p.allowed);
    eq(p.reason, "self");
  });

  // Policy outranks the window, so the message names the real reason.
  t("policy outranks the lock window", () => {
    const p = run(`disablePermission({lockWindow:{enabled:true,startHour:22,endHour:6}}, {allowDisable:false}, ${at(23)})`);
    eq(p.reason, "managed");
  });

  return t;
}
