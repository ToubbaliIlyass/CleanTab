document.addEventListener("DOMContentLoaded", () => {
  // A horizontal deck rather than a scrolling page: one question per screen, the slide
  // moves right-to-left, and the window itself never scrolls. The old version stacked
  // full-height sections and let the page scroll, so a step could be half-read and the
  // progress dots disagreed with what you were looking at.
  //
  // Step 1 is intent routing — setting this up for yourself is a different product from
  // setting it up for a child, and asking up front is what lets the rest of the flow
  // stop hedging. Everything after it branches on the answer.

  const el = (id) => document.getElementById(id);

  const STEPS = [
    { key: "welcome",   gate: () => state.acknowledged },
    { key: "intent",    gate: () => Boolean(state.mode) },
    { key: "sensitivity", gate: () => Boolean(state.sensitivity) },
    { key: "lock",      gate: () => lockStepSatisfied() },
    { key: "incognito", gate: () => state.incognitoResolved },
    { key: "day",       gate: () => state.hours !== null },
  ];

  const state = {
    acknowledged: false,
    mode: null,          // "self" | "guardian"
    sensitivity: null,
    partnerEnabled: false,
    partnerHash: null,
    partnerLabel: null,
    windowEnabled: false,
    windowStart: 22,
    windowEnd: 6,
    dwell: false,
    incognitoResolved: false,
    policyActive: false,
    hours: null,
  };

  let index = 0;

  // ── Draft persistence ──────────────────────────────────────────────────────
  //
  // Toggling "Allow in Incognito" makes Chrome RELOAD the extension, which tears down
  // this page — you came back to a fresh step 1 with every answer gone, on the one step
  // that tells you to go and do exactly that. Progress is written on every change and
  // restored on load, so a reload costs nothing.
  //
  // The partner passphrase is stored as its hash, never as the phrase, same as
  // everywhere else.

  const DRAFT_KEY = "onboardingDraft";
  let draftTimer = null;

  function saveDraft(extra = {}) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      storageSet({ [DRAFT_KEY]: { ...state, index, ...extra } }).catch(() => {});
    }, 120);
  }

  // Re-running setup should start from what you already have, not from blank. Without
  // this, a parent who re-runs it to change sensitivity and skips the partner step
  // would silently drop the passphrase they set — setup would become a way to weaken
  // the lock rather than configure it.
  async function loadExistingSettings() {
    let data;
    try {
      data = await storageGet([
        "onboardingCompleted", "setupMode", "sensitivity", "enableDwellDetection",
        "partnerLockHash", "partnerLockLabel", "lockWindow", "selfEstimateHours",
      ]);
    } catch {
      return false;
    }
    if (!data.onboardingCompleted) return false;

    state.acknowledged = true;               // already agreed to this once
    state.mode = data.setupMode || "self";
    state.sensitivity = data.sensitivity || null;
    state.dwell = Boolean(data.enableDwellDetection);
    state.partnerHash = data.partnerLockHash || null;
    state.partnerLabel = data.partnerLockLabel || null;
    state.partnerEnabled = Boolean(data.partnerLockHash);
    state.windowEnabled = Boolean(data.lockWindow?.enabled);
    state.windowStart = Number.isFinite(data.lockWindow?.startHour) ? data.lockWindow.startHour : 22;
    state.windowEnd = Number.isFinite(data.lockWindow?.endHour) ? data.lockWindow.endHour : 6;
    state.hours = data.selfEstimateHours ?? null;

    el("ackBox").checked = true;
    document.querySelectorAll("#modePicker .pick").forEach((b) =>
      b.classList.toggle("selected", b.dataset.mode === state.mode));
    applyMode();
    if (state.sensitivity) {
      sensPicker.querySelectorAll(".pick").forEach((b) =>
        b.classList.toggle("selected", b.dataset.sens === state.sensitivity));
      paintMeter(state.sensitivity);
    }
    el("optStrictKid").checked = state.dwell;
    el("optPartner").checked = state.partnerEnabled;
    el("partnerPanel").style.display = state.partnerEnabled ? "" : "none";
    if (state.partnerHash) {
      el("partnerError").style.display = "";
      el("partnerError").style.color = "var(--text2)";
      el("partnerError").textContent = state.partnerLabel
        ? `${state.partnerLabel}'s passphrase is already set. Retype both fields to change it.`
        : "A passphrase is already set. Retype both fields to change it.";
    }
    el("optWindow").checked = state.windowEnabled;
    el("winStart").value = String(state.windowStart);
    el("winEnd").value = String(state.windowEnd);
    if (state.hours !== null) {
      document.querySelectorAll("#hoursPicker .pick").forEach((b) =>
        b.classList.toggle("selected", parseFloat(b.dataset.hours) === state.hours));
      paintRing();
    }
    updateLockStack();
    return true;
  }

  async function restoreDraft() {
    let draft;
    try {
      ({ [DRAFT_KEY]: draft } = await storageGet([DRAFT_KEY]));
    } catch {
      return false;
    }
    if (!draft || typeof draft.index !== "number") return false;

    Object.assign(state, {
      acknowledged: Boolean(draft.acknowledged),
      mode: draft.mode || null,
      sensitivity: draft.sensitivity || null,
      partnerEnabled: Boolean(draft.partnerEnabled),
      partnerHash: draft.partnerHash || null,
      partnerLabel: draft.partnerLabel || null,
      windowEnabled: Boolean(draft.windowEnabled),
      windowStart: Number.isFinite(draft.windowStart) ? draft.windowStart : 22,
      windowEnd: Number.isFinite(draft.windowEnd) ? draft.windowEnd : 6,
      dwell: Boolean(draft.dwell),
      incognitoResolved: Boolean(draft.incognitoResolved),
      hours: draft.hours ?? null,
    });

    // Reflect the restored state in the controls.
    el("ackBox").checked = state.acknowledged;
    if (state.mode) {
      document.querySelectorAll("#modePicker .pick").forEach((b) =>
        b.classList.toggle("selected", b.dataset.mode === state.mode));
      applyMode();
    }
    if (state.sensitivity) {
      sensPicker.querySelectorAll(".pick").forEach((b) =>
        b.classList.toggle("selected", b.dataset.sens === state.sensitivity));
      paintMeter(state.sensitivity);
    }
    el("optStrictKid").checked = state.dwell;
    el("optPartner").checked = state.partnerEnabled;
    el("partnerPanel").style.display = state.partnerEnabled ? "" : "none";
    if (state.partnerHash) {
      // The phrase itself was never stored, so say so rather than showing empty fields
      // that look like nothing was saved.
      el("partnerError").style.display = "";
      el("partnerError").style.color = "var(--text2)";
      el("partnerError").textContent = state.partnerLabel
        ? `${state.partnerLabel}'s passphrase is saved. Retype both fields to change it.`
        : "Passphrase saved. Retype both fields to change it.";
    }
    el("optWindow").checked = state.windowEnabled;
    el("winStart").value = String(state.windowStart);
    el("winEnd").value = String(state.windowEnd);
    if (state.hours !== null) {
      document.querySelectorAll("#hoursPicker .pick").forEach((b) =>
        b.classList.toggle("selected", parseFloat(b.dataset.hours) === state.hours));
      paintRing();
    }
    updateLockStack();

    index = Math.min(Math.max(draft.index, 0), STEPS.length - 1);
    return true;
  }

  // ── Deck ───────────────────────────────────────────────────────────────────

  const deck = el("deck");
  const slides = [...document.querySelectorAll(".slide")];
  const progress = el("progress");

  STEPS.forEach(() => {
    const seg = document.createElement("span");
    seg.className = "seg";
    progress.appendChild(seg);
  });
  const segments = [...progress.children];
  el("stepTotal").textContent = String(STEPS.length);

  function render() {
    deck.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((s, i) => s.classList.toggle("is-active", i === index));
    segments.forEach((seg, i) => {
      seg.classList.toggle("done", i < index);
      seg.classList.toggle("now", i === index);
    });
    el("stepNow").textContent = String(index + 1);
    el("backBtn").style.visibility = index === 0 ? "hidden" : "visible";
    el("importLink").style.display = index === 0 ? "" : "none";

    const last = index === STEPS.length - 1;
    const next = el("nextBtn");
    next.innerHTML = last
      ? 'Start browsing <span class="cta-arrow">→</span>'
      : 'Next <span class="cta-arrow">→</span>';
    refreshGate();

    // Slides are focusable regions; moving focus keeps the keyboard path sane and
    // stops a hidden slide's controls from being tabbable.
    slides.forEach((s, i) => {
      s.querySelectorAll("button, input, select, a").forEach((node) => {
        node.tabIndex = i === index ? 0 : -1;
      });
    });

    if (index === 3) checkPolicy();
    if (index === 4) checkIncognito();
    if (index === 5) renderSummary();
  }

  function refreshGate() {
    el("nextBtn").disabled = !STEPS[index].gate();
  }

  function goTo(next) {
    if (next < 0 || next >= STEPS.length) return;
    index = next;
    render();
    saveDraft();
  }

  function advance() {
    if (!STEPS[index].gate()) return;
    if (index === STEPS.length - 1) return finish();
    goTo(index + 1);
  }

  el("nextBtn").addEventListener("click", advance);
  el("backBtn").addEventListener("click", () => goTo(index - 1));

  document.addEventListener("keydown", (e) => {
    // Enter advances, which is the single biggest speed-up in a flow like this. Not
    // while typing a passphrase, though — Enter there would submit a half-typed field.
    const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
      && document.activeElement?.type !== "checkbox";
    if (e.key === "Enter" && !typing) { e.preventDefault(); advance(); }
    if (e.key === "ArrowRight" && !typing) advance();
    if (e.key === "ArrowLeft" && !typing) goTo(index - 1);
  });

  // ── 0 · Welcome ────────────────────────────────────────────────────────────

  el("ackBox").addEventListener("change", (e) => {
    state.acknowledged = e.target.checked;
    refreshGate();
    saveDraft();
  });

  // ── 1 · Intent ─────────────────────────────────────────────────────────────

  document.querySelectorAll("#modePicker .pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll("#modePicker .pick").forEach((b) =>
        b.classList.toggle("selected", b === btn));
      applyMode();
      refreshGate();
      saveDraft();
    });
  });

  function applyMode() {
    const guardian = state.mode === "guardian";
    // The partner passphrase and the overnight lock apply to BOTH paths. They used to be
    // inside the self-only block, so on the guardian path the lock stack advertised two
    // layers with no control anywhere to turn them on.
    el("guardianLock").style.display = guardian ? "" : "none";
    el("recheckPolicy").style.display = guardian ? "" : "none";

    el("partnerOptTitle").textContent = guardian
      ? "Set a passphrase they don't know"
      : "Ask someone to hold the passphrase";
    el("partnerOptSub").textContent = guardian
      ? "You keep it. They can't disable protection without you. Stored as a one-way hash."
      : "They type it now and keep it. Stored as a one-way hash — nothing is sent anywhere.";
    el("windowOptTitle").textContent = guardian
      ? "Lock the off switch overnight"
      : "Lock the off switch overnight";

    el("lockHeadline").innerHTML = guardian
      ? "Make it hard<br/>to remove."
      : "Make it hard<br/>to switch off.";
    el("lockLede").textContent = guardian
      ? "Anything they can undo in two clicks isn't protection. These are the layers that actually hold."
      : "A blocker you can turn off in two clicks isn't a blocker. Turn on as much friction as you'll actually keep.";
    el("lockFoot").textContent = guardian
      ? "Getting past one wrong block stays one click for them — that's deliberate, so a misfire on a school page doesn't become a reason to fight the tool."
      : "Getting past one wrong block stays one click, whatever you turn on here.";

    el("dayHeadline").textContent = guardian ? "Last question." : "One last question.";
    el("dayLede").textContent = guardian
      ? "This sets the browsing floor their ring needs before a day counts. Rough is fine."
      : "This sets the browsing floor your ring needs before a day counts. Rough is fine.";

    // The guardian path recommends image scanning; the self path leaves it off.
    syncDwellControl();
    updateLockStack();
  }

  // ── 2 · Sensitivity ────────────────────────────────────────────────────────

  const sensPicker = el("sensPicker");
  const METER = { strict: 100, balanced: 62, lenient: 28 };
  const ORDER = ["lenient", "balanced", "strict"];

  ORDER.forEach((key) => {
    const profile = SENSITIVITY_PROFILES[key];
    const btn = document.createElement("button");
    btn.className = "pick";
    btn.dataset.sens = key;
    btn.innerHTML =
      `<span class="pick-title">${profile.label}</span>` +
      `<span class="pick-sub">${profile.blurb}</span>`;
    btn.addEventListener("click", () => {
      state.sensitivity = key;
      sensPicker.querySelectorAll(".pick").forEach((b) => b.classList.toggle("selected", b === btn));
      paintMeter(key);
      syncDwellControl();
      refreshGate();
      saveDraft();
    });
    sensPicker.appendChild(btn);
  });

  const meterRows = el("meterRows");
  const METER_ROWS = [
    "A search for an explicit term",
    "A site full of explicit titles",
    "A borderline news article",
    "Images you linger on",
  ];

  function paintMeter(key) {
    const value = el("meterValue");
    if (!key) {
      value.textContent = "Pick one";
      value.classList.add("empty");
      el("meterFill").style.width = "0%";
      drawRows(() => false);
      return;
    }
    value.textContent = SENSITIVITY_PROFILES[key].label;
    value.classList.remove("empty");
    el("meterFill").style.width = `${METER[key]}%`;
    drawRows((row, i) => {
      if (i < 2) return true;
      if (i === 2) return key === "strict";
      return SENSITIVITY_PROFILES[key].dwell;
    });
  }

  // Lenient disables image scanning at the profile level, so offering the toggle there
  // would be a control that silently does nothing.
  function syncDwellControl() {
    const box = el("optStrictKid");
    const allowed = !state.sensitivity || SENSITIVITY_PROFILES[state.sensitivity].dwell;
    box.disabled = !allowed;
    if (!allowed) { box.checked = false; state.dwell = false; }
    else if (state.mode === "guardian" && !box.dataset.touched) { box.checked = true; state.dwell = true; }
    el("dwellSub").textContent = allowed
      ? "Classifies pictures locally, only when you stop on one. Costs some battery."
      : "Lenient turns image scanning off entirely, so this isn't available.";
  }

  function drawRows(isOn) {
    meterRows.innerHTML = "";
    METER_ROWS.forEach((text, i) => {
      const row = document.createElement("div");
      row.className = `meter-row${isOn(text, i) ? " on" : ""}`;
      row.innerHTML = `<span class="dot"></span><span>${text}</span>`;
      meterRows.appendChild(row);
    });
  }

  // ── 3 · Lock strength ──────────────────────────────────────────────────────

  function hourOptions(select, selected) {
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = formatHour(h);
      if (h === selected) opt.selected = true;
      select.appendChild(opt);
    }
  }
  hourOptions(el("winStart"), 22);
  hourOptions(el("winEnd"), 6);

  // What is actually on, in one place, so the stack and the closing summary can never
  // disagree with each other.
  function lockLayers() {
    const guardian = state.mode === "guardian";
    return {
      passphrase: { on: true, label: "Typed passphrase", state: "Always on" },
      cooldown:   { on: true, label: "Cooldown, doubling", state: "Always on" },
      partner: {
        on: state.partnerEnabled && Boolean(state.partnerHash),
        label: guardian ? "Passphrase only you know" : "Partner holds the key",
        state: state.partnerEnabled && state.partnerHash
          ? (state.partnerLabel ? state.partnerLabel : "On")
          : "Off",
      },
      window: {
        on: state.windowEnabled,
        label: "Overnight lock",
        state: state.windowEnabled
          ? `${formatHour(state.windowStart)}–${formatHour(state.windowEnd)}`
          : "Off",
      },
      policy: {
        on: state.policyActive,
        label: "Admin policy",
        state: state.policyActive ? "Detected" : (guardian ? "Not set up yet" : "Off"),
      },
    };
  }

  function updateLockStack() {
    const layers = lockLayers();
    document.querySelectorAll(".lock-layer").forEach((layer) => {
      const info = layers[layer.dataset.layer];
      if (!info) return;
      layer.classList.toggle("on", info.on);
      layer.querySelector(".lock-name").textContent = info.label;
      layer.querySelector(".lock-state").textContent = info.state;
    });
  }

  // The admin-policy layer used to be hardcoded off, so it could never reflect reality —
  // you could set the policy up and the card would still say it was not there. Managed
  // storage is populated the moment a policy applies, which makes this checkable the same
  // way incognito access is.
  function checkPolicy() {
    if (!chrome.storage?.managed) { updateLockStack(); return; }
    try {
      chrome.storage.managed.get(null, (values) => {
        void chrome.runtime.lastError;
        state.policyActive = Boolean(values && Object.keys(values).length);
        updateLockStack();
      });
    } catch {
      updateLockStack();
    }
  }

  el("recheckPolicy").addEventListener("click", checkPolicy);

  el("optPartner").addEventListener("change", (e) => {
    state.partnerEnabled = e.target.checked;
    el("partnerPanel").style.display = e.target.checked ? "" : "none";
    if (!e.target.checked) {
      state.partnerHash = null;
      state.partnerLabel = null;
    }
    updateLockStack();
    refreshGate();
    saveDraft();
  });

  async function validatePartner() {
    const phrase = el("partnerPhrase").value;
    const repeat = el("partnerRepeat").value;
    const error = el("partnerError");
    let message = "";

    if (phrase && !isValidPartnerPassphrase(phrase)) {
      message = `At least ${PARTNER_MIN_LENGTH} characters.`;
    } else if (phrase && repeat && normalizePassphrase(phrase) !== normalizePassphrase(repeat)) {
      message = "The two entries don't match.";
    }
    error.textContent = message;
    error.style.display = message ? "" : "none";

    const ready = isValidPartnerPassphrase(phrase) &&
      normalizePassphrase(phrase) === normalizePassphrase(repeat);
    state.partnerHash = ready ? await hashPassphrase(phrase) : null;
    state.partnerLabel = el("partnerName").value.trim() || null;
    updateLockStack();
    refreshGate();
    saveDraft();
  }

  ["partnerPhrase", "partnerRepeat", "partnerName"].forEach((id) => {
    el(id).addEventListener("input", validatePartner);
  });
  // Same reasoning as the disable flow: pasting defeats the point of the other person
  // actually typing it.
  ["partnerPhrase", "partnerRepeat"].forEach((id) => {
    el(id).addEventListener("paste", (e) => e.preventDefault());
    el(id).addEventListener("drop", (e) => e.preventDefault());
  });

  el("optWindow").addEventListener("change", (e) => {
    state.windowEnabled = e.target.checked;
    updateLockStack();
    saveDraft();
  });
  el("winStart").addEventListener("change", (e) => {
    state.windowStart = Number(e.target.value);
    updateLockStack();
    saveDraft();
  });
  el("winEnd").addEventListener("change", (e) => {
    state.windowEnd = Number(e.target.value);
    updateLockStack();
    saveDraft();
  });

  el("optStrictKid").addEventListener("change", (e) => {
    e.target.dataset.touched = "1";
    state.dwell = e.target.checked;
    saveDraft();
  });

  el("openDeploy").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://cleantab.acture.co/deploy" });
  });

  // The lock step is optional by design — someone who turns nothing on still gets the
  // passphrase and the escalating cooldown. It only blocks when a partner phrase was
  // started and left half-finished, which would otherwise be silently discarded.
  function lockStepSatisfied() {
    if (!state.partnerEnabled) return true;
    return Boolean(state.partnerHash);
  }

  // ── 4 · Incognito ──────────────────────────────────────────────────────────

  let poll = null;

  let incognitoOn = false;
  let incognitoWord = "Not allowed";

  function incognitoSummary() { return incognitoWord; }

  function setIncognito(stateName, text, switchOn) {
    incognitoOn = Boolean(switchOn);
    saveDraft();
    incognitoWord = stateName === "ok" ? "Allowed"
      : stateName === "skipped" ? "Skipped"
      : stateName === "unknown" ? "Unverified"
      : "Not allowed";
    el("incognitoStatus").dataset.state = stateName;
    el("incognitoStatusText").textContent = text;
    el("mockSwitch").classList.toggle("on", Boolean(switchOn));
  }

  function checkIncognito() {
    if (!chrome.extension?.isAllowedIncognitoAccess) {
      setIncognito("unknown", "Can't verify this automatically — check it on the settings page.", false);
      state.incognitoResolved = true;
      refreshGate();
      return;
    }
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      if (allowed) {
        setIncognito("ok", "Allowed in Incognito. Protection follows you there.", true);
        state.incognitoResolved = true;
        if (poll) { clearInterval(poll); poll = null; }
      } else if (!state.incognitoResolved) {
        setIncognito("pending", "Not allowed in Incognito yet.", false);
      }
      refreshGate();
    });
  }

  el("openSettingsBtn").addEventListener("click", () => {
    // Changing incognito access reloads the extension, which can take this tab with it.
    // Mark the draft so the service worker knows to bring the page back.
    saveDraft({ resumePending: true });
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    if (!poll) poll = setInterval(checkIncognito, 1500);
  });
  el("recheckBtn").addEventListener("click", checkIncognito);
  el("skipIncognito").addEventListener("click", () => {
    setIncognito("skipped", "Skipped. Incognito windows will have no protection.", false);
    state.incognitoResolved = true;
    if (poll) { clearInterval(poll); poll = null; }
    refreshGate();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Both of these are things the user leaves the tab to do.
    if (index === 3) checkPolicy();
    if (index === 4) checkIncognito();
  });

  // ── 5 · Your day ───────────────────────────────────────────────────────────

  const RING_CIRCUMFERENCE = 327;

  document.querySelectorAll("#hoursPicker .pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.hours = parseFloat(btn.dataset.hours);
      document.querySelectorAll("#hoursPicker .pick").forEach((b) =>
        b.classList.toggle("selected", b === btn));
      paintRing();
      refreshGate();
      saveDraft();
    });
  });

  function renderSummary() {
    const layers = lockLayers();
    const box = el("summary");
    const rows = [
      ["Sensitivity", state.sensitivity ? SENSITIVITY_PROFILES[state.sensitivity].label : "Balanced", true],
      ["Image scanning", state.dwell ? "On" : "Off", state.dwell],
      [layers.partner.label, layers.partner.state, layers.partner.on],
      [layers.window.label, layers.window.state, layers.window.on],
      ["Incognito", incognitoSummary(), incognitoOn],
      [layers.policy.label, layers.policy.state, layers.policy.on],
    ];
    box.innerHTML = `<p class="summary-head">What you've turned on</p>`;
    for (const [name, value, on] of rows) {
      const row = document.createElement("div");
      row.className = `summary-row${on ? " on" : ""}`;
      row.innerHTML = `<span class="summary-name"></span><span class="summary-value"></span>`;
      row.querySelector(".summary-name").textContent = name;
      row.querySelector(".summary-value").textContent = value;
      box.appendChild(row);
    }
    const foot = document.createElement("p");
    foot.className = "summary-foot";
    foot.textContent = "All of this lives in the Guard tab — you can change it there.";
    box.appendChild(foot);
  }

  function paintRing() {
    const goalPct = 95;
    el("ringPct").textContent = `${goalPct}%`;
    el("ringFill").style.strokeDashoffset =
      String(RING_CIRCUMFERENCE * (1 - goalPct / 100));
    const minutes = computeInitialGoal(state.hours);
    el("ringCaption").textContent =
      `About ${minutes} minutes of browsing a day, ${goalPct}% of it clean.`;
  }

  // ── Finish ─────────────────────────────────────────────────────────────────

  async function finish() {
    await storageSet({
      selfEstimateHours: state.hours,
      enableDwellDetection: state.dwell,
      goalMinutes: computeInitialGoal(state.hours),
      sensitivity: state.sensitivity || DEFAULT_SENSITIVITY,
      setupMode: state.mode || "self",
      partnerLockHash: state.partnerHash,
      partnerLockLabel: state.partnerLabel,
      lockWindow: {
        enabled: state.windowEnabled,
        startHour: state.windowStart,
        endHour: state.windowEnd,
      },
      onboardingCompleted: true,
    });
    await storageRemove(DRAFT_KEY);
    window.close();
  }

  // ── Restore a backup ───────────────────────────────────────────────────────

  const importFile = el("importFile");
  el("importLink").addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.schemaVersion) throw new Error("not a CleanTab backup");

        const importable = new Set(Object.keys(getDefaults(todayLocal())));
        const clean = {};
        for (const [k, v] of Object.entries(data)) if (importable.has(k)) clean[k] = v;
        if (clean.schemaVersion === 1) Object.assign(clean, migrateV1ToV2(clean));
        clean.onboardingCompleted = true;

        await storageSet(clean);
        await storageRemove(DRAFT_KEY);
        window.close();
      } catch {
        alert("Invalid CleanTab backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ── Boot ───────────────────────────────────────────────────────────────────

  (async () => {
    updateLockStack();
    paintMeter(null);
    const resumed = await restoreDraft();
    if (!resumed) await loadExistingSettings();
    render();
    if (resumed) {
      // We are back; the worker no longer needs to reopen this page.
      saveDraft({ resumePending: false });
    }
  })();
});
