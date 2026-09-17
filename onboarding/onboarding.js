document.addEventListener("DOMContentLoaded", () => {
  // Four screens instead of one. The old flow asked for an hours estimate and nothing
  // else — it never said what CleanTab does, what it gets wrong, or that image scanning
  // exists. Setting a goal for a product the user hasn't been told about is backwards.
  //
  // Each screen that asks something now gates its own Next button (see `gates` below).
  // Previously every question could be walked straight past: sensitivity arrived
  // pre-selected, so the most common setup was one nobody had chosen.

  let selectedHours = null;
  // Deliberately null, not DEFAULT_SENSITIVITY. A pre-selected answer is not an answer —
  // the screen asked a question and the user should have to answer it.
  let selectedSensitivity = null;

  // ── Gates ──────────────────────────────────────────────────────────────────
  // Each forward button carries data-gate and stays disabled until its screen has
  // actually been satisfied. Back buttons are never gated.
  const gates = { ack: false, sens: false, incognito: false };

  function refreshGates() {
    document.querySelectorAll("[data-gate]").forEach((btn) => {
      btn.disabled = !gates[btn.dataset.gate];
    });
  }

  function satisfy(name) {
    gates[name] = true;
    refreshGates();
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  function goToStep(index) {
    document.querySelectorAll(".step").forEach((s) => {
      s.classList.toggle("is-active", Number(s.dataset.step) === index);
    });
    document.querySelectorAll(".dot").forEach((d) => {
      d.classList.toggle("active", Number(d.dataset.dot) === index);
    });
    window.scrollTo(0, 0);
    // Coming back to the incognito screen should re-check rather than show a stale answer.
    if (index === 2) checkIncognito();
  }

  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.gate && !gates[btn.dataset.gate]) return;
      goToStep(Number(btn.dataset.next));
    });
  });

  // ── Step 1 gate: acknowledgement ───────────────────────────────────────────
  const ackBox = document.getElementById("ackBox");
  ackBox?.addEventListener("change", () => {
    gates.ack = ackBox.checked;
    refreshGates();
  });

  // ── Sensitivity picker ─────────────────────────────────────────────────────
  const sensChips = document.getElementById("sensChips");

  const sensHint = document.getElementById("sensHint");

  Object.entries(SENSITIVITY_PROFILES).forEach(([key, profile]) => {
    const btn = document.createElement("button");
    btn.className = "chip wide";
    btn.dataset.sens = key;

    const title = document.createElement("span");
    title.className = "chip-title";
    title.textContent = profile.label;

    const sub = document.createElement("span");
    sub.className = "chip-sub";
    sub.textContent = profile.blurb;

    btn.append(title, sub);
    btn.addEventListener("click", () => {
      selectedSensitivity = key;
      sensChips.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      if (sensHint) {
        sensHint.textContent = key === "lenient"
          ? "Lenient also turns image scanning off — only unmistakable content blocks."
          : profile.blurb;
      }
      satisfy("sens");
    });
    sensChips.appendChild(btn);
  });

  // ── Step 3 gate: incognito access ──────────────────────────────────────────
  //
  // Chrome ships every extension disabled in incognito, which is exactly the window
  // where a user most wants this on. The permission cannot be requested from code —
  // only the user can grant it on the extension's own settings page — so the honest
  // thing is to send them there and then verify the result rather than assume it.
  const incognitoStatus = document.getElementById("incognitoStatus");
  const incognitoStatusText = document.getElementById("incognitoStatusText");
  let incognitoPoll = null;

  function setIncognitoState(state, text) {
    if (incognitoStatus) incognitoStatus.dataset.state = state;
    if (incognitoStatusText) incognitoStatusText.textContent = text;
  }

  function checkIncognito() {
    // isAllowedIncognitoAccess is the only way to read this, and it is unavailable in
    // some contexts. Treat absence as "cannot verify" rather than as a failure.
    if (!chrome.extension?.isAllowedIncognitoAccess) {
      setIncognitoState("unknown", "Can't verify this automatically — check it yourself on the settings page.");
      satisfy("incognito");
      return;
    }
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      if (allowed) {
        setIncognitoState("ok", "Allowed in incognito. Protection follows you there.");
        satisfy("incognito");
        if (incognitoPoll) { clearInterval(incognitoPoll); incognitoPoll = null; }
      } else {
        setIncognitoState("pending", "Not allowed in incognito yet.");
      }
    });
  }

  document.getElementById("openSettingsBtn")?.addEventListener("click", () => {
    // A page cannot navigate itself to chrome://extensions, but an extension may open it
    // in a new tab. Passing the id lands the user on this extension's own row.
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    // The toggle is flipped in that other tab, so poll until we see it or the user
    // comes back and presses Check again.
    if (!incognitoPoll) incognitoPoll = setInterval(checkIncognito, 1500);
  });

  document.getElementById("recheckBtn")?.addEventListener("click", checkIncognito);

  document.getElementById("skipIncognito")?.addEventListener("click", () => {
    setIncognitoState("skipped", "Skipped. Incognito windows will have no protection.");
    satisfy("incognito");
    if (incognitoPoll) { clearInterval(incognitoPoll); incognitoPoll = null; }
  });

  // Stop polling if the tab is hidden; nothing can change while it is not being watched.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkIncognito();
  });

  // ── Hours estimate ─────────────────────────────────────────────────────────
  const chips = document.querySelectorAll("#chips .chip");
  const doneBtn = document.getElementById("doneBtn");
  const goalPreview = document.getElementById("goalPreview");

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      selectedHours = parseFloat(chip.dataset.hours);
      doneBtn.disabled = false;
      if (goalPreview) goalPreview.style.opacity = "1";
    });
  });

  doneBtn?.addEventListener("click", async () => {
    if (!selectedHours) return;
    await storageSet({
      selfEstimateHours: selectedHours,
      goalMinutes: computeInitialGoal(selectedHours),
      // Falls back only if the picker somehow never ran; the gate normally guarantees it.
      sensitivity: selectedSensitivity || DEFAULT_SENSITIVITY,
      onboardingCompleted: true,
    });
    window.close();
  });

  // ── Restore a backup ───────────────────────────────────────────────────────
  // Reinstalls are the normal way back in — export/import is the continuity story, so
  // it belongs on the first screen rather than buried in a settings tab.
  const importFile = document.getElementById("importFile");

  document.getElementById("importLink")?.addEventListener("click", () => importFile?.click());

  importFile?.addEventListener("change", (e) => {
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

  refreshGates();
  checkIncognito();
});
