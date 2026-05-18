document.addEventListener("DOMContentLoaded", () => {
  const chips = document.querySelectorAll(".chip");
  const doneBtn = document.getElementById("doneBtn");
  let selectedHours = null;

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      selectedHours = parseFloat(chip.dataset.hours);
      doneBtn.disabled = false;
    });
  });

  doneBtn.addEventListener("click", () => {
    if (!selectedHours) return;

    const goalMinutes = computeInitialGoal(selectedHours);

    chrome.storage.local.set(
      {
        selfEstimateHours: selectedHours,
        goalMinutes,
        onboardingCompleted: true,
      },
      () => {
        window.close();
      },
    );
  });

  function computeInitialGoal(hours) {
    const raw = Math.round(hours * 60 * 0.7);
    return Math.min(240, Math.max(60, raw));
  }
});
