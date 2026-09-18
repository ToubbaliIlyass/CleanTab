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
    hours: null,
  };

  let index = 0;

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

    if (index === 4) checkIncognito();
  }

  function refreshGate() {
    el("nextBtn").disabled = !STEPS[index].gate();
  }

  function goTo(next) {
    if (next < 0 || next >= STEPS.length) return;
    index = next;
    render();
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
  });

  // ── 1 · Intent ─────────────────────────────────────────────────────────────

  document.querySelectorAll("#modePicker .pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll("#modePicker .pick").forEach((b) =>
        b.classList.toggle("selected", b === btn));
      applyMode();
      refreshGate();
    });
  });

  function applyMode() {
    const guardian = state.mode === "guardian";
    el("selfLock").style.display = guardian ? "none" : "";
    el("guardianLock").style.display = guardian ? "" : "none";

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
    if (guardian && !el("optStrictKid").dataset.touched) {
      el("optStrictKid").checked = true;
      state.dwell = true;
    }
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
      refreshGate();
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

  function updateLockStack() {
    const on = {
      passphrase: true,
      cooldown: true,
      partner: state.partnerEnabled && Boolean(state.partnerHash),
      window: state.windowEnabled,
      policy: false,
    };
    document.querySelectorAll(".lock-layer").forEach((layer) => {
      const key = layer.dataset.layer;
      layer.classList.toggle("on", Boolean(on[key]));
      const stateEl = layer.querySelector(".lock-state");
      if (key === "partner") stateEl.textContent = on.partner ? "On" : "Off";
      if (key === "window") {
        stateEl.textContent = on.window
          ? `${formatHour(state.windowStart)}–${formatHour(state.windowEnd)}`
          : "Off";
      }
      if (key === "policy") {
        stateEl.textContent = state.mode === "guardian" ? "See the guide" : "Optional";
      }
    });
  }

  el("optPartner").addEventListener("change", (e) => {
    state.partnerEnabled = e.target.checked;
    el("partnerPanel").style.display = e.target.checked ? "" : "none";
    if (!e.target.checked) {
      state.partnerHash = null;
      state.partnerLabel = null;
    }
    updateLockStack();
    refreshGate();
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
  });
  el("winStart").addEventListener("change", (e) => {
    state.windowStart = Number(e.target.value);
    updateLockStack();
  });
  el("winEnd").addEventListener("change", (e) => {
    state.windowEnd = Number(e.target.value);
    updateLockStack();
  });

  el("optStrictKid").addEventListener("change", (e) => {
    e.target.dataset.touched = "1";
    state.dwell = e.target.checked;
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

  function setIncognito(stateName, text, switchOn) {
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
    if (document.visibilityState === "visible" && index === 4) checkIncognito();
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
    });
  });

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
      goalMinutes: computeInitialGoal(state.hours),
      sensitivity: state.sensitivity || DEFAULT_SENSITIVITY,
      enableDwellDetection: state.dwell,
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
        window.close();
      } catch {
        alert("Invalid CleanTab backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ── Boot ───────────────────────────────────────────────────────────────────

  updateLockStack();
  paintMeter(null);
  render();
});
