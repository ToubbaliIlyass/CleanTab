document.addEventListener("DOMContentLoaded", () => {
  const chips = document.querySelectorAll(".chip");
  const doneBtn = document.getElementById("doneBtn");
  const goalPreview = document.getElementById("goalPreview");
  const goalVal = document.getElementById("goalVal");
  let selectedHours = null;

  function computeGoal(hours) {
    return Math.min(240, Math.max(60, Math.round(hours * 60 * 0.7)));
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      selectedHours = parseFloat(chip.dataset.hours);
      doneBtn.disabled = false;

      // Show goal preview
      const goal = computeGoal(selectedHours);
      if (goalVal) goalVal.textContent = goal;
      if (goalPreview) goalPreview.style.opacity = "1";
    });
  });

  doneBtn.addEventListener("click", () => {
    if (!selectedHours) return;
    const goalMinutes = computeGoal(selectedHours);
    chrome.storage.local.set(
      { selfEstimateHours: selectedHours, goalMinutes, onboardingCompleted: true },
      () => window.close()
    );
  });
});
