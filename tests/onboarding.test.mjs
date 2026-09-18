// Onboarding draft persistence.
//
// Granting incognito access makes Chrome reload the extension, which tears down the
// onboarding page — on the exact step that tells the user to go and grant it. Every
// answer was lost and the flow restarted at step one. The draft is what makes that
// survivable, so its shape is worth pinning.

import { createEnv, makeTester, eq, ok, notOk } from "./harness.mjs";

export default async function () {
  const t = makeTester("onboarding draft");
  const { run, runAsync, local } = createEnv();

  await t("a fresh profile has no draft", async () => {
    await runAsync(`await bootstrap();`);
    const { onboardingDraft } = await runAsync(`return storageGet(["onboardingDraft"]);`);
    eq(onboardingDraft, null);
  });

  await t("onboarding is not marked complete on a fresh profile", async () => {
    const { onboardingCompleted } = await runAsync(`return storageGet(["onboardingCompleted"]);`);
    eq(onboardingCompleted, false);
  });

  // The draft is an ordinary storage key, so the import filter must accept it — a
  // restored backup that dropped it would be fine, but one that dropped the key from
  // the defaults would make bootstrap re-add it forever.
  await t("draft is a known key, so imports and bootstrap agree on it", async () => {
    const defaults = await runAsync(`return getDefaults(todayLocal());`);
    ok("onboardingDraft" in defaults, "must be in the schema defaults");
    ok("setupMode" in defaults, "setupMode must be in the schema defaults");
  });

  await t("a draft round-trips through storage", async () => {
    await runAsync(`
      await storageSet({ onboardingDraft: {
        index: 4, mode: "guardian", sensitivity: "strict",
        partnerHash: "a".repeat(64), partnerLabel: "Sam",
        windowEnabled: true, windowStart: 22, windowEnd: 6,
        dwell: true, hours: 5.5, resumePending: true,
      }});
    `);
    const { onboardingDraft: d } = await runAsync(`return storageGet(["onboardingDraft"]);`);
    eq(d.index, 4);
    eq(d.mode, "guardian");
    eq(d.partnerLabel, "Sam");
    ok(d.resumePending);
  });

  // The phrase itself must never reach storage, only its hash — the same rule the
  // finished settings follow.
  await t("the draft carries a hash, never a passphrase", async () => {
    const { onboardingDraft: d } = await runAsync(`return storageGet(["onboardingDraft"]);`);
    eq(d.partnerHash.length, 64);
    notOk(JSON.stringify(d).includes("keep going"), "no phrase text anywhere in the draft");
  });

  await t("bootstrap leaves an existing draft alone", async () => {
    await runAsync(`await bootstrap();`);
    const { onboardingDraft: d } = await runAsync(`return storageGet(["onboardingDraft"]);`);
    eq(d.index, 4, "bootstrap must not reset a draft in progress");
  });

  // resumePending is what stops the worker reopening onboarding for someone who simply
  // closed the tab and never wants to see it again.
  await t("resume is opt-in, not implied by an incomplete onboarding", async () => {
    await runAsync(`await storageSet({ onboardingDraft: { index: 2, resumePending: false } });`);
    const { onboardingDraft: d } = await runAsync(`return storageGet(["onboardingDraft"]);`);
    notOk(d.resumePending);
  });

  await t("finishing clears the draft", async () => {
    await runAsync(`
      await storageSet({ onboardingCompleted: true });
      await storageRemove("onboardingDraft");
    `);
    const out = await runAsync(`return storageGet(["onboardingDraft", "onboardingCompleted"]);`);
    eq(out.onboardingDraft, undefined);
    eq(out.onboardingCompleted, true);
  });

  return t;
}
